---
name: overnight-ci-flakes
description: Run an autonomous overnight campaign to find, prove, fix, and document CI flakes. Use when the user asks to stabilize CI through repeated full-pipeline runs and leave an evidence-backed draft PR.
---

# Overnight CI flakes

- Ask for the exact macOS and Linux machine hosts and wait; never infer or reuse them.
- Open a draft PR and keep a concise `docs/ci-flakes.md` current with every run.
- Run `/ci` 5 times on both hosts without step retries.
- For every failure, record evidence, proven root cause, proposed or applied fix, and present state; never guess or hide failures.
- Fix every repository-addressable failure, then run `/be-review`.
- Run `/ci` 5 more times on both hosts and finish only when those runs and GitHub CI are green on the current PR head.
