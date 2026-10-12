# Milestone 4 — evidence-linked report explanations

Status: implementation plan, 2026-09-05. The user asked to continue beyond the beta.15 handoff. Its independent post-implementation audit remains pending, not waived or retrospectively certified. Work stays on the private review branch; no main merge or deployment.

## Smallest useful scope

Explain one already-completed scientific report. Retrieval uses an explicit topic selected by the reader: overview, inclusion, descriptive statistics, uncertainty, outliers, model validation, best-tested conditions, candidate or limitations. This is a bounded evidence-card assistant, not open-domain chat, semantic search, literature RAG or a claim that a language model independently interprets experiments.

Each topic selects a fixed allowlist of report fields and versioned first-party method cards. Every answer block cites exact evidence IDs; report evidence carries a JSON Pointer into the existing authorized run, dataset/result hashes, and its exact value. Method cards identify the implementation contract, not independent experimental validation. The server assembles text from trusted templates and values. No provider-written prose, numbers, links or invented citations are displayed.

An optional model may reorder the already-retrieved cards. It receives only a whitelisted topic and card IDs/titles, never report values, questions, names, notes, images or class/run identifiers. Its output must be an exact permutation of the allowed IDs; any omission, duplicate, additional field, unknown ID, invalid JSON, timeout or upstream failure falls back to deterministic ordering. Required cautions cannot be dropped. This limited reranking is deliberately not marketed as free-form grounded generation.

## Authority and resources

- Fresh active teacher/admin and every captured record's current class authorization, using ScientificService.get. Incomplete reports fail with 409; worker availability is not required to read completed evidence.
- Strict UTF-8 JSON command: topic and use_model only. 16 KiB maximum, bounded read time, no query parameters. Existing same-origin POST guard applies.
- External model disabled by default and also requires explicit per-request opt-in. A dedicated new key is required; do not reuse the unresolved historical provider key. No live provider call during implementation/testing.
- Fixed provider endpoint, no redirect, 5-second deadline, bounded response bytes, no retry and at most two in-flight requests. Offline fallback is labeled and works without an API key.
- Per-user rate limit; no shared report cache. Reauthorize synchronously after every asynchronous boundary before sending a response. Log only topic/mode/hash, never raw report evidence or credentials.
- No database migration: reports and scientific results are not changed. Explanation identities hash canonical evidence and ordered trusted answer blocks; model ordering can change the answer hash without changing scientific results.

## Evaluation

Offline deterministic tests and mock-provider fault tests, not a live-model quality benchmark. Check all topic mappings, exact pointers and values, required limitations, missing/unsupported commands, empty cohorts, null results, broken integrity, forbidden roles/classes, account revocation while awaiting model/audit, privacy allowlist, forged/duplicated/omitted citations, timeouts, response-size limits and malicious strings. Real HTTP tests operate on the existing scientific workflow. Execute the actual browser script for safe rendering and stale-response handling.

Run every existing gate plus a machine-readable grounded-evidence evaluation. Keep old migrations byte-identical. Record real Git SHA, CI, synthetic-fixture scope and limitations. Review findings and real-provider evaluation remain separate acceptance work; no fabricated deployment, adoption or experimental efficacy metrics.

## Provider contract reference

The optional adapter follows the official [DeepSeek JSON output guide](https://api-docs.deepseek.com/guides/json_mode/) and [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/), checked on 2026-09-05. The adapter requests JSON, disables thinking for this small ordering task and rejects truncated responses. JSON syntax alone is insufficient: local exact-permutation validation remains authoritative. This documentation check is not a live API integration test.
