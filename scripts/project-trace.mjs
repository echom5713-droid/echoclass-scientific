import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashCanonicalBytes, parseStrictJson } from "../dist/src/domain/scientific/canonical.js";
import { runSyntheticDemo } from "./scientific-demo.mjs";

const fixture = fileURLToPath(new URL("../tests/fixtures/scientific/synthetic-envelope.json", import.meta.url));

/** Inspect only the committed, entirely synthetic case; never read a classroom store. */
export function inspectTraceEnvelope(envelope) {
  if (envelope?.schema !== "echoclass.scientific-envelope.v1" || !Array.isArray(envelope.canonical_inputs) || envelope.canonical_inputs.length !== 20)
    throw new Error("Trace requires the twenty-record synthetic fixture.");
  const decode = (bytes, digest) => {
    if (typeof bytes !== "string" || hashCanonicalBytes(bytes) !== digest)
      throw new Error("Sealed bytes do not match their saved digest.");
    const value = parseStrictJson(bytes);
    if (canonicalize(value) !== bytes) throw new Error("Sealed bytes are not canonical JSON.");
    return value;
  };
  const dataset = decode(envelope.dataset_canonical_json, envelope.dataset_hash);
  const execution = decode(envelope.execution_canonical_json, envelope.execution_fingerprint);
  if (dataset.schema !== "echoclass.scientific-dataset.v1" || dataset.class_id !== "synthetic-class" || dataset.entries.length !== 20 || execution.dataset_hash !== envelope.dataset_hash)
    throw new Error("Trace manifest does not bind the synthetic inputs.");
  const records = envelope.canonical_inputs.map((entry, ordinal) => {
    const input = decode(entry.canonical_json, entry.input_hash);
    const record = input.record_snapshot;
    const review = input.review_snapshot;
    const manifest = dataset.entries[ordinal];
    if (input.schema !== "echoclass.scientific-input.v1" || input.review_binding_mode !== "effective" || record?.metadata?.synthetic_demo !== true || record.class_id !== dataset.class_id || record.review_status !== "included" || review?.status !== "included" || review.record_id !== record.id || record.effective_review_id !== review.id || manifest.record_id !== record.id || manifest.ordinal !== ordinal || manifest.input_hash !== entry.input_hash)
      throw new Error("Trace record, review and manifest identities disagree.");
    return { record_id: record.id, concentration: record.nh4cl_concentration, oil_mass: record.oil_mass, peel_mass: record.peel_mass, yield_percent: record.yield_percent, review_id: review.id, review_sequence: review.event_sequence, review_status: review.status, review_binding_mode: input.review_binding_mode, input_hash: entry.input_hash };
  });
  if (new Set(records.map((record) => record.record_id)).size !== records.length)
    throw new Error("Trace record IDs must be unique.");
  const selected = records.find((record) => record.record_id === "synthetic-005");
  if (!selected) throw new Error("Trace selected record is missing.");
  return { records, selected, dataset_hash: envelope.dataset_hash, execution_fingerprint: envelope.execution_fingerprint, configuration: execution.configuration };
}

export function runProjectTrace(options = {}) {
  const envelope = parseStrictJson(readFileSync(fixture, "utf8"));
  const trail = inspectTraceEnvelope(envelope);
  const result = runSyntheticDemo(options);
  if (result.dataset_hash !== trail.dataset_hash)
    throw new Error("Worker result belongs to another dataset.");
  // Detach before changing anything: the original fixture and saved identities stay intact.
  const changed = structuredClone(envelope);
  const entry = changed.canonical_inputs[trail.records.findIndex((record) => record.record_id === trail.selected.record_id)];
  const snapshot = parseStrictJson(entry.canonical_json);
  snapshot.record_snapshot.oil_mass += 1;
  snapshot.record_snapshot.yield_percent = 100 * snapshot.record_snapshot.oil_mass / snapshot.record_snapshot.peel_mass;
  entry.canonical_json = canonicalize(snapshot);
  let rejected = false;
  try { inspectTraceEnvelope(changed); }
  catch (error) {
    if (error.message !== "Sealed bytes do not match their saved digest.") throw error;
    rejected = true;
  }
  if (!rejected || inspectTraceEnvelope(envelope).selected.input_hash !== trail.selected.input_hash)
    throw new Error("Detached sealed-input exercise failed.");
  return {
    schema: "echoclass.project-trace.v1",
    label: "Synthetic records and invented review events; read-only offline code reading.",
    ...trail,
    group: result.groups.find((group) => group.concentration === trail.selected.concentration),
    best_tested: result.best_tested,
    candidate: result.candidate,
    scientific_result_hash: result.scientific_result_hash,
    observed_identity: result.observed_identity,
    identity_note: result.identity_note,
    exercise: { changed_record_id: trail.selected.record_id, original_oil_mass: trail.selected.oil_mass, hypothetical_oil_mass: snapshot.record_snapshot.oil_mass, changed_input_hash: hashCanonicalBytes(entry.canonical_json), unchanged_saved_hash: trail.selected.input_hash, rejected_by_input_byte_check: rejected, original_input_still_matches: true, note: "Detached in-memory integrity check; no record, review, report or fixture file was written." },
  };
}

export function formatProjectTrace(trace, language = "en") {
  const t = (en, zh) => language === "zh" ? zh : en;
  const r = trace.selected;
  return [
    t("EchoClass | Trace one synthetic result", "EchoClass | 追踪一份合成结果"),
    t("All records and review events are invented. No classroom writes.", "全部记录和审核事件均为虚构，不写入课堂。"),
    "",
    `${t("Record", "记录")}: ${r.record_id}; NH4Cl ${r.concentration}%; ${r.oil_mass} g / ${r.peel_mass} g = ${r.yield_percent}%`,
    `${t("Bound review", "绑定审核")}: ${r.review_id}; ${r.review_status}; ${t("sequence", "顺序")} ${r.review_sequence}`,
    `${t("Sealed input", "封存输入")}: ${r.input_hash}`,
    `${t("Dataset", "数据集")}: ${trace.dataset_hash}`,
    `${t("Actual worker group mean", "实际计算的组均值")}: ${trace.group.mean.value}% (n=${trace.group.n})`,
    `${t("Best tested concentrations", "实测最佳浓度")}: ${trace.best_tested.concentrations.join("%, ")}%`,
    `${t("Exploratory model candidate", "探索性模型候选")}: ${Number(trace.candidate.concentration.toPrecision(8))}%`,
    t("No observation at the candidate; this is not an established optimum.", "候选点没有观测，不能称为已验证最优条件。"),
    `${t("Scientific result", "科学结果")}: ${trace.scientific_result_hash}`,
    "",
    t("Detached-copy exercise: 8.8 g → 9.8 g; the unchanged saved digest rejects the changed bytes. The original still matches.", "分离副本练习：8.8 g → 9.8 g；未改变的保存摘要拒绝改变后的字节，原件仍然匹配。"),
    t("Input integrity cannot establish measurement truth or independence. The fixture execution identity is synthetic; use JSON for the observed runtime identity.", "输入完整性不能证明测量真实或独立。测试执行身份为合成身份，JSON 提供实测运行身份。"),
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = "Usage: npm run project:trace -- [--json | --text [--lang en|zh]]";
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else if (!(args.length === 0 || args.length === 1 && ["--json", "--text"].includes(args[0]) || args.length === 3 && args[0] === "--text" && args[1] === "--lang" && ["en", "zh"].includes(args[2]))) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    try {
      const trace = runProjectTrace();
      console.log(args[0] === "--text" ? formatProjectTrace(trace, args[2]) : JSON.stringify(trace, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
