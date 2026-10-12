import type { ServerResponse } from "node:http";
import { AppError } from "../application/errors.js";
import { sendJson } from "./response.js";

export interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; fields: unknown[] };
  request_id: string;
}

export function errorEnvelope(
  error: unknown,
  requestId: string,
): { status: number; body: ErrorEnvelope } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, fields: error.fields },
        request_id: requestId,
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "服务器暂时无法处理请求", fields: [] },
      request_id: requestId,
    },
  };
}

export function sendError(res: ServerResponse, error: unknown, requestId: string): number {
  const mapped = errorEnvelope(error, requestId);
  sendJson(res, mapped.body, mapped.status);
  return mapped.status;
}
