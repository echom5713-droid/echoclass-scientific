import type { JsonObject } from "../shared/json-safe.js";

/** Measured at startup, before any scientific run is accepted. */
export interface WorkerIdentity {
  algorithm_version: string;
  code_version: string;
  environment_fingerprint: string;
  environment: JsonObject;
}

export class ScientificWorkerError extends Error {
  constructor(
    public readonly code: string,
    public readonly transient: boolean,
  ) {
    super(code);
    this.name = "ScientificWorkerError";
  }
}

export interface ScientificWorker {
  identity(): WorkerIdentity | null;
  ready(): Promise<boolean>;
  analyze(envelope: unknown, options?: { comparison: boolean }): Promise<unknown>;
}
