import type { Attack, AttackCategory } from "../types.js";
import { instructionOverrideAttacks } from "./instruction-override.js";
import { roleHijackingAttacks } from "./role-hijacking.js";
import { systemPromptExtractionAttacks } from "./system-prompt-extraction.js";
import { contextPoisoningAttacks } from "./context-poisoning.js";
import { goalHijackingAttacks } from "./goal-hijacking.js";
import { multiTurnAttacks } from "./multi-turn.js";

export const allAttacks: Attack[] = [
  ...instructionOverrideAttacks,
  ...roleHijackingAttacks,
  ...systemPromptExtractionAttacks,
  ...contextPoisoningAttacks,
  ...goalHijackingAttacks,
  ...multiTurnAttacks,
];

export const attacksByCategory: Record<AttackCategory, Attack[]> = {
  "instruction-override": instructionOverrideAttacks,
  "role-hijacking": roleHijackingAttacks,
  "system-prompt-extraction": systemPromptExtractionAttacks,
  "context-poisoning": contextPoisoningAttacks,
  "goal-hijacking": goalHijackingAttacks,
  "multi-turn": multiTurnAttacks,
};

export {
  instructionOverrideAttacks,
  roleHijackingAttacks,
  systemPromptExtractionAttacks,
  contextPoisoningAttacks,
  goalHijackingAttacks,
  multiTurnAttacks,
};
