---
name: ci-runtime
description: Reusable CI infrastructure — signoff (commit status posting), multisystem build (git bundle + SSH), log capture, orchestration protocol. The project's own `ci` skill delegates to these primitives; do not invoke this directly.
---

# CI Runtime

Reusable infrastructure for project CI skills. A project's own `ci` skill (deployed at `.claude/skills/ci/SKILL.md`) defines its steps inline; this skill defines how to run them, post statuses, route remote work, and capture logs.

## Primitives

Shims live at `.claude/skills/ci-runtime/scripts/` after `apm install`. All read `$CI_SHA` if exported (set it once from `ci-preflight` so every shim sees the same sha for the whole run).

- **`ci-status <step> <pending|success|failure|error> [description]`** — post a commit status via the configured forge. GitHub today; Bitbucket via the same shim later. Always use this; never call `gh api` directly.
- **`ci-ssh <system> <cmd…>`** — git-bundle the repo at the captured sha, ship to the target host, run `cmd`, stream output, clean up. System→host map lives in `~/.config/ci/hosts.json` (prompted + cached on first use per system).
- **`ci-log <step>`** — emit the canonical log path: `.logs/<short-sha>/<step>.log`.
- **`ci-preflight`** — assert clean worktree + HEAD pushed; emit the resolved sha on stdout.
- **`ci-verify <step…>`** — cross-check posted statuses for the current sha against the listed step names; print a table; exit non-zero on any missing or non-success.

## Orchestration protocol

A project's CI skill follows this when asked to run CI:

1. **Preflight.** `export CI_SHA=$(ci-preflight)` — fail-fast on dirty/unpushed; pin the sha for the rest of the run.
2. **Plan.** Read your step list from your own SKILL.md — names, commands, optional `depends_on`, optional `system`. Build the DAG.
3. **Execute.** For each step:
   - `ci-status <step> pending`
   - Run `command` (or `ci-ssh <system> <command>` if `system` is set); tee combined output to `$(ci-log <step>)`.
   - Exit 0 → `success "<elapsed>s"`. Exit ≠ 0 → `failure "<elapsed>s · <log path>"`.
   - Mark dependents of failures `failure "blocked by <upstream>"` and skip their commands.
   - Run independent ready steps in parallel by spawning one subagent per step; each subagent posts its own statuses and returns a one-line result.
4. **Verify.** `ci-verify <every step name>`. A missing context = silent failure — report it loudly.
5. **Summarize.** One line per step; non-zero exit if any failed or missing.

## Step name discipline

Branch protection pins literal context strings. Use the canonical step name from the project's SKILL.md verbatim — no paraphrasing, abbreviating, or suffixing.

## Authoring a project CI skill

Write `.apm/skills/ci/SKILL.md` in your project (deploys to `.claude/skills/ci/SKILL.md` via apm). List your steps in markdown — name, command, optional `depends_on`, optional `system`. Reference this `ci-runtime` skill for the protocol. The SKILL.md *is* the manifest; no separate config file.
