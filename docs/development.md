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

Each server port owns an isolated development slot: its own padi state, kaval
daemon, and runtime directory. A development instance cannot adopt or stop the
daemons used by a production service.

`just dev` / `just dev-auto` (and the standalone `just server`) also materialise
`.#agent-flake-env` and export `SURFACE_AGENT_FLAKE_REF` — the same bake the
production Nix wrapper applies — so you can add remote hosts from a working-tree
run without switching to `nix run .#kolu`. Nix reads the **git-tracked** tree, so
an uncommitted edit to a tracked file is baked in, but a brand-new file must be
`git add`ed before a dialed remote will see it. The bake resolves once at start,
so restart whichever entrypoint you are running — `just dev` or `just server` —
after editing agent-tree source.

The default `just dev` slot is shared across worktrees. If another worktree
already owns it, this checkout connects to that slot's existing daemons. Prefer
`just dev-auto` when working in parallel.

## Reset a development slot

Stop the slot's padi and kaval processes and remove its development state:

```sh
just dev-clean
```

For a custom server port:

```sh
just dev-clean 7700
```

This permanently removes only the selected development slot. It does not touch
a packaged or home-manager kolu service.

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
