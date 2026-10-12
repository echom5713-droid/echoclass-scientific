import type { IncomingMessage } from "node:http";
import { AppError } from "../application/errors.js";

export function evidenceInputError(message: string, status = 400): AppError {
  return new AppError("VALIDATION_ERROR", message, status, [
    {
      field: "evidence",
      code: status === 413 ? "FILE_TOO_LARGE" : "EVIDENCE_ENVELOPE",
      message,
    },
  ]);
}

export function evidenceHeader(req: IncomingMessage, name: string, required = true): string {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) count++;
  const value = req.headers[name];
  if (count > 1 || Array.isArray(value) || (required && (!value || count !== 1)))
    throw evidenceInputError("证据请求头缺失或重复");
  return value ?? "";
}

export function readEvidenceBytes(req: IncomingMessage, maximum: number): Promise<Uint8Array> {
  const length = evidenceHeader(req, "content-length", false);
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    req.resume();
    return Promise.reject(evidenceInputError("证据文件超过允许大小", 413));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("aborted", aborted);
      req.off("error", fail);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) return fail(evidenceInputError("证据文件超过允许大小", 413));
      chunks.push(chunk);
    };
    const end = () => {
      if (settled) return;
      if (length && Number(length) !== size)
        return fail(evidenceInputError("证据文件请求未完整接收"));
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(evidenceInputError("证据文件请求未完整接收"));
    const timer = setTimeout(() => fail(evidenceInputError("证据上传超时", 408)), 15_000);
    req.on("data", data);
    req.once("end", end);
    req.once("aborted", aborted);
    req.once("error", fail);
  });
}
