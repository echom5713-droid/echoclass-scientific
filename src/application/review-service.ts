import { canReviewRecord, hasRole } from "../domain/authorization.js";
import type {
  AuditRepository,
  ExperimentRepository,
  ReviewRepository,
} from "../domain/repositories.js";
import type {
  AppendReviewCommand,
  ExperimentRecord,
  RecordReview,
  Session,
} from "../domain/types.js";
import { AppError } from "./errors.js";
import type { IdGenerator } from "./ports.js";

export type ReviewAction = "include" | "approve" | "exclude" | "review" | "delete";

export class ReviewService {
  constructor(
    private readonly records: ExperimentRepository,
    private readonly reviews: ReviewRepository,
    private readonly audit: AuditRepository,
    ids: IdGenerator,
  ) {
    // Compatibility injection retained while authoritative event IDs move to persistence.
    void ids;
  }

  async apply(
    actor: Session | null,
    recordId: string,
    action: ReviewAction,
    note: string,
    meta: { ip: string; ua: string },
  ): Promise<{ deleted: boolean; record?: ExperimentRecord }> {
    if (!actor || !hasRole(actor, ["teacher", "admin"]))
      throw new AppError("FORBIDDEN", "无权限", 403);
    const record = await this.records.findById(recordId);
    if (!record) throw new AppError("NOT_FOUND", "记录不存在", 404);
    if (!canReviewRecord(actor, record)) throw new AppError("FORBIDDEN", "无权管理该班级数据", 403);
    if (action === "delete") {
      const deleted = await this.records.delete(recordId);
      if (!deleted) throw new AppError("NOT_FOUND", "记录不存在或已归档", 404);
      await this.audit.write({
        actor: actor ?? undefined,
        action: "record.archive",
        targetType: "record",
        targetId: recordId,
        className: record.class_name,
        ...meta,
        ok: true,
      });
      return { deleted: true };
    }
    const statusMap = {
      include: "included",
      approve: "included",
      exclude: "excluded",
      review: "review",
    } as const;
    const status = statusMap[action];
    if (!status) throw new AppError("VALIDATION_ERROR", "未知操作", 400);
    const review: AppendReviewCommand = {
      record_id: recordId,
      reviewer_user_id: actor.id,
      status,
      note,
      reviewed_by: actor.username,
    };
    const updated = await this.reviews.appendReview(review);
    await this.audit.write({
      actor: actor ?? undefined,
      action: `record.${status}`,
      targetType: "record",
      targetId: recordId,
      className: record.class_name,
      ...meta,
      ok: true,
    });
    return { deleted: false, record: updated ?? record };
  }

  async history(actor: Session | null, recordId: string): Promise<RecordReview[]> {
    if (!hasRole(actor, ["teacher", "admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    const record = await this.records.findByIdForAudit(recordId);
    if (!record) throw new AppError("NOT_FOUND", "记录不存在", 404);
    if (!canReviewRecord(actor, record)) throw new AppError("FORBIDDEN", "无权查看该班级评审", 403);
    return this.reviews.listReviewHistory(recordId);
  }
}
