# kolu CI

kolu's CI is a two-platform pipeline driven by
[odu](https://github.com/juspay/odu). The executable source of truth is
[`mod.just`](mod.just): its `default` recipe defines the DAG, and odu expands
each reachable recipe into Linux and macOS nodes.

## Run it

Run the pipeline locally on the current platform:

```sh
just ci
```

Run one recipe without posting GitHub statuses:

```sh
just ci::e2e
```

Run the canonical multi-platform pipeline:

```sh
nix run .#odu -- run
```

Only odu posts GitHub commit statuses. Add its live NDJSON feed when another
tool is supervising the run:

```sh
nix run .#odu -- run --progress json
```

Attach a terminal dashboard to a run already in progress:

```sh
nix run .#odu -- attach
# or
just ci::attach
```

## Platforms and hosts

Every reachable recipe runs on:

- `x86_64-linux`
- `aarch64-darwin`

Lane hosts come from `$ODU_HOSTS`, then `~/.config/odu/hosts.json`, with
`~/.config/justci/hosts.json` accepted as the legacy location. A localhost lane
runs against the current checkout. A remote lane fetches the pushed commit into
its own workspace.

Linux runs lease an idle warm Incus container from the configured venue pool.
Odu owns the lease for the life of the run and releases it when the run ends.
The coordinator-side maintenance commands are:

```sh
just ci::pool-status
just ci::pool-ensure
```

## Pipeline nodes

The current DAG covers four kinds of work:

| Area | Required nodes |
| --- | --- |
| Nix and packaging | `nix`, `flake-check`, `home-manager`, `smoke`, `pnpm-hash-fresh` |
| Code quality | `fmt`, `biome`, `unit`, `daemon` |
| Browser behavior | `e2e` |
| Living docs and examples | `surface-example-build`, `surface-app-example-build`, `atlas-sync` |

`nix` builds every flake output for the lane's system, including checks and dev
shells. Workspace typechecking is a flake check, so `nix build .#default` alone
is not a type proof: Vite and `tsx` transpile without checking types.

The `daemon` node is separate from `unit` because it forks real padi and kaval
processes. Keeping it explicit prevents the default-off daemon suites from
silently disappearing from CI.

## Critical path

The large `nix` build remains a required gate, but `e2e`, `smoke`, and
`home-manager` do not wait for it. Each builds only the store path it needs, and
Nix store locking deduplicates the shared work while the branches run in
parallel:

```text
            ┌─ nix ───────────────┐
setup ──────├─ e2e ──────────────┤
            ├─ smoke ─────────────┤── required verdict
            └─ home-manager ──────┘
```

This keeps the roughly two-minute end-to-end suite off the big build's critical
path without weakening the merge gate. The measurements and dependency model
are in the [CI workflow report](../docs/ci-workflow-ralph-report.md).

## Change the pipeline

Edit [`mod.just`](mod.just). Keep leaf recipes platform-neutral: odu currently
replicates every reachable recipe across both platforms.

The `install` node is the single pnpm installation for a lane. Downstream pnpm
consumers must depend on it and invoke pnpm directly; concurrent installs can
corrupt the shared `node_modules`.

After changing the DAG, inspect the required status contexts for both platforms:

```sh
just ci::protect --dry-run
```
