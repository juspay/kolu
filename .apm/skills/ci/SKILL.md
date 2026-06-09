---
name: ci
description: Reference for `odu`, this repo's CI runner — how to invoke a full pipeline, a single recipe, or a platform-pinned node, and how to attach to a live run. Trigger when the user asks to "run CI", "run the pipeline", "re-run a check", or names a specific recipe by `<recipe>@<platform>`.
---

# odu

`odu` (Tamil ஓடு — "run", `packages/odu`) runs the `just` recipe DAG tagged
`[metadata("ci")]` across platforms and posts GitHub commit statuses. It
replaced `justci` in this repo (Atlas: `mini-ci-vs-justci`) with the same
status contexts (`ci::<recipe>@<platform>`), the same per-SHA log layout
(`.ci/<sha>/<plat>/<recipe>.log`), and the same strict-mode flag table — but
the run is **live state you attach to**: a coordinator owns the run and
serves a typed surface on `.ci/odu.sock`, so `status`/`logs`/`monitor` are
in-band (no process-compose, no separately-versioned socket client).

## Invoking

Inside this repo, run the flake package:

```sh
nix run .#odu -- <subcommand> [args]
```

(From elsewhere: `nix run github:juspay/kolu#odu -- …`.)

## Modes

**Strict by default** — `odu run` refuses a dirty tree, pins `HEAD` via
`git worktree`, posts commit statuses, and splits per-recipe logs into
`.ci/<sha>/<plat>/<recipe>.log`. Three flags relax that policy:

| Flags | Tree | HEAD pin | Status posts | Use for |
| --- | --- | --- | --- | --- |
| _(none — default)_ | clean (refuses dirty) | `git worktree` at HEAD | posted | "real" CI runs |
| `--no-post` | clean | `git worktree` at HEAD | _none_ | non-GitHub strict consumers; debugging strict without writing the PR's check list |
| `--no-snapshot` (implies `--no-post`) | live working tree | none | _none_ | strict-mode dev iteration without clean-tree refuse |
| `--no-strict` (meta — same as `--no-snapshot --no-post`) | live working tree | none | _none_ | dev iteration; the one-flag opt-out for "just run the pipeline" |

Every mode ends with the same `── ci run summary ──` verdict block and exits
non-zero if any node failed or errored.

## Common invocations

```sh
# Full pipeline (the [metadata("ci")] root, every platform in the fanout).
# Strict by default — refuses a dirty tree, posts GH statuses.
nix run .#odu -- run

# Dev iteration on a dirty tree: no clean-tree refuse, no HEAD pin, no posts.
nix run .#odu -- run --no-strict

# Re-run a single failed recipe on one lane — overwrites the same GitHub
# commit-status context the full run wrote (closes the red check).
nix run .#odu -- run e2e@x86_64-linux

# Re-run a single recipe across every pipeline platform; selectors compose.
nix run .#odu -- run e2e
nix run .#odu -- run e2e biome

# Restrict the WHOLE fanout to one platform (repeatable).
nix run .#odu -- run --platform x86_64-linux

# Skip the dependency closure; run ONLY the named nodes (_ci-setup still rides).
nix run .#odu -- run --no-deps e2e@aarch64-darwin

# A different DAG root instead of the [metadata("ci")] recipe.
nix run .#odu -- run --root ci::e2e

# One-shot redirect of a platform's host (how ci/pu/run.sh pins the leased box).
nix run .#odu -- run --host x86_64-linux=kolu-ci-3

# Stream one NDJSON line per node transition (the /do consumption contract):
# {"node":"ci::e2e@x86_64-linux","recipe":"ci::e2e","platform":"x86_64-linux",
#  "status":"running|success|failed|skipped|errored","exit_code":1,
#  "log":".ci/<sha7>/x86_64-linux/ci::e2e.log"}
nix run .#odu -- run --progress json
```

## Inspection subcommands (no side effects)

```sh
# Resolved pipeline as JSON — no host dials, works offline.
nix run .#odu -- dump

# Dependency graph in Mermaid flowchart syntax.
nix run .#odu -- graph

# Print the (recipe × platform) contexts the canonical DAG produces — the
# source of truth for the required-checks list. Without --dry-run, PATCHes
# GitHub branch protection to exactly that list.
nix run .#odu -- protect --dry-run
nix run .#odu -- protect
```

## Live introspection (attach to a run in progress)

While `odu run` is live in a checkout (typically backgrounded by `/do`),
these attach to its surface over `.ci/odu.sock`:

```sh
# Snapshot every node's state. -o json → [{name, status, exit_code, duration_ms}]
nix run .#odu -- status
nix run .#odu -- status -o json

# One line per node transition, no polling. On a TTY this is instead a live
# dashboard (node table + log pane; keys: digits attach, n/p cycle,
# r rerun — the one mutation — q quit). -o json forces the stream form.
nix run .#odu -- monitor
nix run .#odu -- monitor -o json

# Replay one node's log; -f follows. Bare recipe names resolve when unique.
nix run .#odu -- logs ci::e2e@aarch64-darwin
nix run .#odu -- logs -f e2e@aarch64-darwin
```

No run in progress ⇒ exit non-zero with `no run in progress in this checkout
(no live socket at .ci/odu.sock)`. One run per checkout — a second `odu run`
refuses while the socket is live.

## Hosts config

`$ODU_HOSTS` (a file path) → `~/.config/odu/hosts.json` → fallback
`~/.config/justci/hosts.json` (so the justci migration needed zero config):

```json
{
  "x86_64-linux": "drishti-ci",
  "aarch64-darwin": "nix-infra@rasam.tail12b27.ts.net"
}
```

Keys are Nix system tuples; values are anything ssh dials, or `localhost`
(runs directly against the snapshot, no closure copy). Missing platforms
silently drop from the fanout. `--host PLAT=ADDR` overrides per run.

A lane host needs only **ssh + Nix + outbound https**: the runner ships as a
Nix closure (`nix copy` → realise), and the source arrives by `git fetch` of
the **pushed** SHA — remote lanes cannot test unpushed commits (odu has no
git-bundle transport; push first).

## Differences from justci worth knowing

- `status`/`logs`/`monitor` speak odu's own surface — there is no
  `.ci/pc.sock`, no process-compose, no `--tui` flag (the dashboard lives in
  `odu monitor`), and no `--` passthrough (there is no process-compose to
  forward to). `dump` replaces `dump-yaml` (there is no YAML).
- A lane whose ssh link dies mid-run fails as `errored` (GitHub state
  `error`, description `Errored (<dur>): <log>`); live state does not
  survive a runner restart — the per-SHA log files do.
- Skipped nodes post no status: an absent required context is what blocks
  the merge, exactly as before.

## When NOT to use this skill

- Questions about odu's internals or design history — read
  `packages/odu/README.md` and the Atlas note `mini-ci-vs-justci`.
- Kolu-specific CI operations (the warm pu-box pool, rasam, banned flags,
  evidence gates) — that's `.agency/do.md`'s CI section, layered on top of
  this reference.
