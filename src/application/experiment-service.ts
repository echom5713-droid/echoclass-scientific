import { canAccessClass, canCreateRecord } from "../domain/authorization.js";
import { diagnoseRecord, type RecordDiagnosis } from "../domain/experiments/diagnostics.js";
import { createExperimentRecord } from "../domain/experiments/record.js";
import { validateExperiment } from "../domain/experiments/validation.js";
import {
  RepositoryConflictError,
  type AuditRepository,
  type ExperimentRepository,
  type RecordScope,
} from "../domain/repositories.js";
import type {
  CreateExperimentCommand,
  ExperimentRecord,
  OfflineExperimentCommand,
  PersistExperimentCommand,
  Session,
} from "../domain/types.js";
import { AppError } from "./errors.js";
import type { IdGenerator } from "./ports.js";

export interface OperationContext {
  actor: Session | null;
  ip: string;
  ua: string;
  authorize?: () => Promise<void>;
}

export interface OfflineSyncResult {
  added: number;
  records: Array<{
    client_submission_id: string;
    record_id: string;
    created: boolean;
  }>;
}

export class ExperimentService {
  constructor(
    private readonly records: ExperimentRepository,
    private readonly audit: AuditRepository,
    private readonly ids: IdGenerator,
  ) {}

  async list(
    actor: Session | null,
    demoRecords?: readonly ExperimentRecord[],
  ): Promise<ExperimentRecord[]> {
    if (demoRecords) return demoRecords.map((record) => structuredClone(record));
    if (!actor) return [];
    const scope: RecordScope =
      actor.role === "admin" ? { includeAll: true } : { class_name: actor.class_name };
    return this.records.findAll(scope);
  }

  private trustedCommand(input: CreateExperimentCommand, actor: Session): CreateExperimentCommand {
    const identity =
      actor.role === "student"
        ? {
            student_name: actor.name,
            class_name: actor.class_name,
            group_name: actor.group_name ?? "",
          }
        : actor.role === "teacher"
          ? {
              student_name: input.student_name,
              class_name: actor.class_name,
              group_name: input.group_name,
            }
          : {
              student_name: input.student_name,
              class_name: input.class_name,
              group_name: input.group_name,
            };
    return {
      ...identity,
      nh4cl_concentration: input.nh4cl_concentration,
      peel_mass: input.peel_mass,
      oil_mass: input.oil_mass,
      distillation_time: input.distillation_time,
      phase_clarity_score: input.phase_clarity_score,
      emulsification_level: input.emulsification_level,
      emulsion_concentration: input.emulsion_concentration,
      ecoli_observation_group: input.ecoli_observation_group,
      inhibition_zone_diameter: input.inhibition_zone_diameter,
      colony_growth_score: input.colony_growth_score,
      异常标记: input.异常标记,
      error_source: input.error_source,
      note: input.note,
      experiment_date: input.experiment_date,
      petri_diameter_mm: input.petri_diameter_mm,
      measurement_method: input.measurement_method,
    };
  }

  private async persist(
    input: CreateExperimentCommand,
    context: OperationContext,
    offline?: { clientSubmissionId: string },
  ): Promise<{ record: ExperimentRecord; diagnosis: RecordDiagnosis; mode: "stored" }> {
    const { actor } = context;
    if (!actor) throw new AppError("AUTHENTICATION_REQUIRED", "请先登录后提交真实课堂数据", 401);
    const command = this.trustedCommand(input, actor);
    if (!canCreateRecord(actor, command.class_name))
      throw new AppError("FORBIDDEN", "无权向该班级写入数据", 403);
    const findings = validateExperiment(command);
    if (findings.length)
      throw new AppError(
        "VALIDATION_ERROR",
        findings.map((item) => item.message).join("；"),
        400,
        findings,
      );

    const cohort = await this.list(actor);
    const diagnosis = diagnoseRecord(command, cohort);
    const record = createExperimentRecord(command, {
      id: `rec-${this.ids.random(16)}`,
      createdAt: new Date().toISOString(),
      createdBy: actor.username,
      createdByUserId: actor.id,
      clientSubmissionId: offline?.clientSubmissionId,
      reviewStatus: diagnosis.status === "review" ? "review" : "normal",
      syncedFromOffline: Boolean(offline),
      metadata: offline
        ? {
            client_submission_id: offline.clientSubmissionId,
            idempotency_actor_id: actor.id,
            idempotency_class_name: command.class_name,
          }
        : {},
    });
    try {
      const persistence: PersistExperimentCommand = {
        ...command,
        id: record.id,
        client_submission_id: record.client_submission_id,
        created_by_user_id: actor.id,
        created_by: record.created_by,
        created_at: record.created_at,
        initial_quality_status: record.review_status === "review" ? "review" : "normal",
        synced_from_offline: record.synced_from_offline,
        ai_diagnosis: record.ai_diagnosis,
        metadata: record.metadata,
      };
      await context.authorize?.();
      await this.records.add(persistence);
    } catch (error) {
      if (error instanceof RepositoryConflictError)
        throw new AppError("CONFLICT", "记录标识冲突，请重试", 409);
      throw error;
    }
    await this.audit.write({
      actor,
      action: "records.create",
      targetType: "record",
      targetId: record.id,
      className: record.class_name,
      ip: context.ip,
      ua: context.ua,
      ok: true,
      detail: { diagnosis: diagnosis.status, offline: Boolean(offline) },
    });
    return { record, diagnosis, mode: "stored" };
  }

  async create(
    input: CreateExperimentCommand,
    context: OperationContext,
    demo = false,
  ): Promise<{ record: ExperimentRecord; diagnosis: RecordDiagnosis; mode: "demo" | "stored" }> {
    if (demo) {
      const actor: Session = context.actor ?? {
        id: "demo",
        role: "student",
        username: "demo",
        name: input.student_name || "演示学生",
        class_name: input.class_name || "演示化学班",
        group_name: input.group_name || "演示小组",
      };
      const command = this.trustedCommand(input, actor);
      return {
        record: createExperimentRecord(command, {
          id: `demo-${this.ids.random(12)}`,
          createdAt: new Date().toISOString(),
          createdBy: "demo",
          reviewStatus: "normal",
        }),
        diagnosis: { status: "normal", reasons: ["游客沙盒提交，不写入真实数据库"] },
        mode: "demo",
      };
    }
    return this.persist(input, context);
  }

  async sync(
    inputs: OfflineExperimentCommand[],
    context: OperationContext,
  ): Promise<OfflineSyncResult> {
    const { actor } = context;
    if (!actor) throw new AppError("AUTHENTICATION_REQUIRED", "请先登录后同步真实数据", 401);
    const seen = new Map<string, string>();
    const mappings: OfflineSyncResult["records"] = [];
    let added = 0;
    for (const source of inputs) {
      const { client_submission_id: clientSubmissionId, ...command } = source;
      const trusted = this.trustedCommand(command, actor);
      if (!canAccessClass(actor, trusted.class_name)) continue;
      const scopedKey = `${trusted.class_name}\u0000${clientSubmissionId}`;
      const repeatedId = seen.get(scopedKey);
      if (repeatedId) {
        mappings.push({
          client_submission_id: clientSubmissionId,
          record_id: repeatedId,
          created: false,
        });
        continue;
      }
      const existing = await this.records.findByClientSubmission({
        actorId: actor.id,
        className: trusted.class_name,
        clientSubmissionId,
      });
      if (existing) {
        seen.set(scopedKey, existing.id);
        mappings.push({
          client_submission_id: clientSubmissionId,
          record_id: existing.id,
          created: false,
        });
        continue;
      }
      let persisted: Awaited<ReturnType<ExperimentService["persist"]>>;
      try {
        persisted = await this.persist(command, context, { clientSubmissionId });
      } catch (error) {
        if (error instanceof AppError && error.code === "CONFLICT") {
          const winner = await this.records.findByClientSubmission({
            actorId: actor.id,
            className: trusted.class_name,
            clientSubmissionId,
          });
          if (winner) {
            seen.set(scopedKey, winner.id);
            mappings.push({
              client_submission_id: clientSubmissionId,
              record_id: winner.id,
              created: false,
            });
            continue;
          }
        }
        throw error;
      }
      seen.set(scopedKey, persisted.record.id);
      mappings.push({
        client_submission_id: clientSubmissionId,
        record_id: persisted.record.id,
        created: true,
      });
      added += 1;
    }
    await this.audit.write({
      actor,
      action: "records.offline_sync",
      targetType: "records",
      className: actor.class_name,
      ip: context.ip,
      ua: context.ua,
      ok: true,
      detail: { added },
    });
    return { added, records: mappings };
  }
}
