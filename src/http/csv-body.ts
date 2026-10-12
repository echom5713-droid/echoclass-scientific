import type { IncomingMessage } from "node:http";
import { AppError } from "../application/errors.js";
import { CSV_LIMITS } from "../domain/csv/contract.js";

export function csvInputError(message: string, status = 400): AppError {
  return new AppError("VALIDATION_ERROR", message, status, [
    {
      row_number: null,
      field: "csv",
      code: status === 413 ? "FILE_TOO_LARGE" : "CSV_ENVELOPE",
      message,
    },
  ]);
}

export function singleHeader(req: IncomingMessage, name: string, required = true): string {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === name) count++;
  }
  const value = req.headers[name];
  if (count > 1 || Array.isArray(value) || (required && (!value || count !== 1)))
    throw csvInputError("CSV 请求头缺失或重复");
  return value ?? "";
}

export function readCsvBytes(req: IncomingMessage): Promise<Uint8Array> {
  const length = singleHeader(req, "content-length", false);
  if (length && (!/^\d+$/.test(length) || Number(length) > CSV_LIMITS.bytes)) {
    req.resume();
    return Promise.reject(csvInputError("CSV 超过 1 MiB 限制", 413));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("aborted", aborted);
      req.off("error", fail);
    };
    const fail = (error: Error) => {
      cleanup();
      req.resume();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > CSV_LIMITS.bytes) {
        fail(csvInputError("CSV 超过 1 MiB 限制", 413));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(csvInputError("CSV 请求未完整接收"));
    const timer = setTimeout(() => fail(csvInputError("CSV 上传超时", 408)), 15_000);
    req.on("data", data);
    req.once("end", end);
    req.once("aborted", aborted);
    req.once("error", fail);
  });
}
