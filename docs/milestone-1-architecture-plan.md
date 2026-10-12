# Milestone 1 Architecture Plan

## Baseline and scope

- Baseline commit: `7a9f3544805e058d360fb500599fc0ad9b1169eb` (`chore: establish sanitized EchoClass v3 baseline`).
- The current application is a dependency-free Node.js ESM HTTP server. Milestone 1 will preserve the native server-rendered UI, browser client, demo accounts, SQLite-first storage, JSON fallback, and public routes.
- This milestone introduces TypeScript and explicit boundaries. It does not redesign the UI, change databases or frameworks, deploy the application, or implement later analytics/review/RAG milestones.

## Current architecture inventory

### 1. Entry points

- `server.js`: loads local environment files, initializes storage, creates the HTTP server, dispatches every page/API route, and handles shutdown.
- `scripts/start-production.mjs`: production launcher for `server.js`.
- `scripts/smoke-test.mjs`: starts the server and exercises public and authenticated workflows.
- `public/client.js`: browser-side interactions and API calls.

### 2. HTTP routes

| Kind                   | Routes                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Public pages           | `/`, `/theme`, `/demo`, `/student/login`, `/teacher/login`, `/admin/login`, `/dashboard`, `/llm-teaching`, `/curriculum`, `/resources` |
| Protected pages        | `/submit`, `/admin`, `/admin/console`, `/admin/users`, `/report`, `/practice`                                                          |
| Session/authentication | `/logout`, `POST /api/auth/login`, `POST /api/auth/change-password`                                                                    |
| Administration         | `POST /api/admin/reset-password`, `POST /api/admin/create-user`, `POST /api/admin/import-users`                                        |
| Experiments            | `GET/POST /api/records`, `POST /api/records/manage`, `POST /api/sync`, `GET /api/analytics`, `GET /api/trend-svg`                      |
| AI                     | `GET /api/llm/status`, `POST /api/llm/ask`, `POST /api/llm/class-summary`                                                              |
| Practice               | `POST /api/practice/answer`, `GET /api/practice/results`                                                                               |
| Operations/static      | `/api/health`, `/api/metrics`, `/static/*`                                                                                             |

### 3. Storage calls

`src/lib/storage.js` owned SQLite setup/migrations and JSON fallback plus user, record, session, login-attempt, audit, and metrics operations. `server.js` imported those concrete functions directly. Practice answers were separately stored as JSON from `server.js`.

### 4. Authentication logic

`server.js` parses login requests, performs rate-limit checks, finds users, verifies passwords, creates/revokes sessions, sets/clears cookies, and redirects by role. Password change and admin password reset are also implemented directly in route handlers. Hashing and cookie primitives live in `src/lib/security.js`.

### 5. Authorization logic

`server.js` defines `hasRole` and `canAccessClass`, then repeats role and class checks in API/page branches. `src/lib/storage.js` also derives class scopes. Access decisions are server-side but are not represented by reusable typed policies or independently tested across classes.

### 6. Validation logic

`src/lib/validators.js` validates login, password changes, and core record ranges. `server.js` also performs ad hoc request length, required-field, role, action, import-row, and AI-history checks. `src/views/pages.js` normalizes experiment payloads and computes scientific diagnostics, mixing transport conversion with domain rules.

### 7. AI-provider logic

`src/views/pages.js` contains both local-answer behavior and the provider HTTP request in `answerFor`. `server.js` performs PII redaction and rate limiting, assembles prompts, invokes `answerFor`, and audits metadata. Provider configuration, transport, validation, and application orchestration are therefore split across views and routes.

### 8. Statistical and business logic

`src/views/pages.js` owns yield calculation, grouping, descriptive statistics, quadratic fit, record diagnostics/inclusion, error classification, analytics, record normalization, and inhibition grading. The same file renders all HTML. Record creation/review/sync workflows and account import workflows are in `server.js`.

### 9. View responsibilities

`src/views/pages.js` builds all HTML and SVG output. It also exposes demo data, request/query helpers, payload normalization, statistics, diagnostics, and the provider call. Views receive records/users/session values and do not directly query the database, but they currently contain domain and infrastructure responsibilities.

### 10. Coupling problems

- `server.js` is the composition root, router, middleware stack, controller set, service layer, and part of persistence/AI infrastructure.
- Application workflows depend directly on concrete storage functions.
- SQL/JSON fallback, repository behavior, seeds, and runtime storage selection share one large module.
- Core scientific functions and provider calls are coupled to a 1,700+ line view template module.
- Error shapes vary by route and internal exception messages can reach users.
- Logs do not consistently include request IDs, routes, actors, results, and durations.
- Authorization is duplicated and lacks focused cross-class tests.
- External request data is largely untyped until runtime string/number coercion.

## Target architecture

```text
HTTP request
  -> request context / security middleware
  -> focused route module + transport schema
  -> application service
  -> domain validation / authorization policy
  -> explicit repository interface or provider port
  -> SQLite/JSON storage adapter or DeepSeek adapter
```

The existing view templates remain server-rendered but will be reached through a typed view boundary. Scientific logic required by workflows will move to domain modules; compatibility exports may remain temporarily for view rendering where removal would create unnecessary UI risk.

## Migration map

| Current function/file                      | Target module                                                     | Responsibility                                       | Migration risk                                                                |
| ------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `server.js` startup/config                 | `src/server.ts`, `src/config/*`                                   | composition root, validated configuration, lifecycle | Medium: startup scripts and smoke tests must follow compiled/dev entry points |
| `server.js` route dispatch                 | `src/http/router.ts`, `src/http/routes/*`                         | route matching and transport translation             | High: all existing routes and redirects must remain compatible                |
| `handleLogin`, password/logout flow        | `src/application/auth-service.ts`, auth routes                    | authentication/session orchestration                 | High: cookie/session/login throttling regressions                             |
| `handleRecordPost`, manage, sync           | `src/application/experiment-service.ts`, experiment routes        | record workflow, access checks, audit coordination   | High: class isolation and payload compatibility                               |
| review action map                          | `src/application/review-service.ts`                               | typed current-state review workflow boundary         | Medium: preserve statuses without adding Milestone 2 history schema           |
| PII/rate-limit/provider orchestration      | `src/application/ai-service.ts`                                   | safe AI request pipeline                             | High: provider failures and content safety must degrade safely                |
| `answerFor` provider request               | `src/infrastructure/llm/deepseek-provider.ts`                     | external provider HTTP adapter                       | Medium: response/time-out compatibility                                       |
| concrete storage imports                   | `src/domain/repositories.ts`, `src/infrastructure/repositories/*` | repository contracts and storage adapters            | High: SQLite/JSON behavior and data shapes                                    |
| `hasRole`, `canAccessClass`                | `src/domain/authorization.ts`                                     | reusable role/class policies                         | High: deny cross-class access consistently                                    |
| `validateRecordPayload` and request checks | `src/domain/experiments/validation.ts`, `src/http/schemas/*`      | domain versus transport validation                   | Medium: retain current accepted form shapes                                   |
| analytics/diagnostics in views             | `src/domain/experiments/analytics.ts`                             | pure scientific/descriptive functions                | Medium: rendered values must not change unexpectedly                          |
| HTML functions in `pages.js`               | `src/views/*` typed facade over existing templates                | render prepared view models only                     | Low/medium: large compatibility surface; migrate incrementally                |
| ad hoc `console.error`                     | `src/shared/logger.ts`, request middleware                        | structured metadata-safe logs                        | Low: operational output changes only                                          |
| inconsistent JSON errors                   | `src/application/errors.ts`, `src/http/error-mapper.ts`           | stable safe error codes and envelope                 | Medium: preserve success response compatibility                               |

## Planned verification

- Unit tests: domain validation, authorization, mocked repository service behavior, safe AI handling, error mapping.
- Integration tests: student/teacher/admin login, record create/read, student and teacher cross-class denial, AI provider-unavailable fallback.
- Regression checks: existing baseline tests, smoke test, security check, plus lint, strict typecheck, and production build.
