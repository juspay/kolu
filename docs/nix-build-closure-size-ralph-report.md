# Ralph Report: `nix build` Closure Size Optimization

## Target

Reduce the runtime closure of `nix build .#default` without changing Kolu's
application behavior.

## Methodology

- **Measurement:** `nix path-info -S "$(nix build .#default --no-link --print-out-paths)"`
- **Breakdown:** `nix path-info -r --json` plus `nix why-depends`
- **Machine:** x86_64-linux, Nix 2.31.3
- **Unit:** exact NAR closure bytes. Unlike elapsed time, a realized store graph's
  closure size is deterministic, so repeated samples would be identical.

## Results

|                    | Bytes         | Display size |
| ------------------ | ------------- | ------------ |
| **Baseline**       | 1,351,008,904 | 1.3 GiB      |
| **Final**          | 696,462,408   | 664.2 MiB    |
| **Improvement**    | 654,546,496   | 48.4%        |

## Baseline Findings

- The built workspace is 274 MiB as a NAR and appears twice in the closure.
  `kolu-stamped` copies the whole workspace solely to replace the commit
  placeholder in `packages/client/dist/index.html`.
- The workspace contains about 23 MiB of client output and 320 MiB on disk of
  pnpm packages.
- The closure also contains two Node.js major versions and substantial
  Nix/Git/Python tool closures. These need separate attribution after removing
  the obvious duplicate.

## Optimization Log

| Cycle | Change | Before | After | Delta | Kept? |
| ----- | ------ | ------ | ----- | ----- | ----- |
| 1 | Link immutable client files; copy and stamp only `index.html` | 1,351,008,904 | 1,064,463,240 | -286,545,664 (-21.2%) | Yes |
| 2 | Use a Node-24-backed TSX package so the closure carries one Node major | 1,064,463,240 | 964,649,168 | -99,814,072 (-9.4%) | Yes |
| 3 | Use the same Git 2.53 core via nixpkgs' minimal output | 964,649,168 | 883,921,464 | -80,727,704 (-8.4%) | Yes |
| 4 | Keep only node-pty's runtime native module; remove node-gyp metadata | 883,921,464 | 760,435,216 | -123,486,248 (-14.0%) | Yes |
| 5 | Remove remaining compiler, bundler, DOM-test, and dev-runner packages | 760,435,216 | 696,677,968 | -63,757,248 (-8.4%) | Yes |
| 6 | Remove type-only packages and Vazhi-only Ink dependencies from Kolu's shared tree | 696,677,968 | 686,323,424 | -10,354,544 (-1.5%) | Yes |
| 7 | Advance nixpkgs to a Node-24.15 revision compatible with idli and x86_64-darwin; keep pnpm 10 | 686,314,112 | 696,462,408 | +10,148,296 (+1.5%) | Yes |

## Final Largest Paths

These are individual NAR sizes, not marginal closure costs; dependencies shared
by several roots are counted once in the 664.2 MiB total.

| Path | NAR size | Why it remains |
| ---- | -------- | -------------- |
| Production Kolu workspace | 203 MiB | Server, daemons, terminal clients, runtime npm modules, and the client bundle |
| Node.js core | 84 MiB | Executes the TypeScript application and daemons |
| Git minimal | 52 MiB | Repository status, diffs, worktrees, and remote context |
| ICU | 38 MiB | Node.js internationalization |
| GitHub CLI | 39 MiB | PR and forge integration |
| glibc | 33 MiB | Linux runtime |

## Verification

- `just fmt`
- Built `default`, `koluBin`, `kaval`, `padi`, `kaval-tui`, `padi-tui`, and
  `vazhi`
- Built the workspace typecheck derivation and evaluated `nix flake check
  --no-build`
- Ran each shipped CLI far enough to load its packaged TypeScript dependency
  graph
- Loaded the rebuilt node-pty native module under the shipped Node 24.15.0
- `just ci::smoke`: `/api/health` returned 200, SIGTERM shut down cleanly, and
  the production wrapper honored an inherited `KOLU_STATE_DIR`; its hosted
  terminal retained `node`, `npm`, `npx`, and `corepack`
- `nix develop`: 1.325s with `--no-eval-cache`; 0.236s and 0.243s warm

## Investigated Without Improvement

- Splitting the build into pnpm `deploy --prod` outputs would reduce the main
  package tree further, and works from a normal development store. In the Nix
  sandbox, legacy deploy re-resolves unrelated dev dependencies whose registry
  metadata is intentionally absent; injected-workspace deploy consumes the
  lockfile but cannot retrieve the Git-pinned node-pty tarball from
  `fetchPnpmDeps`' package mirror. Both fail offline before producing an output,
  so this iteration was discarded.
- Replacing the aggregate `pkgs.nix` output with its `nix-cli` and `nix-store`
  components saves only about 9 KiB; those components already form essentially
  all of the 158 MiB Nix CLI closure.

## Key Findings

- Stamping one HTML file by copying the whole workspace was the largest single
  avoidable cost. A small symlink tree preserves the cache boundary and removes
  the duplicate bytes.
- Generated node-gyp metadata retained Python and node-gyp even though runtime
  only needs `build/Release/pty.node`.
- The original wrapper graph and nixpkgs' TSX package collectively retained two
  Node majors. The advanced pin builds TSX against Node 22, so Kolu overrides
  only that input with nixpkgs' stock Node 24.15 runtime. The final closure
  carries one Node core, and that Node output is
  substitutable from `cache.nixos.org`; only the small TSX package is rebuilt.
  The full Node 24 toolset remains because hosted terminals inherit its `npm`,
  `npx`, and `corepack` commands.
- The remaining large external tools are tied to Kolu features: Nix and SSH
  provision remote agents, Git supplies repository behavior, and `gh` supplies
  forge behavior. Removing them would change the application contract rather
  than optimize its packaging.
