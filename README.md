# aegis-probe

Fire adversarial prompts at any LLM-powered chat endpoint, grade the responses, and report what broke. A small, open-source red-teaming CLI for people shipping LLM chat features.

`aegis-probe` sends OpenAI-compatible chat requests (`POST { messages: [...] }`) to a target you specify, runs a battery of known adversarial prompts against it, and grades whether the target's guardrails held.

## What it does

- Fires attacks across six categories at your target endpoint:
  - **Instruction override** — direct "ignore your instructions" style attacks
  - **Role hijacking** — jailbreak personas (DAN-style, fictional characters, fake authority)
  - **System prompt extraction** — attempts to leak the target's system/developer prompt
  - **Context poisoning** — fabricated prior turns or poisoned documents injected into context
  - **Goal hijacking via indirect injection** — malicious instructions hidden inside content the model is asked to process (emails, web pages, tool output)
  - **Multi-turn attacks** — stateful attacks that build across 2-3 turns of conversation, escalating gradually or exploiting false premises established earlier in the chat
- Grades every response either for free (keyword/pattern matching for obvious capitulation) or with an LLM judge that scores severity and explains its verdict.
- Reports results as a human-readable table or as JSON for CI pipelines.

This is **not** an exhaustive jailbreak benchmark — it's a fast first pass to catch obvious guardrail failures before you ship.

## Install

```bash
git clone <this repo>
cd aegis-probe
npm install
```

Run directly with `tsx` (no build step needed):

```bash
npx tsx bin/aegis-probe.ts --url https://your-endpoint.example.com/v1/chat
```

Or link it globally for a `aegis-probe` command:

```bash
npm link
aegis-probe --url https://your-endpoint.example.com/v1/chat
```

No target yet? Try it with zero setup:

```bash
aegis-probe --mock
```

### Interactive shell

Running `aegis-probe` with no arguments at all drops you into a persistent interactive shell instead of printing a usage error:

```bash
aegis-probe
```

```
aegis [target: none] ❯ help                                # print the full help layout
aegis [target: none] ❯ target https://api.example.com/chat  # set a target — shown in the prompt
aegis [target: https://api.example.com/chat] ❯ mock         # run the local --mock simulation inline
aegis [target: https://api.example.com/chat] ❯ spill        # raw, untruncated dump of the last results
aegis [target: https://api.example.com/chat] ❯ target none  # clear the target back to 'none'
aegis [target: none] ❯ exit                                 # (or quit, or Ctrl+C) leave cleanly
```

The results table wraps long attack/note text instead of truncating it, and re-renders automatically if you resize the terminal. If the wrapped table still isn't what you want to read, `spill` prints every result as plain, borderless, un-wrapped text.

Any invocation with at least one argument (`--mock`, `--list`, `--url ...`, `--help`, etc.) skips the shell entirely and runs as a normal one-shot command.

## Usage

```
aegis-probe --url <endpoint> [--key <key>] [--model <model>] [--base-url <url>] [--judge-key <key>] [--judge-model <model>] [--output json|table]
aegis-probe --mock
```

There are no defaults for the target — you always pass `--url` explicitly (or `--mock` to skip a target entirely).

### Target endpoint vs. judge LLM

These two option groups are independent and validated separately:

| | Options | Purpose |
|---|---|---|
| **Target** (required) | `--url`, `--key`, `--model`, `--header` | The endpoint being attacked. `--model` here is sent as the `model` field in the request body, if the target needs one. |
| **Judge** (optional) | `--base-url`, `--judge-key`, `--judge-model` | An LLM used to grade responses instead of the free keyword matcher. |

- `--url <endpoint>` — the chat endpoint to attack. Must accept `POST { messages: [{role, content}, ...] }` and return an OpenAI-compatible body (`{ choices: [{ message: { content } }] }`) or a plain-text/simple-JSON reply.
- `--key <key>` — optional bearer token sent as `Authorization: Bearer <key>` to the target.
- `--model <model>` — optional model string sent in the request body to the target (e.g. `gpt-4o-mini`), if it requires one. This is unrelated to judge grading.
- `--header "Name: Value"` — extra header to send to the target. Repeatable for multiple headers.

### Grading

By default, `aegis-probe` grades responses for free using keyword/pattern matching — it looks for phrases suggesting the target adopted a jailbreak persona, echoed override language, or started leaking what looks like a system prompt, versus clear refusal language. This is fast and has no external dependency, but it's crude: it can miss subtle compliance and can't judge nuance.

For real grading, point `aegis-probe` at any OpenAI-compatible chat completions API to use as a judge LLM:

```bash
aegis-probe --url https://your-endpoint.example.com/v1/chat \
  --base-url https://openrouter.ai/api/v1 \
  --judge-key sk-or-... \
  --judge-model "openai/gpt-oss-20b:free"
```

`--base-url`, `--judge-key`, and `--judge-model` must all be supplied together — passing only some of them is treated as a configuration error rather than silently falling back to keyword grading. Passing `--model` alone (without any judge flags) is fine — it only configures the target and never touches judge validation.

If a judge failure happens mid-run (expired key, 429, dropped connection), that single result falls back to the keyword grader with an explanation noting why — the rest of the run isn't lost.

### Mock mode

`--mock` runs a fully local simulation: no network calls, no keys required, all 25 built-in attacks graded with randomized (clearly labeled `[MOCK]`) results, rendered through the exact same table/JSON report as a real run. Useful for demoing the UI or testing your own tooling around aegis-probe's output without a live target.

```bash
aegis-probe --mock
aegis-probe --mock --category role-hijacking --output json
```

`--mock` bypasses all target/judge validation, including the requirement for `--url`.

### Free-tier rate limiting

If aegis-probe detects a judge configuration that looks like a free-tier or shared endpoint (model name containing `free`, or an OpenRouter base URL), it prints a warning and automatically inserts delays between requests to reduce the odds of tripping upstream 429s. All target and judge requests also time out after 15 seconds, so a dropped connection or hung socket can't stall a run indefinitely — it just surfaces as a failed turn/result and the run continues.

### Filtering and listing attacks

```bash
# Only run specific categories
aegis-probe --url ... --category role-hijacking --category multi-turn

# List every built-in attack without contacting any endpoint
aegis-probe --list
```

### Output

```bash
aegis-probe --url ... --output table   # default, human-readable
aegis-probe --url ... --output json    # machine-readable, for CI
```

The process exits with code `1` if any attack broke the target (per the active grader), and `0` otherwise — useful as a CI gate.

## Using OpenRouter's free models as the judge LLM

[OpenRouter](https://openrouter.ai) aggregates many providers behind a single OpenAI-compatible API and offers a rotating set of **free** models, which makes it a convenient no-cost judge backend:

1. Sign up at [openrouter.ai](https://openrouter.ai) and create an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Browse [openrouter.ai/models](https://openrouter.ai/models) and filter for models with a `:free` suffix (e.g. `openai/gpt-oss-20b:free`, `meta-llama/llama-3.3-70b-instruct:free` — exact availability changes over time, check the site).
3. Run aegis-probe with:

```bash
aegis-probe --url https://your-endpoint.example.com/v1/chat \
  --base-url https://openrouter.ai/api/v1 \
  --judge-key sk-or-v1-... \
  --judge-model "openai/gpt-oss-20b:free"
```

**Note:** OpenRouter's free-tier model lineup rotates — models get added, retired, or occasionally start requiring payment. If a previously-working `--judge-model` value starts failing or unexpectedly billing you, check [openrouter.ai/models](https://openrouter.ai/models) for the current free lineup and swap in a new model string. aegis-probe automatically adds request delays when it detects a free-tier judge, but shared rate limits are still shared — you may occasionally see a 429, which now degrades gracefully to keyword grading for that one result instead of crashing the run.

Any other OpenAI-compatible provider works the same way — OpenAI itself, Groq, Together AI, a local vLLM or Ollama server, etc. Just point `--base-url` at their `/v1`-style base, `--judge-key` at your key for that provider, and `--judge-model` at their model id.

## Adding your own attacks

Attacks live in `src/attacks/*.ts`, one file per category, each exporting an array of `Attack` objects (see `src/types.ts`). An attack is just an id, category, name, description, and a list of one or more user-turn prompts — multi-turn attacks list multiple prompts and `aegis-probe` maintains conversation history across them automatically. Add a new attack by appending to the relevant category file's array, or add a new category by creating a new file and wiring it into `src/attacks/index.ts`.

## Project layout

```
bin/aegis-probe.ts   CLI entry point (commander)
src/attacks/          Attack definitions, one file per category
src/probe.ts           Fires attacks, collects responses, maintains multi-turn state, free-tier detection
src/judge.ts            Keyword + LLM-judge grading, non-fatal fallback on judge failure
src/mock.ts              Randomized dataset generator for --mock
src/report.ts             Table/JSON output formatting
src/ui.ts                  Gradient text, spinner, banner, warning blocks
```

## Responsible use

This tool is intended for testing systems you own or are authorized to test — pre-launch red-teaming, CI regression checks, or security research with permission. Don't point it at third-party production systems without authorization.

## License

MIT — see [LICENSE](./LICENSE).
