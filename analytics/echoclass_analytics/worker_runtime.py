"""Authenticated local transport; a request never owns the calculation slot."""

from __future__ import annotations

import asyncio
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import hmac
import json
import threading
import time
from typing import Any, Callable

from fastapi import FastAPI, Request
from starlette.responses import Response

MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_RESULT_BYTES = 2 * 1024 * 1024
CORE_ERROR_CODES = frozenset(
    {"HASH_MISMATCH", "INVALID_ENVELOPE", "INVALID_INPUT", "INVALID_CONFIGURATION"}
)


class WorkerBudgetExceeded(Exception):
    pass


class WorkerCancelled(Exception):
    pass


class WorkerIdentityMismatch(Exception):
    pass


class WorkerInvalidOutput(Exception):
    pass


@dataclass(eq=False)
class Calculation:
    cancellation: threading.Event = field(default_factory=threading.Event)
    future: Future[bytes] | None = None
    deadline: float | None = None


def encode_result(value: Any, limit: int = MAX_RESULT_BYTES) -> bytes:
    chunks: list[bytes] = []
    length = 0
    try:
        encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        for piece in encoder.iterencode(value):
            chunk = piece.encode("utf-8", errors="strict")
            length += len(chunk)
            if length > limit:
                raise WorkerInvalidOutput()
            chunks.append(chunk)
    except (TypeError, ValueError, OverflowError, UnicodeError, RecursionError) as error:
        raise WorkerInvalidOutput() from error
    return b"".join(chunks)


class CalculationRuntime:
    def __init__(
        self,
        analyze: Callable[..., dict[str, Any]],
        parse_envelope: Callable[[bytes], Any],
        verify_identity: Callable[[Any, dict[str, Any], bool], None],
        identity: dict[str, Any],
        *,
        budget_seconds: float = 30.0,
        cancellation_grace_seconds: float = 1.0,
    ) -> None:
        self.analyze = analyze
        self.parse_envelope = parse_envelope
        self.verify_identity = verify_identity
        self.identity = json.loads(encode_result(identity))
        self.budget_seconds = budget_seconds
        self.cancellation_grace_seconds = cancellation_grace_seconds
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="echoclass-analysis")
        self._lock = threading.Lock()
        self._active: Calculation | None = None
        self._closing = False
        self._poisoned = False

    def _check_overdue(self) -> None:
        active = self._active
        if active and active.deadline is not None and time.monotonic() > active.deadline + self.cancellation_grace_seconds:
            active.cancellation.set()
            self._poisoned = True

    def health(self) -> dict[str, Any]:
        with self._lock:
            self._check_overdue()
            busy = self._active is not None
            unavailable = self._closing or self._poisoned
            return {
                "ready": not busy and not unavailable,
                "busy": busy,
                "status": "unavailable" if unavailable else ("busy" if busy else "ready"),
                "identity": self.identity,
            }

    def reserve(self) -> Calculation | None:
        with self._lock:
            self._check_overdue()
            if self._active is not None or self._closing or self._poisoned:
                return None
            self._active = Calculation()
            return self._active

    def release_unstarted(self, calculation: Calculation) -> None:
        with self._lock:
            if self._active is calculation and calculation.future is None:
                self._active = None

    def submit(self, calculation: Calculation, raw: bytes, comparison: bool) -> Future[bytes]:
        def execute() -> bytes:
            def check_budget() -> None:
                if calculation.cancellation.is_set():
                    raise WorkerCancelled()
                if calculation.deadline is not None and time.monotonic() >= calculation.deadline:
                    raise WorkerBudgetExceeded()

            check_budget()
            envelope = self.parse_envelope(raw)
            check_budget()
            self.verify_identity(envelope, self.identity, comparison)
            check_budget()
            result = self.analyze(envelope, check_budget=check_budget)
            check_budget()
            if not isinstance(result, dict):
                raise WorkerInvalidOutput()
            output = encode_result({"result": result, "identity": self.identity})
            check_budget()
            return output

        with self._lock:
            if self._active is not calculation or self._closing or calculation.future is not None:
                raise RuntimeError("Worker unavailable")
            calculation.deadline = time.monotonic() + self.budget_seconds
            future = self._executor.submit(execute)
            calculation.future = future

        def finished(completed: Future[bytes]) -> None:
            # This is the real executor Future, not an asyncio wrapper that an
            # HTTP cancellation can finish while its underlying thread runs.
            if not completed.cancelled():
                completed.exception()
            with self._lock:
                if self._active is calculation:
                    self._check_overdue()
                    self._active = None

        future.add_done_callback(finished)
        return future

    def close(self) -> None:
        with self._lock:
            self._closing = True
            if self._active:
                self._active.cancellation.set()
        self._executor.shutdown(wait=False, cancel_futures=True)


def response(code: str, status: int) -> Response:
    return Response(
        encode_result({"error": {"code": code}}),
        status_code=status,
        media_type="application/json",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


def create_app(
    *,
    analyze: Callable[..., dict[str, Any]],
    parse_envelope: Callable[[bytes], Any],
    verify_identity: Callable[[Any, dict[str, Any], bool], None],
    identity: dict[str, Any],
    token: str,
    protocol_error_types: tuple[type[Exception], ...] = (),
    budget_seconds: float = 30.0,
    cancellation_grace_seconds: float = 1.0,
    body_timeout_seconds: float = 5.0,
) -> FastAPI:
    if not token.isascii() or not 32 <= len(token) <= 256:
        raise ValueError("Invalid worker credential")
    if not 0 < budget_seconds <= 30 or not 0 < cancellation_grace_seconds <= 1:
        raise ValueError("Invalid worker budget")
    runtime = CalculationRuntime(
        analyze, parse_envelope, verify_identity, identity,
        budget_seconds=budget_seconds,
        cancellation_grace_seconds=cancellation_grace_seconds,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            runtime.close()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.runtime = runtime

    def authorized(request: Request) -> bool:
        values = [value for name, value in request.scope["headers"] if name == b"authorization"]
        return len(values) == 1 and hmac.compare_digest(values[0], ("Bearer " + token).encode("ascii"))

    @app.get("/health")
    async def health(request: Request) -> Response:
        if not authorized(request):
            return response("WORKER_UNAUTHORIZED", 401)
        if request.scope["query_string"]:
            return response("WORKER_INVALID_REQUEST", 400)
        return Response(encode_result(runtime.health()), media_type="application/json", headers={"Cache-Control": "no-store"})

    @app.post("/v1/analyze")
    async def analyze_request(request: Request) -> Response:
        if not authorized(request):
            return response("WORKER_UNAUTHORIZED", 401)
        headers: dict[bytes, list[bytes]] = {}
        for key, value in request.scope["headers"]:
            headers.setdefault(key, []).append(value)
        if (
            request.scope["query_string"]
            or headers.get(b"content-type") != [b"application/json"]
            or b"content-encoding" in headers
            or len(headers.get(b"content-length", [])) > 1
            or headers.get(b"x-echoclass-comparison-mode", []) not in ([], [b"numerical"])
        ):
            return response("WORKER_INVALID_REQUEST", 400)
        expected_length: int | None = None
        if b"content-length" in headers:
            length = headers[b"content-length"][0]
            if not length.isdigit() or len(length) > 10:
                return response("WORKER_INVALID_REQUEST", 400)
            expected_length = int(length)
            if expected_length > MAX_REQUEST_BYTES:
                return response("WORKER_REQUEST_TOO_LARGE", 413)
        calculation = runtime.reserve()
        if calculation is None:
            code = "WORKER_UNAVAILABLE" if runtime.health()["status"] == "unavailable" else "WORKER_BUSY"
            return response(code, 503)
        disconnected: asyncio.Task[None] | None = None
        try:
            async def read_body() -> bytes:
                chunks: list[bytes] = []
                total = 0
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > MAX_REQUEST_BYTES:
                        raise OverflowError()
                    chunks.append(chunk)
                if expected_length is not None and expected_length != total:
                    raise ValueError()
                return b"".join(chunks)

            try:
                raw = await asyncio.wait_for(read_body(), timeout=body_timeout_seconds)
            except OverflowError:
                return response("WORKER_REQUEST_TOO_LARGE", 413)
            except asyncio.TimeoutError:
                return response("WORKER_BODY_TIMEOUT", 408)
            except Exception:
                return response("WORKER_INVALID_REQUEST", 400)

            comparison = b"x-echoclass-comparison-mode" in headers
            future = runtime.submit(calculation, raw, comparison)

            async def watch_disconnect() -> None:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        calculation.cancellation.set()
                        return

            disconnected = asyncio.create_task(watch_disconnect())
            wrapped = asyncio.wrap_future(future)
            wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            try:
                remaining = max(0.0, (calculation.deadline or time.monotonic()) - time.monotonic())
                output = await asyncio.wait_for(asyncio.shield(wrapped), timeout=remaining)
            except asyncio.TimeoutError:
                calculation.cancellation.set()
                try:
                    await asyncio.wait_for(asyncio.shield(wrapped), timeout=cancellation_grace_seconds)
                except Exception:
                    pass
                # Keep the slot if the computation ignored its cancellation.
                runtime.health()
                return response("WORKER_TIMEOUT", 504)
            except WorkerBudgetExceeded:
                return response("WORKER_TIMEOUT", 504)
            except WorkerCancelled:
                return response("WORKER_CANCELLED", 499)
            except WorkerIdentityMismatch:
                return response("WORKER_IDENTITY_MISMATCH", 409)
            except WorkerInvalidOutput:
                return response("WORKER_INVALID_OUTPUT", 500)
            except protocol_error_types as error:
                code = getattr(error, "code", "INVALID_ENVELOPE")
                return response(code if code in CORE_ERROR_CODES else "INVALID_ENVELOPE", 400)
            except Exception:
                return response("WORKER_EXECUTION_FAILED", 500)
            result_headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
            if comparison:
                result_headers["X-EchoClass-Environment-Comparison"] = "numerical"
            return Response(output, media_type="application/json", headers=result_headers)
        except asyncio.CancelledError:
            calculation.cancellation.set()
            raise
        finally:
            if disconnected is not None:
                disconnected.cancel()
            runtime.release_unstarted(calculation)

    return app
