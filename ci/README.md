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

### Linux on odu's Cloudflare lane

odu can also run the Linux lane in Cloudflare Containers (4 vCPU / 12 GiB /
20 GB microVMs with `/dev/kvm`). See odu's docs, "Run lanes on Cloudflare
Containers", for `odu cloudflare setup`. Declare eight slots:

```json
{ "x86_64-linux": { "host": "cloudflare", "slots": 8 } }
```

The primary container runs every unsharded node. `e2e` and `home-manager`
(`odu:shard=3`) and `upgrade-window` (`odu:shard=1`) each take their own
containers, which keeps the primary's store and build directories inside 18 GB.
A pool without spare slots runs everything in place, as before.

A lane container runs as root and holds nothing but Nix, so kolu supplies what
its recipes need:

- **Default shell (Linux):** `procps` and `hostname`.
- **e2e shell:** `ncurses` (`clear`) and a baked `FONTCONFIG_FILE`; Chromium
  aborts without a fontconfig config.
- **Recipe bodies** that run before `nix develop` use only bash, git and
  coreutils.
- **e2e steps type ASCII only.** Without a UTF-8 locale or an inputrc,
  readline scrambles typed non-ASCII, so a painted glyph travels as a
  `printf %b` octal escape (`packages/tests/support/asciiTyping.ts`).
- **Root:** tests that rely on file modes skip as root, and a uid-independent
  twin covers the same rule.
- **NixOS VM tests** set `virtualisation.qemu.forceAccel`: they run under KVM
  or fail, and never fall back to TCG.
- **Sharding:** a sharded `ci/flake-build` boots its VMs one at a time.
- **Cache:** `nix-cache.yml` warms every subflake a CI node builds, including
  the two examples, so a cold container substitutes instead of building.

When an agent-indicator scenario fails, its error carries the detector's
inputs: the process tree, tty paths, breadcrumbs, the screen tail kaval holds,
and padi's log lines. A failing worker also prints its detector log lines.

Each container starts with an empty Nix store, so a full Linux run is slower
than on a warm pool host (about 20 min with every node green, measured in
juspay/kolu#2282).

## Pipeline nodes

The [`default` recipe](./mod.just) is the executable inventory of required
nodes. Do not copy that membership into documentation: odu expands the recipes
reachable from that root, applies the platform attributes in the same file, and
uses the resulting set for protected statuses.

The DAG groups work by responsibility:

- Nix and packaging recipes build the root flake, independent subflakes,
  package hashes, smoke targets, and upgrade windows.
- Code-quality recipes own formatting, linting, unit/daemon coverage, and the
  osfacts checks.
- Browser recipes own end-to-end behavior and its append-only governance
  ledger.
- Living-documentation and example recipes prove Surface examples remain
  buildable and the rendered outputs stay synchronized.

For the exact current membership and dependency edges, inspect
[`ci/mod.just`](./mod.just); local entry points and their dependency-bearing
wrappers live in the root [`justfile`](../justfile).

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
