import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const problems = [];
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /https?:\/\/[^\s/]+:[^\s/@]+@/,
];
for (const name of paths) {
  if (name !== ".env.example" && /(?:^|\/)(?:\.env(?:\..*)?|users\.json|records\.json|sessions\.json|audit\.json|practice_answers\.json)$|\.(?:db|sqlite|db-wal|db-shm|pem|key)$|^(?:uploads|backups|node_modules|dist)\//.test(name)) {
    problems.push({ path: name, reason: "runtime or credential file" });
    continue;
  }
  if (name.startsWith("public/materials/") && name !== "public/materials/nh4cl-yield-sample.csv" || name.startsWith("public/models/")) {
    problems.push({ path: name, reason: "legacy unverified asset" });
    continue;
  }
  const file = path.join(root, name);
  if (!lstatSync(file).isFile()) { problems.push({ path: name, reason: "non-regular file" }); continue; }
  const bytes = readFileSync(file), text = bytes.toString("utf8");
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) {
    problems.push({ path: name, reason: "binary or invalid UTF-8 source" });
    continue;
  }
  if (secretPatterns.some(pattern => pattern.test(text))) problems.push({ path: name, reason: "credential-shaped content" });
}
const sample = readFileSync(path.join(root, "public/materials/nh4cl-yield-sample.csv"), "utf8");
if (!sample.includes("synthetic_demo")) problems.push({ path: "public/materials/nh4cl-yield-sample.csv", reason: "missing synthetic label" });
const envelope = JSON.parse(readFileSync(path.join(root, "tests/fixtures/scientific/synthetic-envelope.json"), "utf8"));
if (envelope.canonical_inputs.length !== 20 || envelope.canonical_inputs.some(input => JSON.parse(input.canonical_json).record_snapshot.metadata.synthetic_demo !== true))
  problems.push({ path: "tests/fixtures/scientific/synthetic-envelope.json", reason: "fixture is not entirely labeled synthetic" });
if (problems.length) {
  console.error(JSON.stringify({ status: "rejected", problems }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "PUBLICATION_SOURCE_PASS", trackedFiles: paths.length, secretPatternsChecked: secretPatterns.length, legacyAssetsIncluded: 0, scientificInputs: 20, note: "Read-only source checks. No credentials are printed. Historical external key revocation and production acceptance are not established." }, null, 2));
}
