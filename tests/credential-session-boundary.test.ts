import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hasRole, canAccessClass, requiresPasswordChange } from "../src/domain/authorization.js";
import type { Session } from "../src/domain/types.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";

function seed(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO users(id,role,username,password_hash,default_password,name,class_name,group_name,status,created_at)
    VALUES('u','student','student','scrypt$old',0,'Synthetic','Class A','Group A','active','2026-10-05T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at)
    VALUES('sid','u','student','2026-10-05T00:00:00.000Z',?)`,
  ).run(Date.now() + 100_000);
}

test("schema-16 upgrade revokes pre-boundary sessions once and retains account credentials", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runMigrations(db, MIGRATIONS.slice(0, 16));
    seed(db);
    const original = db.prepare("SELECT * FROM users").get();
    runMigrations(db);
    assert.ok(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at);
    assert.deepEqual(db.prepare("SELECT * FROM users").get(), original);
    db.prepare("UPDATE sessions SET revoked_at=NULL").run();
    runMigrations(db);
    assert.equal(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at, null);
  } finally {
    db.close();
  }
});

test("credential and scope changes revoke sessions inside the same SQLite statement", async (t) => {
  for (const mutation of [
    "password_hash='scrypt$new'",
    "default_password=1",
    "role='teacher'",
    "class_name='Class B'",
    "group_name='Group B'",
    "status='disabled'",
    "username='new-name'",
  ])
    await t.test(mutation.split("=")[0], () => {
      const db = new DatabaseSync(":memory:");
      try {
        runMigrations(db);
        seed(db);
        db.exec("BEGIN IMMEDIATE");
        db.exec("UPDATE users SET " + mutation + " WHERE id='u'");
        assert.ok(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at);
        db.exec("ROLLBACK");
        assert.equal(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at, null);
      } finally {
        db.close();
      }
    });
});

test("failed session revocation rolls back the credential update; a name edit preserves the session", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runMigrations(db);
    seed(db);
    db.exec(
      "CREATE TRIGGER fail_revocation BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    assert.throws(
      () => db.exec("UPDATE users SET password_hash='scrypt$new' WHERE id='u'"),
      /injected/,
    );
    assert.equal(db.prepare("SELECT password_hash FROM users").get()?.password_hash, "scrypt$old");
    assert.equal(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at, null);
    db.exec("UPDATE users SET name='Renamed',password_hash=password_hash WHERE id='u'");
    assert.equal(db.prepare("SELECT revoked_at FROM sessions").get()?.revoked_at, null);
  } finally {
    db.close();
  }
});

test("temporary credentials have no role or class capability; opted-in demo sessions remain usable", () => {
  const actor: Session = {
    id: "u",
    role: "admin",
    username: "owner",
    name: "Synthetic",
    class_name: "Class A",
    status: "active",
    defaultPassword: true,
  };
  assert.equal(requiresPasswordChange(actor), true);
  assert.equal(hasRole(actor, ["admin"]), false);
  assert.equal(canAccessClass(actor, "Class A"), false);
  assert.equal(canAccessClass(actor, "Class B"), false);
  assert.equal(hasRole({ ...actor, defaultPassword: false }, ["admin"]), true);
  assert.equal(requiresPasswordChange({ ...actor, status: "demo" }), false);
});

for (const mode of ["sqlite", "json"])
  test(`actual ${mode} storage rejects stale login and password/import snapshots`, () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "echoclass-auth-storage-"));
    try {
      const result = spawnSync(process.execPath, ["dist/tests/fixtures/auth-storage-worker.js"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ECHOCLASS_DATA_DIR: directory,
          STORAGE_MODE: mode,
          ECHOCLASS_SEED_DEMO: "0",
        },
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /AUTH_STORAGE_PASS/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
