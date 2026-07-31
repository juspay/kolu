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
nix run ./ci#odu -- run
```

Only odu posts GitHub commit statuses. Add its live NDJSON feed when another
tool is supervising the run:

```sh
nix run ./ci#odu -- run --progress json
```

Attach a terminal dashboard to a run already in progress:

```sh
nix run ./ci#odu -- attach
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
| Nix and packaging | `nix`, `agent-flake-nix`, `website-nix`, `website-pnpm-hash-fresh`, `surface-examples-nix`, `solid-browser-example-nix`, `odu-nix`, `home-manager`, `smoke`, `dev-smoke`, `pnpm-hash-fresh`, `upgrade-window` |
| Code quality | `fmt`, `biome`, `unit`, `daemon`, `osfacts`, `osfacts-live` |
| Browser behavior | `e2e`, `e2e-governance` |
| Living docs and examples | `surface-example-build`, `surface-app-example-build`, `atlas-sync` |

`nix` builds every runnable-Kolu flake output for the lane's system and runs
that flake's evaluation gate. The independent website, Surface examples, Solid
Browser example, and Odu flakes are separate nodes. `home-manager` builds its
own example flake: Darwin checks activation and launchd configuration, while
Linux builds the NixOS configuration and runs its VM tests. Workspace
typechecking is a flake check, so `nix build .#default` alone is not a type
proof: Vite and `tsx` transpile without checking types.

The `daemon` node is separate from `unit` because it forks real padi and kaval
processes. Keeping it explicit prevents the default-off daemon suites from
silently disappearing from CI.

## Critical path

The large `nix` build is the shared prerequisite for every later node that
invokes `nix build`. Their commands remain self-contained, but start from a
warmed store instead of running several Nix builds at once:

```text
                   ┌─ website-nix ─ website-pnpm-hash-fresh
                   ├─ surface-examples-nix
                   ├─ solid-browser-example-nix
                   ├─ odu-nix
setup ─── nix ─────├─ home-manager (Darwin checks / Linux VM tests)
                   ├─ e2e
                   ├─ smoke
                   └─ pnpm-hash-fresh
```

This lengthens the critical path but lowers peak CPU, memory, and Nix-store
contention.

## Change the pipeline

Edit [`mod.just`](mod.just). Odu respects just's OS attributes, but a
cross-platform product gate such as `home-manager` should remain one node and
select its platform-specific proof inside the recipe.

The `install` node is the single pnpm installation for a lane. Downstream pnpm
consumers must depend on it and invoke pnpm directly; concurrent installs can
corrupt the shared `node_modules`.

After changing the DAG, inspect the required status contexts for both platforms:

```sh
just ci::protect --dry-run
```
