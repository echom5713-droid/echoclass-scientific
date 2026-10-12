import type {
  AnalysisInput,
  AnalysisInputSelection,
  AnalysisRun,
  AnalysisRunStateUpdate,
  AppendReviewCommand,
  CreateAnalysisRunCommand,
  AuditEvent,
  ExperimentRecord,
  PersistExperimentCommand,
  PracticeAnswer,
  RecordReview,
  Session,
  UpdateExperimentCommand,
  User,
} from "./types.js";

export class RepositoryConflictError extends Error {
  constructor() {
    super("repository conflict");
    this.name = "RepositoryConflictError";
  }
}

export class RepositoryCorruptionError extends Error {
  constructor(message = "Stored provenance data is corrupt") {
    super(message);
    this.name = "RepositoryCorruptionError";
  }
}

export interface RecordScope {
  class_name?: string;
  includeAll?: boolean;
}

export interface UserRepository {
  findAll(scope?: RecordScope): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  saveAll(users: User[], expectedUsers?: readonly User[]): Promise<void>;
  update(id: string, patch: Partial<User>): Promise<User | null>;
  changePassword(input: {
    userId: string;
    sidHash: string;
    expectedPasswordHash: string;
    passwordHash: string;
    changedAt: string;
  }): Promise<boolean>;
}

export interface SessionRepository {
  create(input: {
    sidHash: string;
    user: User;
    ip: string;
    ua: string;
    ttlMs?: number;
  }): Promise<void>;
  find(sidHash: string): Promise<Session | null>;
  revoke(sidHash: string): Promise<void>;
  refreshUser(userId: string): Promise<void>;
}

export interface LoginAttemptRepository {
  check(key: string): Promise<{ ok: boolean; retryAfter?: number }>;
  register(input: { key: string; ip: string; username: string; route: string }): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface ExperimentRepository {
  findAll(scope?: RecordScope): Promise<ExperimentRecord[]>;
  findById(id: string): Promise<ExperimentRecord | null>;
  findByIdForAudit(id: string): Promise<ExperimentRecord | null>;
  findByClientSubmission(scope: {
    actorId: string;
    className: string;
    clientSubmissionId: string;
  }): Promise<ExperimentRecord | null>;
  add(command: PersistExperimentCommand): Promise<void>;
  update(id: string, patch: UpdateExperimentCommand): Promise<ExperimentRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface PracticeRepository {
  findAll(): Promise<PracticeAnswer[]>;
  add(answer: PracticeAnswer): Promise<void>;
}

export interface ReviewRepository {
  appendReview(command: AppendReviewCommand): Promise<ExperimentRecord | null>;
  listReviewHistory(recordId: string): Promise<RecordReview[]>;
  getEffectiveReview(recordId: string): Promise<RecordReview | null>;
}

export interface AnalysisRepository {
  createAnalysisRun(run: CreateAnalysisRunCommand, inputs: AnalysisInputSelection[]): Promise<void>;
  findAnalysisRun(id: string): Promise<AnalysisRun | null>;
  updateAnalysisRunState(id: string, update: AnalysisRunStateUpdate): Promise<AnalysisRun | null>;
  listAnalysisInputs(runId: string): Promise<AnalysisInput[]>;
}

export interface AuditRepository {
  write(event: AuditEvent): Promise<void>;
}

export interface MetricsRepository {
  read(): Promise<Record<string, string | number>>;
}
