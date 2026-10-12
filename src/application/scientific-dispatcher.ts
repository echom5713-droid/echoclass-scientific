import {
  ScientificFault,
  type ScientificAnalysisRepository,
  type ScientificIdentity,
  type ScientificRun,
  type ScientificWork,
} from "../domain/scientific/contract.js";
import { validateScientificResult } from "../domain/scientific/result-validation.js";
import { canonicalHash } from "../domain/scientific/canonical.js";
import { assertJsonSafeObject, type JsonObject, type JsonValue } from "../shared/json-safe.js";
import { ScientificWorkerError, type ScientificWorker } from "./scientific-worker.js";

function failure(error: unknown): { code: string; transient: boolean } {
  if (error instanceof ScientificWorkerError)
    return { code: error.code, transient: error.transient };
  if (error instanceof ScientificFault) return { code: error.reason, transient: false };
  return { code: "SCIENTIFIC_INTEGRITY_ERROR", transient: false };
}

export function checkedWorkerResult(
  value: unknown,
  work: { run: ScientificRun; envelope: ScientificWork["envelope"] },
  identity: ScientificIdentity,
): JsonObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "identity,result"
  )
    throw new ScientificWorkerError("WORKER_INVALID_OUTPUT", false);
  const response = value as Record<string, unknown>;
  assertJsonSafeObject(response.identity, "worker response identity");
  if (
    response.identity.algorithm_version !== identity.algorithm_version ||
    response.identity.code_version !== identity.code_version ||
    response.identity.environment_fingerprint !== identity.environment_fingerprint ||
    canonicalHash(response.identity.environment) !== canonicalHash(identity.environment)
  )
    throw new ScientificWorkerError("WORKER_IDENTITY_MISMATCH", false);
  return validateScientificResult(response.result, work.envelope);
}

/** One in-process dispatcher, enabled only after the supervisor holds the cross-process lock. */
export class ScientificDispatcher {
  private enabled = false;
  private stopped = false;
  private active: Promise<void> | null = null;
  private reproducing = false;
  private requested = false;
  private blocked = new Set<string>();
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly repository: ScientificAnalysisRepository,
    private readonly worker: ScientificWorker,
    private readonly frozenIdentity: ScientificIdentity,
    private readonly reportFailure: (code: string) => void = () => {},
    wait?: (milliseconds: number) => Promise<void>,
  ) {
    this.wait =
      wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  identity(): ScientificIdentity | null {
    const measured = this.worker.identity();
    return measured &&
      measured.code_version === this.frozenIdentity.code_version &&
      measured.environment_fingerprint === this.frozenIdentity.environment_fingerprint &&
      !this.stopped
      ? structuredClone(this.frozenIdentity)
      : null;
  }

  async start(): Promise<void> {
    if (this.enabled || this.stopped) return;
    if (!(await this.worker.ready()) || !this.identity())
      throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
    this.enabled = true;
    // The caller already owns the parent/child flock before this recovery is permitted.
    this.active = this.recover();
    try {
      await this.active;
    } finally {
      this.active = null;
    }
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.enabled = false;
  }
  async drain(): Promise<void> {
    while (this.active) await this.active;
  }

  kick(): void {
    this.requested = true;
    if (!this.enabled || this.stopped || this.active || this.reproducing) return;
    this.requested = false;
    this.active = this.pump()
      .catch((error: unknown) => this.reportFailure(failure(error).code))
      .finally(() => {
        this.active = null;
        if (this.requested) this.kick();
      });
  }

  private async recover(): Promise<void> {
    for (const id of this.repository.runningRunIds()) {
      if (this.stopped) return;
      try {
        const run = this.repository.readExecutionRun(id);
        const attempt = run.attempts.at(-1);
        if (!attempt) throw new ScientificWorkerError("SCIENTIFIC_INVALID_ATTEMPT", false);
        if (attempt.number === 2) {
          this.repository.finishScientificRun(id, attempt.token, {
            status: "failed",
            error_code: "WORKER_INTERRUPTED",
          });
          continue;
        }
        await this.wait(5_000);
        if (this.stopped) return;
        if (!(await this.worker.ready())) {
          if (!this.stopped)
            this.repository.finishScientificRun(id, attempt.token, {
              status: "failed",
              error_code: "WORKER_UNAVAILABLE",
            });
          continue;
        }
        if (this.stopped) return;
        const work = this.repository.retryRunningRun(
          id,
          attempt.token,
          "WORKER_INTERRUPTED",
          this.frozenIdentity,
        );
        if (work) await this.execute(work);
      } catch (error) {
        this.failRun(id, failure(error).code);
      }
    }
  }

  private async pump(): Promise<void> {
    while (!this.stopped) {
      const id = this.repository.pendingRunIds().find((candidate) => !this.blocked.has(candidate));
      if (!id) return;
      try {
        const identity = this.identity();
        if (!identity) throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
        const work = this.repository.claimPendingRun(id, identity);
        if (work) await this.execute(work);
      } catch (error) {
        this.failRun(id, failure(error).code);
      }
    }
  }

  private failRun(id: string, code: string): void {
    if (this.stopped) return;
    try {
      const run = this.repository.readExecutionRun(id);
      if (run.status === "pending") this.repository.failPendingRun(id, code);
      else if (run.status === "running" && run.attempts.at(-1))
        this.repository.finishScientificRun(id, run.attempts.at(-1)!.token, {
          status: "failed",
          error_code: code,
        });
    } catch {
      this.blocked.add(id);
      this.reportFailure("SCIENTIFIC_INTEGRITY_BLOCKED");
    }
  }

  private async execute(initial: ScientificWork): Promise<void> {
    let work = initial;
    while (!this.stopped) {
      try {
        if (!(await this.worker.ready()))
          throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
        if (this.stopped) return;
        // Repository claim/retry already rechecked requester and all captured current classes.
        const output = await this.worker.analyze(work.envelope);
        if (this.stopped) return;
        const result = checkedWorkerResult(output, work, this.frozenIdentity);
        this.repository.finishScientificRun(work.run.id, work.attempt.token, {
          status: "completed",
          result,
        });
        return;
      } catch (error) {
        if (this.stopped) return;
        const currentFailure = failure(error);
        if (!currentFailure.transient || work.attempt.number === 2) {
          this.repository.finishScientificRun(work.run.id, work.attempt.token, {
            status: "failed",
            error_code: currentFailure.code,
          });
          return;
        }
        await this.wait(5_000);
        if (this.stopped) return;
        if (!(await this.worker.ready())) {
          if (!this.stopped)
            this.repository.finishScientificRun(work.run.id, work.attempt.token, {
              status: "failed",
              error_code: "WORKER_UNAVAILABLE",
            });
          return;
        }
        if (this.stopped) return;
        const retry = this.repository.retryRunningRun(
          work.run.id,
          work.attempt.token,
          currentFailure.code,
          this.frozenIdentity,
        );
        if (!retry) return;
        work = retry;
      }
    }
  }

  async reproduce(run: ScientificRun): Promise<JsonObject> {
    if (run.status !== "completed" || !run.result || !run.scientific_result_hash)
      throw new ScientificFault(
        "conflict",
        "REPRODUCTION_REQUIRES_COMPLETED",
        "只有已完成的科学分析可以比较复现结果",
      );
    if (!this.enabled || this.stopped || this.active || this.reproducing)
      throw new ScientificWorkerError("WORKER_BUSY_OR_UNAVAILABLE", true);
    const current = this.identity();
    if (!current) throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
    if (
      current.algorithm_version !== run.identity.algorithm_version ||
      current.code_version !== run.identity.code_version
    )
      throw new ScientificWorkerError("WORKER_CODE_VERSION_MISMATCH", false);
    this.reproducing = true;
    try {
      if (!(await this.worker.ready())) throw new ScientificWorkerError("WORKER_BUSY", true);
      const envelope = this.repository.readScientificInputs(run.id);
      const differentEnvironment =
        current.environment_fingerprint !== run.identity.environment_fingerprint;
      const output = await this.worker.analyze(envelope, { comparison: differentEnvironment });
      if (this.stopped) throw new ScientificWorkerError("WORKER_UNAVAILABLE", true);
      const result = checkedWorkerResult(output, { run, envelope }, current);
      const resultHash = canonicalHash(result);
      const mismatches: string[] = [];
      compareResults(run.result, result, "$", differentEnvironment, mismatches);
      return {
        schema: "echoclass.scientific-reproduction.v1",
        mode: differentEnvironment ? "numerical_comparison" : "exact",
        matches: differentEnvironment
          ? mismatches.length === 0
          : resultHash === run.scientific_result_hash,
        saved_result_hash: run.scientific_result_hash,
        reproduced_result_hash: resultHash,
        saved_environment_fingerprint: run.identity.environment_fingerprint,
        current_environment_fingerprint: current.environment_fingerprint,
        absolute_tolerance: differentEnvironment ? 1e-12 : 0,
        relative_tolerance: differentEnvironment ? 1e-10 : 0,
        mismatches,
      };
    } finally {
      this.reproducing = false;
      this.kick();
    }
  }
}

function compareResults(
  saved: JsonValue,
  result: JsonValue,
  at: string,
  tolerant: boolean,
  mismatches: string[],
): void {
  if (typeof saved === "number" && typeof result === "number") {
    if (
      saved !== result &&
      (!tolerant || Math.abs(result - saved) > 1e-12 + 1e-10 * Math.abs(saved))
    )
      mismatches.push(at);
    return;
  }
  if (Array.isArray(saved) && Array.isArray(result)) {
    if (saved.length !== result.length) {
      mismatches.push(at);
      return;
    }
    saved.forEach((value, i) =>
      compareResults(value, result[i]!, `${at}[${i}]`, tolerant, mismatches),
    );
    return;
  }
  if (
    saved &&
    result &&
    typeof saved === "object" &&
    typeof result === "object" &&
    !Array.isArray(saved) &&
    !Array.isArray(result)
  ) {
    if (Object.keys(saved).sort().join("\0") !== Object.keys(result).sort().join("\0")) {
      mismatches.push(at);
      return;
    }
    for (const key of Object.keys(saved))
      compareResults(
        saved[key]!,
        result[key]!,
        `${at}.${key}`,
        tolerant &&
          ![
            "ordinal",
            "concentration",
            "candidate_count",
            "included_count",
            "excluded_count",
            "n",
            "n_groups",
            "rank",
            "residual_df",
          ].includes(key),
        mismatches,
      );
    return;
  }
  if (saved !== result) mismatches.push(at);
}
