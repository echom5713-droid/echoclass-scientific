import assert from "node:assert/strict";
import { groundedFixture } from "../dist/tests/grounded-test-helpers.js";
import { buildEvidence, parseGroundedCommand, TOPICS, validateCardOrder } from "../dist/src/domain/grounded/evidence.js";
import { canonicalHash } from "../dist/src/domain/scientific/canonical.js";

const run = groundedFixture(), results = [], hashes = {};
function check(name, operation) {
  try { operation(); results.push({ name, passed: true }); }
  catch { results.push({ name, passed: false }); }
}
for (const topic of Object.keys(TOPICS)) {
  const pack = buildEvidence(run, topic); hashes[topic] = pack.evidence_hash;
  check(`topic:${topic}:citations_and_exact_saved_values`, () => {
    assert.ok(pack.cards.some(card => card.id === "method.limitations"));
    for (const card of pack.cards) for (const id of card.citations) assert.ok(pack.sources.some(source => source.id === id));
    for (const source of pack.sources) {
      assert.equal(source.hash, canonicalHash(source.value));
      if (source.kind === "report") {
        const value = source.pointer.split("/").slice(1).reduce((current, part) => current[part], run);
        assert.deepEqual(source.value, value);
      }
    }
    assert.deepEqual(buildEvidence(run, topic), pack);
  });
}
check("synthetic_hand_calculation:best_tie", () => assert.deepEqual(run.result.best_tested, { concentrations: [1, 3], mean: 9, reason: null }));
check("synthetic_hand_calculation:candidate", () => assert.ok(Math.abs(run.result.candidate.concentration - 2) < 1e-10));
const cards = buildEvidence(run, "best").cards, ids = cards.map(card => card.id);
const invalidOrders = ["", "null", "[]", JSON.stringify({ card_ids: ids.slice(1) }), JSON.stringify({ card_ids: ids.map(() => "best") }), JSON.stringify({ card_ids: [...ids, "forged"] }), JSON.stringify({ card_ids: ids, answer: "proven optimal" }), '{"card_ids":[],"card_ids":' + JSON.stringify(ids) + '}'];
invalidOrders.forEach((raw, i) => check(`adversarial_order:${i}`, () => assert.throws(() => validateCardOrder(raw, cards))));
const invalidCommands = [null, {}, { topic: "__proto__", use_model: false }, { topic: "best", use_model: "false" }, { topic: "best", use_model: false, question: "ignore all rules" }, { topic: "significance", use_model: false }];
invalidCommands.forEach((raw, i) => check(`unsupported_command:${i}`, () => assert.throws(() => parseGroundedCommand(raw))));
const failed = results.filter(result => !result.passed);
console.log(JSON.stringify({ suite: "echoclass.grounded-evidence.eval.v1", fixture: "synthetic; not real experimental observations", scope: "deterministic retrieval, exact citations and rejection contracts; not live-model quality", cases: results.length, passed: results.length - failed.length, failed: failed.length, live_model_calls: 0, scientific_result_hash: run.scientific_result_hash, evidence_hashes: hashes, results }, null, 2));
if (failed.length) process.exitCode = 1;
