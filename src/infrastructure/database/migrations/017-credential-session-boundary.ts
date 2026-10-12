import type { Migration } from "./types.js";

export const credentialSessionBoundaryMigration: Migration = {
  version: 17,
  name: "credential_session_boundary",
  up(database) {
    database.exec(`
      -- Previously issued sessions cannot establish when credentials were verified.
      UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE revoked_at IS NULL;

      CREATE TRIGGER users_revoke_sessions_after_security_change
      AFTER UPDATE OF password_hash, default_password, role, username,
        class_name, group_name, status ON users
      WHEN NEW.password_hash IS NOT OLD.password_hash
        OR NEW.default_password IS NOT OLD.default_password
        OR NEW.role IS NOT OLD.role
        OR NEW.username IS NOT OLD.username
        OR NEW.class_name IS NOT OLD.class_name
        OR NEW.group_name IS NOT OLD.group_name
        OR NEW.status IS NOT OLD.status
      BEGIN
        UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = NEW.id AND revoked_at IS NULL;
      END;
    `);
  },
};
