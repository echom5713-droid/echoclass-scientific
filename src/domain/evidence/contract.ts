import type { Session } from "../types.js";

export const EVIDENCE_SCHEMA = "echoclass.evidence.v1";
export const EVIDENCE_LIMITS = Object.freeze({
  bytes: 5_242_880,
  csvBytes: 1_048_576,
  perTarget: 20,
  totalBytes: 1_073_741_824,
  concurrent: 4,
});
export type EvidenceTarget = { kind: "record" | "csv_batch"; id: string };
export interface EvidenceContext {
  actor: Session | null;
  ip: string;
  ua: string;
}
export type EvidenceMediaType = "image/png" | "image/jpeg" | "application/pdf" | "text/csv";
export type EvidenceExtension = "png" | "jpg" | "pdf" | "csv";
export interface EvidenceSource {
  schema_version: typeof EVIDENCE_SCHEMA;
  client_upload_id: string;
  sha256: string;
  byte_length: number;
  media_type: EvidenceMediaType;
  extension: EvidenceExtension;
  original_name: string;
}
export interface EvidenceMetadata extends EvidenceSource {
  id: string;
  target: EvidenceTarget;
  uploader_user_id: string;
  uploader_label_snapshot: string;
  received_at: string;
  app_version: string;
  archived_at: string | null;
  archived_by_user_id: string | null;
}
export interface EvidenceObject {
  object_key: string;
  sha256: string;
  byte_length: number;
}
export interface StoredEvidence extends EvidenceMetadata {
  object_key: string;
}
export interface EvidenceReceipt {
  evidence: StoredEvidence;
  replayed: boolean;
}
export class EvidenceFault extends Error {
  constructor(
    public readonly kind:
      | "input"
      | "limit"
      | "unauthenticated"
      | "forbidden"
      | "missing"
      | "conflict"
      | "unavailable"
      | "corrupt",
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceFault";
  }
}
export interface EvidenceRepository {
  authorize(context: EvidenceContext): { id: string; role: Session["role"] };
  authorizeTarget(context: EvidenceContext, target: EvidenceTarget, write: boolean): void;
  list(context: EvidenceContext, target: EvidenceTarget): StoredEvidence[];
  findReplay(
    context: EvidenceContext,
    target: EvidenceTarget,
    source: EvidenceSource,
  ): StoredEvidence | null;
  commit(
    context: EvidenceContext,
    target: EvidenceTarget,
    source: EvidenceSource,
    object: EvidenceObject,
  ): EvidenceReceipt;
  get(context: EvidenceContext, id: string): StoredEvidence;
  archive(context: EvidenceContext, id: string): StoredEvidence;
}
export interface EvidenceFileStore {
  put(bytes: Uint8Array): Promise<EvidenceObject>;
  read(object: EvidenceObject): Promise<Uint8Array>;
}
