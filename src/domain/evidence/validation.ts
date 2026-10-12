import { hasNonBlankUnicodeText, isMachineIdentity } from "../../shared/provenance-contract.js";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA,
  EvidenceFault,
  type EvidenceExtension,
  type EvidenceMediaType,
  type EvidenceSource,
  type EvidenceTarget,
} from "./contract.js";

const types: Record<EvidenceMediaType, EvidenceExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
  "text/csv": "csv",
};

export function validateEvidenceTarget(target: EvidenceTarget): void {
  if (!target || !["record", "csv_batch"].includes(target.kind) || !isMachineIdentity(target.id))
    throw new EvidenceFault("input", "INVALID_EVIDENCE_TARGET", "证据关联目标无效");
}

function mediaAndName(target: EvidenceTarget, mediaType: string, originalName: string) {
  validateEvidenceTarget(target);
  if (
    !hasNonBlankUnicodeText(originalName) ||
    originalName.length > 255 ||
    /[\p{Cc}\p{Cf}/\\]/u.test(originalName)
  )
    throw new EvidenceFault(
      "input",
      "INVALID_FILENAME",
      "文件名须为不超过 255 字符的非空文本，且不能含路径或控制字符",
    );
  if (!Object.hasOwn(types, mediaType))
    throw new EvidenceFault("input", "INVALID_MEDIA_TYPE", "文件类型不受支持");
  const media_type = mediaType as EvidenceMediaType;
  const extension = types[media_type];
  const suffix = originalName.slice(originalName.lastIndexOf(".") + 1).toLowerCase();
  if (
    !originalName.includes(".") ||
    (suffix !== extension && !(extension === "jpg" && suffix === "jpeg")) ||
    (target.kind === "csv_batch" ? media_type !== "text/csv" : media_type === "text/csv")
  )
    throw new EvidenceFault(
      "input",
      "EVIDENCE_TYPE_MISMATCH",
      "文件扩展名、声明类型与关联目标不一致",
    );
  return { media_type, extension };
}

export function validateEvidenceSource(source: EvidenceSource, target: EvidenceTarget): void {
  const expected = mediaAndName(target, source.media_type, source.original_name);
  if (
    source.schema_version !== EVIDENCE_SCHEMA ||
    typeof source.client_upload_id !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(source.client_upload_id) ||
    typeof source.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    source.extension !== expected.extension
  )
    throw new EvidenceFault("input", "EVIDENCE_ENVELOPE", "证据标识、摘要或格式无效");
  const maximum = target.kind === "csv_batch" ? EVIDENCE_LIMITS.csvBytes : EVIDENCE_LIMITS.bytes;
  if (!Number.isInteger(source.byte_length) || source.byte_length <= 0)
    throw new EvidenceFault("input", "EMPTY_EVIDENCE", "证据文件不能为空");
  if (source.byte_length > maximum)
    throw new EvidenceFault("limit", "FILE_TOO_LARGE", "证据文件超过允许大小");
}

export function validateEvidenceBytes(
  target: EvidenceTarget,
  mediaType: string,
  originalName: string,
  bytes: Uint8Array,
): { media_type: EvidenceMediaType; extension: EvidenceExtension } {
  const format = mediaAndName(target, mediaType, originalName);
  const maximum = target.kind === "csv_batch" ? EVIDENCE_LIMITS.csvBytes : EVIDENCE_LIMITS.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    throw new EvidenceFault("input", "EMPTY_EVIDENCE", "证据文件不能为空");
  if (bytes.byteLength > maximum)
    throw new EvidenceFault("limit", "FILE_TOO_LARGE", "证据文件超过允许大小");
  const signatures: Partial<Record<EvidenceMediaType, readonly number[]>> = {
    "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
    "image/jpeg": [255, 216, 255],
    "application/pdf": [37, 80, 68, 70, 45],
  };
  const signature = signatures[format.media_type];
  if (signature && !signature.every((value, index) => bytes[index] === value))
    throw new EvidenceFault("input", "EVIDENCE_SIGNATURE_MISMATCH", "文件内容签名与声明类型不一致");
  if (format.media_type === "text/csv") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new EvidenceFault("input", "INVALID_UTF8", "CSV 原文件必须是有效 UTF-8 字节");
    }
  }
  return format;
}
