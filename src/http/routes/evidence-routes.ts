import type { EvidenceService } from "../../application/evidence-service.js";
import { AppError } from "../../application/errors.js";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA,
  type EvidenceTarget,
} from "../../domain/evidence/contract.js";
import { evidencePage } from "../../views/evidence-page.js";
import { validPresentationQuery } from "../../shared/language.js";
import type { HttpContext } from "../context.js";
import { evidenceHeader, evidenceInputError, readEvidenceBytes } from "../evidence-body.js";
import { sendHtml, sendJson } from "../response.js";

function id(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw evidenceInputError("证据关联标识编码无效");
  }
}

export async function evidenceRoutes(
  context: HttpContext,
  service: EvidenceService,
): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  const path = url.pathname;
  const targetRoute = /^\/api\/(records|csv\/imports)\/([^/]+)\/evidence$/.exec(path);
  const itemRoute = /^\/api\/evidence\/([^/]+)(?:\/(download|archive))?$/.exec(path);
  if (
    path !== "/evidence" &&
    !path.startsWith("/api/evidence") &&
    !/^\/api\/(?:records|csv\/imports)\/[^/]+\/evidence(?:\/|$)/.test(path)
  )
    return false;
  const actor = { actor: session, ip, ua };
  const identity = service.gate(actor);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!targetRoute && !itemRoute && path !== "/evidence")
    throw new AppError("NOT_FOUND", "证据接口不存在", 404);
  const upload = Boolean(targetRoute && req.method === "POST");
  const archive = itemRoute?.[2] === "archive";
  const allowed = targetRoute ? ["GET", "POST"] : [archive ? "POST" : "GET"];
  if (!allowed.includes(req.method ?? "")) throw evidenceInputError("证据请求方法不受支持", 405);
  if (path === "/evidence") {
    const keys = [...url.searchParams.keys()].filter((key) => key !== "lang");
    if (!validPresentationQuery(url, ["record_id", "batch_id"]) || keys.length !== 1)
      throw evidenceInputError("请选择一个实验记录或 CSV 批次");
    const target: EvidenceTarget = {
      kind: keys[0] === "record_id" ? "record" : "csv_batch",
      id: url.searchParams.get(keys[0]!) ?? "",
    };
    service.authorizeTarget(actor, target, false);
    sendHtml(res, evidencePage(context.language, url.pathname + url.search));
    return true;
  }
  const keys = [...url.searchParams.keys()];
  if (
    upload
      ? keys.length !== 1 || keys[0] !== "filename" || !url.searchParams.get("filename")
      : keys.length !== 0
  )
    throw evidenceInputError("证据请求参数缺失、重复或未知");
  if (targetRoute) {
    const target: EvidenceTarget = {
      kind: targetRoute[1] === "records" ? "record" : "csv_batch",
      id: id(targetRoute[2]!),
    };
    if (!upload) {
      sendJson(res, {
        ok: true,
        user_id: identity.id,
        role: identity.role,
        evidence: service.list(actor, target),
      });
      return true;
    }
    await service.withOperation(actor, async () => {
      service.authorizeTarget(actor, target, false);
      const type = evidenceHeader(req, "content-type");
      const encoding = evidenceHeader(req, "content-encoding", false);
      const token = evidenceHeader(req, "x-echoclass-client-upload-id");
      if (
        !["image/png", "image/jpeg", "application/pdf", "text/csv"].includes(type) ||
        encoding ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(token)
      )
        throw evidenceInputError("仅接受支持类型的未编码原始文件和有效上传标识");
      const bytes = await readEvidenceBytes(
        req,
        target.kind === "csv_batch" ? EVIDENCE_LIMITS.csvBytes : EVIDENCE_LIMITS.bytes,
      );
      const result = await service.upload(
        actor,
        target,
        {
          original_name: url.searchParams.get("filename")!,
          media_type: type,
          client_upload_id: token,
        },
        bytes,
      );
      sendJson(res, { ok: true, ...result }, result.replayed ? 200 : 201);
    });
    return true;
  }
  const evidenceId = id(itemRoute![1]!);
  if (archive) {
    if (
      evidenceHeader(req, "content-encoding", false) ||
      evidenceHeader(req, "transfer-encoding", false) ||
      !["", "0"].includes(evidenceHeader(req, "content-length", false))
    )
      throw evidenceInputError("归档请求不能包含请求体");
    sendJson(res, { ok: true, evidence: service.archive(actor, evidenceId) });
    return true;
  }
  if (itemRoute![2] === "download") {
    if (evidenceHeader(req, "range", false)) throw evidenceInputError("证据文件不支持分段下载");
    await service.withOperation(actor, async () => {
      const result = await service.download(actor, evidenceId);
      // This check and header emission are synchronous after the caller's await boundary.
      service.get(actor, evidenceId);
      res.writeHead(200, {
        "Content-Type": result.evidence.media_type,
        "Content-Disposition": `attachment; filename="echoclass-evidence.${result.evidence.extension}"`,
        "Content-Length": result.bytes.byteLength,
        "X-EchoClass-Evidence-Schema": EVIDENCE_SCHEMA,
      });
      res.end(result.bytes);
    });
    return true;
  }
  sendJson(res, { ok: true, evidence: service.get(actor, evidenceId) });
  return true;
}
