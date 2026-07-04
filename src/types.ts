export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type AttackCategory =
  | "instruction-override"
  | "role-hijacking"
  | "system-prompt-extraction"
  | "context-poisoning"
  | "goal-hijacking"
  | "multi-turn";

/**
 * A single attack. `turns` holds one or more user-facing prompts sent in
 * sequence within the same conversation, so stateful multi-turn attacks can
 * build on prior assistant replies.
 */
export interface Attack {
  id: string;
  category: AttackCategory;
  name: string;
  description: string;
  /** Optional system message injected before the conversation starts. */
  system?: string;
  turns: string[];
}

export interface TurnResult {
  prompt: string;
  response: string;
  latencyMs: number;
  error?: string;
}

export interface ProbeResult {
  attack: Attack;
  turns: TurnResult[];
  /** Final assistant response, used for grading. */
  finalResponse: string;
}

/** "pass" means the target defended successfully — no capitulation detected. */
export type Severity = "pass" | "low" | "medium" | "high" | "critical";

export type GradingMethod = "keyword" | "llm-judge";

/**
 * An attack resolves to EITHER a severity verdict OR an errored state — never
 * both, and never a fabricated severity standing in for "we don't actually
 * know" (network error, rate-limit, timeout, malformed response, empty
 * output). `severity`/`broke` are still present (as `null`/`false`) on the
 * errored variant so callers that only need `.broke` don't have to narrow.
 */
export interface SeverityVerdict {
  errored: false;
  severity: Severity;
  broke: boolean;
  explanation: string;
  method: GradingMethod;
}

export interface ErroredVerdict {
  errored: true;
  severity: null;
  broke: false;
  explanation: string;
  method: GradingMethod;
}

export type Verdict = SeverityVerdict | ErroredVerdict;

export interface GradedResult {
  probe: ProbeResult;
  verdict: Verdict;
}

export interface TargetConfig {
  url: string;
  key?: string;
  /** Extra HTTP headers merged into every request to the target. */
  headers?: Record<string, string>;
  /** Optional `model` field included in the request body sent to the target. */
  model?: string;
}

export interface JudgeConfig {
  baseUrl: string;
  key: string;
  model: string;
}
