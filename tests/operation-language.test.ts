import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildEvidence, TOPICS, type GroundedTopic } from "../src/domain/grounded/evidence.js";
import { canonicalHash } from "../src/domain/scientific/canonical.js";
import { groundedReadingCard } from "../src/shared/grounded-reading.js";
import {
  OPERATION_ENGLISH,
  operationText,
  operationLanguageScript,
} from "../src/shared/operation-copy.js";
import { languageSwitch, validPresentationQuery } from "../src/shared/language.js";
import { scientificPage } from "../src/views/scientific-page.js";
import { groundedPage } from "../src/views/grounded-page.js";
import { csvPage } from "../src/views/csv-page.js";
import { evidencePage } from "../src/views/evidence-page.js";
import { groundedFixture } from "./grounded-test-helpers.js";

test("all fixed client copy has an English entry with the same interpolation slots", () => {
  const slots = (value: string) => (value.match(/\{\d+\}/g) ?? []).sort();
  for (const [source, english] of Object.entries(OPERATION_ENGLISH)) {
    assert.deepEqual(slots(english), slots(source), source);
    assert.doesNotMatch(english, /\p{Script=Han}/u, source);
  }
  for (const name of ["scientific", "grounded", "retrieval", "csv", "evidence"]) {
    const source = readFileSync(`public/${name}-client.js`, "utf8");
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(file) === "ui" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        assert.ok(Object.hasOwn(OPERATION_ENGLISH, node.arguments[0].text), node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.equal(
    operationText("en", "报告 {0} · 建立于 {1}", "原记录 {1} <img>", "timestamp"),
    "Report 原记录 {1} <img> · Created timestamp",
  );
  assert.equal(
    operationText("zh", "报告 {0} · 建立于 {1}", "original", "timestamp"),
    "报告 original · 建立于 timestamp",
  );
});

test("operational HTML defaults to English and preserves form controls across both languages", () => {
  for (const render of [scientificPage, groundedPage, csvPage, evidencePage]) {
    const en = render(),
      zh = render("zh");
    assert.match(en, /<html lang="en">/);
    assert.match(zh, /<html lang="zh-CN">/);
    assert.doesNotMatch(en.replaceAll("中文", ""), /\p{Script=Han}/u);
    assert.deepEqual(en.match(/\bid="[^"]+"/g), zh.match(/\bid="[^"]+"/g));
    assert.deepEqual(en.match(/<script[^>]+>/g), zh.match(/<script[^>]+>/g));
    assert.ok(en.indexOf("operation-language.js") < en.indexOf("-client.js"));
  }
  assert.match(csvPage(), /500 records and 1 MiB/);
  assert.match(evidencePage(), /Custody starts when a file is actually uploaded/);
});

test("language links retain an authorized target without accepting external links or extra API inputs", () => {
  for (const path of [
    "/scientific-analysis?class_id=class-A",
    "/scientific-analysis/runs/run-A",
    "/grounded-analysis/runs/run-A",
    "/evidence?record_id=record-A",
    "/evidence?batch_id=batch-A",
  ]) {
    const links = [...languageSwitch(path, "en").matchAll(/href="([^"]+)"/g)].map(
      (match) => new URL(match[1]!.replaceAll("&amp;", "&"), "http://test.internal"),
    );
    assert.deepEqual(
      links.map((url) => url.searchParams.get("lang")),
      ["en", "zh"],
    );
    const original = new URL(path, "http://test.internal");
    for (const link of links) {
      assert.equal(link.pathname, original.pathname);
      for (const [key, value] of original.searchParams)
        assert.equal(link.searchParams.get(key), value);
    }
  }
  for (const path of [
    "//evil.test/csv",
    "/csv?extra=1",
    "/api/csv/classes",
    "/evidence?record_id=A&batch_id=B",
    "/evidence?record_id=A&record_id=B",
    "/csv?lang=en&lang=zh",
  ]) {
    const html = languageSwitch(path, "en");
    assert.match(html, /href="\/\?lang=en"/);
    assert.doesNotMatch(html, /evil|extra|record_id|batch_id/);
  }
  assert.equal(validPresentationQuery(new URL("http://test/csv?lang=zh")), true);
  for (const query of ["?lang=fr", "?lang=en&lang=zh", "?lang=zh&unknown=1"])
    assert.equal(validPresentationQuery(new URL("http://test/csv" + query)), false);
});

for (const topic of Object.keys(TOPICS) as GroundedTopic[])
  test(`English reading for ${topic} preserves canonical evidence, cited values and cautions`, () => {
    const pack = buildEvidence(groundedFixture(), topic),
      original = JSON.stringify(pack);
    const reading = pack.cards.map((card) => groundedReadingCard(pack, card));
    assert.deepEqual(
      reading.map((card) => [card.id, card.citations]),
      pack.cards.map((card) => [card.id, card.citations]),
    );
    assert.equal(JSON.stringify(pack), original);
    const { evidence_hash, ...content } = pack;
    assert.equal(canonicalHash(content), evidence_hash);
    for (const card of reading) assert.doesNotMatch(card.title + card.text, /\p{Script=Han}/u);
    const limits = reading.find((card) => card.id === "method.limitations")!;
    assert.match(limits.text, /independence is unverified/);
    assert.match(limits.text, /cannot establish causality, statistical significance/);
    if (topic === "uncertainty")
      assert.match(
        reading.find((card) => card.id === "method.uncertainty")!.text,
        /10,000.*95%.*independent replicate/,
      );
    if (topic === "candidate")
      assert.match(
        reading.find((card) => card.id === "method.candidate")!.text,
        /sensitivity range, not a confidence interval/,
      );
    for (const source of pack.sources) {
      if (source.id.endsWith(".n")) {
        const card = reading.find((item) => item.id === source.id)!;
        assert.ok(card.text.includes(String(source.value)), source.id);
      }
    }
  });

test("English reading does not invent unavailable results and fails closed for unknown evidence", () => {
  const pack = buildEvidence(groundedFixture(), "candidate");
  const source = pack.sources.find((item) => item.id === "candidate")!;
  source.value = { concentration: null, reason: "fold_unstable" };
  assert.match(
    groundedReadingCard(pack, pack.cards[0]!).text,
    /no candidate concentration \(fold_unstable\)/,
  );
  const unknown = { ...pack.cards[0]!, id: "unexpected", citations: ["candidate"] };
  assert.throws(() => groundedReadingCard(pack, unknown), /Unknown evidence/);
  source.pointer = "/forged";
  assert.throws(() => groundedReadingCard(pack, pack.cards[0]!), /Missing cited/);
  const wrongVersion = { ...pack, schema: "unknown" };
  assert.throws(
    () => groundedReadingCard(wrongVersion as typeof pack, pack.cards[0]!),
    /Unsupported/,
  );
});

test("the browser helper uses the same reading function and labels untranslated server details", () => {
  const context = vm.createContext({ document: { documentElement: { lang: "en" } } });
  vm.runInContext(operationLanguageScript(), context);
  const ui = context.EchoClassUI as {
    text(source: string): string;
    error(message: string, code: string, status?: number): string;
    readingCard: typeof groundedReadingCard;
  };
  assert.equal(ui.text("排队中"), "Queued");
  assert.equal(
    ui.error("NH₄Cl 浓度只能为 0%、1%、3%、4%", "INVALID_FIELD"),
    "NH₄Cl concentration must be 0%, 1%, 3% or 4%",
  );
  assert.match(
    ui.error("服务端原信息", "FORBIDDEN", 403),
    /^Access denied.*Server detail \(original language\): 服务端原信息$/,
  );
  const pack = buildEvidence(groundedFixture(), "best");
  assert.equal(
    JSON.stringify(ui.readingCard(pack, pack.cards[0]!)),
    JSON.stringify(groundedReadingCard(pack, pack.cards[0]!)),
  );
});
