import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ScientificWorkerError,
  type ScientificWorker,
  type WorkerIdentity,
} from "../../application/scientific-worker.js";
import { assertJsonSafeObject } from "../../shared/json-safe.js";
import { parseStrictJson } from "../../domain/scientific/canonical.js";

const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_REQUEST = 8 * 1024 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/;

function framed(hash: ReturnType<typeof createHash>, bytes: Buffer): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length).update(bytes);
}

export interface LocalPythonWorkerOptions {
  dataDir: string;
  packageDirectory: string;
  pythonExecutable: string;
  startupTimeoutMs?: number;
  responseTimeoutMs?: number;
}

async function files(directory: string, suffix: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("scientific source must not contain symlinks");
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") continue;
      for (const nested of await files(path.join(directory, entry.name), suffix))
        result.push(`${entry.name}/${nested}`);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(entry.name);
  }
  return result.sort();
}

/** Digest the actual JS/TS artifact used by this process, not a claimed Git revision. */
export async function nodeScientificCodeVersion(): Promise<string> {
  const source = fileURLToPath(new URL("../../", import.meta.url));
  const suffix = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const hash = createHash("sha256");
  for (const relative of await files(source, suffix)) {
    if (relative.endsWith(".d.ts")) continue;
    const bytes = await readFile(path.join(source, relative));
    hash
      .update(relative, "utf8")
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function validateIdentity(value: unknown): WorkerIdentity {
  assertJsonSafeObject(value, "worker identity");
  if (
    typeof value.algorithm_version !== "string" ||
    value.algorithm_version.length > 100 ||
    typeof value.code_version !== "string" ||
    !HASH.test(value.code_version) ||
    typeof value.environment_fingerprint !== "string" ||
    !HASH.test(value.environment_fingerprint)
  )
    throw new Error("invalid worker identity");
  assertJsonSafeObject(value.environment, "worker environment");
  return structuredClone(value) as unknown as WorkerIdentity;
}

/** Linux local-FS supervisor. Both processes retain the flock open-file-description. */
export class LocalPythonWorker implements ScientificWorker {
  private child: ChildProcess | null = null;
  private childClosed: Promise<void> | null = null;
  private lockFd: number | null = null;
  private runtimeDirectory: string | null = null;
  private measuredIdentity: WorkerIdentity | null = null;
  private port: number | null = null;
  private readonly token = randomBytes(32).toString("hex");
  private stopping = false;
  private calculation = false;

  constructor(private readonly options: LocalPythonWorkerOptions) {}

  identity(): WorkerIdentity | null {
    return this.measuredIdentity && this.child?.exitCode === null && !this.stopping
      ? structuredClone(this.measuredIdentity)
      : null;
  }

  async start(): Promise<WorkerIdentity> {
    if (this.child || this.lockFd !== null) throw new Error("worker already started");
    if (process.platform !== "linux")
      throw new ScientificWorkerError("WORKER_PLATFORM_UNSUPPORTED", false);
    try {
      await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });
      const lockPath = path.join(this.options.dataDir, "scientific-executor.lock");
      this.lockFd = openSync(
        lockPath,
        constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      if (!fstatSync(this.lockFd).isFile()) throw new Error("invalid executor lock");
      this.runtimeDirectory = await mkdtemp(path.join(this.options.dataDir, "scientific-runtime-"));
      const destination = path.join(this.runtimeDirectory, "echoclass_analytics");
      await mkdir(destination, { mode: 0o700 });
      const names = await files(this.options.packageDirectory, ".py");
      if (!names.includes("worker.py") || !names.includes("__init__.py"))
        throw new Error("incomplete scientific package");
      const sourceHash = createHash("sha256");
      for (const relative of names) {
        if (relative.split("/").includes("tests")) continue;
        const target = path.join(destination, relative);
        const bytes = await readFile(path.join(this.options.packageDirectory, relative));
        framed(sourceHash, Buffer.from(relative, "utf8"));
        framed(sourceHash, bytes);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: "wx", mode: 0o400 });
      }
      const expectedCodeVersion = `sha256:${sourceHash.digest("hex")}`;
      await chmod(destination, 0o500);
      // Explicit environment: credentials for unrelated providers never enter Python.
      const child = spawn(this.options.pythonExecutable, ["-m", "echoclass_analytics.worker"], {
        cwd: this.runtimeDirectory,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C.UTF-8",
          PYTHONPATH: this.runtimeDirectory,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONUNBUFFERED: "1",
          OPENBLAS_NUM_THREADS: "1",
          OMP_NUM_THREADS: "1",
          MKL_NUM_THREADS: "1",
          NUMEXPR_NUM_THREADS: "1",
          ECHOCLASS_WORKER_TOKEN: this.token,
          ECHOCLASS_WORKER_LOCK_FD: "3",
          ECHOCLASS_WORKER_PARENT_PID: String(process.pid),
        },
        stdio: ["ignore", "pipe", "pipe", this.lockFd],
      });
      this.child = child;
      child.on("error", () => {
        this.port = null;
        this.measuredIdentity = null;
      });
      this.childClosed = new Promise<void>((resolve) => {
        child.once("close", () => {
          this.port = null;
          this.measuredIdentity = null;
          resolve();
        });
      });
      // Drain errors without exposing dataset, traceback or credentials in application logs.
      child.stderr?.on("data", () => {});
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => done(new Error("worker startup deadline")),
          this.options.startupTimeoutMs ?? 30_000,
        );
        const onError = () => done(new Error("worker start failed"));
        const onClose = () => done(new Error("worker exited before readiness"));
        const done = (error?: Error) => {
          clearTimeout(timeout);
          child.off("error", onError);
          child.off("close", onClose);
          child.stdout?.off("data", onData);
          if (error) reject(error);
          else resolve();
        };
        const onData = (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (Buffer.byteLength(output) > 64 * 1024)
            return done(new Error("worker readiness exceeded limit"));
          const newline = output.indexOf("\n");
          if (newline === -1) return;
          try {
            const ready = parseStrictJson(output.slice(0, newline)) as Record<string, unknown>;
            if (
              ready.event !== "ready" ||
              !Number.isInteger(ready.port) ||
              Number(ready.port) < 1 ||
              Number(ready.port) > 65535
            )
              throw new Error("invalid worker readiness");
            this.measuredIdentity = validateIdentity(ready.identity);
            if (this.measuredIdentity.code_version !== expectedCodeVersion)
              throw new Error("worker source identity mismatch");
            this.port = ready.port as number;
            done();
          } catch {
            done(new Error("invalid worker readiness"));
          }
        };
        child.once("error", onError);
        child.once("close", onClose);
        child.stdout?.on("data", onData);
      });
      child.stdout?.on("data", () => {});
      if (!(await this.ready())) throw new Error("worker not ready");
      return this.identity()!;
    } catch {
      await this.stop();
      throw new ScientificWorkerError("WORKER_START_FAILED", true);
    }
  }

  private async request(
    route: string,
    body?: string,
    timeoutMs = 2_000,
    comparison = false,
  ): Promise<unknown> {
    if (!this.port || !this.identity()) throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(comparison ? { "X-EchoClass-Comparison-Mode": "numerical" } : {}),
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
        redirect: "error",
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > MAX_RESPONSE) {
            controller.abort();
            throw new ScientificWorkerError("WORKER_RESPONSE_TOO_LARGE", false);
          }
          chunks.push(chunk);
        }
      }
      if (!response.ok)
        throw new ScientificWorkerError(
          [429, 503, 504].includes(response.status)
            ? "WORKER_BUSY_OR_UNAVAILABLE"
            : response.status === 409
              ? "WORKER_IDENTITY_MISMATCH"
              : "WORKER_REJECTED_INPUT",
          [429, 503, 504].includes(response.status),
        );
      try {
        return parseStrictJson(
          new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
        );
      } catch {
        throw new ScientificWorkerError("WORKER_INVALID_JSON", false);
      }
    } catch (error) {
      if (error instanceof ScientificWorkerError) throw error;
      throw new ScientificWorkerError(
        controller.signal.aborted ? "WORKER_DEADLINE" : "WORKER_UNAVAILABLE",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async ready(): Promise<boolean> {
    if (this.calculation) return false;
    try {
      const response = (await this.request("/health")) as Record<string, unknown>;
      const reported = validateIdentity(response.identity);
      return (
        response.ready === true &&
        response.busy === false &&
        this.identity() !== null &&
        reported.code_version === this.measuredIdentity?.code_version &&
        reported.environment_fingerprint === this.measuredIdentity?.environment_fingerprint &&
        reported.algorithm_version === this.measuredIdentity?.algorithm_version
      );
    } catch {
      return false;
    }
  }

  async analyze(envelope: unknown, options?: { comparison: boolean }): Promise<unknown> {
    if (this.calculation) throw new ScientificWorkerError("WORKER_BUSY", true);
    const body = JSON.stringify(envelope);
    if (Buffer.byteLength(body) > MAX_REQUEST)
      throw new ScientificWorkerError("WORKER_REQUEST_TOO_LARGE", false);
    this.calculation = true;
    try {
      return await this.request(
        "/v1/analyze",
        body,
        this.options.responseTimeoutMs ?? 35_000,
        options?.comparison === true,
      );
    } finally {
      this.calculation = false;
    }
    // Python owns the actual computation slot, including after this HTTP request times out.
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.port = null;
    const child = this.child;
    if (child && this.childClosed) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const hardStop = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000);
      await this.childClosed;
      clearTimeout(hardStop);
    }
    this.child = null;
    this.childClosed = null;
    this.measuredIdentity = null;
    // Close only after the old child has actually exited; never unlink or LOCK_UN the lock.
    if (this.lockFd !== null) {
      closeSync(this.lockFd);
      this.lockFd = null;
    }
    if (this.runtimeDirectory) {
      await chmod(path.join(this.runtimeDirectory, "echoclass_analytics"), 0o700).catch(() => {});
      await rm(this.runtimeDirectory, { recursive: true, force: true });
      this.runtimeDirectory = null;
    }
  }
}
