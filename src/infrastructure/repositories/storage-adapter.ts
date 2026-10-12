import type {
  AnalysisRepository,
  AuditRepository,
  ExperimentRepository,
  LoginAttemptRepository,
  MetricsRepository,
  ReviewRepository,
  SessionRepository,
  UserRepository,
} from "../../domain/repositories.js";
import type {
  AnalysisInput,
  AnalysisInputSelection,
  AnalysisRun,
  AnalysisRunStateUpdate,
  CreateAnalysisRunCommand,
  AuditEvent,
  ExperimentRecord,
  PersistExperimentCommand,
  RecordReview,
  Session,
  UpdateExperimentCommand,
  User,
} from "../../domain/types.js";
import {
  addRecord,
  appendRecordReview,
  auditLog,
  checkLoginRateLimit,
  clearLoginFailures,
  createAnalysisRun,
  createSession,
  changeUserPassword,
  deleteRecord,
  ensureData,
  findAnalysisRun,
  findRecordByClientSubmission,
  findRecordById,
  findRecordByIdIncludingDeleted,
  metrics,
  readAnalysisInputs,
  readEffectiveReview,
  readRecords,
  readReviewHistory,
  readSession,
  readUsers,
  registerLoginFailure,
  revokeSession,
  storageInfo,
  updateRecord,
  updateAnalysisRunState,
  updateSessionForUser,
  updateUser,
  saveUsers,
} from "../database/storage.js";

export { ensureData, storageInfo };
export {
  createCsvRepository,
  createEvidenceRepository,
  createScientificRepository,
} from "../database/storage.js";

export class StorageUserRepository implements UserRepository {
  async findAll(scope = {}): Promise<User[]> {
    return (await readUsers(scope)) as User[];
  }
  async findById(id: string): Promise<User | null> {
    return (await this.findAll({ includeAll: true })).find((user) => user.id === id) ?? null;
  }
  async findByUsername(username: string): Promise<User | null> {
    return (
      (await this.findAll({ includeAll: true })).find((user) => user.username === username) ?? null
    );
  }
  async saveAll(users: User[], expectedUsers?: readonly User[]): Promise<void> {
    await saveUsers(users, expectedUsers);
  }
  async update(id: string, patch: Partial<User>): Promise<User | null> {
    return (await updateUser(id, patch)) as User | null;
  }
  async changePassword(input: Parameters<UserRepository["changePassword"]>[0]): Promise<boolean> {
    return changeUserPassword(input);
  }
}

export class StorageSessionRepository implements SessionRepository {
  async create(input: Parameters<SessionRepository["create"]>[0]): Promise<void> {
    await createSession(input);
  }
  async find(sidHash: string): Promise<Session | null> {
    return await readSession(sidHash);
  }
  async revoke(sidHash: string): Promise<void> {
    await revokeSession(sidHash);
  }
  async refreshUser(userId: string): Promise<void> {
    await updateSessionForUser(userId);
  }
}

export class StorageLoginAttemptRepository implements LoginAttemptRepository {
  async check(key: string): Promise<{ ok: boolean; retryAfter?: number }> {
    return checkLoginRateLimit({ key });
  }
  async register(input: Parameters<LoginAttemptRepository["register"]>[0]): Promise<void> {
    await registerLoginFailure(input);
  }
  async clear(key: string): Promise<void> {
    await clearLoginFailures(key);
  }
}

export class StorageExperimentRepository implements ExperimentRepository, ReviewRepository {
  async findAll(scope = {}): Promise<ExperimentRecord[]> {
    return (await readRecords(scope)) as ExperimentRecord[];
  }
  async findById(id: string): Promise<ExperimentRecord | null> {
    return (await findRecordById(id)) as ExperimentRecord | null;
  }
  async findByIdForAudit(id: string): Promise<ExperimentRecord | null> {
    return (await findRecordByIdIncludingDeleted(id)) as ExperimentRecord | null;
  }
  async findByClientSubmission(scope: {
    actorId: string;
    className: string;
    clientSubmissionId: string;
  }): Promise<ExperimentRecord | null> {
    return (await findRecordByClientSubmission(scope)) as ExperimentRecord | null;
  }
  async add(record: PersistExperimentCommand): Promise<void> {
    await addRecord(record);
  }
  async update(id: string, patch: UpdateExperimentCommand): Promise<ExperimentRecord | null> {
    return (await updateRecord(id, patch)) as ExperimentRecord | null;
  }
  async appendReview(
    command: import("../../domain/types.js").AppendReviewCommand,
  ): Promise<ExperimentRecord | null> {
    return (await appendRecordReview(command)) as ExperimentRecord | null;
  }
  async listReviewHistory(recordId: string): Promise<RecordReview[]> {
    return (await readReviewHistory(recordId)) as RecordReview[];
  }
  async getEffectiveReview(recordId: string): Promise<RecordReview | null> {
    return (await readEffectiveReview(recordId)) as RecordReview | null;
  }
  async delete(id: string): Promise<boolean> {
    return (await deleteRecord(id)) as boolean;
  }
}

export class StorageAnalysisRepository implements AnalysisRepository {
  async createAnalysisRun(
    run: CreateAnalysisRunCommand,
    inputs: AnalysisInputSelection[],
  ): Promise<void> {
    await createAnalysisRun(run, inputs);
  }
  async findAnalysisRun(id: string): Promise<AnalysisRun | null> {
    return (await findAnalysisRun(id)) as AnalysisRun | null;
  }
  async updateAnalysisRunState(
    id: string,
    update: AnalysisRunStateUpdate,
  ): Promise<AnalysisRun | null> {
    return (await updateAnalysisRunState(id, update)) as AnalysisRun | null;
  }
  async listAnalysisInputs(runId: string): Promise<AnalysisInput[]> {
    return (await readAnalysisInputs(runId)) as AnalysisInput[];
  }
}

export class StorageAuditRepository implements AuditRepository {
  async write(event: AuditEvent): Promise<void> {
    await auditLog({
      actor: event.actor,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      className: event.className,
      ip: event.ip,
      ua: event.ua,
      ok: event.ok,
      detail: event.detail,
    });
  }
}

export class StorageMetricsRepository implements MetricsRepository {
  async read(): Promise<Record<string, string | number>> {
    return metrics();
  }
}
