import Table from "cli-table3";
import type { GradedResult, Severity } from "./types.js";
import { BOLD, DIM, RESET } from "./ui.js";

const SEVERITY_ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Solid color "pill" badges. cli-table3 measures visible width itself
 * (via string-width, ANSI-aware), so unlike the old hand-rolled table we
 * don't need to separately track each badge's rendered width — that
 * duplicate bookkeeping was the source of a real alignment bug (the
 * critical badge's tracked width was off by one from its true rendered
 * width, 11 vs. the actual 10). */
const SEVERITY_BADGE: Record<Severity, string> = {
  none: `\x1b[100m\x1b[97m NONE \x1b[0m`,
  low: `\x1b[46m\x1b[30m LOW \x1b[0m`,
  medium: `\x1b[43m\x1b[30m MEDIUM \x1b[0m`,
  high: `\x1b[41m\x1b[97m HIGH \x1b[0m`,
  critical: `\x1b[48;5;53m\x1b[97m\x1b[1m CRITICAL \x1b[0m`,
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

function sortWorstFirst(results: GradedResult[]): GradedResult[] {
  return [...results].sort((a, b) => SEVERITY_ORDER[b.verdict.severity] - SEVERITY_ORDER[a.verdict.severity]);
}

interface ColumnWidths {
  id: number;
  severity: number;
  attack: number;
  notes: number;
}

const NUM_COLUMNS = 4;
const BORDER_OVERHEAD = NUM_COLUMNS + 1; // one vertical border char per column edge
const MIN_ATTACK_WIDTH = 18;
const MIN_NOTES_WIDTH = 22;

/**
 * Column widths (each including cli-table3's own cell padding) computed
 * fresh from the current terminal width every time — so a resize is just a
 * re-render with new inputs, not a separate code path. ID and SEVERITY are
 * fixed; the remaining space is split between ATTACK and NOTES, favoring
 * NOTES, with floors so neither ever degenerates to an unreadable sliver.
 */
function computeColumnWidths(termWidth: number): ColumnWidths {
  const id = 10;
  const severity = 13; // fits the widest badge (" CRITICAL ", 10 visible chars) plus padding
  const remainder = termWidth - id - severity - BORDER_OVERHEAD;
  const attack = Math.max(MIN_ATTACK_WIDTH, Math.floor(remainder * 0.4));
  const notes = Math.max(MIN_NOTES_WIDTH, remainder - attack);
  return { id, severity, attack, notes };
}

function buildTable(widths: ColumnWidths): InstanceType<typeof Table> {
  return new Table({
    head: [`${BOLD}ID${RESET}`, `${BOLD}SEVERITY${RESET}`, `${BOLD}ATTACK${RESET}`, `${BOLD}NOTES${RESET}`],
    colWidths: [widths.id, widths.severity, widths.attack, widths.notes],
    wordWrap: true,
    wrapOnWordBoundary: true,
    chars: {
      "top-left": "╭",
      "top-right": "╮",
      "bottom-left": "╰",
      "bottom-right": "╯",
    },
    style: { head: [], border: ["grey"] },
  });
}

/**
 * Renders one result row's cells. Isolated so a single malformed result
 * (missing/unexpected fields, an unrecognized severity value, etc.) can
 * never take down the whole table — the caller wraps this per-row.
 */
function buildRowCells(r: GradedResult): [string, string, string, string] {
  const sev = r.verdict.severity;
  const badge = SEVERITY_BADGE[sev];
  if (!badge) {
    throw new Error(`unrecognized severity: ${String(sev)}`);
  }
  const brokeMark = r.verdict.broke ? "⚠ " : "";
  const idCell = `${CYAN}${r.probe.attack.id}${RESET}`;
  const nameCell = r.probe.attack.name;
  const noteCell = `${brokeMark}${r.verdict.explanation}`;
  return [idCell, badge, nameCell, noteCell];
}

function renderTable(results: GradedResult[]): string {
  const sorted = sortWorstFirst(results);
  const termWidth = process.stdout.columns ?? 100;
  const widths = computeColumnWidths(termWidth);
  const table = buildTable(widths);

  for (const r of sorted) {
    try {
      table.push(buildRowCells(r));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      table.push([
        r.probe?.attack?.id ?? "[render error]",
        "[render error]",
        r.probe?.attack?.name ?? "[render error]",
        `[render error] ${message}`,
      ]);
    }
  }

  const summary = summarize(results);
  return [table.toString(), "", summaryPanel(summary)].join("\n");
}

/**
 * Plain, borderless dump of every result with the full untruncated
 * explanation — the `spill` escape hatch for when the boxed table's
 * wrapping still isn't what you want to read.
 */
export function formatSpill(results: GradedResult[]): string {
  const sorted = sortWorstFirst(results);
  const blocks = sorted.map((r) => {
    const sev = r.verdict.severity;
    const badge = SEVERITY_BADGE[sev] ?? sev.toUpperCase();
    const brokeMark = r.verdict.broke ? " ⚠ BROKE" : "";
    return [
      `${BOLD}${r.probe.attack.id}${RESET}  ${badge}${brokeMark}`,
      `${r.probe.attack.name}`,
      `${DIM}${r.verdict.explanation}${RESET}`,
    ].join("\n");
  });
  return blocks.join(`\n\n${DIM}${"─".repeat(40)}${RESET}\n\n`);
}

export function formatTable(results: GradedResult[]): string {
  try {
    return renderTable(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      `${RED}[table render failed (${message}) — showing raw dump instead]${RESET}`,
      "",
      formatSpill(results),
    ].join("\n");
  }
}

function summaryPanel(summary: ReportSummary): string {
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
