# Scientific protocol v1

Implementation contract; acceptance is pending. All example/fixture observations are synthetic. SHA-256 values below use `sha256:` followed by 64 lowercase hexadecimal digits. Canonical strings are Node-produced RFC8785 UTF-8 JSON, without BOM/newline; Python verifies their bytes before parsing their contents. JSON duplicate keys, non-finite numbers, lone surrogates and unknown schema fields are errors. Current snapshot metadata retains its existing JSON-safe contract.

## Request and identity

`analyze(envelope, check_budget=None)` in `echoclass_analytics.analysis` returns the scientific result object below. `check_budget` is an optional zero-argument callback; it is called before/after every group, bootstrap batch and regression fold, and before returning. Callback exceptions propagate. `models.parse_envelope(raw: bytes)` parses bounded strict outer JSON and returns `AnalysisEnvelope`; `models.verify_envelope(envelope)` verifies hashes and returns validated input/dataset/execution models. `ProtocolError` has a safe `code` and no raw observations. The worker owns cancellation, authorization, byte limits and one actual calculation slot.

Outer request, all fields required, no extras:

```json
{
  "schema": "echoclass.scientific-envelope.v1",
  "canonical_inputs": [{ "input_hash": "sha256:...", "canonical_json": "..." }],
  "dataset_hash": "sha256:...",
  "dataset_canonical_json": "...",
  "execution_fingerprint": "sha256:...",
  "execution_canonical_json": "..."
}
```

Each input string contains exactly `{schema:"echoclass.scientific-input.v1", snapshot_schema:"echoclass.analysis-input.v1", record_snapshot:<complete current snapshot>, review_snapshot:<complete review or null>, review_binding_mode:"effective"|"none", review_omission_reason:null}`. Optional record/review fields are omitted, not replaced with null. Required record fields and domains match `analysis-snapshot-v1.ts`; complete known snapshots include metadata and provenance, not merely the two measured columns. `effective` requires one matching review projection; `none` forbids effective-review provenance. New requests capture active records only.

Dataset string: `{schema:"echoclass.scientific-dataset.v1", class_id:string, entries:[{ordinal:0,record_id:string,input_hash:string},...]}`. There are 1–500 unique records, ordered by sealed ordinal and binary record ID, with contiguous ordinals. Every input is referenced exactly once and class IDs agree.

Execution string: `{schema:"echoclass.scientific-execution.v1", dataset_hash:string, configuration:<below>, algorithm_version:"echoclass.yield-analysis.v1", code_version:string, node_code_version:string, environment_fingerprint:string}`. All three identity digests are SHA-256 values. `code_version` hashes the entire deployed Python package, including worker/runtime modules; `node_code_version` independently identifies executed Node source. Neither enters the random seed. Runtime comparison with the expected identity is the worker/Node boundary's responsibility; pure offline analysis can compute old bundles without pretending that its environment matches.

`identity.get_identity()` returns `{algorithm_version,code_version,environment_fingerprint,environment}`. `environment` includes Python implementation/version, exact numpy/pandas/scipy/statsmodels/pydantic/fastapi/uvicorn versions, platform system/release/machine, byte order, and NumPy numerical-backend configuration. Identity hashing uses a separate documented sorted-ASCII JSON encoding because its fields contain no scientific numbers; it is not a second JCS implementation. Package source digest is SHA-256 over sorted relative POSIX `*.py` paths and exact bytes, each length framed with an unsigned 8-byte big-endian length. Exclude caches and tests; do not exclude package runtime modules.

## Frozen configuration

Every field is required and fixed except the derived `seed_hex`:

```json
{
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
  "seed_hex": "32 lowercase hexadecimal characters"
}
```

`settings_without_seed` is exactly this configuration with only `seed_hex` removed. Default seed is the first 16 SHA-256 bytes of Node JCS `{schema:"echoclass.scientific-seed.v1",dataset_hash,settings_without_seed}`; encode as 32 lowercase hex characters. `SeedSequence(int(seed_hex,16)).spawn(4)` assigns PCG64 streams to 0,1,3,4 including missing groups. Within each group retain sealed ordinal order. For each of 39 full batches plus a final 16-resample batch, use `rng.integers(0,n,size=(batch_count,n),dtype=np.int64,endpoint=False)`. Take the sample mean of each resampled row, then linear 0.025/0.975 quantiles. Do not merge, split or reorder these RNG calls.

## Result

Top-level fields are exactly `{schema,dataset_hash,execution_fingerprint,algorithm_version,configuration,selection,groups,regression,best_tested,candidate,limitations}`. `schema` is `echoclass.scientific-result.v1`. The first four identity fields and configuration echo verified inputs; no run ID, current time, attempt ID or traceback occurs in scientific content. Node validates and hashes the JCS result; Python serializes with `allow_nan=False` and normalizes output negative zero to zero.

`Metric` is always `{value:number|null,reason:string|null}`; available values have null reason, unavailable values have a nonempty stable reason code. Every number is finite. `selection` is `{candidate_count,included_count,excluded_count,records:[{ordinal,record_id,review_binding_mode,review_status,included,reason}]}`. Reasons are null for approved `included`, `review_excluded` for human excluded, otherwise `not_approved`. Included records stay included despite IQR flags.

`groups` always has four ordered entries: `{concentration,n,record_ids,statistics,ci,iqr_flags}`. `statistics` contains exactly `mean,median,min,max,sd,q1,q3,iqr,mad,mad_normal`, each a Metric. `ci` is `{confidence_level:0.95,method:"percentile",resamples:10000,lower:number|null,upper:number|null,reason:string|null}`. `iqr_flags` is `{record_ids:string[],reason:string|null}`; n<4 or zero IQR makes the flag rule unavailable. For n=0, every statistic is unavailable; n=1 sample SD/CI are unavailable. Constant empirical groups have unavailable CI.

`regression` is `{available,reason,n_groups,residual_df,coefficients,rank,condition_number,saturated,training_r_squared,training_rmse,loocv}`. `coefficients` is null or `{a,b,c}` in original concentration/yield units. `rank`, `condition_number` and `residual_df` are null when no fit is possible; training metrics use Metric. `loocv` is `{available,reason,rmse,folds}` with Metric rmse and ordered fold entries `{held_out_concentration,observed_mean,predicted_mean,residual,extrapolation,vertex,vertex_reason}`. Fold outputs are in original yield units before aggregate RMSE; concentrations 0 and 4 are outside their fold's training range. No partial successful-fold average is allowed.

`best_tested` is `{concentrations:number[],mean:number|null,reason:string|null}`. Group means, ranking and ties use exact rational means of the sealed decimal yield values, preventing `[0.10,0.20]` versus `[0.15,0.15]` from producing a false unique winner or a spurious nonconstant regression response. Displayed means are converted to float64 once. Q1, median and Q3 use exact rational linear interpolation at indices `(n-1)/4`, `(n-1)/2` and `3(n-1)/4`; IQR is the exact Q3−Q1 difference. These displayed values and the observed minimum/maximum are converted to float64 once, preserving their ordering. IQR decisions compare exact decimal observations strictly against the exact `Q1-1.5×IQR` and `Q3+1.5×IQR` fences, without an epsilon: a fence equality is not a flag, while any strictly outside decimal value is. If a nonzero IQR cannot be represented as a nonzero float64, that statistic and its flag rule are `numeric_unavailable`. Other descriptive statistics and bootstrap calculations retain scaled float64.

For each full regression and leave-one-out fit, subtract the exact mean of that training set's exact group means, then divide the exact deviations by their maximum absolute value before conversion to float64. An exactly constant response instead uses zero deviations. This affine response change preserves intercept OLS while preventing a common baseline from erasing small differences. Coefficients, predictions, training residuals, R² and RMSE all derive from this same centered fit; restore the response offset and scale for original-unit outputs. R² is `constant_response` only for exactly equal rational group means; there is no near-constant tolerance or clipping of R². A nonzero response scale that rounds to zero makes the fit `numeric_unavailable`. The concavity check still uses coefficients scaled to the original maximum absolute response, including its intercept, so centering does not relax the existing roundoff margin. These implementation corrections change numerical result bytes and the package `code_version`; they do not rewrite historical results.

`candidate` is `{concentration:number|null,predicted_yield:number|null,leave_one_out_vertex_range:[number,number]|null,reason:string|null}`. It requires a numerically stable concave full fit and all four concave interior leave-one-out vertices; otherwise every candidate numeric field is null. The leave-one-out vertex range is sensitivity, not a confidence interval.

`limitations` is a stable ordered string-code list including `exploratory_analysis`, `record_independence_unverified`, `bootstrap_assumes_independent_records`, `four_concentration_model`, `candidate_requires_new_experiment`. The UI maps these and unavailable reason codes to ordinary explanatory text.

Numerical methods, scientific limitations, scope and retry/authorization behavior are specified in [milestone-3-plan.md](milestone-3-plan.md). A valid cohort with insufficient approved observations returns a complete unavailable report, not an execution failure. Hash/schema/configuration contradictions raise `ProtocolError` (`HASH_MISMATCH`, `INVALID_ENVELOPE`, `INVALID_INPUT`, or `INVALID_CONFIGURATION`). A valid but unrepresentable individual statistic uses `numeric_unavailable`; cancellation/time budget is controlled by the callback and never converted into a successful partial result.
