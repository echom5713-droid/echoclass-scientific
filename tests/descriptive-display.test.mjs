import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_RECORDS, reportPage, teacherPage, trendSvg } from "../dist/src/views/pages.js";

function observation(overrides = {}) {
  return {
    ...DEMO_RECORDS[0],
    id: "synthetic-display-observation",
    nh4cl_concentration: 1,
    peel_mass: 50,
    oil_mass: 0.5,
    review_status: "included",
    异常标记: false,
    ...overrides,
  };
}

test("an empty descriptive report has no winning concentration or fabricated zero mean", () => {
  const html = reportPage([], null);
  assert.match(html, /暂无可比较数据/);
  assert.doesNotMatch(html, /<h3>[0134]% NH₄Cl<\/h3>/);
  assert.doesNotMatch(html, /平均得率 0\.00%/);
  assert.match(html, /<td>0%<\/td><td>0<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
});

test("all excluded records leave the comparison empty", () => {
  const html = reportPage([observation({ review_status: "excluded" })], null);
  assert.match(html, /暂无可比较数据/);
  assert.doesNotMatch(html, /<h3>[0134]% NH₄Cl<\/h3>/);
});

test("teacher inclusion takes precedence over an anomaly flag in both arithmetic and explanation", () => {
  const html = reportPage([observation({ 异常标记: true })], null);
  assert.match(html, /<td>1%<\/td><td>1<\/td><td>1\.00%<\/td>/);
  assert.match(html, /未参与比较<\/small><strong>0<\/strong>/);
  assert.match(html, /教师已纳入的记录参与比较，即使原记录带有异常标记/);
  assert.doesNotMatch(html, /被标记为污染或异常的数据不参与/);
});

test("teacher exclusion without an anomaly flag is counted as absent from comparison", () => {
  const html = reportPage([
    observation(),
    observation({ id: "synthetic-excluded", nh4cl_concentration: 4, review_status: "excluded" }),
  ], null);
  assert.match(html, /未参与比较<\/small><strong>1<\/strong>/);
});

test("equal observed means retain every tied measured group in report, summary and trend", () => {
  const rows = [observation(), observation({ id: "synthetic-tie", nh4cl_concentration: 3 })];
  const html = reportPage(rows, null);
  assert.match(html, /<h3>1%、3% NH₄Cl（并列）<\/h3>/);
  assert.equal((html.match(/decision-row is-best/g) || []).length, 2);
  assert.match(trendSvg(rows), /1%、3% NH₄Cl 组观测均值并列最高/);
});

test("rounding for display does not invent a tie", () => {
  const rows = [observation({ oil_mass: 0.50001 }), observation({ id: "close-mean", nh4cl_concentration: 3, oil_mass: 0.50002 })];
  const html = reportPage(rows, null);
  assert.match(html, /<h3>3% NH₄Cl<\/h3>/);
  assert.doesNotMatch(html, /（并列）/);
  assert.equal((html.match(/decision-row is-best/g) || []).length, 1);
});

test("a single observation has no sample standard deviation", () => {
  const html = reportPage([observation()], null);
  assert.match(html, /<td>1%<\/td><td>1<\/td><td>1\.00%<\/td><td>—<\/td>/);
  assert.match(html, /样本量小于 2 时不显示样本标准差/);
});

test("two equal observations retain a defined zero sample standard deviation", () => {
  const html = reportPage([observation(), observation({ id: "second-equal" })], null);
  assert.match(html, /<td>1%<\/td><td>2<\/td><td>1\.00%<\/td><td>0\.00<\/td>/);
});

test("an included zero yield is displayed as measured zero, including tied zero means", () => {
  const rows = [observation({ oil_mass: 0, yield_percent: 0 }), observation({ id: "zero-tie", nh4cl_concentration: 3, oil_mass: 0, yield_percent: 0 })];
  const report = reportPage(rows, null);
  assert.match(report, /<h3>1%、3% NH₄Cl（并列）<\/h3>/);
  assert.match(report, /平均得率 0\.00%/);
  assert.match(teacherPage(rows, null), /<b>0\.00%<\/b><span>1%<\/span>/);
});
