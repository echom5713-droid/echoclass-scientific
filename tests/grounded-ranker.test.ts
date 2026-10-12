import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekGroundedRanker } from "../src/infrastructure/llm/grounded-ranker.js";

const config = { enabled: true, apiKey: "synthetic-test-key-not-real", model: "deepseek-v4-flash" };
const input = { topic: "best" as const, cards: [{ id: "best", title: "已测条件" }] };
const response = (content = '{"card_ids":["best"]}', finish_reason = "stop") =>
  Response.json({ choices: [{ finish_reason, message: { content } }] });
test("grounded adapter requires explicit enable, dedicated key and supported model", async () => {
  for (const change of [{ enabled: false }, { apiKey: "" }, { model: "unknown" }]) {
    let calls = 0;
    const ranker = new DeepSeekGroundedRanker({ ...config, ...change }, () => {
      calls++;
      return Promise.resolve(response());
    });
    assert.equal(ranker.configured(), false);
    await assert.rejects(ranker.rank(input));
    assert.equal(calls, 0);
  }
});
test("grounded adapter pins HTTPS endpoint, refuses redirects and sends only fixed metadata", async () => {
  const ranker = new DeepSeekGroundedRanker(config, (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options!.redirect, "error");
    assert.ok(options!.signal);
    const body = JSON.parse(options!.body as string) as {
      messages: { content: string }[];
      response_format: unknown;
    };
    assert.deepEqual(JSON.parse(body.messages[1]!.content), input);
    assert.deepEqual(body.response_format, { type: "json_object" });
    return Promise.resolve(response());
  });
  assert.equal(await ranker.rank(input), '{"card_ids":["best"]}');
});
test("grounded provider rejects bad status, MIME, UTF-8, duplicate JSON, truncation and oversized body", async () => {
  const cases = [
    () => new Response("synthetic error", { status: 500 }),
    () => new Response("<html>not json</html>", { headers: { "Content-Type": "text/html" } }),
    () => new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }),
    () =>
      new Response('{"choices":[],"choices":[]}', {
        headers: { "Content-Type": "application/json" },
      }),
    () => response("{}", "length"),
    () => Response.json({ choices: [] }),
    () =>
      Response.json({
        choices: { 0: { finish_reason: "stop", message: { content: "{}" } }, length: 1 },
      }),
    () => Response.json({ choices: [{ finish_reason: "stop", message: { content: 3 } }] }),
    () => new Response(" ".repeat(16385), { headers: { "Content-Type": "application/json" } }),
  ];
  for (const make of cases)
    await assert.rejects(
      new DeepSeekGroundedRanker(config, () => Promise.resolve(make())).rank(input),
    );
});
test("deadline includes response body and abort is propagated", async () => {
  let signal: AbortSignal | null | undefined;
  const ranker = new DeepSeekGroundedRanker(
    config,
    (_url, options) => {
      signal = options!.signal;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              signal!.addEventListener("abort", () => controller.error(Error("synthetic abort")), {
                once: true,
              });
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    },
    20,
  );
  await assert.rejects(ranker.rank(input));
  assert.equal(signal!.aborted, true);
});
test("hung transport retains two physical slots after timeout, preventing unlimited requests", async () => {
  const finish: ((value: Response) => void)[] = [];
  const ranker = new DeepSeekGroundedRanker(
    config,
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
    20,
  );
  await assert.rejects(ranker.rank(input));
  await assert.rejects(ranker.rank(input));
  await assert.rejects(ranker.rank(input));
  assert.equal(finish.length, 2);
  for (const resolve of finish) resolve(response());
  await new Promise((resolve) => setImmediate(resolve));
  const fourth = ranker.rank(input);
  finish[2]!(response());
  assert.equal(await fourth, '{"card_ids":["best"]}');
});
