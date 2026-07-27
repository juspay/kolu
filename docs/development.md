# Developing kolu

This guide gets a local checkout running, keeps it isolated from other kolu
instances, and names the checks to run before opening a pull request.

## Prepare the checkout

kolu uses Nix for the toolchain and pnpm for the TypeScript workspace.

```sh
nix develop
just prepare
```

`just prepare` installs the workspace dependencies and warms the caches used by
the other recipes.

## Start a development instance

Use random free ports when another kolu instance or worktree may already be
running:

```sh
just dev-auto
```

The recipe prints the server and Vite URLs. The client has hot reload.

For the canonical development ports, use:

```sh
just dev
```

This serves kolu on `127.0.0.1:7681` and the Vite client on
`127.0.0.1:5173`. To choose both ports explicitly:

```sh
just dev 7700 5180
```

Each **worktree** owns an isolated development instance. Its padi anchors at
`<worktree>/.kolu-dev/padi`, and that path is padi's identity: the socket, the
kaval, and the supervisor gate are all keyed by a digest of it. So two worktrees
never share daemons, and a development instance can neither adopt nor stop the
daemons used by a production service.

The port is a separate axis, and it is not what isolates you: two worktrees on
the same port collide on the port alone. Use `just dev-auto` when working in
parallel — it picks two free ports.

## Reset a development instance

Remove this worktree's development state and stop the daemons it anchored:

```sh
just dev-clean
```

Because the state root *is* the identity, deleting it makes those daemons stale
by definition, and the sweep below collects them. `dev-clean` never touches a
packaged or home-manager kolu service, whose state root is still present.

## Collect stranded daemons

padi is detached: it outlives the `just dev` that spawned it and has no idle
timeout. Removing a worktree with `git worktree remove` therefore strands its
padi and kaval forever — they hold PTYs and a few hundred MB each, and nothing
notices. To sweep every padi on this host whose state root is gone:

```sh
just dev-reap
```

A padi whose state root still exists is never a candidate, so this is safe to
run at any time.

## Run checks

| Command | Purpose |
| --- | --- |
| `just fmt` | Format TypeScript, Markdown, and Nix files in place. Run this before committing. |
| `just check` | Run workspace typechecking and Biome lint. |
| `just test-unit` | Run the fork-free unit-test suite, safe beside a live kolu. |
| `just test-quick` | Build from source and run the end-to-end suite on random ports. Accepts a feature file or scenario line. |
| `just test` | Build the Nix package and run the full end-to-end suite. |
| `just ci` | Run the local, single-platform form of the CI pipeline. |

For example, run one end-to-end feature while iterating:

```sh
just test-quick features/command-palette.feature
```

`just test-daemon` forks real padi and kaval daemons in bulk. It is intended for
CI or a disposable test host, not a workstation running a production kolu.

The canonical multi-platform pipeline, its nodes, and the commands for
attaching to a live run are documented in [kolu CI](../ci/README.md).

## Work on the website

The website has its own authoring and validation workflow:

```sh
just website::dev
just website::check
just website::nix-build
```

See the [website README](../website/README.md) for content locations,
frontmatter, search, changelog entries, and deployment.
