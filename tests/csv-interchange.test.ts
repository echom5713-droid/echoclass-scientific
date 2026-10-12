import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { parse } from "csv-parse/sync";
import { AppError } from "../src/application/errors.js";
import { CsvService } from "../src/application/csv-service.js";
import {
  CSV_HEADERS,
  CSV_EXPORT_HEADERS,
  CSV_SCHEMA,
  CSV_DIAGNOSTICS,
  CSV_LIMITS,
  CsvFault,
  spreadsheetText,
  validateCsvRows,
  type CsvRepository,
} from "../src/domain/csv/contract.js";
import { diagnoseRecord } from "../src/domain/experiments/diagnostics.js";
import { MIGRATIONS, runMigrations } from "../src/infrastructure/database/migrations/index.js";
import { SqliteCsvRepository } from "../src/infrastructure/database/sqlite-csv-repository.js";
import {
  csvFixture,
  csvContext,
  csvSnapshot,
  csvBytes,
  syntheticCells,
  codec,
  openCsvDb,
  seedCsv,
  csvClock,
} from "./csv-test-helpers.js";

const encode = (text: string) => Buffer.from(text, "utf8");
const field = (index: number, value: string) =>
  syntheticCells.map((cell, i) => (i === index ? value : cell));
const appStatus = (status: number, reason?: string) => (error: unknown) =>
  error instanceof AppError &&
  error.status === status &&
  (!reason || error.fields.some((entry) => entry.code === reason));
const validCommand = (className = "Synthetic A") => ({
  ...validateCsvRows([syntheticCells], className).commands[0]!,
  initial_quality_status: "normal" as const,
  synced_from_offline: false,
  metadata: {},
});

test("CSV parser preserves UTF-8, single BOM, quotes, commas and logical multiline rows", () => {
  const cells = field(14, '中文, "quote"\nline\r\nnext');
  const quoted = Buffer.from(csvBytes([cells])).toString("utf8");
  for (const text of [
    quoted,
    quoted.slice(1),
    quoted.slice(0, -2),
    quoted.replaceAll("\r\n", "\n"),
  ]) {
    const rows = codec.parse(encode(text));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]![0], syntheticCells[0]);
    assert.equal(
      rows[0]![14],
      text.includes("\r\nnext") ? cells[14] : cells[14]!.replaceAll("\r\n", "\n"),
    );
  }
  assert.equal(
    codec.sha256(encode(quoted)),
    createHash("sha256").update(encode(quoted)).digest("hex"),
  );
  assert.notEqual(codec.sha256(encode(quoted)), codec.sha256(encode(quoted.slice(1))));
});

test("CSV parser rejects invalid encodings, ambiguous headers, widths, empty records and malformed quotes", () => {
  const good = Buffer.from(csvBytes()).toString("utf8");
  const bad = [
    Buffer.from([0xff, 0xfe, 0]),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(good, "utf16le"),
    encode(`\uFEFF${good}`),
    encode(""),
    codec.serialize(CSV_HEADERS, []),
    encode(good + "\r\n"),
    encode(good.replace('"student_name"', '"class_id"')),
    encode(good.replace('"group_name"', '"student_name"')),
    encode(good.replace('"student_name","group_name"', '"group_name","student_name"')),
    encode(good.replace('"student_name"', '" student_name"')),
    encode(good.replaceAll(",", ";")),
    codec.serialize([...CSV_HEADERS, "metadata"], [[...syntheticCells, "{}"]]),
    codec.serialize(CSV_HEADERS.slice(1), [syntheticCells.slice(1)]),
    encode(good.replace('"Synthetic 学生",', '"Synthetic 学生",extra,')),
    encode(good.replace('"Synthetic 学生",', "")),
    encode(good.replace('"Synthetic 学生"', '"unterminated')),
    encode(good.replace('"Synthetic 学生"', 'bad"quote')),
  ];
  for (const bytes of bad) assert.throws(() => codec.parse(bytes), CsvFault);
});

test("CSV lexical checks and the existing domain validator reject invalid values without guessing", () => {
  for (const value of [
    "",
    " ",
    "NaN",
    "Infinity",
    "0x3",
    "3abc",
    "1,000",
    "1,5",
    "3%",
    "1e999",
    "1".repeat(65),
    "2",
  ])
    assert.equal(validateCsvRows([field(2, value)], "Synthetic A").valid, false, value);
  for (const [index, values] of [
    [0, ["\u00a0\u2007", "x".repeat(41)]],
    [1, [" ", "x".repeat(81)]],
    [7, ["", "x".repeat(81)]],
    [9, ["\uFEFF", "x".repeat(81)]],
    [12, ["", "FALSE", "0", "yes"]],
    [13, ["x".repeat(501)]],
    [14, ["x".repeat(2001), "x\0y"]],
    [15, ["2023-02-29", "2024-13-01", "2024-01-01T00:00:00Z"]],
    [16, ["0", "501"]],
    [17, ["not_recorded_legacy", "manual_local_image_calibrated", ""]],
  ] as const)
    for (const value of values)
      assert.equal(
        validateCsvRows([field(index, value)], "Synthetic A").valid,
        false,
        `${index}:${value.slice(0, 25)}`,
      );
  const valid = validateCsvRows([field(2, "+3e0")], "Synthetic A");
  assert.equal(valid.valid, true);
  assert.equal(valid.commands[0]!.nh4cl_concentration, 3);
  assert.equal(valid.commands[0]!.phase_clarity_score, 3.5);
  assert.equal(validateCsvRows([field(12, "true")], "Synthetic A").commands[0]!.异常标记, true);
  for (const [i, value] of [
    [3, "0"],
    [4, "21"],
    [5, "1441"],
    [6, "0"],
    [8, "101"],
    [10, "61"],
    [11, "6"],
  ] as const)
    assert.equal(validateCsvRows([field(i, value)], "Synthetic A").valid, false);
});

test("500 rows, byte budgets, parser record buffers and error caps are whole-file boundaries", () => {
  assert.equal(
    codec.parse(csvBytes(Array.from({ length: 500 }, () => syntheticCells))).length,
    500,
  );
  assert.throws(
    () => codec.parse(csvBytes(Array.from({ length: 501 }, () => syntheticCells))),
    /500/,
  );
  assert.throws(() => codec.parse(csvBytes([field(14, "a".repeat(17000))])), /缓冲/);
  const padded = Array.from({ length: 500 }, () => field(14, ""));
  let remaining = CSV_LIMITS.bytes - csvBytes(padded).byteLength;
  for (const row of padded) {
    const n = Math.min(remaining, 2500);
    row[14] = "x".repeat(n);
    remaining -= n;
  }
  assert.equal(remaining, 0);
  const exact = csvBytes(padded);
  assert.equal(exact.byteLength, CSV_LIMITS.bytes);
  assert.equal(codec.parse(exact).length, 500);
  assert.throws(() => codec.parse(Buffer.concat([exact, Buffer.from("x")])), /1 MiB/);
  const result = validateCsvRows(
    Array.from({ length: 101 }, () => field(2, "NaN")),
    "Synthetic A",
  );
  assert.equal(result.error_count, 101);
  assert.equal(result.errors.length, 100);
  assert.equal(result.errors_truncated, true);
});

test("preview is read-only and validates the last row beyond the 20-row display", () => {
  const f = csvFixture();
  try {
    const before = csvSnapshot(f.db);
    const preview = f.service.preview(f.context, "class-A", CSV_SCHEMA, csvBytes());
    assert.equal(preview.valid, true);
    const rows = Array.from({ length: 25 }, () => syntheticCells);
    rows[24] = field(4, "");
    const bytes = csvBytes(rows);
    const invalid = f.service.preview(f.context, "class-A", CSV_SCHEMA, bytes);
    assert.equal(invalid.valid, false);
    assert.equal(invalid.preview.length, 20);
    assert.equal(invalid.errors[0]!.row_number, 25);
    assert.throws(() => f.submit(bytes), appStatus(422));
    assert.deepEqual(csvSnapshot(f.db), before);
    assert.equal(f.db.isTransaction, false);
  } finally {
    f.db.close();
  }
});

test("canonical batch uses server provenance, one audit and durable scoped idempotency", () => {
  const f = csvFixture();
  try {
    const bytes = csvBytes([syntheticCells, syntheticCells]);
    const first = f.submit(bytes);
    const before = csvSnapshot(f.db);
    assert.equal(first.added_this_request, 2);
    assert.equal(new Set(first.receipt.rows.map((r) => r.record_id)).size, 2);
    const replay = f.submit(bytes);
    assert.equal(replay.replayed, true);
    assert.equal(replay.added_this_request, 0);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.deepEqual(csvSnapshot(f.db), before);
    const row = f.db.prepare("SELECT * FROM experiment_records LIMIT 1").get()!;
    assert.equal(row.created_by_user_id, "teacher");
    assert.equal(row.created_by_label, "teacher");
    assert.equal(row.submission_kind, "canonical_submission");
    assert.equal(row.synced_from_offline, 0);
    for (const key of [
      "client_submission_id",
      "storage_import_id",
      "idempotency_scope_class_id",
      "effective_review_id",
    ])
      assert.equal(row[key], null);
    assert.equal(row.yield_percent, 1);
    assert.equal(row.review_status, "normal");
    assert.equal(
      (JSON.parse(String(row.submitted_json)) as Record<string, unknown>).note,
      syntheticCells[14],
    );
    assert.equal(before.audit_logs!.length, 1);
    assert.throws(
      () => f.submit(csvBytes([field(14, "changed")])),
      appStatus(409, "IDEMPOTENCY_CONFLICT"),
    );
    assert.throws(
      () =>
        f.service.import(
          f.context,
          "class-A",
          CSV_SCHEMA,
          "synthetic-import-0001",
          codec.sha256(bytes),
          csvBytes(),
        ),
      appStatus(409, "PREVIEW_BYTES_CHANGED"),
    );
    for (const changed of [
      Buffer.from(bytes).subarray(3),
      encode(Buffer.from(bytes).toString().replaceAll("\r\n", "\n")),
    ])
      assert.throws(() => f.submit(changed), appStatus(409, "IDEMPOTENCY_CONFLICT"));
    assert.equal(f.submit(bytes, "synthetic-import-new").added_this_request, 2);
    assert.equal(
      f.submit(bytes, "synthetic-import-0001", csvContext("peer")).added_this_request,
      2,
    );
    assert.equal(
      f.submit(bytes, "synthetic-import-0001", csvContext("admin"), "class-B").added_this_request,
      2,
    );
    const groups = f.db
      .prepare("SELECT class_id,id FROM groups WHERE name=?")
      .all(syntheticCells[1]!);
    assert.equal(groups.length, 2);
    assert.notEqual(groups[0]!.id, groups[1]!.id);
    assert.throws(
      () => f.service.receipt(csvContext("peer"), first.receipt.batch_id),
      appStatus(403),
    );
  } finally {
    f.db.close();
  }
});

test("fresh session and role/class facts control all CSV operations including replay", () => {
  const f = csvFixture();
  try {
    const first = f.submit();
    assert.throws(() => f.service.gate({ ...f.context, actor: null }, false), appStatus(401));
    for (const id of ["student", "disabled", "demo"])
      assert.throws(() => f.service.gate(csvContext(id), false), appStatus(403));
    assert.throws(
      () => f.service.preview(csvContext("other"), "class-A", CSV_SCHEMA, csvBytes()),
      appStatus(403),
    );
    assert.throws(
      () => f.service.preview(csvContext("admin"), "absent", CSV_SCHEMA, csvBytes()),
      appStatus(404),
    );
    for (const change of ["role='student'", "status='disabled'", "class_name='Synthetic B'"]) {
      f.db.exec(`UPDATE users SET ${change} WHERE id='teacher'`);
      assert.throws(() => f.submit(), appStatus(401));
      assert.throws(() => f.service.receipt(f.context, first.receipt.batch_id), appStatus(401));
      f.db.exec(
        "UPDATE users SET role='teacher',status='active',class_name='Synthetic A' WHERE id='teacher'",
      );
      // Restoring permissions does not revive the old session; a fresh sign-in does.
      assert.throws(() => f.submit(), appStatus(401));
      const sidHash = createHash("sha256").update(`synthetic-fresh-${change}`).digest("hex");
      f.db
        .prepare(
          "INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at) VALUES(?,'teacher','teacher',?,?)",
        )
        .run(sidHash, csvClock.now(), Date.parse("2035-01-01T00:00:00Z"));
      assert.ok(f.context.actor);
      f.context.actor.sidHash = sidHash;
      assert.deepEqual(f.submit().receipt, first.receipt);
    }
    f.db.exec("UPDATE sessions SET revoked_at='2026-09-05T00:00:00.000Z' WHERE user_id='teacher'");
    assert.throws(() => f.submit(), appStatus(401));
    f.db.exec("UPDATE sessions SET revoked_at=NULL,expires_at=0 WHERE user_id='teacher'");
    assert.throws(() => f.submit(), appStatus(401));
    assert.equal(f.db.isTransaction, false);
    const noSqlite = new CsvService(new SqliteCsvRepository(null, "test"), codec, codec, {
      allow: () => true,
    });
    assert.throws(() => noSqlite.gate(f.context, false), appStatus(503));
  } finally {
    f.db.close();
  }
});

test("rate limit is per actor and does not write business data", () => {
  const f = csvFixture();
  try {
    const before = csvSnapshot(f.db);
    for (let i = 0; i < 10; i++) f.service.gate(f.context, true);
    assert.throws(() => f.service.gate(f.context, true), appStatus(429));
    f.service.gate(csvContext("peer"), true);
    assert.deepEqual(csvSnapshot(f.db), before);
  } finally {
    f.db.close();
  }
});

test("commit reauthorizes inside its transaction after validation and class lookup have succeeded", () => {
  for (const change of [
    "UPDATE users SET role='student' WHERE id='teacher'",
    "UPDATE users SET class_name='Synthetic B' WHERE id='teacher'",
    "UPDATE users SET status='disabled' WHERE id='teacher'",
    "UPDATE sessions SET expires_at=0 WHERE user_id='teacher'",
  ]) {
    const f = csvFixture();
    try {
      const service = new CsvService(
        f.repo,
        {
          serialize: codec.serialize.bind(codec),
          parse(bytes) {
            const rows = codec.parse(bytes);
            f.db.exec(change);
            return rows;
          },
        },
        codec,
        { allow: () => true },
      );
      const before = csvSnapshot(f.db);
      const bytes = csvBytes();
      assert.throws(
        () =>
          service.import(
            f.context,
            "class-A",
            CSV_SCHEMA,
            "synthetic-toctou-token",
            codec.sha256(bytes),
            bytes,
          ),
        (e: unknown) => e instanceof AppError && [401, 403].includes(e.status),
      );
      assert.deepEqual(csvSnapshot(f.db), before);
      assert.equal(f.db.isTransaction, false);
    } finally {
      f.db.close();
    }
  }
});

test("renamed class keeps its original stable batch scope and pre-import cohort", () => {
  const f = csvFixture();
  try {
    const first = f.submit();
    f.db.exec(
      "UPDATE classes SET name='Synthetic Renamed' WHERE id='class-A'; UPDATE users SET class_name='Synthetic Renamed' WHERE id='teacher'",
    );
    assert.throws(() => f.submit(), appStatus(401));
    const sidHash = createHash("sha256").update("synthetic-renamed-session").digest("hex");
    f.db
      .prepare(
        "INSERT INTO sessions(sid_hash,user_id,role,created_at,expires_at) VALUES(?,'teacher','teacher',?,?)",
      )
      .run(sidHash, csvClock.now(), Date.parse("2035-01-01T00:00:00Z"));
    assert.ok(f.context.actor);
    f.context.actor.sidHash = sidHash;
    f.context.actor.class_name = "Synthetic Renamed";
    assert.deepEqual(f.submit().receipt, first.receipt);
    assert.equal(f.store.findActiveByClassId("class-A").length, 1);
    const second = f.submit(csvBytes(), "synthetic-renamed-token");
    assert.equal(second.receipt.class_id, first.receipt.class_id);
    assert.equal(second.receipt.class_name_snapshot, "Synthetic Renamed");
  } finally {
    f.db.close();
  }
});

test("busy writer is a retryable storage error and leaves no batch behind", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "csv-lock-"));
  try {
    const file = path.join(dir, "test.db");
    const f = csvFixture(file);
    const lock = openCsvDb(file);
    try {
      f.db.exec("PRAGMA busy_timeout=1");
      lock.exec("BEGIN IMMEDIATE");
      const before = csvSnapshot(f.db);
      assert.throws(() => f.submit(), appStatus(503));
      assert.equal(f.db.isTransaction, false);
      assert.deepEqual(csvSnapshot(f.db), before);
      lock.exec("ROLLBACK");
      assert.equal(f.submit().added_this_request, 1);
    } finally {
      if (lock.isTransaction) lock.exec("ROLLBACK");
      lock.close();
      f.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const stage of ["record", "mapping", "batch", "audit", "commit"] as const)
  test(`real SQLite fault after writes at ${stage} rolls back all batch state and permits same-token retry`, () => {
    const f = csvFixture();
    try {
      if (stage === "commit")
        f.store.add({
          ...validCommand(),
          id: "unmapped-record",
          created_by: "teacher",
          created_by_user_id: "teacher",
          created_at: csvClock.now(),
        });
      const before = csvSnapshot(f.db);
      const faults = {
        record:
          "BEFORE INSERT ON experiment_records WHEN (SELECT count(*) FROM experiment_records)>=2 BEGIN SELECT RAISE(ABORT,'synthetic record failure'); END",
        mapping:
          "BEFORE INSERT ON csv_import_rows WHEN NEW.row_number=3 BEGIN SELECT RAISE(ABORT,'synthetic mapping failure'); END",
        batch:
          "BEFORE INSERT ON csv_import_batches BEGIN SELECT RAISE(ABORT,'synthetic batch failure'); END",
        audit:
          "BEFORE INSERT ON audit_logs WHEN NEW.action='records.csv_import' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
        commit:
          "AFTER INSERT ON audit_logs WHEN NEW.action='records.csv_import' BEGIN INSERT INTO csv_import_rows VALUES('missing-batch',1,'unmapped-record'); END",
      };
      f.db.exec(`CREATE TEMP TRIGGER synthetic_fault ${faults[stage]}`);
      const bytes = csvBytes(Array.from({ length: 3 }, (_, i) => field(1, `synthetic-new-${i}`)));
      assert.throws(() => f.submit(bytes));
      assert.equal(f.db.isTransaction, false);
      assert.deepEqual(csvSnapshot(f.db), before);
      f.db.exec("DROP TRIGGER synthetic_fault");
      assert.equal(f.submit(bytes).added_this_request, 3);
    } finally {
      f.db.close();
    }
  });

test("correction, archival and reclassification preserve immutable receipts and current access", () => {
  const f = csvFixture();
  try {
    const first = f.submit();
    const id = first.receipt.rows[0]!.record_id;
    f.store.update(id, { note: "synthetic correction" });
    assert.deepEqual(f.submit().receipt, first.receipt);
    f.store.delete(id);
    assert.deepEqual(f.submit().receipt, first.receipt);
    assert.equal(f.store.findById(id), null);
    // A second active record can move classes while its original batch stays sealed.
    const second = f.submit(csvBytes(), "synthetic-second-batch");
    const moved = second.receipt.rows[0]!.record_id;
    f.store.update(moved, { class_name: "Synthetic B", group_name: "Synthetic G" });
    assert.throws(
      () => f.service.receipt(f.context, second.receipt.batch_id),
      appStatus(409, "BATCH_SCOPE_CHANGED"),
    );
    assert.deepEqual(
      f.service.receipt(csvContext("admin"), second.receipt.batch_id),
      second.receipt,
    );
  } finally {
    f.db.close();
  }
});

test("all rows use the same pre-import class cohort, independent of file order and other admin classes", () => {
  const statuses: string[][] = [];
  for (const reverse of [false, true]) {
    const f = csvFixture();
    try {
      for (const [i, oil] of [1, 1.1, 1.2, 1.3].entries())
        f.store.add({
          ...validCommand("Synthetic B"),
          oil_mass: oil,
          id: `cohort-${i}`,
          created_by: "admin",
          created_by_user_id: "admin",
          created_at: csvClock.now(),
        });
      const cells = [1, 1, 1, 1, 8].map((oil, i) => {
        const row = field(4, String(oil));
        row[0] = `synthetic-${i}`;
        return row;
      });
      if (reverse) cells.reverse();
      f.submit(csvBytes(cells), "synthetic-cohort-token", csvContext("admin"));
      const records = f.store.findAll({ class_name: "Synthetic A" });
      for (const record of records)
        assert.equal(record.review_status, diagnoseRecord(record, []).status);
      statuses.push(
        records
          .sort((a, b) => a.student_name.localeCompare(b.student_name))
          .map((r) => r.review_status),
      );
    } finally {
      f.db.close();
    }
  }
  assert.deepEqual(statuses[0], statuses[1]);
});

test("spreadsheet display protection covers all text classes while preserving stored values and deterministic bytes", () => {
  for (const text of [
    "=1+2",
    "+1",
    "-2",
    "@x",
    " =x",
    "\tplain",
    "\rplain",
    "\nplain",
    "\u0085plain",
    "\u00a0\u200b'=x",
    "'\uFEFF＋x",
    "＝1",
    "－1",
    "＠x",
    '=HYPERLINK("x,y;z")',
  ])
    assert.equal(spreadsheetText(text), `text:${text}`);
  for (const text of ["plain", " 中文 ", "<script>alert(1)</script>", "'plain", "1e3"])
    assert.equal(spreadsheetText(text), text);
  const f = csvFixture();
  try {
    const raw = ' \u200b\'=1+2,"x"\nnext';
    const first = f.submit(csvBytes([field(14, raw)]));
    f.submit(csvBytes(), "synthetic-other-class", csvContext("admin"), "class-B");
    const a = f.service.export(f.context, "class-A");
    assert.deepEqual(a.bytes, f.service.export(f.context, "class-A").bytes);
    const text = Buffer.from(a.bytes).toString();
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.ok(text.endsWith("\r\n"));
    assert.ok(text.startsWith('\uFEFF"record_id","class_id"'));
    const rows = parse<Record<string, string>>(a.bytes, { bom: true, columns: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.note, `text:${raw}`);
    assert.equal(rows[0]!.anomaly_flag, "false");
    assert.equal(rows[0]!.oil_mass_g, "1");
    assert.equal(rows[0]!.csv_import_batch_id, first.receipt.batch_id);
    assert.equal(rows[0]!.csv_source_row, "1");
    assert.equal(rows[0]!.petri_diameter_mm, "");
    assert.equal(f.store.findById(first.receipt.rows[0]!.record_id)!.note, raw);
    f.store.delete(first.receipt.rows[0]!.record_id);
    assert.deepEqual(
      f.service.export(f.context, "class-A").bytes,
      codec.serialize(CSV_EXPORT_HEADERS, []),
    );
    assert.throws(() => f.service.export(csvContext("other"), "class-A"), appStatus(403));
  } finally {
    f.db.close();
  }
});

test("export limits fail before serialization returns a partial file, including quote expansion", () => {
  const f = csvFixture();
  try {
    const repository: CsvRepository = Object.create(f.repo) as CsvRepository;
    repository.exportRows = () => [['"'.repeat(CSV_LIMITS.exportBytes / 2)]];
    const service = new CsvService(repository, codec, codec, { allow: () => true });
    assert.throws(() => service.export(f.context, "class-A"), appStatus(413));
    repository.exportRows = () => [[Infinity]];
    assert.throws(() => service.export(f.context, "class-A"), appStatus(500));
    for (let i = 0; i < 11; i++)
      f.submit(
        csvBytes(Array.from({ length: i === 10 ? 1 : 500 }, () => syntheticCells)),
        `synthetic-limit-${String(i).padStart(4, "0")}`,
      );
    assert.throws(() => f.service.export(f.context, "class-A"), appStatus(413));
  } finally {
    f.db.close();
  }
});

const parentSql =
  "INSERT INTO csv_import_batches(id,uploader_user_id,class_id,client_import_id,schema_version,raw_sha256,byte_length,row_count,created_at,completed_at,uploader_label_snapshot,class_name_snapshot,app_version,diagnostics_policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
function parentValues(overrides: Record<string, unknown> = {}) {
  return Object.values({
    id: "synthetic-batch",
    uploader: "teacher",
    class_id: "class-A",
    token: "synthetic-rawsql-token",
    schema: CSV_SCHEMA,
    hash: "a".repeat(64),
    bytes: 100,
    count: 1,
    created: csvClock.now(),
    completed: csvClock.now(),
    label: "teacher",
    class_name: "Synthetic A",
    version: "test",
    policy: CSV_DIAGNOSTICS,
    ...overrides,
  }) as (string | number | null)[];
}

test("raw SQL guards reject incomplete, misattributed and malformed seals; absent guard reproduction demonstrates necessity", () => {
  const f = csvFixture();
  try {
    for (const id of ["one", "two"])
      f.store.add({
        ...validCommand(),
        id,
        created_by: "teacher",
        created_by_user_id: "teacher",
        created_at: csvClock.now(),
      });
    const before = csvSnapshot(f.db);
    const reject = (operation: () => void) => {
      f.db.exec("BEGIN IMMEDIATE");
      try {
        assert.throws(operation);
      } finally {
        f.db.exec("ROLLBACK");
      }
      assert.deepEqual(csvSnapshot(f.db), before);
      assert.equal(f.db.isTransaction, false);
    };
    reject(() => f.db.prepare(parentSql).run(...parentValues()));
    reject(() => {
      f.db.exec("INSERT INTO csv_import_rows VALUES('synthetic-batch',1,'one')");
      f.db.exec("COMMIT");
    });
    for (const change of [
      { count: 2 },
      { count: 0 },
      { count: 1.5 },
      { hash: "a".repeat(63) + "Z" },
      { hash: "a".repeat(64) + "\0x" },
      { bytes: 0 },
      { bytes: 1048577 },
      { class_id: "class-B", class_name: "Synthetic B" },
      { uploader: "peer", label: "peer" },
      { label: "spoof" },
      { schema: "unknown" },
      { policy: "unknown" },
      { token: "short" },
      { token: "valid-token-12345\0x" },
      { created: "2026-02-30T00:00:00.000Z" },
      { completed: "2026-09-04T00:00:00.000Z" },
    ])
      reject(() => {
        f.db.exec("INSERT INTO csv_import_rows VALUES('synthetic-batch',1,'one')");
        f.db.prepare(parentSql).run(...parentValues(change));
      });
    reject(() => {
      f.db.exec(
        "INSERT INTO csv_import_rows VALUES('synthetic-batch',1,'one'),('synthetic-batch',3,'two')",
      );
      f.db.prepare(parentSql).run(...parentValues({ count: 2 }));
    });
    reject(() =>
      f.db.exec(
        "INSERT INTO csv_import_rows VALUES('synthetic-batch',1,'one'),('other-batch',1,'one')",
      ),
    );
    // In this isolated test only, removing completeness allows a false row_count to commit.
    f.db.exec(
      "BEGIN; DROP TRIGGER csv_batch_complete; INSERT INTO csv_import_rows VALUES('synthetic-batch',1,'one')",
    );
    f.db.prepare(parentSql).run(...parentValues({ count: 2 }));
    assert.equal(f.db.prepare("SELECT row_count FROM csv_import_batches").get()!.row_count, 2);
    f.db.exec("ROLLBACK");
    assert.deepEqual(csvSnapshot(f.db), before);
  } finally {
    f.db.close();
  }
});

test("sealed tables reject append/update/delete and INSERT OR REPLACE without destroying prior evidence", () => {
  const f = csvFixture();
  try {
    const first = f.submit();
    const before = csvSnapshot(f.db);
    const batch = first.receipt.batch_id;
    const id = first.receipt.rows[0]!.record_id;
    for (const sql of [
      "UPDATE csv_import_batches SET row_count=2",
      "DELETE FROM csv_import_batches",
      "UPDATE csv_import_rows SET row_number=2",
      "DELETE FROM csv_import_rows",
      "INSERT OR REPLACE INTO csv_import_batches SELECT * FROM csv_import_batches",
      "INSERT OR REPLACE INTO csv_import_rows SELECT * FROM csv_import_rows",
    ]) {
      assert.throws(() => f.db.exec(sql));
      assert.deepEqual(csvSnapshot(f.db), before);
    }
    assert.throws(() =>
      f.db.prepare("INSERT INTO csv_import_rows VALUES(?,?,?)").run(batch, 2, id),
    );
    assert.deepEqual(csvSnapshot(f.db), before);
    assert.equal(f.db.isTransaction, false);
  } finally {
    f.db.close();
  }
});

test("raw SQL cannot attach offline or legacy records to a new CSV seal", () => {
  const f = csvFixture(":memory:", true, 1);
  try {
    const legacy = {
      ...validCommand(),
      id: "legacy",
      created_by: "Historical synthetic label",
      created_at: csvClock.now(),
    };
    f.db
      .prepare(
        "INSERT INTO records(id,class_name,created_by,student_name,nh4cl_concentration,yield_percent,created_at,data_json) VALUES('legacy','Synthetic A','Historical synthetic label','Synthetic 学生',3,1,?,?)",
      )
      .run(csvClock.now(), JSON.stringify(legacy));
    runMigrations(f.db);
    assert.notEqual(
      f.db.prepare("SELECT submission_kind FROM experiment_records WHERE id='legacy'").get()!
        .submission_kind,
      "canonical_submission",
    );
    f.store.add({
      ...validCommand(),
      id: "offline",
      created_by: "teacher",
      created_by_user_id: "teacher",
      created_at: csvClock.now(),
      synced_from_offline: true,
      client_submission_id: "synthetic-offline-id",
    });
    const before = csvSnapshot(f.db);
    for (const id of ["offline", "legacy"]) {
      f.db.exec("BEGIN IMMEDIATE");
      try {
        f.db.prepare("INSERT INTO csv_import_rows VALUES('synthetic-batch',1,?)").run(id);
        assert.throws(() => f.db.prepare(parentSql).run(...parentValues()));
      } finally {
        f.db.exec("ROLLBACK");
      }
      assert.deepEqual(csvSnapshot(f.db), before);
      assert.equal(f.db.isTransaction, false);
    }
  } finally {
    if (f.db.isTransaction) f.db.exec("ROLLBACK");
    f.db.close();
  }
});

test("export orders mixed records by binary ID and preserves existing measurement methods without invented CSV provenance", () => {
  const f = csvFixture();
  try {
    for (const [id, method] of [
      ["z", "not_recorded_legacy"],
      ["A", "manual_local_image_calibrated"],
      ["a", "not_recorded"],
    ] as const) {
      f.store.add({
        ...validCommand(),
        id,
        created_by: "teacher",
        created_by_user_id: "teacher",
        created_at: csvClock.now(),
        measurement_method: method,
        petri_diameter_mm: 90,
      });
    }
    const rows = parse<Record<string, string>>(f.service.export(f.context, "class-A").bytes, {
      bom: true,
      columns: true,
    });
    assert.deepEqual(
      rows.map((r) => r.record_id),
      ["A", "a", "z"],
    );
    assert.deepEqual(
      rows.map((r) => r.measurement_method),
      ["manual_local_image_calibrated", "not_recorded", "not_recorded_legacy"],
    );
    for (const row of rows) {
      assert.equal(row.csv_import_batch_id, "");
      assert.equal(row.csv_source_row, "");
    }
  } finally {
    f.db.close();
  }
});

test("Migration 013 upgrades schema12 data, is idempotent, rolls back mid-failure and preserves Migration 012", () => {
  const db = openCsvDb();
  try {
    seedCsv(db, 12);
    const users = db.prepare("SELECT * FROM users").all();
    const failing = {
      ...MIGRATIONS[12]!,
      up(
        database: typeof db,
        context: Parameters<NonNullable<(typeof MIGRATIONS)[number]["up"]>>[1],
      ) {
        MIGRATIONS[12]!.up(database, context);
        throw new Error("synthetic migration fault");
      },
    };
    assert.throws(() => runMigrations(db, [...MIGRATIONS.slice(0, 12), failing], csvClock.now));
    assert.equal(db.isTransaction, false);
    assert.equal(
      db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='csv_import_batches'").get()!.n,
      0,
    );
    assert.equal(runMigrations(db, MIGRATIONS.slice(0, 13)).currentVersion, 13);
    const schema = db.prepare("SELECT * FROM sqlite_master ORDER BY name").all();
    runMigrations(db, MIGRATIONS.slice(0, 13));
    assert.deepEqual(db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(), schema);
    assert.deepEqual(db.prepare("SELECT * FROM users").all(), users);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      createHash("sha256")
        .update(
          readFileSync(
            "src/infrastructure/database/migrations/012-historical-legacy-review-quarantine.ts",
          ),
        )
        .digest("hex"),
      "c7db6b4f7b3b9078247043a69b37e4afaa93e3731480a5d4c16490c457fda404",
    );
  } finally {
    db.close();
  }
});

test("disk reopen after a lost response replays the same committed IDs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "csv-durable-"));
  try {
    const file = path.join(dir, "test.db");
    const first = csvFixture(file);
    const receipt = first.submit().receipt;
    first.db.close();
    const reopened = csvFixture(file, false);
    try {
      const retry = reopened.submit();
      assert.deepEqual(retry.receipt, receipt);
      assert.equal(retry.added_this_request, 0);
      assert.equal(csvSnapshot(reopened.db).audit_logs!.length, 1);
    } finally {
      reopened.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("independent processes racing the same token converge to one batch and one success audit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "csv-race-"));
  try {
    const file = path.join(dir, "test.db");
    const f = csvFixture(file);
    f.db.exec("PRAGMA journal_mode=WAL");
    f.db.close();
    const children = [0, 1].map(() =>
      fork("dist/tests/fixtures/csv-race-worker.js", [file], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      }),
    );
    const ready = children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("message", () => resolve());
          child.once("error", reject);
        }),
    );
    await Promise.all(ready);
    const results = children.map(
      (child) =>
        new Promise<{ batch: string; added: number }>((resolve, reject) => {
          child.once("message", resolve);
          child.once("error", reject);
          child.once("exit", (code) => {
            if (code) reject(new Error(`race worker exit ${code}`));
          });
        }),
    );
    for (const child of children) child.send("go");
    const outcomes = await Promise.all(results);
    assert.equal(outcomes[0]!.batch, outcomes[1]!.batch);
    assert.equal(
      outcomes.reduce((n, r) => n + r.added, 0),
      1,
    );
    const reopened = csvFixture(file, false);
    try {
      const snap = csvSnapshot(reopened.db);
      assert.equal(snap.csv_import_batches!.length, 1);
      assert.equal(snap.experiment_records!.length, 1);
      assert.equal(snap.audit_logs!.length, 1);
    } finally {
      reopened.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
