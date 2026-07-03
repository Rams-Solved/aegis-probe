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

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export interface Verdict {
  severity: Severity;
  broke: boolean;
  explanation: string;
  method: "keyword" | "llm-judge";
}

export interface GradedResult {
  probe: ProbeResult;
  verdict: Verdict;
}

export interface TargetConfig {
  url: string;
  key?: string;
  /** Extra HTTP headers merged into every request to the target. */
  headers?: Record<string, string>;
}

export interface JudgeConfig {
  baseUrl: string;
  key: string;
  model: string;
}
