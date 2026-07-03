import type { GradedResult, Severity } from "./types.js";
import { BOLD, DIM, RESET } from "./ui.js";

const SEVERITY_ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Badge background/foreground per severity — solid pills, easy to scan at a glance. */
const SEVERITY_BADGE: Record<Severity, string> = {
  none: `\x1b[100m\x1b[97m NONE \x1b[0m`,
  low: `\x1b[46m\x1b[30m LOW \x1b[0m`,
  medium: `\x1b[43m\x1b[30m MEDIUM \x1b[0m`,
  high: `\x1b[41m\x1b[97m HIGH \x1b[0m`,
  critical: `\x1b[48;5;53m\x1b[97m\x1b[1m CRITICAL \x1b[0m`,
};
const SEVERITY_BADGE_WIDTH: Record<Severity, number> = {
  none: 6,
  low: 5,
  medium: 8,
  high: 6,
  critical: 11,
};

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

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
  return oneLine.slice(0, Math.max(0, max - 1)) + "…";
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function padBadge(badge: string, visibleWidth: number, targetWidth: number): string {
  const gap = Math.max(0, targetWidth - visibleWidth);
  return badge + " ".repeat(gap);
}

const H = "─";
const V = "│";
const TL = "╭";
const TR = "╮";
const BL = "╰";
const BR = "╯";
const ML = "├";
const MR = "┤";
const MT = "┬";
const MB = "┴";
const MX = "┼";

function box(cols: number[]): { top: string; mid: string; bottom: string } {
  const seg = (l: string, m: string, r: string) => l + cols.map((w) => H.repeat(w + 2)).join(m) + r;
  return {
    top: seg(TL, MT, TR),
    mid: seg(ML, MX, MR),
    bottom: seg(BL, MB, BR),
  };
}

/** Joins already-padded (plain-width) cells with dim column separators. */
function dataRow(cells: string[]): string {
  const sep = `${DIM}${V}${RESET}`;
  return `${sep} ${cells.join(` ${sep} `)} ${sep}`;
}

export function formatTable(results: GradedResult[]): string {
  const sorted = [...results].sort(
    (a, b) => SEVERITY_ORDER[b.verdict.severity] - SEVERITY_ORDER[a.verdict.severity],
  );

  const termWidth = process.stdout.columns ?? 100;

  const idW = 8;
  const sevW = 11; // widest badge, "CRITICAL"
  const nameW = 28;
  const fixed = idW + sevW + nameW;
  const noteW = Math.max(24, Math.min(60, termWidth - fixed - 13));

  const widths = [idW, sevW, nameW, noteW];
  const { top, mid, bottom } = box(widths);

  const lines: string[] = [];
  lines.push(gradientRule(top));
  lines.push(
    dataRow([
      `${BOLD}${pad("ID", idW)}${RESET}`,
      `${BOLD}${pad("SEVERITY", sevW)}${RESET}`,
      `${BOLD}${pad("ATTACK", nameW)}${RESET}`,
      `${BOLD}${pad("NOTES", noteW)}${RESET}`,
    ]),
  );
  lines.push(`${DIM}${mid}${RESET}`);

  for (const r of sorted) {
    const sev = r.verdict.severity;
    const badge = padBadge(SEVERITY_BADGE[sev], SEVERITY_BADGE_WIDTH[sev], sevW);
    const brokeMark = r.verdict.broke ? "⚠ " : "";
    const note = pad(brokeMark + truncate(r.verdict.explanation, noteW - brokeMark.length), noteW);
    lines.push(
      dataRow([
        `${CYAN}${pad(r.probe.attack.id, idW)}${RESET}`,
        badge,
        pad(truncate(r.probe.attack.name, nameW), nameW),
        note,
      ]),
    );
  }
  lines.push(`${DIM}${bottom}${RESET}`);

  const summary = summarize(results);
  lines.push("");
  lines.push(summaryPanel(summary));

  return lines.join("\n");
}

function gradientRule(line: string): string {
  // Subtle: keep structural lines dim rather than gradient, so the gradient
  // stays reserved for the spinner/banner and doesn't fight the data.
  return `${DIM}${line}${RESET}`;
}

function summaryPanel(summary: ReportSummary): string {
  const brokeColor = summary.broken > 0 ? RED : GREEN;
  const verdictLine =
    summary.broken > 0
      ? `${RED}${BOLD}⚠ ${summary.broken}/${summary.total} attacks broke the target${RESET}`
      : `${GREEN}${BOLD}✓ Target held against all ${summary.total} attacks${RESET}`;

  const sevSummary = (["critical", "high", "medium", "low", "none"] as Severity[])
    .filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${SEVERITY_BADGE[s]} ${DIM}×${summary.bySeverity[s]}${RESET}`)
    .join("   ");

  const lines = [
    verdictLine,
    `${DIM}graded with ${summary.gradingMethod === "llm-judge" ? "LLM judge" : "free keyword matcher"} · ${summary.total} attack${summary.total === 1 ? "" : "s"} total${RESET}`,
  ];
  if (sevSummary) lines.push(sevSummary);

  return lines.join("\n");
}

export function formatReport(results: GradedResult[], output: "json" | "table"): string {
  return output === "json" ? formatJson(results) : formatTable(results);
}
