import type { GroundedRanker } from "../../application/grounded-service.js";
import { parseStrictJson } from "../../domain/scientific/canonical.js";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
export interface GroundedRankerConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
}

/** Dedicated opt-in credential; this adapter never consults legacy AI credentials. */
export class DeepSeekGroundedRanker implements GroundedRanker {
  private active = 0;
  constructor(
    private readonly config: GroundedRankerConfig,
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}
  configured(): boolean {
    return (
      this.config.enabled &&
      Boolean(this.config.apiKey.trim()) &&
      ["deepseek-v4-flash", "deepseek-v4-pro"].includes(this.config.model)
    );
  }
  async rank(input: Parameters<GroundedRanker["rank"]>[0]): Promise<string> {
    if (!this.configured() || this.active >= 2) throw Error("Grounded model unavailable");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.active++;
    // The actual operation owns its slot until it settles, even if a broken
    // transport ignores abort. A deadline cannot create unbounded new work.
    const operation = this.perform(input, controller.signal).finally(() => {
      this.active--;
    });
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("Grounded model deadline"));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async perform(
    input: Parameters<GroundedRanker["rank"]>[0],
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.request(ENDPOINT, {
      method: "POST",
      signal,
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              'Reorder these fixed evidence cards for readability. Return only JSON with exactly one key: {"card_ids":["id1","id2"]}. Include every supplied ID exactly once. Do not add text, facts, citations or identifiers.',
          },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (
      !response.ok ||
      !response.body ||
      !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
    ) {
      await response.body?.cancel();
      throw Error("Invalid grounded provider response");
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0,
      complete = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        size += value.length;
        if (size > 16384) throw Error("Grounded provider response too large");
        chunks.push(value);
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const payload = parseStrictJson(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
    ) as {
      choices?: { finish_reason?: unknown; message?: { content?: unknown } }[];
    };
    const choice = payload?.choices?.[0];
    if (
      !Array.isArray(payload?.choices) ||
      payload.choices.length !== 1 ||
      choice?.finish_reason !== "stop" ||
      typeof choice.message?.content !== "string"
    )
      throw Error("Incomplete grounded provider response");
    return choice.message.content;
  }
}
