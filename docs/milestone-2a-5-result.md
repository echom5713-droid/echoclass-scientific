# Milestone 2A.5 Result

## Status

PASS locally at `3.0.0-beta.6`. Milestone 2B has not started. Exact-commit private CI evidence is reported after the single corrective commit is pushed and observed.

## Initial red phase

The new executable `analysis-run-integrity` suite first ran against the beta.5 implementation with 14 tests, 0 passing and 14 failing. Its grouped cases reproduced all mandatory audit scenarios: caller-owned run status/time, invalid or empty identities, backdated review binding, invalid run states/timestamps, terminal regression, creator mutation, malformed/array JSON fallback, required snapshot-key NULL propagation, invalid snapshot provenance, empty input hashes, internally valid forged snapshots, calendar-invalid imports, provenance-kind upgrading, invalid user timestamps and missing Migration 007 registration.

## Trusted run creation and state

`CreateAnalysisRunCommand` exposes only run ID, dataset hash, algorithm/code versions, configuration and optional creator ID. Ordinary creation validates bounded identities and a real creator reference, ignores additional caller status/result/time properties at runtime, uses an injected `Clock`, inserts `pending`, `{}` results and no completion time. State updates use the trusted clock for terminal completion and cannot regress a terminal state.

Migration 007 installs insert/update triggers requiring JSON objects, strict identities and valid state/timestamp pairs. Pending/running rows have no completion time; completed/failed rows have a completion time at or after creation. Identity, configuration, creation time and creator remain immutable. Repository reads throw `RepositoryCorruptionError` for malformed JSON or inconsistent run state.

## Selection and v1 snapshot authority

New selections must occur at or after record creation, the selected record version and the bound review event at both repository and SQLite boundaries. Effective mode binds the current latest event at insertion; immutable reads continue validating the exact stored event after future reviews.

Every required v1 numeric, boolean, string, lifecycle and provenance key has a fail-closed SQLite type/presence condition. The TypeScript validator requires strict lifecycle timestamps, non-empty optional creator/review identifiers, boolean `synced_from_offline`, and string `ai_diagnosis`. Input hashes and run/record IDs are non-empty and bounded.

At insertion, identity, scientific values, canonical yield, experiment/measurement values, lifecycle, creator, offline provenance, current review projection, AI text and metadata must agree with the durable record. Metadata is semantically compared during Migration 007 preflight and compared with the repository-produced canonical JSON representation for new SQL insertion. The equality check applies only to selection; a later durable record edit does not invalidate a stored legitimate v1 snapshot.

## Import validation

JSON startup import uses a strict calendar-valid ISO timestamp parser for records, review history/projection and users, including optional user provenance times. Invalid supplied timestamps fail atomically instead of being normalized. Missing legacy times receive the existing explicit import-time fallback metadata. Review provenance accepts only `human` and `legacy_projection`; missing legacy provenance becomes `legacy_projection`, while unknown values fail and are never upgraded to human.

## Migration 007 behavior

Migration 007 scans existing analysis runs for invalid identities, timestamps, JSON objects, creator references and status/completion contradictions. Definite failures report run IDs. It revalidates v1 inputs: empty identities are definite corruption; structurally incomplete or otherwise historically unverifiable rows become `echoclass.analysis-input.legacy`; a durable-record contradiction for a version that had not been subsequently edited fails with run/ordinal and fields. Legitimate point-in-time review bindings survive later reviews. No migration 001–006 source was modified.

## Tests and local results

- Main suite: 135/135 passing after implementation.
- New 2A.5 adversarial suite: 19/19 passing.
- Existing temporal 2A.4 suite: 15/15 passing.
- Coverage was not run and no coverage claim is made.

The remaining lint, typecheck, build, integration, smoke, security, format, architecture, diff and release checks are recorded in the final delivery report from their actual outputs.

## Remaining limitations and manual blockers

- No cross-language canonical hash contract or analysis executor is claimed.
- There is no general append-only experiment-record version history; Migration 007 truthfully downgrades history that later edits make unprovable.
- JSON compatibility mode does not claim SQLite-equivalent constraints or concurrency.
- The old DeepSeek key revocation remains an unconfirmed owner action.
- Bundled asset rights/consent and legacy deployed demo-account audit remain owner actions.
- This result does not claim public-release, production, or scientific-validation readiness.

## Suggested commit

`fix: enforce analysis selection and run integrity`
