"""Strict transport and immutable-input validation; no persistence authority."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
import json
import math
import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError, model_validator

from . import ALGORITHM_VERSION

MAX_REQUEST_BYTES = 8 * 1024 * 1024
Digest = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
Identity = Annotated[str, Field(pattern=r"^[\x21-\x7e]{1,256}$")]
Number = Annotated[FiniteFloat, Field(strict=True)]


class ProtocolError(ValueError):
    """A safe error code; never embed scientific observations in the message."""

    def __init__(self, code: str, message: str = "Scientific protocol validation failed"):
        self.code = code
        super().__init__(message)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, serialize_by_alias=True, validate_by_alias=True, validate_by_name=False)


def _date_valid(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value, flags=re.ASCII):
        return False
    year, month, day = map(int, value.split("-"))
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return 1 <= year <= 9999 and 1 <= month <= 12 and 1 <= day <= days[month - 1]


def strict_timestamp(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value, re.ASCII):
        return False
    return _date_valid(value[:10]) and int(value[11:13]) < 24 and int(value[14:16]) < 60 and int(value[17:19]) < 60


def _json_values(value: Any, *, forbid_negative_zero: bool = False) -> None:
    if isinstance(value, str):
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("Invalid Unicode")
    elif value is None or isinstance(value, bool):
        return
    elif isinstance(value, (int, float)):
        try:
            finite = math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            raise ValueError("Non-finite JSON number")
        if forbid_negative_zero and value == 0 and math.copysign(1, value) < 0:
            raise ValueError("Negative zero metadata")
    elif isinstance(value, list):
        for item in value:
            _json_values(item, forbid_negative_zero=forbid_negative_zero)
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("Invalid JSON key")
            _json_values(key)
            _json_values(item, forbid_negative_zero=forbid_negative_zero)
    else:
        raise ValueError("Unsupported JSON value")


def strict_json_loads(raw: str | bytes) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def constant(_: str) -> None:
        raise ValueError("Non-finite JSON constant")

    try:
        text = raw.decode("utf-8", errors="strict") if isinstance(raw, bytes) else raw
        if text.startswith("\ufeff"):
            raise ValueError("Unexpected BOM")
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
        _json_values(value)
        return value
    except (ValueError, UnicodeError, RecursionError, OverflowError) as error:
        raise ProtocolError("INVALID_ENVELOPE") from error


class RecordSnapshot(StrictModel):
    id: Identity
    student_name: str
    class_name: str
    group_name: str
    nh4cl_concentration: Number
    peel_mass: Annotated[Number, Field(gt=0, le=1000)]
    oil_mass: Annotated[Number, Field(ge=0, le=20)]
    distillation_time: Annotated[Number, Field(gt=0, le=1440)]
    phase_clarity_score: Annotated[Number, Field(ge=1, le=5)]
    emulsification_level: str
    emulsion_concentration: Annotated[Number, Field(ge=0, le=100)]
    ecoli_observation_group: str
    inhibition_zone_diameter: Annotated[Number, Field(ge=0, le=60)]
    colony_growth_score: Annotated[Number, Field(ge=1, le=5)]
    anomaly_flag: bool = Field(alias="异常标记")
    error_source: str
    note: str
    class_id: Identity
    status: Literal["active", "deleted"]
    yield_percent: Annotated[Number, Field(ge=0)]
    created_at: str
    updated_at: str
    created_by: str
    review_status: Literal["normal", "review", "included", "excluded"]
    review_note: str
    reviewed_at: str
    reviewed_by: str
    synced_from_offline: bool
    ai_diagnosis: str
    measurement_method: Literal["not_recorded", "not_recorded_legacy", "manual_direct", "manual_local_image_calibrated"]
    metadata: dict[str, Any]
    client_submission_id: Identity | None = None
    created_by_user_id: Identity | None = None
    group_id: Identity | None = None
    experiment_type: str | None = None
    effective_review_id: Identity | None = None
    experiment_date: str | None = None
    petri_diameter_mm: Annotated[Number, Field(gt=0, le=500)] | None = None

    @model_validator(mode="before")
    @classmethod
    def omitted_optionals(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for name in ("client_submission_id", "created_by_user_id", "group_id", "experiment_type", "effective_review_id", "experiment_date", "petri_diameter_mm"):
                if name in value and value[name] is None:
                    raise ValueError("Optional snapshot fields must be omitted")
        return value

    @model_validator(mode="after")
    def validate_science(self) -> RecordSnapshot:
        if self.nh4cl_concentration not in (0, 1, 3, 4):
            raise ValueError("Unsupported concentration")
        for field in ("student_name", "class_name", "emulsification_level", "ecoli_observation_group", "created_by"):
            # Match the Node boundary's union of Python and ECMAScript blank
            # characters without normalizing the immutable snapshot value.
            if not getattr(self, field).replace("\ufeff", "").strip():
                raise ValueError("Missing required text")
        if len(self.student_name.encode("utf-16-le")) // 2 > 40 or len(self.class_name.encode("utf-16-le")) // 2 > 80:
            raise ValueError("Text too long")
        if not strict_timestamp(self.created_at) or not strict_timestamp(self.updated_at) or self.updated_at < self.created_at:
            raise ValueError("Invalid lifecycle timestamp")
        if self.reviewed_at and not strict_timestamp(self.reviewed_at):
            raise ValueError("Invalid review timestamp")
        if self.experiment_date is not None and not _date_valid(self.experiment_date):
            raise ValueError("Invalid experiment date")
        if self.measurement_method == "manual_local_image_calibrated" and self.petri_diameter_mm is None:
            raise ValueError("Calibration diameter is required")
        derived = (self.oil_mass / self.peel_mass) * 100
        if not math.isfinite(derived):
            raise ValueError("Non-finite derived yield")
        if derived < 1e21:
            with localcontext() as context:
                context.prec = 400
                canonical = float(Decimal.from_float(derived).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        else:
            canonical = derived  # ECMAScript toFixed uses number serialization at >= 1e21.
        if abs(self.yield_percent - canonical) > 0.000001:
            raise ValueError("Noncanonical yield")
        _json_values(self.metadata, forbid_negative_zero=True)
        return self


class ReviewSnapshot(StrictModel):
    id: Identity
    record_id: Identity
    reviewer_user_id: Identity | None = None
    status: Literal["review", "included", "excluded"]
    note: str
    reviewed_by: str
    reviewed_at: str
    created_at: str
    provenance_kind: Literal["human", "legacy_projection"]
    event_sequence: Annotated[int, Field(gt=0)] | None = None

    @model_validator(mode="before")
    @classmethod
    def omitted_optionals(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(name in value and value[name] is None for name in ("reviewer_user_id", "event_sequence")):
            raise ValueError("Optional review fields must be omitted")
        return value

    @model_validator(mode="after")
    def chronology(self) -> ReviewSnapshot:
        if not strict_timestamp(self.created_at) or not strict_timestamp(self.reviewed_at) or self.reviewed_at < self.created_at:
            raise ValueError("Invalid review chronology")
        return self


class ScientificInput(StrictModel):
    schema_name: Literal["echoclass.scientific-input.v1"] = Field(alias="schema")
    snapshot_schema: Literal["echoclass.analysis-input.v1"]
    record_snapshot: RecordSnapshot
    review_snapshot: ReviewSnapshot | None
    review_binding_mode: Literal["effective", "none"]
    review_omission_reason: None

    @model_validator(mode="after")
    def binding(self) -> ScientificInput:
        record, review = self.record_snapshot, self.review_snapshot
        if record.status != "active":
            raise ValueError("Scientific input was not active at selection")
        if self.review_binding_mode == "none":
            if review is not None or record.effective_review_id is not None or record.review_status in ("included", "excluded") or record.review_note or record.reviewed_by or record.reviewed_at:
                raise ValueError("Contradictory unreviewed input")
        else:
            if review is None or review.record_id != record.id or review.id != record.effective_review_id:
                raise ValueError("Review binding mismatch")
            if (review.status, review.note, review.reviewed_by, review.reviewed_at) != (record.review_status, record.review_note, record.reviewed_by, record.reviewed_at):
                raise ValueError("Review projection mismatch")
            if review.created_at < record.created_at or review.reviewed_at > record.updated_at:
                raise ValueError("Review outside record lifecycle")
        return self


SETTINGS_WITHOUT_SEED: dict[str, Any] = {
    "schema": "echoclass.scientific-configuration.v1",
    "selection_policy": "approved_only.v1",
    "metric": "yield_percent",
    "group_by": "nh4cl_concentration",
    "concentrations": [0, 1, 3, 4],
    "quantile_method": "linear",
    "sd_ddof": 1,
    "iqr_multiplier": 1.5,
    "iqr_min_n": 4,
    "bootstrap_method": "percentile",
    "bootstrap_confidence_level": 0.95,
    "bootstrap_resamples": 10000,
    "bootstrap_batch_size": 256,
    "resampling_unit": "record_assumed_independent",
    "rng": "PCG64",
    "regression": "quadratic_group_means_equal_weight",
    "numerical_policy": "float64_scaled.v1",
}


class Configuration(StrictModel):
    schema_name: Literal["echoclass.scientific-configuration.v1"] = Field(alias="schema")
    selection_policy: Literal["approved_only.v1"]
    metric: Literal["yield_percent"]
    group_by: Literal["nh4cl_concentration"]
    concentrations: list[Number]
    quantile_method: Literal["linear"]
    sd_ddof: Literal[1]
    iqr_multiplier: Literal[1.5]
    iqr_min_n: Literal[4]
    bootstrap_method: Literal["percentile"]
    bootstrap_confidence_level: Literal[0.95]
    bootstrap_resamples: Literal[10000]
    bootstrap_batch_size: Literal[256]
    resampling_unit: Literal["record_assumed_independent"]
    rng: Literal["PCG64"]
    regression: Literal["quadratic_group_means_equal_weight"]
    numerical_policy: Literal["float64_scaled.v1"]
    seed_hex: Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]

    @model_validator(mode="before")
    @classmethod
    def exact_settings(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("Invalid settings")
        for key, expected in SETTINGS_WITHOUT_SEED.items():
            observed = value.get(key)
            if observed != expected or (isinstance(expected, (int, float)) and isinstance(observed, bool)):
                raise ValueError("Unsupported settings")
        return value


class DatasetEntry(StrictModel):
    ordinal: Annotated[int, Field(ge=0)]
    record_id: Identity
    input_hash: Digest


class DatasetManifest(StrictModel):
    schema_name: Literal["echoclass.scientific-dataset.v1"] = Field(alias="schema")
    class_id: Identity
    entries: Annotated[list[DatasetEntry], Field(min_length=1, max_length=500)]


class ExecutionManifest(StrictModel):
    schema_name: Literal["echoclass.scientific-execution.v1"] = Field(alias="schema")
    dataset_hash: Digest
    configuration: Configuration
    algorithm_version: Literal["echoclass.yield-analysis.v1"]
    code_version: Digest
    node_code_version: Digest
    environment_fingerprint: Digest


class CanonicalInput(StrictModel):
    input_hash: Digest
    canonical_json: str


class AnalysisEnvelope(StrictModel):
    schema_name: Literal["echoclass.scientific-envelope.v1"] = Field(alias="schema")
    canonical_inputs: Annotated[list[CanonicalInput], Field(min_length=1, max_length=500)]
    dataset_hash: Digest
    dataset_canonical_json: str
    execution_fingerprint: Digest
    execution_canonical_json: str


@dataclass(frozen=True)
class VerifiedEnvelope:
    envelope: AnalysisEnvelope
    inputs: list[ScientificInput]
    dataset: DatasetManifest
    execution: ExecutionManifest


def digest_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def parse_envelope(raw: bytes) -> AnalysisEnvelope:
    if not isinstance(raw, bytes) or len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("INVALID_ENVELOPE")
    try:
        return AnalysisEnvelope.model_validate(strict_json_loads(raw))
    except (ValueError, TypeError, RecursionError) as error:
        raise ProtocolError("INVALID_ENVELOPE") from error


def verify_envelope(envelope: AnalysisEnvelope | dict[str, Any]) -> VerifiedEnvelope:
    try:
        if not isinstance(envelope, AnalysisEnvelope):
            _json_values(envelope)
            envelope = AnalysisEnvelope.model_validate(envelope)
        else:
            _json_values(envelope.model_dump())
        strings = [(item.canonical_json, item.input_hash) for item in envelope.canonical_inputs]
        strings.extend([(envelope.dataset_canonical_json, envelope.dataset_hash), (envelope.execution_canonical_json, envelope.execution_fingerprint)])
        if sum(len(text.encode("utf-8")) for text, _ in strings) > MAX_REQUEST_BYTES:
            raise ProtocolError("INVALID_ENVELOPE")
        # Verify all opaque strings before parsing any scientific string.
        for text, expected in strings:
            if digest_bytes(text.encode("utf-8")) != expected:
                raise ProtocolError("HASH_MISMATCH")
        try:
            inputs = [ScientificInput.model_validate(strict_json_loads(item.canonical_json)) for item in envelope.canonical_inputs]
            dataset = DatasetManifest.model_validate(strict_json_loads(envelope.dataset_canonical_json))
        except (ValidationError, ValueError) as error:
            raise ProtocolError("INVALID_INPUT") from error
        try:
            execution = ExecutionManifest.model_validate(strict_json_loads(envelope.execution_canonical_json))
        except (ValidationError, ValueError) as error:
            raise ProtocolError("INVALID_CONFIGURATION") from error
        if execution.dataset_hash != envelope.dataset_hash or len(dataset.entries) != len(inputs):
            raise ProtocolError("INVALID_INPUT")
        record_ids = [item.record_snapshot.id for item in inputs]
        if record_ids != sorted(record_ids) or len(set(record_ids)) != len(record_ids):
            raise ProtocolError("INVALID_INPUT")
        for ordinal, (entry, item, canonical) in enumerate(zip(dataset.entries, inputs, envelope.canonical_inputs, strict=True)):
            if entry.ordinal != ordinal or entry.record_id != item.record_snapshot.id or entry.input_hash != canonical.input_hash or item.record_snapshot.class_id != dataset.class_id:
                raise ProtocolError("INVALID_INPUT")
        return VerifiedEnvelope(envelope=envelope, inputs=inputs, dataset=dataset, execution=execution)
    except ProtocolError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError) as error:
        raise ProtocolError("INVALID_ENVELOPE") from error
