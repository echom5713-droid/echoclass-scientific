// Synthetic study bridge. It has no database or persistence authority.
import fs from "node:fs";
import {
  canonicalHash,
  canonicalize,
  hashCanonicalBytes,
  parseStrictJson,
} from "../../dist/src/domain/scientific/canonical.js";
import { scientificSettings } from "../../dist/src/domain/scientific/contract.js";
import { validateScientificResult } from "../../dist/src/domain/scientific/result-validation.js";
import { nodeScientificCodeVersion } from "../../dist/src/infrastructure/scientific/local-python-worker.js";

const args = process.argv.slice(2);
if (args.length !== 1 || !["seal", "verify"].includes(args[0])) {
  throw new Error("Study bridge requires exactly one operation: seal or verify.");
}
const request = parseStrictJson(fs.readFileSync(0, "utf8"));
if (args[0] === "seal") {
  const nodeCodeVersion = await nodeScientificCodeVersion();
  const envelopes = request.datasets.map((inputs) => {
    const canonicalInputs = inputs.map((value) => {
      const canonicalJson = canonicalize(value);
      return { canonical_json: canonicalJson, input_hash: hashCanonicalBytes(canonicalJson) };
    });
    const datasetCanonicalJson = canonicalize({
      schema: "echoclass.scientific-dataset.v1",
      class_id: inputs[0].record_snapshot.class_id,
      entries: inputs.map((item, ordinal) => ({
        ordinal,
        record_id: item.record_snapshot.id,
        input_hash: canonicalInputs[ordinal].input_hash,
      })),
    });
    const datasetHash = hashCanonicalBytes(datasetCanonicalJson);
    const settings = scientificSettings();
    const configuration = {
      ...settings,
      seed_hex: canonicalHash({
        schema: "echoclass.scientific-seed.v1",
        dataset_hash: datasetHash,
        settings_without_seed: settings,
      }).slice(7, 39),
    };
    const executionCanonicalJson = canonicalize({
      schema: "echoclass.scientific-execution.v1",
      dataset_hash: datasetHash,
      configuration,
      algorithm_version: request.identity.algorithm_version,
      code_version: request.identity.code_version,
      node_code_version: nodeCodeVersion,
      environment_fingerprint: request.identity.environment_fingerprint,
    });
    return {
      schema: "echoclass.scientific-envelope.v1",
      canonical_inputs: canonicalInputs,
      dataset_hash: datasetHash,
      dataset_canonical_json: datasetCanonicalJson,
      execution_fingerprint: hashCanonicalBytes(executionCanonicalJson),
      execution_canonical_json: executionCanonicalJson,
    };
  });
  process.stdout.write(JSON.stringify({ node_code_version: nodeCodeVersion, envelopes }));
} else {
  const hashes = request.map(({ envelope, result }) =>
    canonicalHash(validateScientificResult(result, envelope)),
  );
  process.stdout.write(JSON.stringify(hashes));
}
