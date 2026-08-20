import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatJson } from "./report.js";
import type { GradedResult, Attack, Severity } from "./types.js";

function attack(id: string): Attack {
  return { id, category: "instruction-override", name: `Attack ${id}`, description: "d", turns: ["t"] };
}

function graded(id: string, severity: Severity, broke: boolean): GradedResult {
  return {
    probe: { attack: attack(id), turns: [{ prompt: "t", response: "r", latencyMs: 1 }], finalResponse: "r" },
    verdict: { errored: false, severity, broke, explanation: "e", method: "keyword" },
  };
}

function errored(id: string): GradedResult {
  return {
    probe: { attack: attack(id), turns: [{ prompt: "t", response: "", latencyMs: 1, error: "timeout" }], finalResponse: "" },
    verdict: { errored: true, severity: null, broke: false, explanation: "no verdict", method: "keyword" },
  };
}

test("summarize: counts by severity and broke, excludes errored from bySeverity", () => {
  const results = [graded("1", "pass", false), graded("2", "high", true), graded("3", "high", true), errored("4")];
  const summary = summarize(results);
  assert.equal(summary.total, 4);
  assert.equal(summary.broken, 2);
  assert.equal(summary.errored, 1);
  assert.equal(summary.bySeverity.high, 2);
  assert.equal(summary.bySeverity.pass, 1);
  assert.equal(summary.bySeverity.critical, 0);
});

test("summarize: empty results default gradingMethod to keyword", () => {
  const summary = summarize([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.gradingMethod, "keyword");
});

test("formatJson: round-trips summary and per-result data", () => {
  const results = [graded("1", "critical", true), errored("2")];
  const parsed = JSON.parse(formatJson(results));
  assert.equal(parsed.summary.total, 2);
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].id, "1");
  assert.equal(parsed.results[0].verdict.severity, "critical");
  assert.equal(parsed.results[1].verdict.errored, true);
});
