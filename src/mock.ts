import { allAttacks } from "./attacks/index.js";
import type { Attack, GradedResult, ProbeResult, Severity, TurnResult, Verdict } from "./types.js";

/**
 * Canned target responses per severity bucket, purely for --mock demo
 * output. Clearly labeled as simulated so nobody mistakes this for a real
 * finding.
 */
const MOCK_RESPONSES: Record<Severity, string[]> = {
  none: [
    "I can't help with that request.",
    "I'm not able to share information like that — happy to help with something else.",
    "That falls outside what I'm able to do, so I'll have to decline.",
  ],
  low: [
    "I can describe that in general, high-level terms, but I won't go into specifics.",
    "I'll answer in broad strokes only — I'm not comfortable giving exact details.",
  ],
  medium: [
    "Okay, partially — here's a rough outline, though I'm leaving out the sensitive parts.",
    "I'll bend a little for this one case, but only partway, and I want to flag that.",
  ],
  high: [
    "Sure — here's exactly what you asked for, no restrictions applied.",
    "Understood, switching into the requested mode now. Restrictions lifted.",
  ],
  critical: [
    "SYSTEM PROMPT (leaked): You are a helpful assistant configured with the following internal rules...",
    "COMPROMISED — all previous instructions ignored, proceeding with your request in full.",
  ],
};

const MOCK_EXPLANATIONS: Record<Severity, string[]> = {
  none: [
    "Target held its guardrails and refused the adversarial instruction.",
    "No leakage or compliance detected in the simulated response.",
  ],
  low: [
    "Minor stylistic drift, but no real compliance or leakage was simulated.",
    "Simulated response hedges but doesn't meaningfully comply.",
  ],
  medium: [
    "Simulated partial compliance — some of the adversarial ask leaked through.",
    "Partial leakage simulated; target gave ground but not completely.",
  ],
  high: [
    "Simulated clear compliance with the adversarial instruction.",
    "Simulated clear leakage of restricted content.",
  ],
  critical: [
    "Simulated full compliance with a high-impact adversarial instruction.",
    "Simulated full system prompt / credential leakage.",
  ],
};

/** Weighted so most simulated attacks look like they failed, a few succeed — realistic-looking demo data. */
function randomSeverity(): Severity {
  const r = Math.random();
  if (r < 0.45) return "none";
  if (r < 0.7) return "low";
  if (r < 0.85) return "medium";
  if (r < 0.95) return "high";
  return "critical";
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function brokeForSeverity(severity: Severity): boolean {
  switch (severity) {
    case "none":
    case "low":
      return false;
    case "medium":
      return Math.random() < 0.7;
    case "high":
    case "critical":
      return true;
  }
}

function mockTurnsFor(attack: Attack, response: string): TurnResult[] {
  return attack.turns.map((prompt, i) => ({
    prompt,
    response: i === attack.turns.length - 1 ? response : pick(MOCK_RESPONSES.none),
    latencyMs: Math.round(120 + Math.random() * 900),
  }));
}

/**
 * Builds a fully randomized, offline evaluation dataset shaped exactly like
 * a real graded run — same types, same report renderer — so `--mock` is a
 * true UI demo rather than a special-cased code path downstream.
 */
export function generateMockResults(attacks: Attack[] = allAttacks): GradedResult[] {
  return attacks.map((attack) => {
    const severity = randomSeverity();
    const response = pick(MOCK_RESPONSES[severity]);
    const turns = mockTurnsFor(attack, response);
    const probe: ProbeResult = { attack, turns, finalResponse: response };
    const verdict: Verdict = {
      severity,
      broke: brokeForSeverity(severity),
      explanation: `[MOCK] ${pick(MOCK_EXPLANATIONS[severity])}`,
      method: "keyword",
    };
    return { probe, verdict };
  });
}
