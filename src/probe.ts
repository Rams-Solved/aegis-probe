import type { Attack, ChatMessage, JudgeConfig, ProbeResult, TargetConfig, TurnResult } from "./types.js";

/** Network calls are aborted after this long so a dropped connection or a
 * hung upstream never leaves the spinner stuck forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Delay inserted between sequential requests when talking to a detected
 * free-tier judge endpoint, to avoid slamming shared rate limits. */
export const FREE_TIER_THROTTLE_MS = 2500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Heuristic: is this judge config likely to be a free-tier / shared-rate-limit
 * endpoint (e.g. OpenRouter's `:free` models)? Used to opt into extra
 * inter-request delay so aegis-probe doesn't trip upstream 429s.
 */
export function isFreeTierJudge(judge: JudgeConfig | undefined): boolean {
  if (!judge) return false;
  const modelLooksFree = /free/i.test(judge.model);
  const baseUrlIsOpenRouter = /openrouter\.ai/i.test(judge.baseUrl);
  return modelLooksFree || baseUrlIsOpenRouter;
}

/**
 * Sends one chat completion request to the target endpoint and returns the
 * assistant's reply text. The target is assumed to be OpenAI-compatible:
 * POST { messages: [...] } -> { choices: [{ message: { content } }] }.
 * If the shape doesn't match, we fall back to stringifying the whole body
 * so the tool still works against nonstandard endpoints.
 */
async function sendMessages(target: TargetConfig, messages: ChatMessage[]): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(target.headers ?? {}),
  };
  if (target.key) {
    headers.Authorization = `Bearer ${target.key}`;
  }

  const res = await fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      ...(target.model ? { model: target.model } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Target endpoint returned ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }

  const extracted = extractContent(data);
  return extracted ?? text;
}

function extractContent(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;

  // OpenAI-compatible: { choices: [{ message: { content } }] }
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string") {
      return message.content;
    }
    if (typeof first.text === "string") {
      return first.text;
    }
  }

  // Common alternates seen in custom chat endpoints.
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.reply === "string") return obj.reply;
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.content === "string") return obj.content;

  return undefined;
}

export interface RunAttackOptions {
  /** Called after each turn completes, for live progress reporting. */
  onTurn?: (turn: TurnResult, turnIndex: number, attack: Attack) => void;
}

/**
 * Runs a single attack against the target, maintaining conversation history
 * across all of its turns so multi-turn attacks can build on prior replies.
 * A per-request timeout (see REQUEST_TIMEOUT_MS) means a hung socket or
 * dropped connection surfaces as a normal turn error instead of hanging.
 */
export async function runAttack(
  target: TargetConfig,
  attack: Attack,
  options: RunAttackOptions = {},
): Promise<ProbeResult> {
  const history: ChatMessage[] = [];
  if (attack.system) {
    history.push({ role: "system", content: attack.system });
  }

  const turns: TurnResult[] = [];
  let finalResponse = "";

  for (let i = 0; i < attack.turns.length; i++) {
    const prompt = attack.turns[i];
    history.push({ role: "user", content: prompt });

    const start = Date.now();
    let response = "";
    let error: string | undefined;
    try {
      response = await sendMessages(target, history);
    } catch (err) {
      error = describeNetworkError(err);
    }
    const latencyMs = Date.now() - start;

    if (!error) {
      history.push({ role: "assistant", content: response });
      finalResponse = response;
    }

    const turnResult: TurnResult = { prompt, response, latencyMs, error };
    turns.push(turnResult);
    options.onTurn?.(turnResult, i, attack);

    if (error) break;
  }

  return { attack, turns, finalResponse };
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (dropped connection or hung socket).`;
    }
    return err.message;
  }
  return String(err);
}

export interface RunAttacksOptions extends RunAttackOptions {
  onAttackStart?: (attack: Attack, index: number, total: number) => void;
  onAttackComplete?: (result: ProbeResult, index: number, total: number) => void;
  /** Delay inserted before each attack after the first, e.g. for free-tier throttling. */
  throttleMs?: number;
}

export async function runAttacks(
  target: TargetConfig,
  attacks: Attack[],
  options: RunAttacksOptions = {},
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (let i = 0; i < attacks.length; i++) {
    if (i > 0 && options.throttleMs) {
      await sleep(options.throttleMs);
    }
    const attack = attacks[i];
    options.onAttackStart?.(attack, i, attacks.length);
    const result = await runAttack(target, attack, options);
    results.push(result);
    options.onAttackComplete?.(result, i, attacks.length);
  }
  return results;
}
