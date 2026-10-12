# Project-guide retrieval v1

`POST /api/grounded-runs/:id/sources` accepts exactly `{ "question": "..." }`. It requires current teacher/admin access to a completed report, accepts no query parameters or supplied context, uses the strict 16 KiB JSON reader and origin guard, and shares the ten-per-minute/user explanation limit. The normalized question is 1–500 characters without controls, bidi or malformed Unicode. There is no external request on this path.

## Corpus and index

Twenty sections in `resources/knowledge/echoclass-guide.md` document existing software: the actual peel/oil mass dictionary, sample provenance, CSV/evidence/review, methods and limitations. They do not reproduce a third-party lab protocol, student record or uploaded attachment. Unsupported chemical mechanisms are not supplied.

Each chunk has document/chunk IDs, title, full content, repository path, version and canonical content SHA-256. The corpus identity hashes the ordered chunk objects, so source changes change identity even without a human version bump. These hashes are content-integrity identifiers, not signatures or scientific verification.

The adapter creates an in-memory FTS5 index, then enables `query_only`. No classroom schema changes. Deployed Markdown is authoritative; the index is disposable. Missing/malformed corpus fails startup. The corpus lives under `resources/knowledge`, outside `data` and `uploads`, so the existing Docker runtime volume mounts cannot hide the bundled source. Deploy the resource directory with the application code.

English words and Chinese two-character windows are NFKC-normalized and deduplicated, with a small explicit stopword list. Validated terms are quoted and bound as a MATCH parameter. Ranking uses `bm25(chunks,0,4,1)` ascending, then chunk ID. SQLite assigns lower scores to better matches: [official FTS5 documentation](https://www.sqlite.org/fts5.html#the_bm25_function). Limits are 64 terms, 20 candidates and three excerpts. A candidate must cover 45% of query terms. This heuristic is not calibrated confidence and can miss paraphrases.

A maximum 128-entry cache retains token keys only when every token occurs in returned public excerpts. Unsupported queries and extra/name-like terms are not cached. Copies prevent callers mutating cached sources. Restart rebuilds the index from the same corpus.

## Output and privacy

Response fields include answer, exact citations, limitations, safety notice, provider `local-extractive`, model/prompt version `null`, corpus/retrieval versions and answer hash. `sources_found` means related excerpts, not a complete answer or acceptance of the premise. `insufficient_evidence` invents no citation. Explicit safety, instruction-override and certainty probes produce fixed refusal/caution text and relevant boundary sources.

These lexical guards are incomplete recognizers. The stronger constraint is fixed text plus first-party excerpts: no question can cause a model call, tool action, invented experiment value, automatic exclusion or uploaded-document ingestion. Novel malicious wording can evade classification without acquiring execution authority.

Supported PII patterns include email, phone/numeric sequences and labeled names/student IDs. Redaction occurs before tokenization and is not complete anonymization. Questions are not reflected or audited. Audit details retain outcome, corpus/answer hashes, public source IDs and the redaction flag; ordinary actor columns retain their existing policy. Current permissions are rechecked after audit and next to serialization.

The page uses textContent, labels and status text. Changed questions invalidate delayed replies; denied access, broken citations and changed accounts clear answers. Actual-client simulated DOM tests are not a graphical accessibility audit.

## Original plan boundary

This is extractive retrieval, separate from beta.16 optional report-card reordering. Full generative RAG, persistent document ingestion, private corpora, generated-claim entailment, live model comparisons, human rubrics and held-out evaluation remain unfinished.
