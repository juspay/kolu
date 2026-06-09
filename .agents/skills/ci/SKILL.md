---
name: ci
description: Reference for the `odu` runner — how to invoke a full pipeline, a single recipe, or a platform-pinned node, and how to attach to a live run, from a project whose CI odu runs. Trigger when the user asks to "run CI", "run the pipeline", "re-run a check", or names a specific recipe by `<recipe>@<platform>`.
---

# odu

[`odu`](https://github.com/juspay/odu) (Tamil ஓடு — "run") runs the `just`
recipe DAG tagged `[metadata("ci")]` across platforms and posts GitHub
commit statuses per `<recipe>@<platform>` context. Unlike batch runners,
the run is **live state you attach to**: the coordinator serves a typed
surface on `.ci/odu.sock`, so `status`/`logs`/`monitor` are in-band — no
process-compose, no separately-versioned socket client.

## Invoking

```sh
nix run github:juspay/odu -- <subcommand> [args]
```

Pin a ref for reproducibility, or — if the consuming repo npins-pins odu
and re-exports it (kolu does) — prefer its own flake output so the version
is repo-controlled:

```sh
nix run .#odu -- <subcommand> [args]
```

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

Every mode ends with the same `── ci run summary @ <sha7> ──` verdict block
(the sha reads `<sha7>+dirty` for a live-tree run on uncommitted changes)
and exits non-zero if any node failed or errored.

## Common invocations

```sh
# Full pipeline (the [metadata("ci")] root, every configured platform).
nix run github:juspay/odu -- run

# Dev iteration on a dirty tree: no clean-tree refuse, no HEAD pin, no posts.
nix run github:juspay/odu -- run --no-strict

# Re-run a single failed recipe on one lane — overwrites the same GitHub
# commit-status context the full run wrote (closes the red check).
nix run github:juspay/odu -- run e2e@x86_64-linux

# One recipe across every pipeline platform; selectors compose.
nix run github:juspay/odu -- run e2e lint

# Restrict the WHOLE fanout to one platform (repeatable).
nix run github:juspay/odu -- run --platform x86_64-linux

# Skip the dependency closure; run ONLY the named nodes (_ci-setup still rides).
nix run github:juspay/odu -- run --no-deps e2e@aarch64-darwin

# A different DAG root instead of the [metadata("ci")] recipe.
nix run github:juspay/odu -- run --root ci::e2e

# One-shot redirect of a platform's host (how a pool-lease wrapper pins a box).
nix run github:juspay/odu -- run --host x86_64-linux=my-build-box

# One NDJSON line per node transition, for agents/tools driving CI:
# {"node":"ci::e2e@x86_64-linux","recipe":"ci::e2e","platform":"x86_64-linux",
#  "status":"running|success|failed|skipped|errored","exit_code":1,
#  "log":".ci/<sha7>/x86_64-linux/ci::e2e.log"}
nix run github:juspay/odu -- run --progress json
```

Without `--progress json`, output adapts to where stdout points: a live
colour lane-matrix with a log-tail footer on a TTY; quiet transition lines
plus a once-a-minute "… still running" heartbeat when piped.

## Inspection subcommands (no side effects)

```sh
nix run github:juspay/odu -- dump            # resolved pipeline as JSON
nix run github:juspay/odu -- graph           # dependency graph (Mermaid)
nix run github:juspay/odu -- protect --dry-run   # the (recipe × platform) contexts
nix run github:juspay/odu -- protect             # PATCH branch protection to them
```

## Live introspection (attach to a run in progress)

While `odu run` is live in a checkout, these attach to its surface over
`.ci/odu.sock`:

```sh
nix run github:juspay/odu -- status          # snapshot; -o json for tooling
nix run github:juspay/odu -- monitor         # live TUI dashboard on a tty
                                             # (digits attach · n/p cycle ·
                                             #  r rerun · q quit); -o json
                                             # = transition stream
nix run github:juspay/odu -- logs -f e2e@x86_64-linux
```

No run in progress ⇒ exit non-zero with `no run in progress in this
checkout (no live socket at .ci/odu.sock)`. One run per checkout — a
second `odu run` refuses while the socket is live.

## Hosts config

`$ODU_HOSTS` (a file path) → `~/.config/odu/hosts.json` → fallback
`~/.config/justci/hosts.json` (zero-config migration from justci):

```json
{
  "x86_64-linux": "my-linux-builder",
  "aarch64-darwin": "me@mac-mini.local"
}
```

Keys are Nix system tuples; values are anything ssh dials, or `localhost`
(runs directly against the snapshot, no closure copy). Missing platforms
silently drop from the fanout. `--host PLAT=ADDR` overrides per run.

A lane host needs only **ssh + Nix + outbound https**: the runner ships as
a Nix closure (`nix copy` → realise on the host), and the source arrives by
`git fetch` of the **pushed** SHA — remote lanes cannot test unpushed
commits (no git-bundle transport; push first). The lane host's own nix is
used on the runner's PATH (never a pinned client — version skew against the
host daemon corrupts CA-derivation handling).

## Semantics worth knowing

- **Lanes are one-shot**: a lane whose ssh link dies mid-run fails as
  `errored` (GitHub state `error`, `Errored (<dur>)` description); live
  state does not survive a runner restart — the per-SHA log files do.
- **Skipped nodes post no status**: an absent required context is what
  blocks the merge.
- The coordinator resolves the lane runner via
  `nix eval <snapshot>#packages.<platform>.odu-runner.drvPath` — the
  consuming repo's flake must expose `odu-runner` (re-export odu's, as
  kolu does) until odu threads its own runner derivation.

## When NOT to use this skill

- Questions about odu's internals or design history — read the
  [README](https://github.com/juspay/odu/blob/master/README.md) and the
  kolu Atlas note
  [*A CI runner you attach to*](https://github.com/juspay/kolu/blob/master/docs/atlas/dist/mini-ci-vs-justci.html).
- Project-specific CI operations (warm pools, host leases, banned flags)
  — that's the consuming repo's operational docs, layered on top of this
  reference.
