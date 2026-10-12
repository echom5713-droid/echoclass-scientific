import type { Migration } from "./types.js";

export const initialSchemaMigration: Migration = {
  version: 1,
  name: "initial_operational_schema",
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        teacher_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        default_password INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        class_name TEXT,
        group_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        data_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_users_role_class ON users(role, class_name);
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        class_name TEXT NOT NULL,
        created_by TEXT,
        student_name TEXT,
        nh4cl_concentration REAL,
        yield_percent REAL,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_class_created ON records(class_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_records_class_conc ON records(class_name, nh4cl_concentration);
      CREATE TABLE IF NOT EXISTS sessions (
        sid_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        ip TEXT,
        ua TEXT,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS login_attempts (
        attempt_key TEXT PRIMARY KEY,
        ip TEXT,
        username TEXT,
        route TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        first_at_ms INTEGER NOT NULL,
        locked_until_ms INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_role TEXT,
        actor_username TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        class_name TEXT,
        ip TEXT,
        ua TEXT,
        ok INTEGER NOT NULL DEFAULT 1,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_class ON audit_logs(class_name, created_at DESC);
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT,
        size INTEGER DEFAULT 0,
        uploader_id TEXT,
        class_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS ai_questions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        class_name TEXT,
        question TEXT NOT NULL,
        answer TEXT,
        created_at TEXT NOT NULL
      );
    `);
  },
};
