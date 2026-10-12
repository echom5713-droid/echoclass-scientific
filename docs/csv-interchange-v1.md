# CSV interchange v1

Milestone 2B.1 / application `3.0.0-beta.13` / SQLite schema 14.

The `/csv` page provides a fixed template, existing-class selection, whole-file preview, atomic import, retryable receipt and spreadsheet export. Only active teachers/admins with a current valid session may use it. Students, disabled users and demo accounts cannot perform real CSV work. SQLite is required; JSON compatibility mode returns 503.

## Input contract

`X-EchoClass-Csv-Schema: echoclass.csv.experiment.v1` is mandatory on both POSTs. The body is raw UTF-8 CSV, not JSON, multipart, base64 or a filename. `Content-Type` must be `text/csv`, with optional UTF-8 charset. Content encoding must be absent or identity. No client role, class name, record ID, creator, timestamps, yield, review, metadata or provenance columns are accepted.

The exact ordered headers below are case-sensitive. There are no aliases, implicit trimming, reordered columns or ignored extra columns. Class identity comes from the single external `class_id` query parameter.

| Header                      | Domain field / unit           | Required value                                                                     |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| student_name                | student_name                  | Nonblank observation label, at most 40 UTF-16 code units; never an account lookup. |
| group_name                  | group_name                    | Empty allowed; otherwise nonblank, at most 80. Resolved within this class only.    |
| nh4cl_concentration_pct     | nh4cl_concentration / %       | Exactly 0, 1, 3 or 4.                                                              |
| peel_mass_g                 | peel_mass / g                 | Greater than 0, at most 1000.                                                      |
| oil_mass_g                  | oil_mass / g                  | 0–20 inclusive.                                                                    |
| distillation_time_min       | distillation_time / min       | Greater than 0, at most 1440.                                                      |
| phase_clarity_score         | phase_clarity_score           | 1–5 inclusive, including valid fractional scores.                                  |
| emulsification_level        | emulsification_level          | Nonblank text, at most 80.                                                         |
| emulsion_concentration_pct  | emulsion_concentration / %    | 0–100 inclusive, not a 0–1 fraction convention.                                    |
| ecoli_observation_group     | ecoli_observation_group       | Nonblank text, at most 80.                                                         |
| inhibition_zone_diameter_mm | inhibition_zone_diameter / mm | 0–60 inclusive; zero must be an explicitly recorded observation.                   |
| colony_growth_score         | colony_growth_score           | 1–5 inclusive.                                                                     |
| anomaly_flag                | 异常标记                      | Only lowercase `true` or `false`.                                                  |
| error_source                | error_source                  | Empty allowed; at most 500.                                                        |
| note                        | note                          | Empty allowed; at most 2000; quoted commas, double quotes and newlines preserved.  |
| experiment_date             | experiment_date               | Empty or a real calendar date, exactly YYYY-MM-DD.                                 |
| petri_diameter_mm           | petri_diameter_mm / mm        | Empty or greater than 0 and at most 500.                                           |
| measurement_method          | measurement_method            | Only `not_recorded` or `manual_direct`.                                            |

Numbers must match `^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$`, with at most 64 characters, before finite-number and domain range checks. Empty/whitespace numbers, NaN, infinity, hex, trailing units, thousands separators and truncated prefixes are rejected. No missing observation is imputed. All cells reject NUL. Unicode whitespace checks reuse the existing domain contract; text is not case-folded or normalized. CSV mapping always invokes `validateExperiment`.

CSV import does not accept `not_recorded_legacy` or `manual_local_image_calibrated`. It cannot attest browser image calibration. The existing assisted-measurement workflow remains the way to submit such new measurements; export can display existing methods.

Finite inputs must also produce a finite `(oil_mass / peel_mass) * 100` result. A combination such as `1e-308` g peel and `1` g oil is rejected at the mass column before any write. This adds no invented scientific minimum mass. Migration 014 also guards SQL insertion/correction and refuses to upgrade existing nonfinite yields; verified source values must be used through the existing correction path before retrying that migration. Original submitted snapshots remain unchanged.

## Parsing and budgets

The locked dependencies are csv-parse 7.0.2 and csv-stringify 6.8.3. Fatal UTF-8 decoding rejects malformed bytes; there is no encoding guessing. One initial UTF-8 BOM is allowed and removed in the parsing view only. A double BOM fails the header check. ASCII-compatible bytes cannot reveal which editor encoding originally produced them.

Comma delimiter, double-quoted fields and doubled quote escapes are supported. Record separators are LF or CRLF with an optional final separator; quoted multiline text is retained. Parsing does not skip empty/bad records, relax quotes/widths, trim fields or auto-cast values. Errors use **logical data row 1..N**, excluding the header; quoted multiline records are not physical line numbers.

| Budget                | Limit                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Raw request body      | 1,048,576 bytes, counted incrementally, including BOM; chunked requests are also bounded.                |
| Data records          | 1–500; exceeding this rejects the entire file.                                                           |
| Parser record buffer  | `max_record_size=16384`, the library's field/line buffer character accounting, separate from wire bytes. |
| Displayed preview     | First 20 records; all records are validated.                                                             |
| Displayed row errors  | First 100 distinct row/field errors; total count and truncation indicator accompany preview.             |
| Body receive deadline | 15 seconds.                                                                                              |
| CSV operations        | 10 per actor per 60 seconds combined; class listing/template/page excluded.                              |
| Export                | 5000 active records and 5,242,880 final encoded bytes.                                                   |

The downloadable template contains headers only. `tests/fixtures/csv-v1-synthetic.csv` is explicitly synthetic test material, not observed science and not the historical sample CSV schema. Never submit it to a real classroom dataset as measured results.

## HTTP contract

| Endpoint                         | Response                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/csv/classes             | Current user ID and authorized existing class IDs/names.                                                                            |
| GET /api/csv/template            | Header-only `echoclass-experiment-template-v1.csv`, input schema header.                                                            |
| POST /api/csv/preview?class_id=… | 200 `ok:true`, valid flag, raw hash/byte count, row count, preview, errors, error_count and errors_truncated; zero business writes. |
| POST /api/csv/import?class_id=…  | 201 for new completion, 200 for replay; immutable receipt plus replayed and added_this_request.                                     |
| GET /api/csv/imports/{batch_id}  | Authorized original batch facts and ordered row-to-record IDs, without scientific values.                                           |
| GET /api/csv/export?class_id=…   | Fixed spreadsheet export or whole-request failure.                                                                                  |

Import additionally requires `X-EchoClass-Client-Import-Id` matching `[A-Za-z0-9_-]{16,128}` and `X-EchoClass-Expected-SHA256` containing 64 lowercase hex digits. Headers and query parameters cannot repeat; unknown query switches such as raw/canonical modes, role or filename are rejected. Unsupported methods return 405. Existing origin protection and security headers apply. Responses are no-store, downloads have fixed ASCII filenames, and no permissive CORS is added.

Errors retain `{ok:false,error:{code,message,fields},request_id}`. CSV fields include `{row_number:number|null,field,code,message}`; file errors use null. Malformed CSV/envelopes return 400; domain-invalid import returns 422 `VALIDATION_ERROR` with capped row errors and the total in its message; resource limits return 413. Authorization is 401/403, missing entities 404, conflicts 409, rate limit 429, storage unavailability/busy writes 503 `STORAGE_UNAVAILABLE`. Unknown internal failures remain generic 500; CSV rows, SQL and paths are not logged in errors.

## Atomicity, provenance and retry

The browser submits the same cached ArrayBuffer to preview and import. SHA-256 is recomputed over received bytes including BOM, quote spelling, spaces and line endings. Expected-SHA disagreement returns 409 with field code `PREVIEW_BYTES_CHANGED`. A hash is neither a signature nor proof of a prior preview: direct clients can compute it, but must pass all server validation.

The durable unique namespace is `(uploader_user_id,class_id,client_import_id)`. Same namespace and same bytes/schema returns the original IDs with zero additions. A different fingerprint returns `IDEMPOTENCY_CONFLICT`. Same file with a new token is an intentional independent import, including identical observations on different rows. Same token for another authorized user or class is a separate namespace.

The UI stores only user ID, stable class ID, schema, SHA and token in sessionStorage; no source bytes or preview rows are stored there. A separate entry for each user/class/schema/SHA combination survives previewing another file. A reload requires reselecting the same file and previewing it; matching facts restore the token. Matching old v1 entries are copied without removing unrelated attempts. Storage must be readable and successfully written before submission; damaged or mismatched entries do not silently mint a token. No automatic eviction occurs. Explicitly starting another import requires acknowledging possible duplicate observations and replaces only the selected combination. Browser session storage is not permanent recovery across cleared storage, devices or sessions. Repeated clicks are serialized, and file/class changes invalidate the ready state. Preview and error text use textContent.

Each new batch runs one synchronous `BEGIN IMMEDIATE`: re-read current session/user/class and existing winner; read one active cohort by stable class ID; create canonical records and class-local groups; insert deferred row mappings; insert the complete batch; write one `records.csv_import` audit; COMMIT. No await, file/network call, per-row audit or single-record service loop occurs inside it. Any failure including COMMIT rolls back; a token whose attempt rolled back can retry.

All rows use the same pre-import class cohort for existing deterministic diagnostics. Other classes and earlier rows of this same CSV do not enter that cohort. `diagnostics_policy=pre_import_class_cohort.v1` and app version document this policy, not a saved cohort snapshot. Initial review projection is `normal` or `review`; no human review, included/excluded decision or analysis snapshot is created. Canonical creator, ID, time, yield and immutable submitted_json are server-owned; offline and storage-import identities remain null.

Migration 013 adds two STRICT tables. `csv_import_rows` has a deferred batch FK, unique record ID and batch/row key. Only a complete contiguous set 1..row_count can seal `csv_import_batches`; the seal checks canonical online active records belonging to the original uploader/class, including original submitted class labels. No seal means COMMIT fails. After sealing, append, update, delete and replacement are blocked. Ownership guards apply at initial seal; legitimate record correction, reclassification and soft deletion remain possible.

Receipt lookup includes archived records and never recreates them. Original teachers must still own the receipt and be authorized for the original class and each mapped record's current class. A moved record outside scope yields `BATCH_SCOPE_CHANGED` without mapping details. Admins use current cross-class authority. Session expiry, revocation, demotion and disabled status receive no replay exemption. Class renaming does not rewrite original receipt snapshots or stable IDs.

## Spreadsheet export

Schema `echoclass.csv.experiment-export.v1`, filename `echoclass-experiments-spreadsheet-v1.csv`. Columns are:

1. record_id, class_id, class_name, group_id.
2. All 18 input headers in the exact table order, representing current persisted fields.
3. yield_percent, status, review_status, effective_review_id, created_by_user_id, created_by, created_at, updated_at, submission_kind, csv_import_batch_id, csv_source_row.

CSV links come from the two new tables; non-CSV records have empty links. A single authorized read transaction selects only the target class's active records, with bounded row count and a fixed scalar projection, ordered by record ID using SQLite BINARY ordering. It does not materialize metadata/submitted JSON to export. There is no export timestamp or request-dependent content. Dates/timestamps are stored ISO text; booleans are true/false, absent values empty, numbers use finite JavaScript number representation without new rounding or units. Output is UTF-8 with exactly one BOM, fully quoted cells, doubled quotes, CRLF separators and final CRLF. Final byte and row limits are checked before download headers or body are sent.

All text columns share display protection: initial C0/C1 controls trigger protection; detection also skips leading Unicode whitespace, formatting characters, controls, FEFF and apostrophes before checking ASCII/fullwidth = + - @. A dangerous logical cell gets a visible `text:` prefix **before** CSV quoting. Stored data is never rewritten; numeric and boolean fields retain their types. This chosen display strategy changes representation and is not a certification for every spreadsheet, resave operation or manually removed prefix. No Excel/LibreOffice verification is claimed.

## Evidence boundaries and later stages

The service binds received bytes to a hash; the repository maps newly created IDs; SQL enforces relationship, count and seal invariants. Without storing raw bytes, SQL cannot prove their digest or scientific truth against arbitrary database-administrator fabrication. Raw source files are not retained and cannot be downloaded. Keep originals separately if needed.

This display export is not an input template, backup, original restoration or authoritative Python analysis input. Milestone 3 still uses sealed analysis input v1 with review binding. Future 2B.2 evidence can link stable batch IDs; a later re-upload may prove a hash match at its actual reception time, never retroactively claim historical file custody. No evidence storage or LLM parsing/quality/transaction decision is implemented here.
