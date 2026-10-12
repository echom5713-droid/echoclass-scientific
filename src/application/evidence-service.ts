import type { ContentHasher } from "../domain/csv/contract.js";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA,
  EvidenceFault,
  type EvidenceContext,
  type EvidenceFileStore,
  type EvidenceMetadata,
  type EvidenceRepository,
  type EvidenceSource,
  type EvidenceTarget,
  type StoredEvidence,
} from "../domain/evidence/contract.js";
import {
  validateEvidenceBytes,
  validateEvidenceSource,
  validateEvidenceTarget,
} from "../domain/evidence/validation.js";
import { isMachineIdentity } from "../shared/provenance-contract.js";
import { AppError, type ErrorCode } from "./errors.js";
import type { RateLimiter } from "./ports.js";

export interface EvidenceUploadInput {
  original_name: string;
  media_type: string;
  client_upload_id: string;
}

const failures = {
  input: ["VALIDATION_ERROR", 400],
  limit: ["VALIDATION_ERROR", 413],
  unauthenticated: ["AUTHENTICATION_REQUIRED", 401],
  forbidden: ["FORBIDDEN", 403],
  missing: ["NOT_FOUND", 404],
  conflict: ["CONFLICT", 409],
  unavailable: ["STORAGE_UNAVAILABLE", 503],
  corrupt: ["STORAGE_UNAVAILABLE", 503],
} as const satisfies Record<EvidenceFault["kind"], readonly [ErrorCode, number]>;

function mapped(error: unknown): unknown {
  if (!(error instanceof EvidenceFault)) return error;
  const [code, status] = failures[error.kind];
  const message = error.kind === "corrupt" ? "证据文件暂时不可用" : error.message;
  return new AppError(code, message, status, [{ field: "evidence", code: error.reason, message }]);
}

function publicMetadata(record: StoredEvidence): EvidenceMetadata {
  return {
    schema_version: record.schema_version,
    id: record.id,
    target: { ...record.target },
    client_upload_id: record.client_upload_id,
    sha256: record.sha256,
    byte_length: record.byte_length,
    media_type: record.media_type,
    extension: record.extension,
    original_name: record.original_name,
    uploader_user_id: record.uploader_user_id,
    uploader_label_snapshot: record.uploader_label_snapshot,
    received_at: record.received_at,
    app_version: record.app_version,
    archived_at: record.archived_at,
    archived_by_user_id: record.archived_by_user_id,
  };
}

export class EvidenceService {
  private activeOperations = 0;

  constructor(
    private readonly repository: EvidenceRepository,
    private readonly files: EvidenceFileStore,
    private readonly hashes: ContentHasher,
    private readonly limiter: RateLimiter,
  ) {}

  private invoke<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw mapped(error);
    }
  }

  gate(context: EvidenceContext) {
    return this.invoke(() => this.repository.authorize(context));
  }

  /** Reserve before reading an HTTP body; release only after all file work finishes. */
  async withOperation<T>(context: EvidenceContext, operation: () => Promise<T>): Promise<T> {
    const actor = this.gate(context);
    if (this.activeOperations >= EVIDENCE_LIMITS.concurrent)
      throw new AppError("STORAGE_UNAVAILABLE", "证据文件操作繁忙，请稍后重试", 503, [
        { field: "evidence", code: "EVIDENCE_BUSY", message: "证据文件操作繁忙，请稍后重试" },
      ]);
    if (!this.limiter.allow(actor.id))
      throw new AppError("RATE_LIMITED", "证据文件操作过于频繁，请稍后重试", 429);
    this.activeOperations++;
    try {
      return await operation();
    } catch (error) {
      throw mapped(error);
    } finally {
      this.activeOperations--;
    }
  }

  authorizeTarget(context: EvidenceContext, target: EvidenceTarget, write: boolean): void {
    this.invoke(() => {
      validateEvidenceTarget(target);
      this.repository.authorizeTarget(context, target, write);
    });
  }

  list(context: EvidenceContext, target: EvidenceTarget): EvidenceMetadata[] {
    return this.invoke(() => {
      validateEvidenceTarget(target);
      return this.repository.list(context, target).map(publicMetadata);
    });
  }

  get(context: EvidenceContext, id: string): EvidenceMetadata {
    return this.invoke(() => {
      this.identity(id);
      return publicMetadata(this.repository.get(context, id));
    });
  }

  archive(context: EvidenceContext, id: string): EvidenceMetadata {
    return this.invoke(() => {
      this.identity(id);
      return publicMetadata(this.repository.archive(context, id));
    });
  }

  private identity(id: string): void {
    if (!isMachineIdentity(id))
      throw new EvidenceFault("input", "INVALID_EVIDENCE_ID", "证据 ID 无效");
  }

  async upload(
    context: EvidenceContext,
    target: EvidenceTarget,
    input: EvidenceUploadInput,
    bytes: Uint8Array,
  ): Promise<{ evidence: EvidenceMetadata; replayed: boolean }> {
    try {
      this.authorizeTarget(context, target, false);
      const format = validateEvidenceBytes(target, input.media_type, input.original_name, bytes);
      const source: EvidenceSource = {
        schema_version: EVIDENCE_SCHEMA,
        ...input,
        ...format,
        sha256: this.hashes.sha256(bytes),
        byte_length: bytes.byteLength,
      };
      validateEvidenceSource(source, target);
      const prior = this.repository.findReplay(context, target, source);
      if (prior) return { evidence: publicMetadata(prior), replayed: true };
      this.repository.authorizeTarget(context, target, true);
      const object = await this.files.put(bytes);
      if (object.sha256 !== source.sha256 || object.byte_length !== source.byte_length)
        throw new EvidenceFault(
          "corrupt",
          "EVIDENCE_PUBLICATION_MISMATCH",
          "发布的证据文件校验失败",
        );
      // Commit rechecks current session, target, replay winner and quotas synchronously.
      // Published objects are retained on failure: an uncertain commit cannot justify deletion.
      const result = this.repository.commit(context, target, source, object);
      return { evidence: publicMetadata(result.evidence), replayed: result.replayed };
    } catch (error) {
      throw mapped(error);
    }
  }

  async download(
    context: EvidenceContext,
    id: string,
  ): Promise<{ evidence: EvidenceMetadata; bytes: Uint8Array }> {
    try {
      this.identity(id);
      const record = this.repository.get(context, id);
      const bytes = await this.files.read(record);
      if (bytes.byteLength !== record.byte_length || this.hashes.sha256(bytes) !== record.sha256)
        throw new EvidenceFault("corrupt", "EVIDENCE_CONTENT_MISMATCH", "证据文件校验失败");
      const current = this.repository.get(context, id);
      if (
        current.object_key !== record.object_key ||
        current.sha256 !== record.sha256 ||
        current.byte_length !== record.byte_length
      )
        throw new EvidenceFault("corrupt", "EVIDENCE_METADATA_CHANGED", "证据文件元数据不一致");
      return { evidence: publicMetadata(current), bytes };
    } catch (error) {
      throw mapped(error);
    }
  }
}
