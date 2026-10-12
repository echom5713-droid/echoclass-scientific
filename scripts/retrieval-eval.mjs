import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SqliteDocumentRetriever } from "../dist/src/infrastructure/database/sqlite-document-retriever.js";
import { parseRetrievalCommand, retrieveAnswer } from "../dist/src/domain/grounded/retrieval.js";
import { canonicalHash } from "../dist/src/domain/scientific/canonical.js";

const cases = JSON.parse(readFileSync(new URL("../data/evaluation/retrieval-v1.json", import.meta.url), "utf8"));
const retriever = new SqliteDocumentRetriever(path.resolve("resources/knowledge/echoclass-guide.md"));
const results = [];
try {
  for (const item of cases) {
    const answer = retrieveAnswer(parseRetrievalCommand({ question: item.question }), retriever);
    let error = null;
    try {
      assert.equal(answer.status, item.expected_behavior, "behavior");
      for (const source of item.expected_sources) assert.ok(answer.citations.some(c => c.chunk_id === source), `source ${source}`);
      const text = answer.answer + answer.citations.map(c => c.content).join("\n");
      for (const point of item.required_points) assert.ok(text.includes(point), `required point ${point}`);
      for (const claim of item.forbidden_claims) assert.ok(!text.includes(claim), `forbidden claim ${claim}`);
      for (const citation of answer.citations) {
        assert.deepEqual(citation, retriever.source(citation.chunk_id));
        assert.equal(citation.content_hash, canonicalHash(citation.content));
      }
      const { answer_hash, ...body } = answer;
      assert.equal(answer_hash, canonicalHash(body));
      assert.equal(answer.provider, "local-extractive");
      assert.equal(answer.model, null);
    } catch (failure) { error = failure.message; }
    results.push({ id: item.id, category: item.category, passed: error === null, status: answer.status, sources: answer.citations.map(c => c.chunk_id), answer_hash: answer.answer_hash, error });
  }
  const passed = results.filter(r => r.passed).length;
  console.log(JSON.stringify({ schema: "echoclass.retrieval-evaluation.v1", corpus_version: retriever.corpusVersion, scope: "Developer-authored offline regression questions; no holdout, live model, human rubric or scientific validation", total: results.length, passed, failed: results.length - passed, cases: results }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
} finally { retriever.close(); }
