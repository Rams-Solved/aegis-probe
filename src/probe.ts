import type { Attack, ChatMessage, ProbeResult, TargetConfig, TurnResult } from "./types.js";

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
    body: JSON.stringify({ messages }),
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
      error = err instanceof Error ? err.message : String(err);
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

export interface RunAttacksOptions extends RunAttackOptions {
  onAttackStart?: (attack: Attack, index: number, total: number) => void;
  onAttackComplete?: (result: ProbeResult, index: number, total: number) => void;
}

export async function runAttacks(
  target: TargetConfig,
  attacks: Attack[],
  options: RunAttacksOptions = {},
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (let i = 0; i < attacks.length; i++) {
    const attack = attacks[i];
    options.onAttackStart?.(attack, i, attacks.length);
    const result = await runAttack(target, attack, options);
    results.push(result);
    options.onAttackComplete?.(result, i, attacks.length);
  }
  return results;
}
