# Milestone 1.1 Trust-Boundary Remediation Plan

## Reviewed baseline and scope

- Reviewed commit: `f9baa2dc57422ed119dfd626da904babd82783c3`.
- Preconditions verified before modification: exact `HEAD`, clean working tree, current 10-test suite passing, zero tracked secret/runtime/private paths, and zero provider-shaped secret matches.
- This remediation changes trust boundaries and architecture gates only. It does not add the Milestone 2 normalized schema or review history, Python analytics, RAG, computer vision, a new UI framework, a new database, or a UI redesign.

## Test-first sequence

Regression tests will be added and observed failing before the corresponding implementation:

1. Record-ID collision and protected creation-field rejection.
2. Student identity derivation and ReviewService-only review ownership.
3. Strict numeric/boolean scientific transport parsing and server-derived yield.
4. Public demo analytics invariance after private-record insertion.
5. Existing-user password preservation during import and explicit password updates.
6. Automated dependency-direction architecture gate.
7. Provider independence of core record persistence and rate-limited class summaries.
8. Operational endpoint authorization and safe status/health metadata.
9. Runtime security checks for path traversal, malformed cookies, password hashing, ID collision, and protected fields.

## Trusted record creation boundary

Introduce a `CreateExperimentCommand` containing only client-writable scientific observations and notes. It will not contain database identity, timestamps, creator/reviewer fields, calculated yield, review state, or AI output. The HTTP parser will reject protected fields explicitly and return structured `VALIDATION_ERROR` findings.

Role-specific creation rules:

- Student: `student_name`, `class_name`, and `group_name` come only from the authenticated session.
- Teacher: class is restricted to the teacher's assigned class; the submitted student/group labels are validated classroom-entry fields.
- Administrator: may choose the target class and validated student/group labels.
- Demo: uses the same strict scientific parser but remains non-persistent.

`ExperimentService` receives an `IdGenerator`, creates the database primary key and timestamps on the server, calculates yield from mass observations, assigns the authenticated creator, and initializes review state. Repository conflicts map to `CONFLICT` without returning SQLite details.

## Offline idempotency

Offline synchronization uses a separate validated `client_submission_id`. It is stored as metadata, never as the database primary key. The effective idempotency key is scoped to actor ID and class name. `ExperimentRepository` will expose a scoped lookup so repeated submissions are skipped without permitting cross-user or cross-class replacement.

## Persistence changes

- SQLite record creation changes from `INSERT OR REPLACE` to `INSERT`.
- The storage adapter translates duplicate primary-key persistence failures into a repository-level conflict error.
- Application error mapping exposes only `CONFLICT`, not SQL/error internals.
- Deterministic validation, diagnostics, and persistence complete without waiting for an LLM. Record creation does not call the provider.

## Public/private separation

Move immutable anonymous demo records to `src/shared/demo-records.ts`. Public `/`, `/theme`, unauthenticated analytics, demo routes, and storage seeding may consume that neutral module. Public page rendering must not call `ExperimentRepository`. Remove the unrestricted `ExperimentService.listAll()` query.

## Password-import semantics

`ImportedUser.password` becomes optional. Existing users retain `passwordHash`, `defaultPassword`, and `password_reset_at` when no password is supplied. Explicit passwords are length-validated and update those fields. New users require an explicit validated temporary password; omission is a deterministic `VALIDATION_ERROR`, never an implicit `123456` reset. Username, name, class, group, role, and password lengths receive structured validation.

## Architecture-boundary remediation

- Add `PracticeRepository` domain port.
- Add `PracticeService` for answer persistence and authorized class-scoped reads.
- HTTP receives `PracticeService`, not `JsonPracticeRepository`.
- Add `ClassSummaryService` for analytics, correctness calculation, prompt assembly, rate-limited AI invocation, and audit ownership.
- Route admin listing through an authorized `AdminService` query.
- Route analytics through the domain analytics module, never the view adapter.
- Keep concrete infrastructure construction exclusively in `src/server.ts`.

Automated architecture rules:

```text
domain          !-> application/http/infrastructure/views
application     !-> http/infrastructure/views
infrastructure  !-> http/views
http            !-> concrete infrastructure
```

The composition root `src/server.ts` is the only allowed application-to-infrastructure wiring location.

## Operational metadata

- `/api/metrics` becomes administrator-only.
- Public `/api/llm/status` returns only `configured`, `provider`, and `model`.
- Health reports optional provider dependency truthfully and reports login throttling according to the active storage mode.
- `BUILD_TIME` is renamed to process startup time unless build metadata is explicitly supplied.

## Runtime security checks and cleanup

Update security checks to exercise built runtime modules for static-path containment, cookie decoding, cookie attributes, request parsing, and password hashing. Add endpoint and integration regressions for operational protection and record trust boundaries. Remove legacy `src/lib/http.js`, `src/lib/security.js`, and `src/lib/validators.js` only after imports and checks prove they are dead; migrate the storage engine to the runtime security implementation first.

## Verification gate

Run and record:

```text
npm run lint
npm run typecheck
npm run build
npm test
npm run test:integration
npm run smoke-test
npm run security-check
npm run format:check
git diff --check
```

The architecture-boundary test is part of `npm test` and will also be invoked directly for an explicit gate result. No commit will be created automatically.
