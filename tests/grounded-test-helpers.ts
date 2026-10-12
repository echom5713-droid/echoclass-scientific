import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalHash, parseStrictJson } from "../src/domain/scientific/canonical.js";
import type {
  ScientificConfiguration,
  ScientificEnvelope,
  ScientificIdentity,
  ScientificRun,
} from "../src/domain/scientific/contract.js";
import { validateScientificResult } from "../src/domain/scientific/result-validation.js";
import type { JsonObject } from "../src/shared/json-safe.js";

let cached: ScientificRun | undefined;
/** A real Python result on the labeled offline fixture, not invented observations. */
export function groundedFixture(): ScientificRun {
  if (cached) return structuredClone(cached);
  const file = path.resolve("tests/fixtures/scientific/synthetic-envelope.json");
  const envelope = JSON.parse(readFileSync(file, "utf8")) as ScientificEnvelope;
  const execution = parseStrictJson(envelope.execution_canonical_json) as JsonObject;
  const output = spawnSync(
    process.env.ECHOCLASS_PYTHON || "python3",
    ["-m", "echoclass_analytics.reproduce", file],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        PYTHONPATH: path.resolve("analytics"),
        PYTHONDONTWRITEBYTECODE: "1",
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
        NUMEXPR_NUM_THREADS: "1",
      },
    },
  );
  if (output.status !== 0)
    throw Error("Synthetic grounded fixture requires the locked Python environment");
  const result = validateScientificResult(
    (JSON.parse(output.stdout) as { result: JsonObject }).result,
    envelope,
  );
  cached = {
    id: "synthetic-grounded-report",
    class_id: "synthetic-class",
    class_name: "PRIVATE_CLASS_MUST_NOT_LEAK",
    requester_user_id: "PRIVATE_TEACHER_MUST_NOT_LEAK",
    client_request_id: "synthetic-request-token",
    request_fingerprint: canonicalHash({ synthetic: true }),
    status: "completed",
    created_at: "2026-09-05T00:00:00.000Z",
    completed_at: "2026-09-05T00:00:01.000Z",
    dataset_hash: envelope.dataset_hash,
    execution_fingerprint: envelope.execution_fingerprint,
    configuration: execution.configuration as ScientificConfiguration,
    identity: {
      algorithm_version: execution.algorithm_version,
      code_version: execution.code_version,
      node_code_version: execution.node_code_version,
      environment_fingerprint: execution.environment_fingerprint,
      environment: { synthetic: true },
      app_version: "synthetic-offline-fixture",
    } as ScientificIdentity,
    attempts: [],
    result,
    scientific_result_hash: canonicalHash(result),
    error_code: null,
  };
  return structuredClone(cached);
}
