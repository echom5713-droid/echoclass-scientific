import type { IncomingMessage, ServerResponse } from "node:http";
import type { Session } from "../domain/types.js";
import type { Language } from "../shared/language.js";

export interface HttpContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  session: Session | null;
  language?: Language;
  requestId: string;
  ip: string;
  ua: string;
}
