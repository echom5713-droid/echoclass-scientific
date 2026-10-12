import assert from "node:assert/strict";
import test from "node:test";
import { APP_VERSION } from "../src/config/constants.js";
import { ScientificDispatcher } from "../src/application/scientific-dispatcher.js";
import {
  ScientificWorkerError,
  type ScientificWorker,
} from "../src/application/scientific-worker.js";
import type { ScientificIdentity } from "../src/domain/scientific/contract.js";
import { SqliteScientificRepository } from "../src/infrastructure/database/sqlite-scientific-repository.js";
import { csvFixture } from "./csv-test-helpers.js";

const identity: ScientificIdentity = {
  algorithm_version: "echoclass.yield-analysis.v1",
  code_version: `sha256:${"a".repeat(64)}`,
  node_code_version: `sha256:${"b".repeat(64)}`,
  environment_fingerprint: `sha256:${"c".repeat(64)}`,
  environment: { synthetic: true },
  app_version: APP_VERSION,
};
function fixture(
  analyze: ScientificWorker["analyze"],
  wait: (ms: number) => Promise<void> = async () => {},
) {
  const f = csvFixture();
  f.submit();
  const repo = new SqliteScientificRepository(f.db, APP_VERSION);
  const worker: ScientificWorker = { identity: () => identity, ready: async () => true, analyze };
  const dispatcher = new ScientificDispatcher(repo, worker, identity, () => {}, wait);
  const create = () =>
    repo.createScientificRun(
      f.context,
      {
        class_id: "class-A",
        client_request_id: "synthetic-dispatcher-run-001",
        policy: "approved_only.v1",
      },
      identity,
    ).run;
  return { ...f, repo, worker, dispatcher, create };
}

test("a kick during the previous empty pump completion is not lost", async () => {
  const f = fixture(async () => {
    throw new ScientificWorkerError("INVALID_INPUT", false);
  });
  try {
    await f.dispatcher.start();
    const run = f.create();
    f.dispatcher.kick();
    await f.dispatcher.drain();
    assert.equal(f.repo.readExecutionRun(run.id).status, "failed");
    assert.equal(f.repo.readExecutionRun(run.id).attempts.length, 1);
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
test("a transient worker failure retries exactly once with persisted attempt history", async () => {
  let calls = 0;
  const waits: number[] = [];
  const f = fixture(
    async () => {
      calls++;
      throw new ScientificWorkerError("WORKER_DEADLINE", true);
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  try {
    const run = f.create();
    await f.dispatcher.start();
    await f.dispatcher.drain();
    const saved = f.repo.readExecutionRun(run.id);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [5000]);
    assert.equal(saved.status, "failed");
    assert.equal(saved.attempts.length, 2);
    assert.equal(saved.attempts[0]!.error_code, "WORKER_DEADLINE");
    assert.equal(saved.error_code, "WORKER_DEADLINE");
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
test("malformed worker output is terminal and never retried as a connection problem", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { result: { forged: true }, identity };
  });
  try {
    const run = f.create();
    await f.dispatcher.start();
    await f.dispatcher.drain();
    const saved = f.repo.readExecutionRun(run.id);
    assert.equal(saved.status, "failed");
    assert.equal(calls, 1);
    assert.equal(saved.attempts.length, 1);
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
test("revocation during retry backoff closes the run instead of leaving it running", async () => {
  let calls = 0;
  const f = fixture(
    async () => {
      calls++;
      throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
    },
    async () => {
      f.db.prepare("UPDATE users SET status='disabled' WHERE id='teacher'").run();
    },
  );
  try {
    const run = f.create();
    await f.dispatcher.start();
    await f.dispatcher.drain();
    const saved = f.repo.readExecutionRun(run.id);
    assert.equal(saved.status, "failed");
    assert.equal(calls, 1);
    assert.equal(saved.error_code, "SCIENTIFIC_AUTHORITY_CHANGED");
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
test("an interrupted second attempt fails without a third calculation", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    throw new Error("should not run");
  });
  try {
    const run = f.create();
    const first = f.repo.claimPendingRun(run.id, identity)!;
    f.repo.retryRunningRun(run.id, first.attempt.token, "WORKER_DEADLINE", identity);
    await f.dispatcher.start();
    await f.dispatcher.drain();
    const saved = f.repo.readExecutionRun(run.id);
    assert.equal(saved.status, "failed");
    assert.equal(saved.error_code, "WORKER_INTERRUPTED");
    assert.equal(calls, 0);
    assert.equal(saved.attempts.length, 2);
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
test("shutdown does not accept a late asynchronous response", async () => {
  let release!: (value: unknown) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = fixture(async () => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  try {
    const run = f.create();
    await f.dispatcher.start();
    await began;
    f.dispatcher.stop();
    release({ bad: true });
    await f.dispatcher.drain();
    assert.equal(f.repo.readExecutionRun(run.id).status, "running");
  } finally {
    f.dispatcher.stop();
    f.db.close();
  }
});
