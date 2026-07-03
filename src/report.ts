import type { GradedResult, Severity } from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_COLOR: Record<Severity, string> = {
  none: "\x1b[90m", // gray
  low: "\x1b[36m", // cyan
  medium: "\x1b[33m", // yellow
  high: "\x1b[31m", // red
  critical: "\x1b[41m\x1b[97m", // white on red
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";

export interface ReportSummary {
  total: number;
  broken: number;
  bySeverity: Record<Severity, number>;
  gradingMethod: "keyword" | "llm-judge";
}

export function summarize(results: GradedResult[]): ReportSummary {
  const bySeverity: Record<Severity, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 };
  let broken = 0;
  for (const r of results) {
    bySeverity[r.verdict.severity]++;
    if (r.verdict.broke) broken++;
  }
  return {
    total: results.length,
    broken,
    bySeverity,
    gradingMethod: results[0]?.verdict.method ?? "keyword",
  };
}

export function formatJson(results: GradedResult[]): string {
  const summary = summarize(results);
  const payload = {
    summary,
    results: results.map((r) => ({
      id: r.probe.attack.id,
      category: r.probe.attack.category,
      name: r.probe.attack.name,
      description: r.probe.attack.description,
      turns: r.probe.turns.map((t) => ({
        prompt: t.prompt,
        response: t.response,
        latencyMs: t.latencyMs,
        error: t.error,
      })),
      verdict: r.verdict,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function formatTable(results: GradedResult[]): string {
  const sorted = [...results].sort(
    (a, b) => SEVERITY_ORDER[b.verdict.severity] - SEVERITY_ORDER[a.verdict.severity],
  );

  const idW = 8;
  const catW = 24;
  const nameW = 30;
  const sevW = 10;

  const lines: string[] = [];
  lines.push(
    `${BOLD}${pad("ID", idW)} ${pad("CATEGORY", catW)} ${pad("ATTACK", nameW)} ${pad("SEVERITY", sevW)} EXPLANATION${RESET}`,
  );
  lines.push("-".repeat(idW + catW + nameW + sevW + 40));

  for (const r of sorted) {
    const color = SEVERITY_COLOR[r.verdict.severity];
    const brokeMark = r.verdict.broke ? "⚠" : " ";
    lines.push(
      `${pad(r.probe.attack.id, idW)} ${pad(r.probe.attack.category, catW)} ${pad(
        r.probe.attack.name,
        nameW,
      )} ${color}${pad(r.verdict.severity + " " + brokeMark, sevW)}${RESET} ${truncate(r.verdict.explanation, 80)}`,
    );
  }

  const summary = summarize(results);
  lines.push("");
  lines.push(`${BOLD}Summary${RESET} (grading: ${summary.gradingMethod})`);
  lines.push(`  Total attacks:   ${summary.total}`);
  lines.push(`  Broke target:    ${summary.broken > 0 ? "\x1b[31m" : GREEN}${summary.broken}${RESET}`);
  lines.push(
    `  By severity:     none=${summary.bySeverity.none} low=${summary.bySeverity.low} medium=${summary.bySeverity.medium} high=${summary.bySeverity.high} critical=${summary.bySeverity.critical}`,
  );

  return lines.join("\n");
}

export function formatReport(results: GradedResult[], output: "json" | "table"): string {
  return output === "json" ? formatJson(results) : formatTable(results);
}
