# Security Policy

## Scope

aegis-probe is a red-teaming CLI: it sends adversarial prompts to a target
endpoint *you* specify and control. It is not a scanning or exploitation
tool for endpoints you don't own or have permission to test — only use it
against systems you're authorized to probe.

This policy covers vulnerabilities in aegis-probe itself, for example:

- Credential/API key handling (target `--key`, judge `--judge-key`) leaking
  into logs, error messages, or output that shouldn't contain them.
- Command injection, path traversal, or unsafe deserialization in the CLI
  or REPL.
- A malicious target endpoint's response being able to do more than get
  graded and displayed (e.g. escaping the table renderer, executing code).

It does not cover the fact that the *attack prompts themselves* are
adversarial by design — that's the tool's purpose, not a vulnerability.

## Reporting a vulnerability

Please do not open a public GitHub issue for security reports. Instead,
use GitHub's private vulnerability reporting for this repository
(Security tab → "Report a vulnerability"), or email the maintainer listed
in the repository's GitHub profile.

Include:

- The version/commit you're running.
- Steps to reproduce, ideally with `--mock` or a minimal target so it
  doesn't depend on a private endpoint.
- What you'd expect to happen instead.

We'll acknowledge reports within a few days and aim to release a fix
before any public disclosure.

## Supported versions

This project is pre-1.0 (`0.x`). Only the latest published version is
supported — there are no backported security fixes to older 0.x releases.
