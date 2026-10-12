# Milestone 4 retrieval continuation — beta.17

Author-side implementation verification: PASS. Final whole-project checks passed on 2026-09-05. Independent acceptance remains PENDING. SQLite schema remains 16.

## Decisions and scope

The original plan was recovered and compared with actual beta.16 source. This stage adds first-party Markdown, SQLite FTS5/BM25, exact citations, unsupported/safety/instruction/premise states, a bounded cache and 42 offline questions. It extends existing report permission/rate/audit boundaries without changing scientific algorithms or released migrations. README, architecture, progress and defence notes distinguish current capabilities from remaining requirements.

Deployed documentation is the authority, not generated prose. No free-form model answer, external literature ingestion or automatic science decision is claimed. See development-plan-status.md for explicit changes to the original scientific design.

## Verification record

Targeted retrieval/domain/client checks: 8/8. First evaluation: 41/42; English source clarification yields 42/42. A TypeScript audit-detail mismatch was corrected by storing public chunk IDs as a comma-separated string, preserving the existing scalar audit contract.

Final local commands: npm ci, lint, typecheck, build, test, test:python, eval:grounded, eval:retrieval, test:integration, smoke-test, security-check, format:check and the architecture boundary gate. Final observed counts are appended after execution. No independent review is implied.

## Remaining work and risks

Independent statistical/security audit, live model/human assessment, full generative RAG, engineering/demo work and scientific Docker verification remain pending. Key revocation, asset rights/consent, historical deployment accounts/data and external schema-v7 inventory remain owner release blockers. No public release, deployment or main-branch merge occurs.

## Final local gate

- Clean npm install, lint, typecheck, build and formatting: PASS.
- Node unit/architecture/client suite: 567/567, including eleven added retrieval/service/client tests.
- HTTP integration: 31/31, including current-scope retrieval, strict input, PII audit exclusion, unchanged sealed reports, restart and account revocation.
- Python: 63/63 plus five subtests; pinned interpreter and pip check PASS.
- Offline evidence evaluation: 25/25; offline document evaluation: 42/42. These are separate developer-side suites, not live-model accuracy.
- Smoke and runtime security markers PASS; the security command also reruns the same 31 integration tests. Counts are not additive.
- Four architecture-boundary tests PASS and are already included in the Node total.
- Released migrations 001–016 plus the dedicated 002 preflight, and the analytics package, remain byte-identical to beta.16.
- The initial lint check rejected a control-character regex; validation now checks ASCII control code points explicitly. No behavioral assertion was removed.

The real commit, observed remote CI and clean source archive hashes are provided in the post-commit delivery manifest. No future Git or CI identifiers are predicted here.

## Corrective packaging commit

Post-commit review identified that the existing Docker compose file mounts the whole data directory. Bundled source material under data/knowledge could therefore be hidden by an older runtime volume. A separate corrective commit moves the guide to resources/knowledge and updates loading/source identities. A packaging regression reconstructs a built checkout with no data directory and verifies real retrieval from the shipped resource; it also asserts that the resource is outside both existing volume destinations. This is not a Docker runtime or scientific-container certification. No history is rewritten.

Corrective local checks: Node 567/567, HTTP 31/31, targeted packaging/retrieval/client 9/9, retrieval evaluation 42/42, build/lint/format and captured smoke completion marker PASS. The original commit also completed remote CI successfully; that did not detect the packaging risk. The correction receives its own CI run. Direct terminal captures without the smoke marker were not accepted as proof of completion; a subprocess-captured rerun verified exit 0 and the marker. The smoke source is unchanged.
