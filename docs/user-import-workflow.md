# User Import Credential Workflow

Milestone 1.1 makes password handling explicit and deterministic:

- Existing username, password omitted: profile fields are updated and the existing password hash, default-password flag, and password-reset timestamp are preserved unchanged.
- Existing username, password supplied: the supplied 6-72 character temporary password is hashed and installed; the account is marked as requiring a password change.
- New username, password supplied: the user is created with that validated temporary password and is marked as requiring a password change.
- New username, password omitted: the entire import request fails with `VALIDATION_ERROR`. EchoClass does not invent or silently substitute a credential.
- The isolated demo password `123456` is rejected by operational user creation and import.

Tabular imports use `role, username, name, class, group, password`. Teacher and administrator rows may leave the group column empty. Password reset remains a separate administrator action, generates a one-time random temporary credential, returns it only to the authenticated administrator, and never writes it to audit logs. Since beta.22, an active temporary-password account receives a restricted session until it changes its password and signs in again. Reset/import credential or permission changes revoke older sessions. Imports compare their expected security snapshot during the write so that a stale import cannot reinstate an older credential. See [the credential/session boundary](credential-session-boundary.md).
