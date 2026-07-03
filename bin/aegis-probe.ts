#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { allAttacks, attacksByCategory } from "../src/attacks/index.js";
import { runAttacks } from "../src/probe.js";
import { gradeAll } from "../src/judge.js";
import { formatReport } from "../src/report.js";
import type { AttackCategory, JudgeConfig, TargetConfig } from "../src/types.js";

const CATEGORIES = Object.keys(attacksByCategory) as AttackCategory[];

const program = new Command();

program
  .name("aegis-probe")
  .description(
    [
      "Fire adversarial prompts at any LLM-powered chat endpoint, grade the responses, and report what broke.",
      "",
      "aegis-probe sends OpenAI-compatible chat requests (a JSON body with a `messages` array) to --url",
      "and inspects the replies for signs the target's guardrails failed: instruction overrides, role",
      "hijacking, system prompt leakage, context/goal hijacking via injected content, and multi-turn attacks.",
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
  .addHelpText(
    "after",
    `
Examples:
  $ aegis-probe --url https://api.example.com/v1/chat --key sk-... --output table
      Attack a target endpoint using the free keyword grader.

  $ aegis-probe --url https://api.example.com/v1/chat --key sk-... \\
      --base-url https://openrouter.ai/api/v1 --judge-key sk-or-... --model "openai/gpt-oss-20b:free"
      Attack a target and grade responses with an LLM judge via OpenRouter's free tier.

  $ aegis-probe --url https://api.example.com/v1/chat --category role-hijacking --category multi-turn
      Only run role-hijacking and multi-turn attacks.

  $ aegis-probe --list
      Show every built-in attack without contacting any endpoint.

Getting an API key / model string for the judge LLM:
  - OpenRouter (https://openrouter.ai) offers free-tier models you can use as the judge at no cost.
    Sign up, create a key at https://openrouter.ai/keys, then pass it as --judge-key.
  - Browse available models (and their exact model strings) at https://openrouter.ai/models — filter
    for ':free' suffixed models to avoid charges. Pass the exact string, e.g. "openai/gpt-oss-20b:free",
    as --model, and https://openrouter.ai/api/v1 as --base-url.
  - Free models on OpenRouter rotate over time and may be retired or start requiring payment — if a
    run suddenly fails or starts billing you, check https://openrouter.ai/models for the current list.
  - Any other OpenAI-compatible provider (OpenAI itself, Groq, Together, a local vLLM/Ollama server, etc.)
    works the same way: --base-url <their API base>, --judge-key <their key>, --model <their model id>.
`,
  );

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
    for (const category of CATEGORIES) {
      console.log(`\n${category}`);
      for (const attack of attacksByCategory[category]) {
        console.log(`  ${attack.id}  ${attack.name} (${attack.turns.length} turn${attack.turns.length > 1 ? "s" : ""})`);
      }
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
    console.error(`Running ${attacks.length} attack(s) against ${target.url}...`);
    if (judge) {
      console.error(`Grading with LLM judge: ${judge.model} @ ${judge.baseUrl}`);
    } else {
      console.error("Grading with free keyword matcher (pass --base-url/--judge-key/--model for LLM grading).");
    }
  }

  const results = await runAttacks(target, attacks, {
    onAttackComplete: (result, index, total) => {
      if (isTable) {
        console.error(`  [${index + 1}/${total}] ${result.attack.id} ${result.attack.name} done`);
      }
    },
  });

  const graded = await gradeAll(results, judge);
  console.log(formatReport(graded, outputFormat));

  const anyBroke = graded.some((g) => g.verdict.broke);
  process.exitCode = anyBroke ? 1 : 0;
}

main().catch((err) => {
  console.error("aegis-probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
