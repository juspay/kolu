# ci/ — Kolu's CI pipeline definition

The pipeline itself is defined in [`mod.just`](./mod.just) and driven by [juspay/ci](https://github.com/juspay/ci) — a Haskell binary that translates a `just` recipe graph into a [process-compose](https://f1bonacc1.github.io/process-compose/) DAG, fans it out across target platforms, and posts a GitHub commit status per node.

## Running it

```sh
# Multi-platform fanout (Linux + macOS), live commit statuses, strict mode.
CI=true nix run github:juspay/ci/feat-platform-fanout-and-ssh -- run

# Single-platform local run (no statuses, no remote SSH) — just the local lane
# via just's [parallel] expansion of the root recipe.
just ci

# Individual recipes (no orchestration, runs in the local worktree).
just ci::nix
just ci::e2e

# Inspect the assembled process-compose YAML without side effects.
nix run github:juspay/ci/feat-platform-fanout-and-ssh -- dump-yaml
```

## How the runner picks platforms

The root recipe is `ci::default`, tagged `[linux] [macos] [metadata("ci")]`. The runner intersects those OS families with `~/.config/ci/hosts.json`:

```json
{
  "x86_64-linux": "srid1",
  "aarch64-darwin": "sincereintent"
}
```

Keys are full Nix system tuples. Values are anything `ssh` can dial — bare hostname, `user@host`, or an `~/.ssh/config` alias. An entry for the *local* system takes precedence over inline execution, so the same machine can offload its native lane to a dedicated builder (e.g. an Incus container reached via an ssh-config alias).

Systems without entries are silently dropped. To opt in to a platform, add it to the file.

## How a remote lane runs

Per-platform setup nodes ship the target `just` derivation (via `nix-store --export | ssh <host> nix-store --import`) and a `git bundle` of `HEAD` to each remote *once per run*, into a SHA-keyed cache under `~/.cache/ci/`. Every recipe node on that platform `depends_on` the setup node and reuses the cached checkout. Same-SHA reruns skip the bundle+clone entirely.

Remote recipes run as `just --no-deps <recipe>` against the cached checkout. The remote needs `nix`, `git`, and any tools the recipes themselves use — but **not** `just` itself; the runner ships the derivation.

## Runtime artifacts

All under `$PWD/.ci/` (gitignored):

| Path | Contents |
| --- | --- |
| `.ci/pc.log` | process-compose's combined event log |
| `.ci/pc.sock` | Unix domain socket the central observer subscribes to |
| `.ci/worktree/` | git worktree pinned to HEAD (strict mode only) |
| `.ci/<short-sha>/<platform>/<recipe>.log` | one log file per node |

The GitHub status `description` embeds the log path — a red check links straight to the failing log.

## Modes

| Mode | Trigger | Working tree | Status posts |
| --- | --- | --- | --- |
| Local | `CI` unset | live worktree | none |
| Strict | `CI=true` | git worktree pinned to HEAD | per state transition (`pending` → `success`/`failure`) |

Strict mode refuses to run on a dirty tree — the SHA on the green check must match the bytes tested.

## Adding a step

1. Add a leaf recipe to `mod.just` (platform-neutral — every recipe runs on every pipeline platform until the per-recipe OS filter lands upstream).
2. Add the recipe name to `default`'s dependency list.
3. The next pipeline run will emit `ci::<recipe>@<platform>` status checks; add them to branch protection if they should gate merges.

## Files

- [`mod.just`](./mod.just) — pipeline definition.
- [`smoke.sh`](./smoke.sh) — runtime smoke test invoked by `just smoke` / `ci::smoke`. Boots the packaged Kolu and hits `/api/health`.
