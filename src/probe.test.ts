import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAttack, isFreeTierJudge, sleep } from "./probe.js";
import type { Attack, TargetConfig, JudgeConfig } from "./types.js";

const target: TargetConfig = { url: "https://example.com/chat" };

const attack: Attack = {
  id: "test-01",
  category: "instruction-override",
  name: "Test attack",
  description: "A test attack.",
  turns: ["first turn"],
};

const multiTurnAttack: Attack = {
  id: "test-02",
  category: "multi-turn",
  name: "Test multi-turn",
  description: "A test multi-turn attack.",
  turns: ["first turn", "second turn"],
};

afterEach(() => {
  mock.reset();
});

test("runAttack: extracts content from OpenAI-style choices/message shape", async () => {
  mock.method(global, "fetch", async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "hello from target" } }] }), { status: 200 }),
  );
  const result = await runAttack(target, attack);
  assert.equal(result.finalResponse, "hello from target");
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].error, undefined);
});

test("runAttack: extracts content from choices/text alternate shape", async () => {
  mock.method(global, "fetch", async () => new Response(JSON.stringify({ choices: [{ text: "legacy completion" }] }), { status: 200 }));
  const result = await runAttack(target, attack);
  assert.equal(result.finalResponse, "legacy completion");
});

test("runAttack: extracts content from common custom-endpoint shapes", async () => {
  for (const key of ["response", "reply", "message", "content"]) {
    mock.method(global, "fetch", async () => new Response(JSON.stringify({ [key]: `via ${key}` }), { status: 200 }));
    const result = await runAttack(target, attack);
    assert.equal(result.finalResponse, `via ${key}`);
  }
});

test("runAttack: falls back to raw text when the response isn't recognized JSON", async () => {
  mock.method(global, "fetch", async () => new Response("plain text reply", { status: 200 }));
  const result = await runAttack(target, attack);
  assert.equal(result.finalResponse, "plain text reply");
});

test("runAttack: a non-ok HTTP status becomes a turn error, not a thrown exception", async () => {
  mock.method(global, "fetch", async () => new Response("server exploded", { status: 500, statusText: "Internal Server Error" }));
  const result = await runAttack(target, attack);
  assert.match(result.turns[0].error ?? "", /500/);
  assert.equal(result.finalResponse, "");
});

test("runAttack: stops after the first errored turn in a multi-turn attack", async () => {
  let callCount = 0;
  mock.method(global, "fetch", async () => {
    callCount++;
    return new Response("boom", { status: 500, statusText: "Internal Server Error" });
  });
  const result = await runAttack(target, multiTurnAttack);
  assert.equal(callCount, 1);
  assert.equal(result.turns.length, 1);
});

test("runAttack: carries conversation history across turns", async () => {
  const bodies: string[] = [];
  mock.method(global, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(init.body as string);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  });
  await runAttack(target, multiTurnAttack);
  assert.equal(bodies.length, 2);
  const secondBodyMessages = JSON.parse(bodies[1]).messages;
  assert.equal(secondBodyMessages.length, 3); // turn1 user, turn1 assistant, turn2 user
  assert.equal(secondBodyMessages[1].role, "assistant");
});

test("isFreeTierJudge: detects OpenRouter and 'free' model names", () => {
  assert.equal(isFreeTierJudge(undefined), false);
  assert.equal(isFreeTierJudge({ baseUrl: "https://openrouter.ai/api/v1", key: "k", model: "gpt-4o" }), true);
  assert.equal(isFreeTierJudge({ baseUrl: "https://api.example.com", key: "k", model: "some-model:free" }), true);
  assert.equal(isFreeTierJudge({ baseUrl: "https://api.example.com", key: "k", model: "gpt-4o" }), false);
});

test("sleep resolves after roughly the requested delay", async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15);
});
