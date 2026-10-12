import {
  ScientificFault,
  type ScientificAnalysisRepository,
  type ScientificCommand,
  type ScientificContext,
} from "../domain/scientific/contract.js";
import { AppError, type ErrorCode } from "./errors.js";
import type { RateLimiter } from "./ports.js";
import type { ScientificDispatcher } from "./scientific-dispatcher.js";
import { ScientificWorkerError } from "./scientific-worker.js";

const errors = {
  input: ["VALIDATION_ERROR", 422],
  limit: ["VALIDATION_ERROR", 413],
  unauthenticated: ["AUTHENTICATION_REQUIRED", 401],
  forbidden: ["FORBIDDEN", 403],
  missing: ["NOT_FOUND", 404],
  conflict: ["CONFLICT", 409],
  unavailable: ["STORAGE_UNAVAILABLE", 503],
  corrupt: ["STORAGE_UNAVAILABLE", 503],
} as const satisfies Record<ScientificFault["kind"], readonly [ErrorCode, number]>;

function mapped(error: unknown): unknown {
  if (error instanceof ScientificWorkerError)
    return new AppError("PROVIDER_UNAVAILABLE", "科学计算暂时不可用，请稍后重试", 503, [
      { field: "scientific_analysis", code: error.code, message: "科学计算暂时不可用" },
    ]);
  if (!(error instanceof ScientificFault)) return error;
  const [code, status] = errors[error.kind];
  const message =
    error.kind === "corrupt" ? "科学分析的完整性检查未通过，请联系管理员" : error.message;
  return new AppError(code, message, status, [
    { field: "scientific_analysis", code: error.reason, message },
  ]);
}

export class ScientificService {
  constructor(
    private readonly repository: ScientificAnalysisRepository,
    private readonly limiter: RateLimiter,
    private readonly dispatcher: ScientificDispatcher | null,
  ) {}

  private invoke<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw mapped(error);
    }
  }

  gate(context: ScientificContext) {
    return this.invoke(() => this.repository.authorize(context));
  }
  classes(context: ScientificContext) {
    return this.invoke(() => this.repository.classes(context));
  }
  get(context: ScientificContext, id: string) {
    return this.invoke(() => this.repository.getScientificRun(context, id));
  }
  list(context: ScientificContext, classId: string) {
    return this.invoke(() => this.repository.listScientificRuns(context, classId));
  }
  available(): boolean {
    return this.dispatcher?.identity() !== null && this.dispatcher !== null;
  }

  create(context: ScientificContext, command: ScientificCommand) {
    const actor = this.gate(context);
    if (!this.limiter.allow(actor.id))
      throw new AppError("RATE_LIMITED", "科学分析请求过于频繁，请稍后重试", 429);
    const result = this.invoke(() =>
      this.repository.createScientificRun(context, command, this.dispatcher?.identity() ?? null),
    );
    this.dispatcher?.kick();
    return result;
  }

  async reproduce(context: ScientificContext, id: string) {
    const actor = this.gate(context);
    const run = this.get(context, id);
    if (!this.limiter.allow(actor.id))
      throw new AppError("RATE_LIMITED", "复现请求过于频繁，请稍后重试", 429);
    if (!this.dispatcher) throw mapped(new ScientificWorkerError("WORKER_UNAVAILABLE", true));
    try {
      const result = await this.dispatcher.reproduce(run);
      this.get(context, id);
      return result;
    } catch (error) {
      throw mapped(error);
    }
  }
}
