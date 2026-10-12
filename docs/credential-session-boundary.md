# Credential and session boundary — beta.22

The previous version marked accounts with `defaultPassword` and displayed a change-password prompt, but issued ordinary sessions. Password changes also left older sessions valid. Those behaviours made a user-interface instruction look stronger than the actual permission boundary.

## Current transition

An active account created, imported or reset with a temporary password receives a restricted session. It can reach the dedicated password page, authentication routes, logout and public project reading pages. Protected classroom pages redirect to `/account/password`; protected API calls return `403 PASSWORD_CHANGE_REQUIRED`. Domain role/class checks also reject restricted sessions. A demo query parameter cannot lift that restriction.

Changing the password requires a live session, the current password and a different 6–72 character password. Real accounts cannot choose the fixed demo password. A narrow repository operation checks the live session and expected credential before updating the credential. Success clears the session cookie and requires a fresh sign-in. Confirmation is checked when supplied; the native form and browser client supply it, while older API clients may omit it.

For SQLite, migration 017 revokes pre-existing sessions once and adds an update trigger. Changes to password hash, temporary-password flag, role, username, class, group or status revoke all of that user's live sessions in the same database statement. A failed revocation rolls back the credential change. A display-name-only edit leaves sessions valid. Released migrations 001–016 are unchanged.

A login verified against an older user snapshot cannot create a session after a concurrent reset: session insertion compares that snapshot against the current security fields. User import likewise checks its expected security snapshot inside the write transaction, so a stale import cannot reinstate an older credential or scope.

The JSON adapter serializes guarded writes within one process and rechecks current account state when reading sessions. It does not provide SQLite transactions, cross-process coordination or persistent sessions and remains a weaker compatibility mode. Demo sessions are exempt only for accounts explicitly marked `demo` in a disposable deployment with `ECHOCLASS_SEED_DEMO=1`; that flag must stay disabled for real data.

## Verification and boundaries

- [Migration/storage tests](../tests/credential-session-boundary.test.ts) cover upgrade, seven security-field changes, rollback, harmless edits, stale login and stale import across real SQLite/JSON adapters.
- [HTTP tests](../tests/integration/auth-workflows.test.ts) exercise all three roles, protected endpoints, native forms, multiple sessions, restart, reset/import and explicit demo isolation.
- The English/Chinese account pages use native forms; language preference and session cookies are appended separately. Account pages are not cached, passwords are not stored in browser storage, and session objects omit credential fields.
- Credential mutation and subsequent audit insertion are separate operations. If the response or audit step fails after mutation, the password may already be changed; the client advises a fresh sign-in before repeating an uncertain request.

This is an implemented correction with developer regression evidence. It is not independent security acceptance. Deployment/session rollout and the other owner conditions in the [risk register](risk-register.md) remain subject to review.

The transition follows the restricted reset-session and fresh-sign-in principles described in the primary [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). The project-specific guarantees above depend on the code and tests, not on compliance branding.
