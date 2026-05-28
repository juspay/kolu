---
name: ci
description: Reference for the `justci` runner — how to invoke a full pipeline, a single recipe, or a platform-pinned node from a project that depends on `juspay/justci`. Trigger when the user asks to "run justci", "run the pipeline", "re-run a check", or names a specific recipe by `<recipe>@<platform>`.
---

# justci

`justci` translates a project's `just` recipe DAG into a `process-compose` pipeline and runs it. Multi-platform lanes fan out via SSH; commit statuses get posted (in strict mode) under `<recipe>@<platform>` contexts. Full background in the [repo README](https://github.com/juspay/justci/blob/main/README.md); the subcommand surface below is what you'll reach for most often.

## Invoking

Always invoke via the flake — the consumer may not have `justci` installed on PATH:

```sh
nix run github:juspay/justci -- <subcommand> [args]
```

Pin to a tag (e.g. `github:juspay/justci/v0.2.0`) for reproducibility, or omit the ref to follow `main`. Every command in this skill is shown in the `nix run` form; substitute a pinned ref if your project requires one.

## Modes

| Variable | Effect |
| --- | --- |
| `CI` unset (default) | **Local mode.** Runs against the live working tree. No GitHub status posts, no clean-tree refuse. Use for iterating. |
| `CI=true` | **Strict mode.** Refuses a dirty tree, snapshots `HEAD` via `git worktree`, posts commit statuses, splits per-recipe logs into `.ci/<sha>/<plat>/<recipe>.log`. Use for "real" CI runs. |

Both modes share the same verdict-summary at the end (`── ci run summary ──`) and exit non-zero if any node failed.

## Common invocations

```sh
# Full pipeline (canonical [metadata("ci")] root, every platform in the fanout)
nix run github:juspay/justci -- run                # local mode
CI=true nix run github:juspay/justci -- run        # strict mode

# Re-run a single failed recipe on a specific lane — overwrites the same
# GitHub commit-status context the full run wrote (closes the red check).
nix run github:juspay/justci -- run e2e@x86_64-linux

# Re-run a single recipe across every pipeline platform.
nix run github:juspay/justci -- run e2e

# Multiple positional selectors compose — `e2e` AND `lint` both run.
nix run github:juspay/justci -- run e2e lint

# Restrict the WHOLE fanout to one platform — full DAG, linux lane only.
# Repeatable for a subset; composes with everything else (selectors,
# --root, CI=true). Use for "test strict mode without spinning up the
# remote lanes" and similar pre-flight checks.
nix run github:juspay/justci -- run --platform x86_64-linux
nix run github:juspay/justci -- run --platform x86_64-linux --platform aarch64-darwin
CI=true nix run github:juspay/justci -- run --platform x86_64-linux

# Skip the dependency closure; run ONLY the named nodes. Setup nodes
# auto-ride for remote-platform recipes regardless.
nix run github:juspay/justci -- run --no-deps e2e@aarch64-darwin

# Use a different DAG root instead of the [metadata("ci")] recipe.
nix run github:juspay/justci -- run --root release-pipeline

# One-shot redirect of a platform to a throwaway host (LXC container,
# alternate SSH alias). Repeatable per platform.
nix run github:juspay/justci -- run --host x86_64-linux=root@lxc-foo

# Drive process-compose's interactive TUI instead of headless logs.
nix run github:juspay/justci -- run --tui

# Forward arbitrary args to `process-compose up` after --.
nix run github:juspay/justci -- run -- -t=false
```

## Inspection subcommands (no side effects)

```sh
# Print the assembled process-compose YAML — no host prompts, no git
# rev-parse, works offline.
nix run github:juspay/justci -- dump-yaml

# Print the dependency graph in Mermaid flowchart syntax.
nix run github:juspay/justci -- graph

# PATCH GitHub branch-protection's required_status_checks to the
# (recipe, platform) contexts the canonical DAG produces. --dry-run
# prints what would be PATCHed without touching the API.
nix run github:juspay/justci -- protect --dry-run
nix run github:juspay/justci -- protect                  # writes to default branch
nix run github:juspay/justci -- protect --branch develop
```

## Live introspection (during a backgrounded run)

When `justci run` is in progress — typically because the agent backgrounded it (e.g. `loop until /ci passes`) — these subcommands report fine-grained per-node state without disturbing the run. Each resolves the socket and process-compose binary from the same source `justci run` itself uses, so the client version never drifts from the server.

```sh
# Snapshot every node's current state. Pipe `-o json` into jq for
# fields like name / status / exit_code / restarts.
nix run github:juspay/justci -- status
nix run github:juspay/justci -- status -o json

# Live state-transition stream — one line per (recipe, platform)
# transition, no polling. `-o json` emits one event per line.
nix run github:juspay/justci -- monitor

# Tail one node's stdout/stderr; `-f` follows.
nix run github:juspay/justci -- logs ci::e2e@aarch64-darwin
nix run github:juspay/justci -- logs -f ci::e2e@aarch64-darwin
```

If no run is in progress in this checkout, the subcommand exits non-zero with `no justci run in progress in this checkout (no socket at .ci/pc.sock)`.

### Anti-pattern: do not reach for raw process-compose

If you find yourself typing `nix run nixpkgs#process-compose --` or hunting through `/nix/store/...-process-compose-*/bin/` for a binary, stop — that path is not guaranteed to match the version the running pipeline uses, and the JSON shapes (e.g. `process list -o json`) may disagree. Always go through `nix run github:juspay/justci -- {status,logs,monitor}` so client and server stay version-pinned.

## Decision flow

1. **Full canonical run?** → `nix run github:juspay/justci -- run` (or `CI=true …` for strict mode).
2. **Flaky check on a PR, only one lane is red?** → `nix run github:juspay/justci -- run <recipe>@<platform>` — same status context, overwrites the failure.
3. **Iterating on one recipe locally?** → `nix run github:juspay/justci -- run <recipe>` (no platform pin = fans out to every pipeline platform; `<recipe>@<localPlat>` if you only want the local lane).
4. **Want the full DAG but only on one (or a subset of) platforms?** → `nix run github:juspay/justci -- run --platform <platform>` (repeatable). Slices the fanout pre-DAG, so it composes with `<recipe>` selectors that don't name a platform. Pair with `CI=true` to dry-run strict mode against one lane.
5. **Investigating "what would this run?"** → `nix run github:juspay/justci -- dump-yaml` or `… -- graph`.
6. **Setting up a new repo?** → run `… -- protect --dry-run` after at least one full run, verify the contexts look right, then `… -- protect` to lock them in.
7. **Checking on a backgrounded run?** → `nix run github:juspay/justci -- status` for a snapshot, `… -- logs -f <recipe>@<platform>` to follow one node, `… -- monitor` for the live event stream.

## Hosts config

`justci` reads `~/.config/justci/hosts.json`:

```json
{
  "x86_64-linux":   "srid1",
  "aarch64-darwin": "sincereintent"
}
```

Keys are full Nix system tuples (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`). Values are anything `ssh` knows how to dial — bare hostname, `user@host`, alias from `~/.ssh/config`. Missing platforms silently drop from the fanout (the user opts in by adding the entry). Override per-run with `--host PLATFORM=ADDR`.

## When NOT to use this skill

- The user is asking *about* justci's internals (how the YAML is shaped, what the setup node does, why `[metadata("ci")]` matters) — that's a docs question, point them at the [repo README](https://github.com/juspay/justci/blob/main/README.md).
- The user wants the runner to do something it doesn't support (parallel cross-platform within one recipe, mid-run config reload) — those are not supported today; check the README's Roadmap section.
