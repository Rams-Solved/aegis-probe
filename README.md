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

## Usage

```
aegis-probe --url <endpoint> [--key <key>] [--base-url <url>] [--judge-key <key>] [--model <model>] [--output json|table]
```

There are no defaults for the target — you always pass `--url` explicitly.

### Target endpoint

- `--url <endpoint>` — the chat endpoint to attack. Must accept `POST { messages: [{role, content}, ...] }` and return an OpenAI-compatible body (`{ choices: [{ message: { content } }] }`) or a plain-text/simple-JSON reply.
- `--key <key>` — optional bearer token sent as `Authorization: Bearer <key>` to the target.
- `--header "Name: Value"` — extra header to send to the target. Repeatable for multiple headers.

### Grading

By default, `aegis-probe` grades responses for free using keyword/pattern matching — it looks for phrases suggesting the target adopted a jailbreak persona, echoed override language, or started leaking what looks like a system prompt, versus clear refusal language. This is fast and has no external dependency, but it's crude: it can miss subtle compliance and can't judge nuance.

For real grading, point `aegis-probe` at any OpenAI-compatible chat completions API to use as a judge LLM:

```bash
aegis-probe --url https://your-endpoint.example.com/v1/chat \
  --base-url https://openrouter.ai/api/v1 \
  --judge-key sk-or-... \
  --model "openai/gpt-oss-20b:free"
```

`--base-url`, `--judge-key`, and `--model` must all be supplied together — passing only some of them is treated as a configuration error rather than silently falling back to keyword grading.

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
  --model "openai/gpt-oss-20b:free"
```

**Note:** OpenRouter's free-tier model lineup rotates — models get added, retired, or occasionally start requiring payment. If a previously-working `--model` value starts failing or unexpectedly billing you, check [openrouter.ai/models](https://openrouter.ai/models) for the current free lineup and swap in a new model string.

Any other OpenAI-compatible provider works the same way — OpenAI itself, Groq, Together AI, a local vLLM or Ollama server, etc. Just point `--base-url` at their `/v1`-style base, `--judge-key` at your key for that provider, and `--model` at their model id.

## Adding your own attacks

Attacks live in `src/attacks/*.ts`, one file per category, each exporting an array of `Attack` objects (see `src/types.ts`). An attack is just an id, category, name, description, and a list of one or more user-turn prompts — multi-turn attacks list multiple prompts and `aegis-probe` maintains conversation history across them automatically. Add a new attack by appending to the relevant category file's array, or add a new category by creating a new file and wiring it into `src/attacks/index.ts`.

## Project layout

```
bin/aegis-probe.ts   CLI entry point (commander)
src/attacks/          Attack definitions, one file per category
src/probe.ts           Fires attacks, collects responses, maintains multi-turn state
src/judge.ts            Keyword + LLM-judge grading
src/report.ts             Table/JSON output formatting
```

## Responsible use

This tool is intended for testing systems you own or are authorized to test — pre-launch red-teaming, CI regression checks, or security research with permission. Don't point it at third-party production systems without authorization.

## License

MIT — see [LICENSE](./LICENSE).
