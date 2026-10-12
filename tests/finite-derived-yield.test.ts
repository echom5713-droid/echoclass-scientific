import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../src/application/errors.js";
import { CSV_SCHEMA, validateCsvRows } from "../src/domain/csv/contract.js";
import { validateExperiment } from "../src/domain/experiments/validation.js";
import type { PersistExperimentCommand } from "../src/domain/types.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { csvBytes, csvClock, csvFixture, csvSnapshot, syntheticCells } from "./csv-test-helpers.js";

function command(overrides: Partial<PersistExperimentCommand> = {}): PersistExperimentCommand {
  return {
    ...validateCsvRows([syntheticCells], "Synthetic A").commands[0]!,
    id: "finite-record",
    created_by_user_id: "teacher",
    created_by: "teacher",
    created_at: csvClock.now(),
    synced_from_offline: false,
    metadata: {},
    ...overrides,
  };
}

function insertRaw(
  db: DatabaseSync,
  id: string,
  peel: number,
  oil: number,
  yieldPercent: number,
): void {
  const source = db.prepare("SELECT * FROM experiment_records WHERE id='finite-record'").get()!;
  const row = {
    ...source,
    id,
    peel_mass: peel,
    oil_mass: oil,
    yield_percent: yieldPercent,
    submitted_json: JSON.stringify({
      ...JSON.parse(String(source.submitted_json)),
      peel_mass: peel,
      oil_mass: oil,
    }),
  };
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO experiment_records(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
  ).run(...Object.values(row));
}

test("shared experiment validation rejects overflow in either yield arithmetic step", () => {
  for (const peel of [1e-307, 1e-308, Number.MIN_VALUE]) {
    const findings = validateExperiment(command({ peel_mass: peel, oil_mass: 1 }));
    assert.deepEqual(
      findings.map((finding) => finding.field),
      ["peel_mass"],
    );
    assert.match(findings[0]!.message, /产率.*有限/);
  }
});

test("CSV overflow preview is invalid and import rejects the entire file without writes", () => {
  const f = csvFixture();
  try {
    const invalid = [...syntheticCells];
    invalid[3] = "1e-308";
    const bytes = csvBytes([syntheticCells, invalid]);
    const before = csvSnapshot(f.db);
    const preview = f.service.preview(f.context, "class-A", CSV_SCHEMA, bytes);
    assert.equal(preview.valid, false);
    assert.equal(preview.errors.length, 1);
    assert.equal(preview.errors[0]!.row_number, 2);
    assert.equal(preview.errors[0]!.field, "peel_mass_g");
    assert.throws(
      () => f.submit(bytes),
      (error: unknown) => error instanceof AppError && error.status === 422,
    );
    assert.deepEqual(csvSnapshot(f.db), before);
    assert.equal(f.db.isTransaction, false);
    assert.doesNotThrow(() => f.service.export(f.context, "class-A"));
  } finally {
    f.db.close();
  }
});

test("canonical insert and correction reject derived overflow even on schema 13", () => {
  const f = csvFixture(":memory:", true, 13);
  try {
    f.store.add(command());
    const before = csvSnapshot(f.db);
    assert.throws(
      () => f.store.add(command({ id: "overflow-record", peel_mass: 1e-308, oil_mass: 1 })),
      /Invalid experiment.*peel_mass/,
    );
    assert.throws(
      () => f.store.update("finite-record", { peel_mass: 1e-308, oil_mass: 1 }),
      /Invalid experiment correction.*peel_mass/,
    );
    assert.deepEqual(csvSnapshot(f.db), before);
    assert.equal(f.db.isTransaction, false);
  } finally {
    f.db.close();
  }
});

test("Migration 014 blocks raw INSERT and UPDATE of non-finite stored or derived yield", () => {
  const f = csvFixture();
  try {
    runMigrations(f.db);
    f.store.add(command());
    const before = csvSnapshot(f.db);
    for (const [peel, oil, yieldPercent] of [
      [1e-308, 1, Infinity],
      [Number.MIN_VALUE, 1, Infinity],
      [1e-308, 1, 1],
      [100, 1, Infinity],
      [100, 1, -Infinity],
      [100, 1, NaN],
    ]) {
      assert.throws(
        () => insertRaw(f.db, "raw-overflow", peel!, oil!, yieldPercent!),
        /non-finite experiment yield/,
      );
      assert.throws(
        () =>
          f.db
            .prepare(
              `UPDATE experiment_records SET peel_mass=?,oil_mass=?,yield_percent=?,
             updated_at='2026-09-05T00:00:01.000Z' WHERE id='finite-record'`,
            )
            .run(peel!, oil!, yieldPercent!),
        /non-finite experiment yield/,
      );
      assert.deepEqual(csvSnapshot(f.db), before);
    }
  } finally {
    f.db.close();
  }
});

test("Migration 014 refuses historical overflow, reports only IDs and leaves all evidence intact", () => {
  const f = csvFixture(":memory:", true, 13);
  try {
    f.store.add(command());
    insertRaw(f.db, "historical-overflow-b", 1e-308, 1, Infinity);
    insertRaw(f.db, "historical-overflow-a", 1e-307, 1, Infinity);
    const before = csvSnapshot(f.db);
    const schema = f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all();
    const ledger = f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    assert.throws(() => runMigrations(f.db), {
      message:
        'Migration 014 non-finite experiment yield in records: ["historical-overflow-a","historical-overflow-b"]',
    });
    assert.deepEqual(csvSnapshot(f.db), before);
    assert.deepEqual(f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(), schema);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
      ledger,
    );
    assert.equal(f.db.isTransaction, false);
  } finally {
    f.db.close();
  }
});

test("Migration 014 upgrades clean schema 13 without rewriting rows and is idempotent", () => {
  const f = csvFixture(":memory:", true, 13);
  try {
    f.submit();
    const before = csvSnapshot(f.db);
    assert.equal(runMigrations(f.db, MIGRATIONS.slice(0, 14)).currentVersion, 14);
    assert.deepEqual(csvSnapshot(f.db), before);
    const schema = f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all();
    assert.deepEqual(runMigrations(f.db, MIGRATIONS.slice(0, 14)).applied, []);
    assert.deepEqual(f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(), schema);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});

test("an explicit correction can resolve historical overflow without changing submitted evidence", () => {
  const f = csvFixture(":memory:", true, 13);
  try {
    f.store.add(command());
    insertRaw(f.db, "historical-overflow", 1e-308, 1, Infinity);
    const submitted = f.db
      .prepare("SELECT submitted_json FROM experiment_records WHERE id='historical-overflow'")
      .get()!.submitted_json;
    assert.throws(() => runMigrations(f.db), /Migration 014 non-finite experiment yield/);
    // The replacement below represents a human-confirmed measurement, not a guessed repair.
    const corrected = f.store.update("historical-overflow", { peel_mass: 100, oil_mass: 1 });
    assert.equal(corrected!.yield_percent, 1);
    assert.equal(runMigrations(f.db, MIGRATIONS.slice(0, 14)).currentVersion, 14);
    assert.equal(
      f.db
        .prepare("SELECT submitted_json FROM experiment_records WHERE id='historical-overflow'")
        .get()!.submitted_json,
      submitted,
    );
  } finally {
    f.db.close();
  }
});

test("Migration 014 rolls back a failure after trigger installation", () => {
  const f = csvFixture(":memory:", true, 13);
  try {
    const migration = MIGRATIONS[13]!;
    assert.equal(migration?.version, 14);
    const schema = f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all();
    const failing = {
      ...migration,
      up(db: DatabaseSync, context: { appliedAt: string }) {
        migration.up(db, context);
        throw new Error("synthetic finite-yield migration failure");
      },
    };
    assert.throws(
      () => runMigrations(f.db, [...MIGRATIONS.slice(0, 13), failing]),
      /synthetic finite-yield migration failure/,
    );
    assert.equal(f.db.isTransaction, false);
    assert.deepEqual(f.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(), schema);
    assert.equal(
      f.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()!.version,
      13,
    );
  } finally {
    f.db.close();
  }
});

test("finite tiny masses, zero oil and existing two-decimal yield rounding stay legal", () => {
  const f = csvFixture();
  try {
    runMigrations(f.db);
    for (const [index, [peel, oil]] of [
      [1e-308, 1e-310],
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [Number.MIN_VALUE, 0],
      [1e-305, 1],
      [8, 0.12356],
      [1000, Number.MIN_VALUE],
    ].entries()) {
      const expected = Number(((oil! / peel!) * 100).toFixed(2));
      const input = command({ id: `finite-${index}`, peel_mass: peel!, oil_mass: oil! });
      assert.deepEqual(validateExperiment(input), []);
      f.store.add(input);
      assert.equal(f.store.findById(input.id)!.yield_percent, expected);
      assert.equal(
        f.store.update(input.id, { peel_mass: peel!, oil_mass: oil! })!.yield_percent,
        expected,
      );
    }
    assert.doesNotThrow(() => f.service.export(f.context, "class-A"));
  } finally {
    f.db.close();
  }
});
