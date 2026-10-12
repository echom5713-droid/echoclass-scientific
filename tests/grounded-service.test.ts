import assert from "node:assert/strict";
import test from "node:test";
import { GroundedService, type GroundedRanker } from "../src/application/grounded-service.js";
import { AppError } from "../src/application/errors.js";
import type { AuditEvent } from "../src/domain/types.js";
import { csvContext } from "./csv-test-helpers.js";
import { groundedFixture } from "./grounded-test-helpers.js";
import { SqliteDocumentRetriever } from "../src/infrastructure/database/sqlite-document-retriever.js";
import type { DocumentRetriever } from "../src/domain/grounded/retrieval.js";

function fixture(ranker: GroundedRanker | null = null, retriever: DocumentRetriever | null = null) {
  const run = groundedFixture(),
    events: AuditEvent[] = [];
  const state = { authorized: true, rate: true, auditHook: () => {} };
  const check = () => {
    if (!state.authorized) throw new AppError("FORBIDDEN", "revoked", 403);
  };
  const service = new GroundedService(
    {
      gate: () => {
        check();
        return { id: "teacher", role: "teacher" as const };
      },
      get: () => {
        check();
        return run;
      },
    },
    { allow: () => state.rate },
    {
      write: async (event) => {
        events.push(event);
        state.auditHook();
      },
    },
    ranker,
    retriever,
  );
  return {
    run,
    events,
    state,
    service,
    explain: (use_model = false) =>
      service.explain(csvContext(), run.id, { topic: "best", use_model }),
  };
}

test("retrieval authorizes again after audit; neither audit nor response retain question PII", async (t) => {
  const retriever = new SqliteDocumentRetriever("resources/knowledge/echoclass-guide.md");
  t.after(() => retriever.close());
  const f = fixture(null, retriever);
  const answer = await f.service.sources(csvContext(), f.run.id, {
    question: "姓名: PRIVATE_PERSON; student id: PRIVATE_ID; bootstrap",
  });
  assert.equal(answer.status, "sources_found");
  assert.equal(answer.pii_redacted, true);
  assert.doesNotMatch(JSON.stringify([f.events, answer]), /PRIVATE_PERSON|PRIVATE_ID/);
  assert.equal(f.events[0]!.action, "grounded.retrieve");
  f.state.auditHook = () => {
    f.state.authorized = false;
  };
  await assert.rejects(f.service.sources(csvContext(), f.run.id, { question: "bootstrap" }), {
    status: 403,
  });
});

test("retrieval unavailable, invalid question and exhausted shared limit fail closed", async () => {
  const f = fixture();
  await assert.rejects(f.service.sources(csvContext(), f.run.id, { question: "bootstrap" }), {
    status: 503,
  });
  await assert.rejects(
    f.service.sources(csvContext(), f.run.id, { question: "bootstrap", context: "forged" }),
    { status: 400 },
  );
  f.state.rate = false;
  await assert.rejects(f.service.sources(csvContext(), f.run.id, { question: "bootstrap" }), {
    status: 429,
  });
  assert.equal(f.events.length, 0);
});
test("grounded default path never calls configured provider; audit stores no report text", async () => {
  let calls = 0;
  const f = fixture({
    configured: () => true,
    rank: async () => {
      calls++;
      throw Error("must not call");
    },
  });
  const answer = await f.explain();
  assert.equal(calls, 0);
  assert.equal(answer.mode, "deterministic");
  assert.equal(f.events.length, 1);
  assert.deepEqual(Object.keys(f.events[0]!.detail!).sort(), [
    "answer_hash",
    "evidence_hash",
    "mode",
    "reason",
    "topic",
  ]);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE_|concentrations|平均得率/);
});
test("only static topic/card metadata reaches optional model; every caution survives reordering", async () => {
  let received: unknown;
  const f = fixture({
    configured: () => true,
    rank: async (input) => {
      received = input;
      return JSON.stringify({ card_ids: input.cards.map((card) => card.id).reverse() });
    },
  });
  const result = await f.explain(true);
  assert.equal(result.mode, "model-ranked");
  assert.equal(result.cards[0]!.id, "method.limitations");
  assert.deepEqual(Object.keys(received as object).sort(), ["cards", "topic"]);
  assert.doesNotMatch(
    JSON.stringify(received),
    /PRIVATE_|synthetic-grounded-report|sha256|9|student|note|dataset/,
  );
});
test("missing, throwing and forged provider outputs preserve deterministic evidence", async () => {
  for (const ranker of [
    null,
    {
      configured: () => true,
      rank: async () => {
        throw Error("secret upstream text");
      },
    },
    { configured: () => true, rank: async () => '{"card_ids":["forged"]}' },
  ]) {
    const f = fixture(ranker),
      expected = await f.explain(),
      fallback = await f.explain(true);
    assert.equal(fallback.mode, "offline-fallback");
    assert.deepEqual(fallback.cards, expected.cards);
    assert.equal(fallback.answer_hash, expected.answer_hash);
    assert.doesNotMatch(JSON.stringify(fallback), /secret upstream/);
  }
});
test("revocation during model or audit wait prevents returning evidence", async () => {
  let revoke = () => {};
  const f = fixture({
    configured: () => true,
    rank: async (input) => {
      revoke();
      return JSON.stringify({ card_ids: input.cards.map((card) => card.id) });
    },
  });
  revoke = () => {
    f.state.authorized = false;
  };
  await assert.rejects(f.explain(true), { status: 403 });
  assert.equal(f.events.length, 0);
  const g = fixture();
  g.state.auditHook = () => {
    g.state.authorized = false;
  };
  await assert.rejects(g.explain(), { status: 403 });
});
test("authority, completion and rate limits reject before provider work", async () => {
  let calls = 0;
  const f = fixture({
    configured: () => true,
    rank: async () => {
      calls++;
      return "";
    },
  });
  f.state.authorized = false;
  await assert.rejects(f.explain(true), { status: 403 });
  f.state.authorized = true;
  f.state.rate = false;
  await assert.rejects(f.explain(true), { status: 429 });
  f.state.rate = true;
  f.run.status = "running";
  await assert.rejects(f.explain(true), { status: 409 });
  assert.equal(calls, 0);
});
