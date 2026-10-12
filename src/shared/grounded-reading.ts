import type { EvidenceCard, EvidencePack } from "../domain/grounded/evidence.js";
import type { JsonObject, JsonValue } from "./json-safe.js";

/** Presentation only: the canonical v1 pack, citations and hashes remain unchanged. */
export function groundedReadingCard(pack: EvidencePack, card: EvidenceCard): EvidenceCard {
  if (pack.schema !== "echoclass.grounded-cards.v1")
    throw Error("Unsupported evidence presentation version");
  const methods: Record<string, string> = {
    inclusion:
      "The candidate records and reviews sealed with this report determine inclusion. Only records explicitly included by a teacher enter the main analysis. ‘Normal’ or unreviewed does not mean included. Later reviews do not modify this report.",
    descriptive:
      "Yield is in %. Sample SD uses n−1; MAD is the median absolute deviation from the median. Empty groups and unavailable statistics are identified explicitly, not filled with zero.",
    uncertainty:
      "The mean interval uses 10,000 percentile bootstrap samples, a 95% level and a fixed seed. It assumes each record is an independent replicate; the system cannot establish this design premise. It is not a prediction interval for a new observation or a direct test of differences between groups.",
    outliers:
      "The 1.5×IQR rule applies only when n≥4 and IQR is nonzero. Flags are for human review and do not remove records automatically. Included flagged records still enter the analysis.",
    validation:
      "The quadratic model fits concentration means with equal weights. Each validation fold holds out an entire concentration group, with scaling based only on training groups. The 0% and 4% folds are extrapolations. A three-group fit is saturated and cannot support four-fold validation. Training R² is not predictive ability.",
    best: "The best measured condition compares mean yields only at measured concentrations and retains every exact tie. It does not establish significance, a causal effect or an optimum at an unmeasured condition.",
    candidate:
      "A candidate is shown only when the full fit and all four omitted-group fits have concave vertices within the measured range. The omitted-group vertex range is a sensitivity range, not a confidence interval. A new experiment is required.",
    limitations:
      "This is an exploratory report. Record independence is unverified and only four preset concentrations are available. It cannot establish causality, statistical significance, experimental authenticity, a global optimum or real teaching effectiveness. This reader is bounded and does not provide experimental operating instructions.",
  };
  const find = (id: string, pointer: string | null): JsonValue => {
    const source = pack.sources.find((item) => item.id === id);
    if (!source || !card.citations.includes(id) || source.pointer !== pointer)
      throw Error("Missing cited presentation field");
    return source.value;
  };
  const object = (value: JsonValue): JsonObject => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid cited presentation value");
    return value;
  };
  const metric = (value: JsonValue | undefined) => {
    const v = object(value!);
    return v.value === null ? `unavailable (${v.reason})` : String(v.value);
  };
  let title: string, text: string;
  const id = card.id;
  if (id.startsWith("method.")) {
    const method = id.slice(7);
    if (!Object.hasOwn(methods, method)) throw Error("Unknown presentation method");
    const source = pack.sources.find((item) => item.id === id);
    if (
      !source ||
      source.kind !== "method" ||
      source.pointer !== null ||
      source.document !== `src/domain/grounded/evidence.ts#echoclass.grounded-cards.v1/${method}` ||
      !card.citations.includes(id)
    )
      throw Error("Missing cited presentation method");
    title = "How to interpret this";
    text = methods[method]!;
  } else if (/^selection\.(candidate_count|included_count|excluded_count)$/.test(id)) {
    const field = id.slice(10);
    title = {
      candidate_count: "Snapshot candidates",
      included_count: "Included records",
      excluded_count: "Records not included",
    }[field]!;
    text = `${title}: ${find(id, `/result/selection/${field}`)} records.`;
  } else if (id === "best") {
    title = "Highest mean at a measured condition";
    const v = object(find(id, "/result/best_tested"));
    text =
      v.mean === null
        ? `The best measured condition is unavailable (${v.reason}).`
        : `Measured concentrations: ${(v.concentrations as number[]).join("%, ")}%; mean yield ${v.mean}%. All exact ties are retained.`;
  } else if (id === "candidate") {
    title = "Candidate for a new experiment";
    const v = object(find(id, "/result/candidate"));
    text =
      v.concentration === null
        ? `This report has no candidate concentration (${v.reason}); no value is invented or recomputed.`
        : `Candidate concentration ${v.concentration}%; model-predicted yield ${v.predicted_yield}%. Omitted-group vertices span ${(v.leave_one_out_vertex_range as number[]).join("–")}%.`;
  } else if (/^group\.\d+\.(n|statistics|ci|flags)$/.test(id)) {
    const [, index, field] = id.split(".");
    const concentration = find(
      `group.${index}.concentration`,
      `/result/groups/${index}/concentration`,
    );
    title = `${concentration}% concentration group`;
    const value = find(id, `/result/groups/${index}/${field === "flags" ? "iqr_flags" : field}`);
    if (field === "n") {
      title += " record count";
      text = `${concentration}% group: ${value} included records.`;
    } else {
      const v = object(value);
      if (field === "statistics")
        text = `${concentration}% group: mean yield ${metric(v.mean)}%; sample SD ${metric(v.sd)}; raw MAD ${metric(v.mad)}. An unavailable statistic is not zero.`;
      else if (field === "ci")
        text =
          v.lower === null
            ? `${concentration}% group: interval unavailable (${v.reason}).`
            : `${concentration}% group: the mean’s 95% bootstrap interval is ${v.lower}–${v.upper}%.`;
      else
        text =
          v.reason === null
            ? `${concentration}% group: ${(v.record_ids as JsonValue[]).length} flagged records. A flag is not an instruction to delete a record.`
            : `${concentration}% group: the flagging rule was not applied (${v.reason}).`;
    }
  } else if (id === "validation") {
    title = "Leave-one-concentration-out validation";
    const v = object(find(id, "/result/regression/loocv"));
    text = v.available
      ? `Leave-one-concentration-out RMSE: ${metric(v.rmse)} yield percentage points. The cited values retain each fold’s observed mean, prediction and extrapolation flag.`
      : `Cross-validation is unavailable (${v.reason}); training fit quality does not replace validation.`;
  } else if (id === "limitations") {
    find(id, "/result/limitations");
    title = "Limitations retained by the report";
    text =
      "The report explicitly retains exploratory analysis, unverified independence, the bootstrap assumption, the four-concentration model and the need for a new experiment. Inspect the cited original values.";
  } else throw Error("Unknown evidence presentation card");
  return { id, title, text, citations: [...card.citations] };
}
