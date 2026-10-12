import type { IncomingMessage } from "node:http";
import { AppError } from "../application/errors.js";
import { parseStrictJson } from "../domain/scientific/canonical.js";
import { SCIENTIFIC_POLICY, type ScientificCommand } from "../domain/scientific/contract.js";

export function scientificInput(message: string, status = 400): AppError {
  return new AppError("VALIDATION_ERROR", message, status);
}

function header(req: IncomingMessage, name: string): string {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) count++;
  const value = req.headers[name];
  if (count > 1 || Array.isArray(value)) throw scientificInput("科学分析请求头重复");
  return value ?? "";
}

export async function readBoundedScientificJson(req: IncomingMessage): Promise<unknown> {
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(header(req, "content-type")) ||
    header(req, "content-encoding")
  )
    throw scientificInput("科学分析需要 UTF-8 JSON 请求");
  const length = header(req, "content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 16_384)) {
    req.resume();
    throw scientificInput("科学分析请求超过 16 KiB", 413);
  }
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("error", fail);
      req.off("aborted", aborted);
    };
    const fail = (error: Error) => {
      cleanup();
      req.resume();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) fail(scientificInput("科学分析请求超过 16 KiB", 413));
      else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(scientificInput("科学分析请求未完整接收"));
    const timer = setTimeout(() => fail(scientificInput("科学分析请求超时", 408)), 10_000);
    req.on("data", data);
    req.once("end", end);
    req.once("error", fail);
    req.once("aborted", aborted);
  });
  try {
    return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw scientificInput("科学分析参数缺失、重复或无效");
  }
}

export async function readScientificCommand(req: IncomingMessage): Promise<ScientificCommand> {
  const value = (await readBoundedScientificJson(req)) as Record<string, unknown>;
  try {
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "class_id,client_request_id,policy" ||
      typeof value.class_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value.class_id) ||
      typeof value.client_request_id !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.client_request_id) ||
      value.policy !== SCIENTIFIC_POLICY
    )
      throw new Error("invalid scientific command");
    return value as unknown as ScientificCommand;
  } catch {
    throw scientificInput("科学分析参数缺失、重复或无效");
  }
}

export function requireEmptyScientificBody(req: IncomingMessage): void {
  if (
    header(req, "transfer-encoding") ||
    header(req, "content-encoding") ||
    !["", "0"].includes(header(req, "content-length"))
  )
    throw scientificInput("复现请求不接受新的数据或分析参数");
}
