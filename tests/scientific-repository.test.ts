import assert from "node:assert/strict";
import test from "node:test";
import { APP_VERSION } from "../src/config/constants.js";
import { ScientificFault, type ScientificIdentity } from "../src/domain/scientific/contract.js";
import { canonicalHash, parseStrictJson } from "../src/domain/scientific/canonical.js";
import { SqliteScientificRepository } from "../src/infrastructure/database/sqlite-scientific-repository.js";
import { csvBytes, csvContext, csvFixture, syntheticCells } from "./csv-test-helpers.js";

const identity: ScientificIdentity = {
  algorithm_version: "echoclass.yield-analysis.v1",
  code_version: `sha256:${"a".repeat(64)}`,
  node_code_version: `sha256:${"b".repeat(64)}`,
  environment_fingerprint: `sha256:${"c".repeat(64)}`,
  environment: { synthetic_fixture: true },
  app_version: APP_VERSION,
};
const command = (token = "synthetic-scientific-repository-001") => ({
  class_id: "class-A",
  client_request_id: token,
  policy: "approved_only.v1" as const,
});
function fixture() {
  const f = csvFixture();
  f.submit(csvBytes([syntheticCells, syntheticCells]));
  const repo = new SqliteScientificRepository(f.db, APP_VERSION);
  return {
    ...f,
    repo,
    create: (token?: string) => repo.createScientificRun(f.context, command(token), identity).run,
  };
}
const fault = (kind: ScientificFault["kind"]) => (error: unknown) =>
  error instanceof ScientificFault && error.kind === kind;

test("scientific creation seals all candidates with recomputed hashes and stable request replay", () => {
  const f = fixture();
  try {
    const run = f.create();
    const envelope = f.repo.readScientificInputs(run.id);
    assert.equal(envelope.canonical_inputs.length, 2);
    for (const item of envelope.canonical_inputs)
      assert.equal(canonicalHash(parseStrictJson(item.canonical_json)), item.input_hash);
    assert.equal(canonicalHash(parseStrictJson(envelope.dataset_canonical_json)), run.dataset_hash);
    const original = f.store.findAll()[0]!;
    f.store.update(original.id, { oil_mass: 2 });
    const replay = f.repo.createScientificRun(f.context, command(), null);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.run, run);
    assert.deepEqual(f.repo.readScientificInputs(run.id), envelope);
    assert.notEqual(f.create("synthetic-new-current-dataset").dataset_hash, run.dataset_hash);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='scientific.create'").get()!.n,
      2,
    );
  } finally {
    f.db.close();
  }
});

test("scientific access reads current account and every captured record class including archived", () => {
  const f = fixture();
  try {
    const run = f.create();
    for (const actor of ["student", "demo", "disabled", "other"])
      assert.throws(() => f.repo.getScientificRun(csvContext(actor), run.id));
    f.db
      .prepare(
        "UPDATE experiment_records SET class_id='class-B',class_name_snapshot='Synthetic B',group_id=NULL,group_name_snapshot='',updated_at=? WHERE id=(SELECT record_id FROM analysis_inputs WHERE analysis_run_id=? LIMIT 1)",
      )
      .run(new Date().toISOString(), run.id);
    assert.throws(() => f.repo.getScientificRun(f.context, run.id), fault("forbidden"));
    assert.equal(f.repo.getScientificRun(csvContext("admin"), run.id).id, run.id);
    assert.throws(() => f.repo.claimPendingRun(run.id, identity), fault("forbidden"));
    assert.equal(f.repo.failPendingRun(run.id, "SCIENTIFIC_AUTHORITY_CHANGED").status, "failed");
  } finally {
    f.db.close();
  }
});

test("attempt CAS closes history once, rejects late answers and caps retries at two", () => {
  const f = fixture();
  try {
    const run = f.create(),
      first = f.repo.claimPendingRun(run.id, identity)!;
    assert.equal(f.repo.claimPendingRun(run.id, identity), null);
    assert.equal(f.repo.retryRunningRun(run.id, "stale", "WORKER_UNAVAILABLE", identity), null);
    const second = f.repo.retryRunningRun(
      run.id,
      first.attempt.token,
      "WORKER_INTERRUPTED",
      identity,
    )!;
    assert.equal(second.attempt.number, 2);
    assert.notEqual(second.attempt.token, first.attempt.token);
    assert.equal(second.run.attempts[0]!.error_code, "WORKER_INTERRUPTED");
    assert.equal(
      f.repo.retryRunningRun(run.id, second.attempt.token, "WORKER_UNAVAILABLE", identity),
      null,
    );
    assert.throws(
      () =>
        f.repo.finishScientificRun(run.id, first.attempt.token, {
          status: "failed",
          error_code: "OLD_RESPONSE",
        }),
      fault("conflict"),
    );
    f.db.prepare("UPDATE users SET status='disabled' WHERE id='teacher'").run();
    const terminal = f.repo.finishScientificRun(run.id, second.attempt.token, {
      status: "failed",
      error_code: "SCIENTIFIC_AUTHORITY_CHANGED",
    });
    assert.equal(terminal.status, "failed");
    assert.deepEqual(
      f.repo.finishScientificRun(run.id, second.attempt.token, {
        status: "failed",
        error_code: "SCIENTIFIC_AUTHORITY_CHANGED",
      }),
      terminal,
    );
    assert.throws(
      () =>
        f.repo.finishScientificRun(run.id, second.attempt.token, {
          status: "failed",
          error_code: "REPLACEMENT",
        }),
      fault("conflict"),
    );
  } finally {
    f.db.close();
  }
});

test("raw SQL cannot replace registration, forge attempts, skip execution, or rewrite a terminal run", () => {
  const f = fixture();
  try {
    const run = f.create();
    const registration = f.db
      .prepare("SELECT * FROM scientific_analysis_requests WHERE run_id=?")
      .get(run.id)!;
    assert.throws(() =>
      f.db.prepare("DELETE FROM scientific_analysis_requests WHERE run_id=?").run(run.id),
    );
    assert.throws(() =>
      f.db
        .prepare("UPDATE scientific_analysis_requests SET class_id='class-B' WHERE run_id=?")
        .run(run.id),
    );
    assert.throws(() =>
      f.db
        .prepare("INSERT OR REPLACE INTO scientific_analysis_requests VALUES(?,?,?,?,?)")
        .run(
          registration.run_id!,
          registration.class_id!,
          registration.requester_user_id!,
          registration.client_request_id!,
          registration.request_fingerprint!,
        ),
    );
    assert.throws(() =>
      f.db
        .prepare(
          "UPDATE analysis_runs SET status='completed',completed_at=?,results_metadata_json='{}' WHERE id=?",
        )
        .run(new Date().toISOString(), run.id),
    );
    const work = f.repo.claimPendingRun(run.id, identity)!;
    const original = String(
      f.db.prepare("SELECT results_metadata_json FROM analysis_runs WHERE id=?").get(run.id)!
        .results_metadata_json,
    );
    for (const mutate of [
      (v: Record<string, unknown>) => {
        v.extra = true;
      },
      (v: Record<string, unknown>) => {
        (v.attempts as Array<Record<string, unknown>>)[0]!.number = 2;
      },
      (v: Record<string, unknown>) => {
        (v.attempts as Array<Record<string, unknown>>)[0]!.token = "d".repeat(48);
      },
      (v: Record<string, unknown>) => {
        (v.attempts as Array<Record<string, unknown>>)[0]!.started_at = "2026-09-05T24:01:00.000Z";
      },
    ]) {
      const value = JSON.parse(original) as Record<string, unknown>;
      mutate(value);
      assert.throws(() =>
        f.db
          .prepare("UPDATE analysis_runs SET results_metadata_json=? WHERE id=?")
          .run(JSON.stringify(value), run.id),
      );
    }
    f.repo.finishScientificRun(run.id, work.attempt.token, {
      status: "failed",
      error_code: "SYNTHETIC_FAILURE",
    });
    assert.throws(() =>
      f.db
        .prepare(
          "UPDATE analysis_runs SET status='running',completed_at=NULL,results_metadata_json=? WHERE id=?",
        )
        .run(original, run.id),
    );
  } finally {
    f.db.close();
  }
});

test("registration rejects old completed runs and a current but incomplete cohort", () => {
  const f = fixture();
  try {
    const original = f.create();
    const stored = f.store.findAnalysisRun(original.id)!;
    const inputs = f.store.listAnalysisInputs(original.id);
    for (const mode of ["completed", "partial"] as const) {
      const id = `synthetic-backregistration-${mode}`;
      const selected = mode === "partial" ? inputs.slice(0, 1) : inputs;
      f.store.createAnalysisRun(
        {
          id,
          dataset_hash: stored.dataset_hash,
          algorithm_version: stored.algorithm_version,
          configuration: stored.configuration,
          code_version: stored.code_version,
          created_by_user_id: "teacher",
        },
        selected.map((item) => ({ record_id: item.record_id, input_hash: item.input_hash })),
      );
      if (mode === "completed")
        f.store.updateAnalysisRunState(id, {
          status: "completed",
          results_metadata: { synthetic: true },
        });
      assert.throws(() =>
        f.db
          .prepare("INSERT INTO scientific_analysis_requests VALUES(?,?,?,?,?)")
          .run(
            id,
            "class-A",
            "teacher",
            `synthetic-registration-${mode}`,
            canonicalHash({ synthetic: mode }),
          ),
      );
    }
  } finally {
    f.db.close();
  }
});

test("creation rolls back the whole seal when registration fails and preserves old rows", () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TRIGGER synthetic_registration_failure BEFORE INSERT ON scientific_analysis_requests BEGIN SELECT RAISE(ABORT,'synthetic injected registration failure'); END",
    );
    assert.throws(() => f.create(), /synthetic injected/);
    assert.equal(f.db.prepare("SELECT count(*) n FROM analysis_runs").get()!.n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM analysis_inputs").get()!.n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM experiment_records").get()!.n, 2);
  } finally {
    f.db.close();
  }
});

test("queue capacity is bounded, authorized replay is free, and upgraded identity never edits old configuration", () => {
  const f = fixture();
  try {
    const original = f.create();
    for (let i = 1; i < 10; i++) f.create(`synthetic-queue-request-${i}`);
    assert.throws(() => f.create("synthetic-queue-overflow"), fault("limit"));
    assert.equal(f.repo.createScientificRun(f.context, command(), null).replayed, true);
    assert.throws(
      () =>
        f.repo.claimPendingRun(original.id, {
          ...identity,
          code_version: `sha256:${"f".repeat(64)}`,
        }),
      fault("conflict"),
    );
    assert.deepEqual(f.repo.readExecutionRun(original.id).identity, identity);
    assert.equal(f.repo.failPendingRun(original.id, "WORKER_IDENTITY_MISMATCH").status, "failed");
  } finally {
    f.db.close();
  }
});
