# Milestone 2A.2 result

## Status

Implementation and local verification: **PASS**. Public release: **BLOCKED**. Exact-commit private CI is observed after this document is committed and is reported in the delivery record and private Actions history.

## Red phase

The new closure suite first ran 22 tests with 0 passing and 22 failing. The new HTTP measurement test also failed while the other 12 integration tests passed. Final review then added six focused reproductions for split-source measurement recovery, the full raw snapshot contract, terminal analysis-state regression, coercible numeric/boolean persistence, and stale-review binding; all six failed before their fixes. In total, 29 adversarial behaviors entered a genuine failing state. Tests exercise the real service, repository, SQLite constraints, migrations, startup import, and HTTP server rather than source regex alone.

## Closure delivered

- Restored migration 002 byte-for-byte to its release at `fa0fd1bb39ec5c3d665eced16ea1b9eccfa04072`. Released migrations 001–003 are frozen by a fingerprint regression test.
- Kept strict version-2 legacy preflight outside frozen DDL and executed it inside the same `BEGIN IMMEDIATE` transaction immediately before migration 002.
- Added migration `004-end-to-end-provenance-closure` for measurement recovery, scientific guards, immutable idempotency scope, effective-review projection invariants, semantic snapshot validation, immutable original submissions, and analysis-run identity guards.
- Preserved experiment date, Petri diameter, and measurement method from HTTP through trusted application input, canonical and submitted storage, API reads, and analysis snapshots. Calibrated local-image measurement requires a valid diameter.
- Replaced broad authoritative insertion with an explicit validated persistence command. Canonical yield is recomputed; invalid/negative scientific observations and caller-forged human review projection are rejected.
- Made empty-database JSON import preflighted, all-or-nothing, count-verified, durably marked, and restart-safe. Existing SQLite content is authoritative and stale malformed JSON is not parsed. Defensible review history becomes append-only events; projection-only history is labelled `legacy_projection` without invented identity or decision time.
- Made `echoclass.analysis-input.v1` an executable record/review snapshot contract. New writes and reads validate semantic shape, ownership, IDs, measurements, lifecycle, review fields, and finite science. Incomplete historical inputs are explicitly classified as legacy rather than relabelled v1.
- Bound a reviewed record's effective review by default when creating an analysis input. Intentional omission requires an explicit mode and reason.
- Added narrowly scoped archived-record audit lookup while normal lists remain active-only and role/class authorization remains enforced.
- Added explicit analysis-run state/result updates while database triggers freeze identity and configuration fields.

## Accepted migration fingerprints

| Migration source                        | Git blob fingerprint                       |
| --------------------------------------- | ------------------------------------------ |
| `001-initial-schema.ts`                 | `ba1c161de326f446a01eeac308816ba67bee41b6` |
| `002-normalized-provenance.ts`          | `5c7a8485486c99a4b55c1c8bee2b37e2691559d5` |
| `003-provenance-integrity-hardening.ts` | `2061186b4a757023a1861000e892cbc6204a589a` |

Historical migration DDL is immutable because deployed ledgers identify a version/name, not an arbitrary later source rewrite. A runner precondition may evolve to reject unsafe legacy inputs before the frozen transformation, but it must remain version-keyed, deterministic, and in the same migration transaction.

## Review-state terminology

`normal` and `review` are automated initial data-quality states. `included` and `excluded` are human review decisions and require an effective append-only review event. The database pointer and compatibility projection must match the latest monotonic event exactly; neither raw SQL nor a generic record path may manufacture human approval.

## Verification

The implementation gate before the version bump passed and the closure suite subsequently passed 28/28 after final-review additions. The final aggregate counts, release gate and exact private CI evidence are reported in the Milestone 2A.2 delivery report; no coverage or performance figure is claimed.

## Remaining limitations

- There is no production cross-language canonical serialization/hashing specification.
- General scientific-record edits do not have a complete append-only version history.
- JSON compatibility mode remains weaker than authoritative SQLite mode.
- Python analytics, CSV/upload workflows, RAG, computer vision, and scientific analysis execution are not implemented.
- `node:sqlite` remains behind an adapter; neither it nor this beta is claimed production-ready.
- Owner confirmation of the old DeepSeek-key revocation, bundled-asset provenance/consent, and legacy deployment/demo-account review remains outstanding.
