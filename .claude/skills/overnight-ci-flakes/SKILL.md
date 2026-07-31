---
name: overnight-ci-flakes
description: Run an autonomous overnight campaign to find, prove, fix, and document CI flakes. Use when the user asks to stabilize CI through repeated full-pipeline runs and leave an evidence-backed draft PR.
---

# Overnight CI flakes

- Ask for the exact macOS and Linux machine hosts and wait; never infer or reuse them.
- Open a draft PR and keep a concise `docs/ci-flakes.md` current with every run.
- Run `/ci` on both hosts without step retries until the current PR head passes 5 consecutive runs.
- For every failure, record evidence, proven root cause, proposed or applied fix, and present state; make every repository-addressable fix, reset the count, and repeat the 5-run loop.
- Only after 5 consecutive green runs, run `/be-review`.
- Run `/ci` 5 more consecutive times without step retries; if any run fails, return to the failure-and-fix loop above.
- Finish only when the final 5 runs and GitHub CI are green on the current PR head.
