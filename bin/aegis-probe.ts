#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { allAttacks, attacksByCategory } from "../src/attacks/index.js";
import { runAttacks } from "../src/probe.js";
import { gradeAll } from "../src/judge.js";
import { formatReport } from "../src/report.js";
import { banner, gradientText, Spinner, BOLD, DIM, RESET } from "../src/ui.js";
import type { AttackCategory, JudgeConfig, TargetConfig } from "../src/types.js";

const CATEGORIES = Object.keys(attacksByCategory) as AttackCategory[];
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

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
  .option("--url <endpoint>", "Target chat endpoint to attack (required). Must accept POST { messages: [...] } and return an OpenAI-compatible or plain-text response.")
  .option("--key <key>", "Bearer token/API key sent as `Authorization: Bearer <key>` to the target endpoint, if it requires auth.")
  .option("--header <header...>", "Extra HTTP header(s) to send to the target endpoint, format 'Name: Value'. Repeatable.")
  .option(
    "--base-url <url>",
    "Base URL of an OpenAI-compatible judge LLM API (e.g. https://openrouter.ai/api/v1). Enables LLM-based grading instead of the free keyword grader. Requires --judge-key and --judge-model.",
  )
  .option("--judge-key <key>", "API key for the judge LLM, sent as `Authorization: Bearer <key>`. Get one from your provider's dashboard, e.g. https://openrouter.ai/keys for OpenRouter.")
  .option(
    "--model <model>",
    "Model string the judge LLM API expects, e.g. 'openai/gpt-oss-20b:free' on OpenRouter. See https://openrouter.ai/models for available models (filter by 'free' for no-cost judging).",
  )
  .option("--category <category...>", `Only run attacks from these categories: ${CATEGORIES.join(", ")}. Repeatable. Default: all categories.`)
  .option("--output <format>", "Output format: 'json' or 'table'.", "table")
  .option("--list", "List available attacks and exit, without running anything.")
  .addHelpText("beforeAll", () => {
    return `\n${banner()}\n${DIM}  adversarial red-teaming for LLM chat endpoints${RESET}\n`;
  })
  .addHelpText("after", () => {
    const lines: string[] = [];

    lines.push(section("EXAMPLES"));
    lines.push(`  ${GRAY}# Attack a target using the free keyword grader${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --url https://api.example.com/v1/chat --key sk-...")}\n`);

    lines.push(`  ${GRAY}# Attack and grade with an LLM judge via OpenRouter's free tier${RESET}`);
    lines.push(
      `  ${gradientText('$ aegis-probe --url https://api.example.com/v1/chat --key sk-... \\')}\n  ${gradientText('    --base-url https://openrouter.ai/api/v1 --judge-key sk-or-... --model "openai/gpt-oss-20b:free"')}\n`,
    );

    lines.push(`  ${GRAY}# Only run specific attack categories${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --url https://api.example.com/v1/chat --category role-hijacking --category multi-turn")}\n`);

    lines.push(`  ${GRAY}# List every built-in attack without contacting any endpoint${RESET}`);
    lines.push(`  ${gradientText("$ aegis-probe --list")}`);

    lines.push(section("GETTING A JUDGE API KEY"));
    lines.push(
      [
        `  ${BOLD}OpenRouter${RESET} ${DIM}(recommended — free-tier models, no cost)${RESET}`,
        `    1. Sign up at ${CYAN}https://openrouter.ai${RESET} and create a key at ${CYAN}https://openrouter.ai/keys${RESET}`,
        `    2. Browse ${CYAN}https://openrouter.ai/models${RESET} — filter for ${BOLD}:free${RESET} suffixed models`,
        `    3. Pass ${BOLD}--base-url https://openrouter.ai/api/v1${RESET}, ${BOLD}--judge-key${RESET} your key, ${BOLD}--model${RESET} e.g. "openai/gpt-oss-20b:free"`,
        ``,
        `  ${DIM}Note: free models on OpenRouter rotate over time and may be retired or start requiring payment —${RESET}`,
        `  ${DIM}check https://openrouter.ai/models if a previously working model starts failing or billing you.${RESET}`,
        ``,
        `  ${DIM}Any other OpenAI-compatible provider works too — OpenAI, Groq, Together, a local vLLM/Ollama server —${RESET}`,
        `  ${DIM}just point --base-url/--judge-key/--model at that provider instead.${RESET}`,
      ].join("\n"),
    );
    lines.push("");
    return lines.join("\n");
  });

program.parse(process.argv);
const opts = program.opts();

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

async function main() {
  if (opts.list) {
    console.log(`\n${banner()}\n`);
    for (const category of CATEGORIES) {
      console.log(`${BOLD}${CYAN}${category}${RESET}`);
      for (const attack of attacksByCategory[category]) {
        console.log(`  ${GRAY}${attack.id}${RESET}  ${attack.name} ${DIM}(${attack.turns.length} turn${attack.turns.length > 1 ? "s" : ""})${RESET}`);
      }
      console.log("");
    }
    return;
  }

  if (!opts.url) {
    console.error("Error: --url is required (the target chat endpoint to attack).\n");
    program.help();
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

  const target: TargetConfig = {
    url: opts.url,
    key: opts.key,
    headers: parseHeaders(opts.header),
  };

  let judge: JudgeConfig | undefined;
  if (opts.baseUrl || opts.judgeKey || opts.model) {
    if (!opts.baseUrl || !opts.judgeKey || !opts.model) {
      console.error(
        "Error: LLM-judge grading requires all three of --base-url, --judge-key, and --model. Falling back to the free keyword grader would silently change behavior, so aegis-probe refuses to run instead.\n" +
          "Either pass all three, or omit all three to use the free keyword grader.",
      );
      process.exitCode = 1;
      return;
    }
    judge = { baseUrl: opts.baseUrl, key: opts.judgeKey, model: opts.model };
  }

  const outputFormat = opts.output === "json" ? "json" : "table";
  const isTable = outputFormat === "table";

  if (isTable) {
    console.error(`\n${banner()}\n`);
    console.error(`${DIM}target ${RESET}${target.url}`);
    console.error(
      judge
        ? `${DIM}judge  ${RESET}${judge.model} ${GRAY}@ ${judge.baseUrl}${RESET}`
        : `${DIM}judge  ${RESET}free keyword matcher ${GRAY}(pass --base-url/--judge-key/--model for LLM grading)${RESET}`,
    );
    console.error("");
  }

  const spinner = new Spinner();
  if (isTable) spinner.start();

  const results = await runAttacks(target, attacks, {
    onAttackStart: (attack, index, total) => {
      if (isTable) spinner.setSuffix(`[${index + 1}/${total}] ${attack.id} · ${attack.category}`);
    },
  });

  if (isTable) {
    spinner.setSuffix("grading responses");
  }
  const graded = await gradeAll(results, judge);

  spinner.stop();

  console.log(formatReport(graded, outputFormat));

  const anyBroke = graded.some((g) => g.verdict.broke);
  process.exitCode = anyBroke ? 1 : 0;
}

main().catch((err) => {
  console.error("aegis-probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
