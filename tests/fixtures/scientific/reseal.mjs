// Synthetic-test helper only. Production sealing always selects actual SQLite rows.
import fs from "node:fs";
import {
  canonicalHash,
  canonicalize,
  hashCanonicalBytes,
} from "../../../dist/src/domain/scientific/canonical.js";
import { scientificSettings } from "../../../dist/src/domain/scientific/contract.js";
const { inputs, execution } = JSON.parse(fs.readFileSync(0, "utf8"));
const canonical_inputs = inputs.map((value) => {
  const canonical_json = canonicalize(value);
  return { canonical_json, input_hash: hashCanonicalBytes(canonical_json) };
});
const dataset_canonical_json = canonicalize({
  schema: "echoclass.scientific-dataset.v1",
  class_id: inputs[0].record_snapshot.class_id,
  entries: inputs.map((item, ordinal) => ({
    ordinal,
    record_id: item.record_snapshot.id,
    input_hash: canonical_inputs[ordinal].input_hash,
  })),
});
const dataset_hash = hashCanonicalBytes(dataset_canonical_json);
const settings = scientificSettings();
const configuration = {
  ...settings,
  seed_hex: canonicalHash({
    schema: "echoclass.scientific-seed.v1",
    dataset_hash,
    settings_without_seed: settings,
  }).slice(7, 39),
};
const execution_canonical_json = canonicalize({ ...execution, dataset_hash, configuration });
process.stdout.write(
  JSON.stringify({
    schema: "echoclass.scientific-envelope.v1",
    canonical_inputs,
    dataset_hash,
    dataset_canonical_json,
    execution_fingerprint: hashCanonicalBytes(execution_canonical_json),
    execution_canonical_json,
  }),
);
