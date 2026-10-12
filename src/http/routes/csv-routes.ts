import type { CsvService } from "../../application/csv-service.js";
import { AppError } from "../../application/errors.js";
import { CSV_SCHEMA } from "../../domain/csv/contract.js";
import { csvPage } from "../../views/csv-page.js";
import { validPresentationQuery } from "../../shared/language.js";
import type { HttpContext } from "../context.js";
import { csvInputError, readCsvBytes, singleHeader } from "../csv-body.js";
import { sendHtml, sendJson } from "../response.js";

export async function csvRoutes(context: HttpContext, service: CsvService): Promise<boolean> {
  const { req, res, url, session, ip, ua } = context;
  const path = url.pathname;
  if (path !== "/csv" && !path.startsWith("/api/csv/")) return false;
  const actor = { actor: session, ip, ua };
  const limited = path !== "/csv" && !["/api/csv/template", "/api/csv/classes"].includes(path);
  const identity = service.gate(actor, limited);
  res.setHeader("Cache-Control", "no-store");
  const write = path === "/api/csv/preview" || path === "/api/csv/import";
  if (req.method !== (write ? "POST" : "GET")) throw csvInputError("CSV 请求方法不受支持", 405);
  if (path === "/csv") {
    if (!validPresentationQuery(url)) throw csvInputError("CSV 请求参数缺失、重复或未知");
    sendHtml(res, csvPage(context.language));
    return true;
  }
  const needsClass = write || path === "/api/csv/export";
  if (
    [...url.searchParams.keys()].some((key) => key !== "class_id" || !needsClass) ||
    (needsClass &&
      (url.searchParams.getAll("class_id").length !== 1 || !url.searchParams.get("class_id")))
  )
    throw csvInputError("CSV 请求参数缺失、重复或未知");
  const classId = url.searchParams.get("class_id") ?? "";
  const download = (bytes: Uint8Array, schema: string, filename: string) => {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-EchoClass-Csv-Schema": schema,
      "Content-Length": bytes.byteLength,
    });
    res.end(bytes);
  };
  if (path === "/api/csv/classes") {
    sendJson(res, { ok: true, user_id: identity.id, classes: service.classes(actor) });
    return true;
  }
  if (path === "/api/csv/template") {
    download(service.template(), CSV_SCHEMA, "echoclass-experiment-template-v1.csv");
    return true;
  }
  if (path === "/api/csv/export") {
    const result = service.export(actor, classId);
    download(result.bytes, result.schema, "echoclass-experiments-spreadsheet-v1.csv");
    return true;
  }
  if (write) {
    const type = singleHeader(req, "content-type");
    const encoding = singleHeader(req, "content-encoding", false);
    const schema = singleHeader(req, "x-echoclass-csv-schema");
    if (
      !/^text\/csv(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(type) ||
      (encoding && encoding.toLowerCase() !== "identity") ||
      schema !== CSV_SCHEMA
    )
      throw csvInputError("仅接受 v1 契约的 UTF-8 text/csv 原始字节");
    const token = singleHeader(req, "x-echoclass-client-import-id", path.endsWith("/import"));
    const hash = singleHeader(req, "x-echoclass-expected-sha256", path.endsWith("/import"));
    if (
      path.endsWith("/import") &&
      (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || !/^[a-f0-9]{64}$/.test(hash))
    )
      throw csvInputError("导入标识或预览摘要格式无效");
    service.resolveClass(actor, classId);
    const bytes = await readCsvBytes(req);
    if (path.endsWith("/preview")) sendJson(res, service.preview(actor, classId, schema, bytes));
    else {
      const result = service.import(actor, classId, schema, token, hash, bytes);
      sendJson(res, { ok: true, ...result }, result.replayed ? 200 : 201);
    }
    return true;
  }
  const receipt = /^\/api\/csv\/imports\/([^/]+)$/.exec(path);
  if (receipt) {
    sendJson(res, { ok: true, receipt: service.receipt(actor, receipt[1]!) });
    return true;
  }
  throw new AppError("NOT_FOUND", "CSV 接口不存在", 404);
}
