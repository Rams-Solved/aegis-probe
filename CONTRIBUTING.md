# Contributing to aegis-probe

Thanks for considering a contribution. This is a small CLI with a narrow
scope — a fast first-pass red-teaming tool, not an exhaustive jailbreak
benchmark — so the bar for new code is "does this make that first pass
better" rather than "does this add a new mode."

## Setup

```bash
git clone https://github.com/Rams-Solved/aegis-probe.git
cd aegis-probe
npm install
npm run typecheck
npm test
```

Run the CLI locally with `tsx`, no build step needed:

```bash
npx tsx bin/aegis-probe.ts --mock
```

## Adding an attack

Attacks live in `src/attacks/<category>.ts` as plain `Attack[]` arrays (see
`src/types.ts` for the shape) and are aggregated in `src/attacks/index.ts`.

- Pick the existing category it fits (`instruction-override`,
  `role-hijacking`, `system-prompt-extraction`, `context-poisoning`,
  `goal-hijacking`, `multi-turn`). Propose a new category only if a prompt
  genuinely doesn't fit any existing one.
- Give it a unique `id` following the file's existing prefix convention
  (e.g. `io-05` for a new instruction-override attack).
- `turns` is an array of user-facing prompts sent in sequence in the same
  conversation — most attacks are single-turn; only `multi-turn.ts` attacks
  should have more than one.
- Write a `description` that explains *why* the attack might work, not just
  what it says — that's what shows up in reports and helps someone reading
  results understand the finding.

## Adding a grading heuristic

`src/judge.ts` has two graders: the free `keywordGrade` (regex-based) and
`llmGrade` (delegates to an OpenAI-compatible judge endpoint). If you're
adding capitulation/refusal patterns to `keywordGrade`, keep them specific —
overly broad patterns cause false positives on legitimate refusals or
unrelated text. Add a test case alongside any new pattern.

## Tests

Tests use Node's built-in test runner via `tsx` — no extra test framework.
Add `*.test.ts` files next to the module they cover and run:

```bash
npm test
```

New logic in `src/` (grading, response parsing, report summarization)
should come with a test. UI/formatting code (`src/ui.ts`, terminal color
codes) doesn't need to be exhaustively tested, but anything with real
branching logic does.

## Pull requests

- Keep PRs focused — one attack category, one bug fix, one feature per PR.
- Run `npm run typecheck` and `npm test` before opening a PR.
- Describe what you tested it against (a real endpoint, `--mock`, or both).

## Reporting bugs vs. security issues

Regular bugs (crashes, bad table rendering, wrong CLI parsing) go in GitHub
Issues. Anything about aegis-probe itself being exploitable, or concerns
about how it should be used responsibly, goes through the process in
[SECURITY.md](SECURITY.md) instead.
