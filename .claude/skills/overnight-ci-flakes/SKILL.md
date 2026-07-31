---
name: overnight-ci-flakes
description: Run an autonomous overnight campaign to find, prove, fix, and document CI flakes. Use when the user asks to stabilize CI through repeated full-pipeline runs and leave an evidence-backed draft PR.
---

# Overnight CI flakes

Before starting, ask the user for the exact macOS and Linux machine hosts and wait for their answer; never infer or reuse hosts from another session.

Open a draft PR and keep a concise `docs/ci-flakes.md` current with every run and, for each failure, its evidence-proven root cause, proposed or applied fix, and present state; never guess, retry a failed step, or hide a failure. Fix every repository-addressable failure, including `osfacts-live`, run `/be-review`, and finish only after five consecutive green full-pipeline runs on the current PR head on both hosts.
