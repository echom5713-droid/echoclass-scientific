import type { OperationsService } from "../../application/operations-service.js";
import type { HttpContext } from "../context.js";
import { sendJson } from "../response.js";

export async function operationsRoutes(
  context: HttpContext,
  service: OperationsService,
): Promise<boolean> {
  const { req, res, url, session } = context;
  if (req.method !== "GET") return false;
  if (url.pathname === "/api/health") {
    sendJson(res, service.health());
    return true;
  }
  if (url.pathname === "/api/metrics") {
    sendJson(res, await service.operationalMetrics(session));
    return true;
  }
  return false;
}
