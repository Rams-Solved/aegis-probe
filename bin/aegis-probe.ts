#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { allAttacks, attacksByCategory } from "../src/attacks/index.js";
import { FREE_TIER_THROTTLE_MS, isFreeTierJudge, runAttacks, sleep } from "../src/probe.js";
import { gradeAll } from "../src/judge.js";
import { formatReport, formatSpill } from "../src/report.js";
import { generateMockResults } from "../src/mock.js";
import { banner, gradientText, Spinner, warningBlock, BOLD, DIM, RESET } from "../src/ui.js";
import type { Attack, AttackCategory, GradedResult, JudgeConfig, TargetConfig } from "../src/types.js";

const CATEGORIES = Object.keys(attacksByCategory) as AttackCategory[];
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

/** The most recently rendered result set — backs the REPL's `spill` command
 * and lets a terminal resize re-render at the new width instead of just
 * leaving the stale layout on screen. */
let lastResults: GradedResult[] | undefined;

function section(title: string): string {
  return `\n${BOLD}${CYAN}${title}${RESET}`;
}

const program = new Command();

program
  .name("aegis-probe")
  .description(
    [
      "Fire adversarial prompts at any LLM-powered chat endpoint, grade the responses, and report what broke.",
      "",
      `${DIM}Sends OpenAI-compatible chat requests (JSON body with a \`messages\` array) to --url and inspects`,
      `the replies for signs the target's guardrails failed.${RESET}`,
    ].join("\n"),
  )
  .option("--url <endpoint>", "Target chat endpoint to attack (required, unless --mock). Must accept POST { messages: [...] } and return an OpenAI-compatible or plain-text response.")
  .option("--key <key>", "Bearer token/API key sent as `Authorization: Bearer <key>` to the target endpoint, if it requires auth.")
  .option("--model <model>", "Model string sent in the request body to the TARGET endpoint (e.g. 'gpt-4o-mini'), if it requires one. Unrelated to judge grading — see --judge-model.")
  .option("--header <header...>", "Extra HTTP header(s) to send to the target endpoint, format 'Name: Value'. Repeatable.")
  .option(
    "--base-url <url>",
    "Base URL of an OpenAI-compatible JUDGE LLM API (e.g. https://openrouter.ai/api/v1). Enables LLM-based grading instead of the free keyword grader. Requires --judge-key and --judge-model.",
  )
  .option("--judge-key <key>", "API key for the judge LLM, sent as `Authorization: Bearer <key>`. Get one from your provider's dashboard, e.g. https://openrouter.ai/keys for OpenRouter.")
  .option(
    "--judge-model <model>",
    "Model string the JUDGE LLM API expects, e.g. 'openai/gpt-oss-20b:free' on OpenRouter. See https://openrouter.ai/models for available models (filter by 'free' for no-cost judging).",
  )
  .option("--category <category...>", `Only run attacks from these categories: ${CATEGORIES.join(", ")}. Repeatable. Default: all categories.`)
  .option("--output <format>", "Output format: 'json' or 'table'.", "table")
  .option("--list", "List available attacks and exit, without running anything.")
  .option("--mock", "Run a fully local simulation with randomized results — no network calls, no keys needed. Great for demoing the UI.")
  .addHelpText("beforeAll", () => {
    return `\n${banner()}\n${DIM}  adversarial red-teaming for LLM chat endpoints${RESET}\n`;
  })
  .addHelpText("after", () => {
    const lines: string[] = [];

    lines.push(section("QUICK START"));
    lines.push(`  ${GRAY}# No target yet? Try a local, no-network simulation of the full UI${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --mock")}`);

    lines.push(section("EXAMPLES"));
    lines.push(`  ${GRAY}# Attack a target using the free keyword grader${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --url https://api.example.com/v1/chat --key sk-...")}\n`);

    lines.push(`  ${GRAY}# Attack and grade with an LLM judge via OpenRouter's free tier${RESET}`);
    lines.push(
      `  ${gradientText('$ aegis-probe --url https://api.example.com/v1/chat --key sk-... \\')}\n  ${gradientText('    --base-url https://openrouter.ai/api/v1 --judge-key sk-or-... --judge-model "openai/gpt-oss-20b:free"')}\n`,
    );

    lines.push(`  ${GRAY}# Only run specific attack categories${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --url https://api.example.com/v1/chat --category role-hijacking --category multi-turn")}\n`);

    lines.push(`  ${GRAY}# List every built-in attack without contacting any endpoint${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --list")}`);

    lines.push(section("TARGET vs. JUDGE OPTIONS"));
    lines.push(
      [
        `  ${BOLD}Target${RESET} ${DIM}(the endpoint being attacked)${RESET}      --url  --key  --model  --header`,
        `  ${BOLD}Judge${RESET}  ${DIM}(optional LLM-based grader)${RESET}       --base-url  --judge-key  --judge-model`,
        ``,
        `  ${DIM}These two groups are independent — --model alone (without --base-url/--judge-key/--judge-model)${RESET}`,
        `  ${DIM}just sets the target's model field and uses the free keyword grader.${RESET}`,
      ].join("\n"),
    );

    lines.push(section("GETTING A JUDGE API KEY"));
    lines.push(
      [
        `  ${BOLD}OpenRouter${RESET} ${DIM}(recommended — free-tier models, no cost)${RESET}`,
        `    1. Sign up at ${CYAN}https://openrouter.ai${RESET} and create a key at ${CYAN}https://openrouter.ai/keys${RESET}`,
        `    2. Browse ${CYAN}https://openrouter.ai/models${RESET} — filter for ${BOLD}:free${RESET} suffixed models`,
        `    3. Pass ${BOLD}--base-url https://openrouter.ai/api/v1${RESET}, ${BOLD}--judge-key${RESET} your key, ${BOLD}--judge-model${RESET} e.g. "openai/gpt-oss-20b:free"`,
        ``,
        `  ${DIM}Note: free models on OpenRouter rotate over time, are shared/rate-limited, and may be retired or${RESET}`,
        `  ${DIM}start requiring payment. aegis-probe auto-throttles requests when it detects a free-tier judge,${RESET}`,
        `  ${DIM}but you may still see occasional 429s — check https://openrouter.ai/models for the current list.${RESET}`,
        ``,
        `  ${DIM}Any other OpenAI-compatible provider works too — OpenAI, Groq, Together, a local vLLM/Ollama server —${RESET}`,
        `  ${DIM}just point --base-url/--judge-key/--judge-model at that provider instead.${RESET}`,
      ].join("\n"),
    );

    lines.push(section("IN-SHELL COMMANDS") + `${DIM} (when running aegis-probe with no arguments)${RESET}`);
    lines.push(
      [
        `  ${BOLD}list${RESET}  /  ${BOLD}--list${RESET}                                list built-in attacks`,
        `  ${BOLD}category <name...>${RESET}  /  ${BOLD}--category <name...>${RESET}      filter next ${BOLD}run${RESET}/${BOLD}mock${RESET} (repeatable, accumulates)`,
        `  ${BOLD}run${RESET} ${DIM}[--category ...] [--url ...] [--model ...]${RESET}       fire a real attack using the current session config`,
        `  ${BOLD}mock${RESET} ${DIM}[--category ...]${RESET}                       run the local, no-network simulation`,
        `  ${BOLD}--url${RESET} / ${BOLD}--key${RESET} / ${BOLD}--model${RESET} / ${BOLD}--header${RESET} / ${BOLD}--base-url${RESET} / ${BOLD}--judge-key${RESET} / ${BOLD}--judge-model${RESET} ${DIM}<value>${RESET}   set session config`,
        `  ${BOLD}target <url>${RESET}                                 alias for ${BOLD}--url <url>${RESET} — also shown in the prompt`,
        `  ${BOLD}target none${RESET}  /  ${BOLD}target clear${RESET}                    clear the configured target`,
        `  ${BOLD}target errored${RESET}  /  ${BOLD}target failed${RESET}                re-run only errored attacks against the target`,
        `  ${BOLD}spill${RESET}                                         raw, untruncated dump of the last results`,
        `  ${BOLD}help${RESET}  /  ${BOLD}--help${RESET}  /  ${BOLD}-h${RESET}                             this text`,
        `  ${BOLD}exit${RESET}  /  ${BOLD}quit${RESET}  ${DIM}(or Ctrl+C)${RESET}                          leave the shell`,
        ``,
        `  ${DIM}--output is a one-shot CLI flag only — the shell always renders a table; use ${RESET}spill${DIM} for raw text.${RESET}`,
      ].join("\n"),
    );

    lines.push("");
    return lines.join("\n");
  });

function parseHeaders(headerArgs: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of headerArgs ?? []) {
    const idx = h.indexOf(":");
    if (idx === -1) {
      console.error(`Ignoring malformed --header value (expected 'Name: Value'): ${h}`);
      continue;
    }
    const name = h.slice(0, idx).trim();
    const value = h.slice(idx + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

function printAttackList(): void {
  console.log(`\n${banner()}\n`);
  for (const category of CATEGORIES) {
    console.log(`${BOLD}${CYAN}${category}${RESET}`);
    for (const attack of attacksByCategory[category]) {
      console.log(`  ${GRAY}${attack.id}${RESET}  ${attack.name} ${DIM}(${attack.turns.length} turn${attack.turns.length > 1 ? "s" : ""})${RESET}`);
    }
    console.log("");
  }
}

/**
 * Shared post-validation run orchestration: banner/target/judge display,
 * free-tier warning, spinner, runAttacks + gradeAll. Used by both the
 * one-shot CLI `--url` path (main()) and the REPL's `run` command, so
 * there is exactly one place that ever calls runAttacks/gradeAll for a
 * real (non-mock) attack — no attack-execution or grading logic lives
 * here, just orchestration shared to avoid the two paths drifting apart.
 */
async function executeRealRun(
  target: TargetConfig,
  judge: JudgeConfig | undefined,
  attacks: Attack[],
  outputFormat: "json" | "table",
): Promise<GradedResult[]> {
  const isTable = outputFormat === "table";
  const freeTier = isFreeTierJudge(judge);
  const throttleMs = freeTier ? FREE_TIER_THROTTLE_MS : undefined;

  if (isTable) {
    console.error(`\n${banner()}\n`);
    console.error(`${DIM}target ${RESET}${target.url}${target.model ? ` ${GRAY}(model: ${target.model})${RESET}` : ""}`);
    console.error(
      judge
        ? `${DIM}judge  ${RESET}${judge.model} ${GRAY}@ ${judge.baseUrl}${RESET}`
        : `${DIM}judge  ${RESET}free keyword matcher ${GRAY}(pass --base-url/--judge-key/--judge-model for LLM grading)${RESET}`,
    );
    console.error("");
  }

  if (freeTier) {
    console.error(
      warningBlock(
        "Free tier configuration detected. Adding execution delays to prevent upstream 429 rate limits. Remember to keep your production keys hidden!",
        "caution",
      ),
    );
    console.error("");
  }

  const spinner = new Spinner();
  if (isTable) spinner.start();

  const results = await runAttacks(target, attacks, {
    throttleMs,
    onAttackStart: (attack, index, total) => {
      if (isTable) spinner.setSuffix(`[${index + 1}/${total}] ${attack.id} · ${attack.category}`);
    },
  });

  const graded = await gradeAll(results, judge, {
    throttleMs,
    onProgress: (index, total) => {
      if (isTable) spinner.setSuffix(`grading [${index + 1}/${total}]`);
    },
  });

  spinner.stop();
  return graded;
}

async function main() {
  program.parse(process.argv);
  const opts = program.opts();

  if (opts.list) {
    printAttackList();
    return;
  }

  const requestedCategories: string[] | undefined = opts.category;
  if (requestedCategories) {
    const invalid = requestedCategories.filter((c) => !CATEGORIES.includes(c as AttackCategory));
    if (invalid.length > 0) {
      console.error(`Error: unknown --category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  const attacks = requestedCategories
    ? allAttacks.filter((a) => requestedCategories.includes(a.category))
    : allAttacks;

  if (attacks.length === 0) {
    console.error("No attacks matched the given --category filter(s).");
    process.exitCode = 1;
    return;
  }

  const outputFormat = opts.output === "json" ? "json" : "table";
  const isTable = outputFormat === "table";

  // --mock bypasses all target/judge validation and never touches the network.
  if (opts.mock) {
    await runMock(attacks, outputFormat, isTable);
    return;
  }

  if (!opts.url) {
    console.error("Error: --url is required (the target chat endpoint to attack), or pass --mock for a local simulation.\n");
    program.help();
    return;
  }

  // Judge config is entirely separate from target config: --model configures
  // the target's request body, --base-url/--judge-key/--judge-model configure
  // an optional judge LLM. Only the judge trio is required together.
  let judge: JudgeConfig | undefined;
  if (opts.baseUrl || opts.judgeKey || opts.judgeModel) {
    if (!opts.baseUrl || !opts.judgeKey || !opts.judgeModel) {
      console.error(
        "Error: LLM-judge grading requires all three of --base-url, --judge-key, and --judge-model. Falling back to the free keyword grader would silently change behavior, so aegis-probe refuses to run instead.\n" +
          "Either pass all three, or omit all three to use the free keyword grader.",
      );
      process.exitCode = 1;
      return;
    }
    judge = { baseUrl: opts.baseUrl, key: opts.judgeKey, model: opts.judgeModel };
  }

  const target: TargetConfig = {
    url: opts.url,
    key: opts.key,
    model: opts.model,
    headers: parseHeaders(opts.header),
  };

  const graded = await executeRealRun(target, judge, attacks, outputFormat);

  lastResults = graded;
  console.log(formatReport(graded, outputFormat));

  const anyBroke = graded.some((g) => g.verdict.broke);
  process.exitCode = anyBroke ? 1 : 0;
}

async function runMock(
  attacks: typeof allAttacks,
  outputFormat: "json" | "table",
  isTable: boolean,
): Promise<void> {
  if (isTable) {
    console.error(`\n${banner()}\n`);
  }
  console.error(
    warningBlock(
      "MOCK TEST MODE ACTIVE: Running local simulation. No external network calls are being made, and all keys are ignored. These results are randomized for UI demonstration purposes only.",
      "danger",
    ),
  );
  console.error("");

  const spinner = new Spinner({ frameIntervalMs: 45, wordIntervalMs: 220 });
  if (isTable) spinner.start();

  for (let i = 0; i < attacks.length; i++) {
    const attack = attacks[i];
    if (isTable) spinner.setSuffix(`[${i + 1}/${attacks.length}] ${attack.id} · ${attack.category} (simulated)`);
    await sleep(50 + Math.random() * 130);
  }
  if (isTable) spinner.setSuffix("grading simulated responses");
  await sleep(300);

  spinner.stop();

  const graded = generateMockResults(attacks);
  lastResults = graded;
  console.log(formatReport(graded, outputFormat));

  const anyBroke = graded.some((g) => g.verdict.broke);
  process.exitCode = anyBroke ? 1 : 0;
}

/**
 * Aegis palette prompt: purple "aegis" label, a target indicator, blue "❯"
 * caret. Rebuilt (via rl.setPrompt) every time the target changes.
 */
function buildReplPrompt(target: string | undefined): string {
  return `\x1b[38;5;141maegis \x1b[38;5;244m[target: ${target ?? "none"}]\x1b[38;5;39m ❯ \x1b[0m`;
}

/** Dim follow-up hints shown after any REPL table render, pointing at the
 * next useful command given what's actually in the result set. */
function printPostTableHints(results: GradedResult[]): void {
  console.log(`${DIM}↳ type ${RESET}${BOLD}spill${RESET}${DIM} for raw output${RESET}`);
  if (results.some((r) => r.verdict.errored)) {
    console.log(`${DIM}↳ type ${RESET}${BOLD}target errored${RESET}${DIM} to retry errored attacks${RESET}`);
  }
  console.log("");
}

/**
 * Re-runs ONLY the currently errored attacks (network error, timeout,
 * empty/malformed response — see judge.ts) against `currentTarget`, merging
 * fresh results back into `lastResults` by attack id so everything else in
 * the table is left untouched. Reuses runAttacks/gradeAll exactly as the
 * one-shot CLI path does — no attack-execution or grading logic here, just
 * orchestration. Grades with the free keyword matcher: retargeting is
 * unauthenticated/ungraded-by-LLM by design (mirrors `run` when no judge
 * or key has been configured in the session).
 */
async function retargetErrored(currentTarget: string | undefined): Promise<void> {
  const erroredResults = lastResults?.filter((r) => r.verdict.errored) ?? [];

  if (erroredResults.length === 0) {
    console.log(`${DIM}no errored attacks to retarget${RESET}\n`);
    return;
  }

  if (!currentTarget) {
    console.log(`${DIM}No target configured — use ${RESET}${BOLD}target <url>${RESET}${DIM} first.${RESET}\n`);
    return;
  }

  const attacksToRetry: Attack[] = erroredResults.map((r) => r.probe.attack);
  const target: TargetConfig = { url: currentTarget, headers: {} };

  console.log(
    `${DIM}Re-running ${RESET}${BOLD}${attacksToRetry.length}${RESET}${DIM} errored attack(s) against ${RESET}${currentTarget}${DIM} (keyword grading)...${RESET}\n`,
  );

  const spinner = new Spinner();
  spinner.start();

  const results = await runAttacks(target, attacksToRetry, {
    onAttackStart: (attack, index, total) => {
      spinner.setSuffix(`[${index + 1}/${total}] ${attack.id} · ${attack.category}`);
    },
  });

  const graded = await gradeAll(results, undefined, {
    onProgress: (index, total) => {
      spinner.setSuffix(`grading [${index + 1}/${total}]`);
    },
  });

  spinner.stop();

  const gradedById = new Map(graded.map((g) => [g.probe.attack.id, g]));
  lastResults = (lastResults ?? []).map((r) => gradedById.get(r.probe.attack.id) ?? r);

  console.log(formatReport(lastResults, "table"));
  printPostTableHints(lastResults);
}

/** Persistent in-shell configuration, built up across `--flag`/`target`/
 * `category` commands and consumed by `run`/`mock`. */
interface ReplSession {
  url: string | undefined;
  key: string | undefined;
  model: string | undefined;
  headers: Record<string, string>;
  baseUrl: string | undefined;
  judgeKey: string | undefined;
  judgeModel: string | undefined;
  categories: AttackCategory[];
}

function createReplSession(): ReplSession {
  return {
    url: undefined,
    key: undefined,
    model: undefined,
    headers: {},
    baseUrl: undefined,
    judgeKey: undefined,
    judgeModel: undefined,
    categories: [],
  };
}

/** Tokens recognized as CLI flags with an in-shell equivalent, split by how
 * they're consumed. Kept next to parseInlineFlags so the two can't drift. */
const CONFIG_FLAG_TOKENS = ["--url", "--key", "--model", "--header", "--base-url", "--judge-key", "--judge-model"];

interface InlineFlags {
  categories: string[];
  url?: string;
  key?: string;
  model?: string;
  headers: string[];
  baseUrl?: string;
  judgeKey?: string;
  judgeModel?: string;
  /** Real CLI flags with no in-shell effect (currently just --output). */
  cliOnly: string[];
  /** Tokens that aren't a recognized flag at all. */
  unknown: string[];
}

/** Parses `--flag value` pairs out of a REPL line's tokens (e.g. everything
 * after `run`/`mock`, or a whole config-setting line like `--url X --key Y`).
 * Deliberately hand-rolled rather than re-invoking commander: commander's
 * `Command` instance accumulates option state across calls, which would let
 * flags from one REPL line silently leak into a later, unrelated one. */
function parseInlineFlags(tokens: string[]): InlineFlags {
  const flags: InlineFlags = { categories: [], headers: [], cliOnly: [], unknown: [] };
  const isKnownCliFlag = (token: string) => program.options.some((o) => o.long === token || o.short === token);

  let i = 0;
  // Only consumes the next token as a value if it doesn't itself look like
  // a flag — otherwise `--url --key sk-1` would silently swallow `--key`
  // as the URL instead of leaving it to be parsed as its own flag.
  const nextValue = (): string | undefined => {
    const value = tokens[i + 1];
    if (value === undefined || value.startsWith("-")) return undefined;
    i += 1;
    return value;
  };

  for (; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case "--category": {
        const value = nextValue();
        if (value !== undefined) flags.categories.push(value);
        else flags.unknown.push(token);
        break;
      }
      case "--url": {
        const value = nextValue();
        if (value !== undefined) flags.url = value;
        else flags.unknown.push(token);
        break;
      }
      case "--key": {
        const value = nextValue();
        if (value !== undefined) flags.key = value;
        else flags.unknown.push(token);
        break;
      }
      case "--model": {
        const value = nextValue();
        if (value !== undefined) flags.model = value;
        else flags.unknown.push(token);
        break;
      }
      case "--header": {
        const value = nextValue();
        if (value !== undefined) flags.headers.push(value);
        else flags.unknown.push(token);
        break;
      }
      case "--base-url": {
        const value = nextValue();
        if (value !== undefined) flags.baseUrl = value;
        else flags.unknown.push(token);
        break;
      }
      case "--judge-key": {
        const value = nextValue();
        if (value !== undefined) flags.judgeKey = value;
        else flags.unknown.push(token);
        break;
      }
      case "--judge-model": {
        const value = nextValue();
        if (value !== undefined) flags.judgeModel = value;
        else flags.unknown.push(token);
        break;
      }
      case "--output": {
        nextValue(); // consume the value if present; --output has no in-shell effect
        flags.cliOnly.push(token);
        break;
      }
      default: {
        if (!token.startsWith("-")) {
          flags.unknown.push(token);
        } else if (isKnownCliFlag(token)) {
          flags.cliOnly.push(token);
        } else {
          flags.unknown.push(token);
        }
      }
    }
  }
  return flags;
}

/** First 4 chars + ellipsis — secrets are echoed back in confirmations so
 * you can tell *which* key you set, without printing the whole thing. */
function maskSecret(value: string): string {
  return value.length <= 4 ? "•".repeat(value.length) : `${value.slice(0, 4)}…`;
}

function validateCategoryNames(names: string[]): { valid: AttackCategory[]; invalid: string[] } {
  const valid: AttackCategory[] = [];
  const invalid: string[] = [];
  for (const name of names) {
    if (CATEGORIES.includes(name as AttackCategory)) valid.push(name as AttackCategory);
    else invalid.push(name);
  }
  return { valid, invalid };
}

/** Merges newly-validated category names into the session filter (union,
 * matching the CLI's repeatable --category semantics) and reports back
 * what happened so callers (bare `category` command vs. inline `run
 * --category ...`) can each print their own confirmation. */
function applyCategoryNames(names: string[], session: ReplSession): { added: AttackCategory[]; invalid: string[] } {
  const { valid, invalid } = validateCategoryNames(names);
  const added = valid.filter((c) => !session.categories.includes(c));
  session.categories.push(...added);
  return { added, invalid };
}

function resolveSessionAttacks(session: ReplSession): Attack[] {
  if (session.categories.length === 0) return allAttacks;
  return allAttacks.filter((a) => session.categories.includes(a.category));
}

/** Applies url/key/model/headers/baseUrl/judgeKey/judgeModel from a parsed
 * inline-flags object onto the session, updating the prompt if the target
 * changed. Returns a human-readable summary of what was set, for the
 * caller to print (or fold into a bigger confirmation message). */
function applyConfigFlags(
  flags: InlineFlags,
  session: ReplSession,
  rl: ReturnType<typeof createInterface>,
): string[] {
  const applied: string[] = [];
  if (flags.url !== undefined) {
    session.url = flags.url;
    rl.setPrompt(buildReplPrompt(session.url));
    applied.push(`url: ${flags.url}`);
  }
  if (flags.key !== undefined) {
    session.key = flags.key;
    applied.push(`key: ${maskSecret(flags.key)}`);
  }
  if (flags.model !== undefined) {
    session.model = flags.model;
    applied.push(`model: ${flags.model}`);
  }
  if (flags.headers.length > 0) {
    Object.assign(session.headers, parseHeaders(flags.headers));
    applied.push(`header(s): ${flags.headers.join(", ")}`);
  }
  if (flags.baseUrl !== undefined) {
    session.baseUrl = flags.baseUrl;
    applied.push(`base-url: ${flags.baseUrl}`);
  }
  if (flags.judgeKey !== undefined) {
    session.judgeKey = flags.judgeKey;
    applied.push(`judge-key: ${maskSecret(flags.judgeKey)}`);
  }
  if (flags.judgeModel !== undefined) {
    session.judgeModel = flags.judgeModel;
    applied.push(`judge-model: ${flags.judgeModel}`);
  }
  return applied;
}

function printFlagWarnings(flags: InlineFlags): void {
  for (const token of flags.cliOnly) {
    console.log(
      `${BOLD}${token}${RESET}${DIM} is a one-shot CLI flag only — the shell always renders a table; use ${RESET}${BOLD}spill${RESET}${DIM} for raw output.${RESET}`,
    );
  }
  for (const token of flags.unknown) {
    console.log(`${DIM}Unknown flag: ${RESET}${BOLD}${token}${RESET}${DIM}. Type ${RESET}${BOLD}help${RESET}${DIM} to see available commands.${RESET}`);
  }
}

/**
 * Fires a real attack against the session's configured target, using the
 * session's category filter. Mirrors main()'s one-shot `--url` path via
 * the shared executeRealRun — no attack-execution or grading logic lives
 * here, just session-state plumbing.
 */
async function runReplRun(session: ReplSession): Promise<void> {
  if (!session.url) {
    console.log(
      `${DIM}No target configured — set one with ${RESET}${BOLD}--url <endpoint>${RESET}${DIM} or ${RESET}${BOLD}target <url>${RESET}${DIM} first.${RESET}\n`,
    );
    return;
  }

  let judge: JudgeConfig | undefined;
  if (session.baseUrl || session.judgeKey || session.judgeModel) {
    if (!session.baseUrl || !session.judgeKey || !session.judgeModel) {
      console.log(
        `${DIM}LLM-judge grading requires all three of ${RESET}${BOLD}--base-url${RESET}${DIM}, ${RESET}${BOLD}--judge-key${RESET}${DIM}, and ${RESET}${BOLD}--judge-model${RESET}${DIM}. Set all three, or none, to use the free keyword grader.${RESET}\n`,
      );
      return;
    }
    judge = { baseUrl: session.baseUrl, key: session.judgeKey, model: session.judgeModel };
  }

  const attacks = resolveSessionAttacks(session);
  if (attacks.length === 0) {
    console.log(`${DIM}No attacks matched the current category filter.${RESET}\n`);
    return;
  }

  const target: TargetConfig = {
    url: session.url,
    key: session.key,
    model: session.model,
    headers: session.headers,
  };

  const graded = await executeRealRun(target, judge, attacks, "table");
  lastResults = graded;
  console.log(formatReport(graded, "table"));
  printPostTableHints(graded);
}

/**
 * A persistent interactive shell for aegis-probe, entered when the CLI is
 * launched with zero arguments.
 */
async function runRepl(): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // clear screen + scrollback, cursor home
  console.log(`\n${banner()}\n${DIM}  adversarial red-teaming for LLM chat endpoints${RESET}\n`);
  console.log(
    `${DIM}Type ${RESET}${BOLD}help${RESET}${DIM} for the full command list — ${RESET}${BOLD}list${RESET}${DIM}, ${RESET}${BOLD}mock${RESET}${DIM}, ${RESET}${BOLD}run${RESET}${DIM}, ${RESET}${BOLD}category <name>${RESET}${DIM}, ${RESET}${BOLD}target <url>${RESET}${DIM}, ${RESET}${BOLD}spill${RESET}${DIM}, or ${RESET}${BOLD}exit${RESET}${DIM}.${RESET}\n`,
  );

  const session = createReplSession();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildReplPrompt(session.url),
  });

  let closed = false;
  let resizeTimer: NodeJS.Timeout | undefined;

  const onResize = () => {
    if (!lastResults) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      console.log(`\n${formatReport(lastResults!, "table")}\n`);
      if (!closed) rl.prompt(true);
    }, 100);
  };
  process.stdout.on("resize", onResize);

  rl.on("close", () => {
    closed = true;
    if (resizeTimer) clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
  });
  // Let readline own Ctrl+C: without a listener here, a bare SIGINT during
  // interactive input can surface as an abrupt/uncaught interrupt instead of
  // a clean shutdown.
  rl.on("SIGINT", () => {
    console.log();
    process.exitCode = 0;
    rl.close();
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (line) {
      const parts = line.split(/\s+/);
      const first = parts[0];
      const rest = parts.slice(1);

      // Anything starting with "-" is a flag-form invocation, typed as the
      // first word of the line (e.g. `--list`, `--category x`, `--url y`).
      if (first.startsWith("-")) {
        if (first === "--list") {
          printAttackList();
        } else if (first === "--mock") {
          console.log("");
          const flags = parseInlineFlags(rest);
          if (flags.categories.length > 0) {
            const { invalid } = applyCategoryNames(flags.categories, session);
            if (invalid.length > 0) {
              console.log(`Error: unknown category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}\n`);
            }
          }
          printFlagWarnings(flags);
          await runMock(resolveSessionAttacks(session), "table", true);
          if (lastResults) printPostTableHints(lastResults);
        } else if (first === "--help" || first === "-h") {
          // outputHelp() (not helpInformation()) so the addHelpText hooks —
          // QUICK START, EXAMPLES, judge setup, IN-SHELL COMMANDS — render
          // exactly as they do for `--help`, not just the bare usage block.
          program.outputHelp();
        } else if (first === "--category") {
          const { added, invalid } = applyCategoryNames(rest, session);
          if (invalid.length > 0) {
            console.log(`Error: unknown category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}\n`);
          } else {
            console.log(
              `${DIM}category filter: ${RESET}${session.categories.length > 0 ? session.categories.join(", ") : "all (no filter)"}${DIM} ${added.length > 0 ? `(added ${added.join(", ")})` : ""}${RESET}\n`,
            );
          }
        } else if (CONFIG_FLAG_TOKENS.includes(first)) {
          const flags = parseInlineFlags(parts);
          const applied = applyConfigFlags(flags, session, rl);
          printFlagWarnings(flags);
          if (applied.length > 0) {
            console.log(`${DIM}session updated → ${RESET}${applied.join(", ")}\n`);
          }
        } else if (first === "--output") {
          console.log(
            `${BOLD}--output${RESET}${DIM} is a one-shot CLI flag only — the shell always renders a table; use ${RESET}${BOLD}spill${RESET}${DIM} for raw output.${RESET}\n`,
          );
        } else {
          const known = program.options.some((o) => o.long === first || o.short === first);
          console.log(
            known
              ? `${BOLD}${first}${RESET}${DIM} is a CLI-only flag with no in-shell effect yet.${RESET}\n`
              : `${DIM}Unknown flag: ${RESET}${BOLD}${first}${RESET}${DIM}. Type ${RESET}${BOLD}help${RESET}${DIM} to see available commands.${RESET}\n`,
          );
        }
      } else {
        const cmd = first.toLowerCase();
        switch (cmd) {
          case "list": {
            printAttackList();
            break;
          }
          case "category": {
            if (rest.length === 0) {
              console.log(
                `${DIM}category filter: ${RESET}${session.categories.length > 0 ? session.categories.join(", ") : "all (no filter)"}${DIM} — applies to the next ${RESET}${BOLD}run${RESET}${DIM}/${RESET}${BOLD}mock${RESET}${DIM}.${RESET}\n`,
              );
            } else if (["none", "all", "clear"].includes(rest[0].toLowerCase())) {
              session.categories = [];
              console.log(`${DIM}category filter cleared (all categories).${RESET}\n`);
            } else {
              const { added, invalid } = applyCategoryNames(rest, session);
              if (invalid.length > 0) {
                console.log(`Error: unknown category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}\n`);
              } else {
                console.log(
                  `${DIM}category filter: ${RESET}${session.categories.join(", ")}${DIM} ${added.length > 0 ? `(added ${added.join(", ")})` : ""}${RESET}\n`,
                );
              }
            }
            break;
          }
          case "run": {
            console.log("");
            const flags = parseInlineFlags(rest);
            if (flags.categories.length > 0) {
              const { invalid } = applyCategoryNames(flags.categories, session);
              if (invalid.length > 0) {
                console.log(`Error: unknown category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}\n`);
              }
            }
            applyConfigFlags(flags, session, rl);
            printFlagWarnings(flags);
            await runReplRun(session);
            break;
          }
          case "mock": {
            console.log("");
            const flags = parseInlineFlags(rest);
            if (flags.categories.length > 0) {
              const { invalid } = applyCategoryNames(flags.categories, session);
              if (invalid.length > 0) {
                console.log(`Error: unknown category value(s): ${invalid.join(", ")}. Valid categories: ${CATEGORIES.join(", ")}\n`);
              }
            }
            applyConfigFlags(flags, session, rl);
            printFlagWarnings(flags);
            await runMock(resolveSessionAttacks(session), "table", true);
            if (lastResults) printPostTableHints(lastResults);
            break;
          }
          case "help": {
            program.outputHelp();
            break;
          }
          case "spill": {
            if (!lastResults) {
              console.log(`${DIM}No results yet — run ${RESET}${BOLD}mock${RESET}${DIM} or ${RESET}${BOLD}run${RESET}${DIM} first.${RESET}\n`);
            } else {
              console.log(formatSpill(lastResults));
              console.log("");
            }
            break;
          }
          case "target": {
            const rest2 = rest.join(" ").trim();
            if (!rest2) {
              console.log(`${DIM}target: ${RESET}${session.url ?? "none"}\n`);
            } else if (rest2.toLowerCase() === "none" || rest2.toLowerCase() === "clear") {
              session.url = undefined;
              rl.setPrompt(buildReplPrompt(session.url));
              console.log(`${DIM}target cleared.${RESET}\n`);
            } else if (rest2.toLowerCase() === "errored" || rest2.toLowerCase() === "failed") {
              await retargetErrored(session.url);
            } else {
              session.url = rest2;
              rl.setPrompt(buildReplPrompt(session.url));
              console.log(`${DIM}target set to ${RESET}${BOLD}${session.url}${RESET}\n`);
            }
            break;
          }
          case "exit":
          case "quit": {
            process.exitCode = 0;
            rl.close();
            break;
          }
          default: {
            console.log(
              `${DIM}Unknown command: ${RESET}${BOLD}${cmd}${RESET}${DIM}. Type ${RESET}${BOLD}help${RESET}${DIM} to see available commands.${RESET}\n`,
            );
          }
        }
      }
    }

    if (!closed) rl.prompt();
  }

  console.log(`${DIM}goodbye.${RESET}`);
}

if (process.argv.length <= 2) {
  runRepl().catch((err) => {
    console.error("aegis-probe REPL failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
} else {
  main().catch((err) => {
    console.error("aegis-probe failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
