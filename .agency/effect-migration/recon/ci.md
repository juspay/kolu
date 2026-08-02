# "/ci full green" — complete map (kolu, branch `effect`)

## 0. The one-line answer

CI = **odu** expanding the `[metadata("ci")]` recipe `default` in `/home/srid/code/kolu/.worktrees/effect/ci/mod.just` into `(recipe × platform)` nodes, on **both** `x86_64-linux` and `aarch64-darwin`, posting one GitHub commit status per `ci::<recipe>@<platform>`. Authoritative required-context list: `just ci::protect --dry-run` (never omit the two `--platform` flags).

---

## 1. Lanes / recipes

All in `/home/srid/code/kolu/.worktrees/effect/ci/mod.just`. `set working-directory := '..'` (line 22) so bodies run from repo root. `nix_shell` (line 29) re-enters `nix develop` when not already inside one.

### DAG root (line 68)
```
default: nix agent-flake-nix agent-bake website-nix website-pnpm-hash-fresh
         surface-examples-nix solid-browser-example-nix odu-nix home-manager
         e2e e2e-governance dev-smoke smoke fmt biome unit daemon
         upgrade-window surface-example-build surface-app-example-build
         pnpm-hash-fresh atlas-sync
```
Tagged `[linux]` **and** `[macos]` → every reachable recipe fans out on both platforms. `install` is reachable as a dependency, so it is also a node. ≈23 recipes × 2 platforms ≈ 46 status contexts.

| Recipe | Deps | What it runs | Notes |
|---|---|---|---|
| `install` | — | `just _materialize-osfacts-client` then `pnpm install --frozen-lockfile` | **The single pnpm install per lane.** Every downstream pnpm consumer depends on it and calls pnpm directly with `--no-deps`; two concurrent `pnpm install`s corrupt `node_modules/.bin` (vitest exit 126). |
| `nix` | — | `bash ci/flake-build .` + `nix flake check --no-build -L` | The big one. Builds **every** `packages.<sys>.*`, `checks.<sys>.*`, `devShells.<sys>.*` of the root flake, discovered dynamically. Includes `checks.*.typecheck`, and `packages.default` which itself *depends on* the typecheck derivation. Shared prerequisite of nearly everything. |
| `agent-flake-nix` | `nix` | `nix build .#agent-flake-source`, then `nix eval …drvPath` for every package in `nix/agent-packages.json` `.expose[]` | Only gate on the exposed remote-agent attrs. |
| `agent-bake` | `nix` | `just --no-deps test-agent-bake` (justfile:235) | Proves the `agent_bake` env snippet exports and reaches a child; asserts `dev`/`server` bake once, `_dev-parallel` zero times. |
| `website-nix` | `nix` | `ci/flake-build --kinds packages,checks ./website` + `nix flake check ./website` | Separate Astro subflake, **separate pnpm workspace + separate lockfile**. |
| `website-pnpm-hash-fresh` | `website-nix` | `nix build ./website#pnpm-deps --no-link` then `nix build --rebuild …` | FOD hash gate for `website/default.nix:75`. |
| `surface-examples-nix` | `nix` | `ci/flake-build --kinds packages ./packages/surface/example` + flake check | Reuses root `src`/`pnpmDeps`. |
| `solid-browser-example-nix` | `nix` | same for `./packages/solid-browser/example` | |
| `odu-nix` | `nix` | same for `./ci` (builds npins-pinned odu) | |
| `home-manager` | `nix` | `ci/flake-build --kinds checks ./nix/home/example -- --override-input kolu .`; Linux adds `--nixos-toplevels` (NixOS config + service/adoption/upgrade **VM tests**) | Darwin = activation + launchd only. |
| `e2e` | `install`, `nix` | `CUCUMBER_RETRY=$(darwin?2:1) just --no-deps test` | Cucumber + Playwright. See §3. |
| `e2e-governance` | `install` | `just --no-deps test-e2e-governance` → `pnpm test:governance` in `packages/tests` | Append-only Gherkin inventory + coverage ledger. No browser. |
| `dev-smoke` | `install` | `just --no-deps test-dev` → `pnpm test:dev-smoke` (`packages/tests/devSmoke.ts`) | Boots `just dev` on random ports in a real browser, fails on any console error. **Only** check exercising Vite's untree-shaken DEV module graph. Deliberately has **no** `nix` dep. |
| `smoke` | `nix` | `bash .apm/skills/ci/smoke.sh` | Boots packaged `.#default`, checks `/api/health`, `KOLU_STATE_DIR` honoring, and that a hosted terminal has node/npm/npx/corepack. |
| `fmt` | `install` | `just _fmt-check` → `biome format . && nixpkgs-fmt --check <nix_format_paths>` | `nix_format_paths` at justfile:7. |
| `biome` | `install` | `biome lint --error-on-warnings .` | **Any warning is a failure.** |
| `unit` | `install` | `just --no-deps test-unit` → `pnpm -r --filter=!osfacts-client --workspace-concurrency=1 test:unit` | Fork-free; daemon suites gated OFF. |
| `daemon` | `install`, `unit` | `just --no-deps test-daemon` → same but `KOLU_DAEMON_TESTS=1 KOLU_DAEMON_BIND_PID=$$` | Serialized after `unit` (concurrent trees got SIGKILLed). |
| `upgrade-window` | `install`, `nix` | ls-remote latest `vX.Y.Z` tag → `nix build git+file://$PWD?ref=<tag>#kaval` and `#padi` + current `.#kaval`; refuses if store paths identical; runs `pnpm --filter @kolu/padi exec vitest run src/upgradeWindow/previousRelease.e2e.test.ts` under `KOLU_UPGRADE_WINDOW_REQUIRE=1` | Slowest non-e2e node; builds a whole previous release. |
| `surface-example-build` | `install` | `pnpm --filter "@kolu/surface-example*" build:client` | ~1s |
| `surface-app-example-build` | `install` | `pnpm --filter @kolu/surface-app-example build:client` | ~1s |
| `pnpm-hash-fresh` | `nix` | `nix build .#pnpmDeps --no-link` then `nix build --rebuild .#pnpmDeps --no-link` | **The lockfile↔Nix-hash gate.** See §2. |
| `atlas-sync` | — | `just atlas::check-sync` (`docs/atlas/mod.just`) | Isolated `pnpm install --ignore-workspace`; rebuilds Atlas and fails if committed `docs/atlas/dist/` is stale. |

### Not in the DAG (coordinator-side, unreachable from `default`)
`ci::attach`, `ci::protect`, `ci::pool-ensure`, `ci::pool-status` (mod.just, bottom).

### GitHub Actions (separate from odu)
- `.github/workflows/nix-cache.yml` — on push to master, PR, dispatch; matrix `ubuntu-latest` + `macos-latest`; runs `ci/flake-build` over root/website/examples/ci flakes and pushes closures to `https://cache.nixos.asia/oss` via attic. Warms the cache CI reads.
- `.github/workflows/pages.yml` — website deploy.
- **Code scanning is GitHub "default setup"** (no CodeQL workflow). Query alerts with `?state=open&pr=<n>` — `ref=refs/heads/<branch>` always returns empty and is a false green.

---

## 2. Nix ⇄ pnpm deps: where the hashes live and the exact update procedure

### Two FOD hashes, two lockfiles (three lockfiles total)

| Lockfile | Hash location | Flake attr | CI gate |
|---|---|---|---|
| `/home/srid/code/kolu/.worktrees/effect/pnpm-lock.yaml` (root workspace) | **`nix/workspace.nix:178`** — `hash = "sha256-uwlcP8N5jIrNJ3bhoRrESJUO9kfDmMhU0aOXZuc/o+U=";` inside `pnpmDeps = pkgs.fetchPnpmDeps { … }` (lines 168-180) | `.#pnpmDeps` | `ci::pnpm-hash-fresh` |
| `website/pnpm-lock.yaml` | **`website/default.nix:75`** — `hash = "sha256-x1NKPI1+K37XA10aiJ5flq7TSNQnM4ifdvZ/Y0slDiU=";` | `./website#pnpm-deps` | `ci::website-pnpm-hash-fresh` |
| `docs/atlas/pnpm-lock.yaml` | **none** — Atlas installs at CI time with `pnpm install --ignore-workspace`; no FOD | — | `ci::atlas-sync` |

> **The `/nix-typescript` skill is stale.** It says the hash is in `nix/modules/typescript.nix` — that path does not exist. So do `.claude/skills/be/SKILL.md:61` and `.claude/skills/pierre/SKILL.md:320`. The real location is `nix/workspace.nix:178`.

Both fetchers use `pnpm = pkgs.pnpm-build` (`nix/pnpm.nix` — pnpm_10 wrapped with `npm_config_reporter=append-only` so failures survive into `nix log`) and `fetcherVersion = 3`. The hash is **platform-independent** — regenerate once, on either platform.

### Blast radius when the root hash is stale
Every node that shells out to `nix build` reds simultaneously: `ci::nix`, `ci::pnpm-hash-fresh`, `ci::smoke`, `ci::e2e` (builds `.#koluBin`), `ci::agent-flake-nix`, `ci::agent-bake`, `ci::home-manager`, `ci::upgrade-window`, `ci::website-nix`, `ci::surface-examples-nix`, `ci::solid-browser-example-nix`, `ci::odu-nix` — on both platforms. `just check` never catches it. **Kick the refresh off in the background the instant the lockfile changes.**

### Exact update procedure (root workspace)

```bash
cd /home/srid/code/kolu/.worktrees/effect

# 0. Regenerate the lockfile (from inside the dev shell)
nix develop -c pnpm install          # or: just install
#    -> pnpm-lock.yaml changes

# 1. FORCE a mismatch. Do NOT just re-run `nix build` with the old hash:
#    the store path of an FOD is derived FROM the declared hash, so if that
#    path is already in the local store or substitutable from
#    cache.nixos.asia, `nix build .#pnpmDeps` SUCCEEDS against a hash that no
#    longer matches the lockfile. That is precisely why ci::pnpm-hash-fresh
#    runs two builds with --rebuild.
#    Set the hash to an all-A sentinel (lib.fakeHash) in nix/workspace.nix:178:
sed -i 's|hash = "sha256-[^"]*";|hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";|' nix/workspace.nix
#    (edit by hand if you prefer — line 178 only; do NOT touch website/default.nix:75)

# 2. Build; read the `got:` line out of the hash-mismatch error.
nix build .#pnpmDeps --no-link -L 2>&1 | tee /tmp/pnpmdeps.log
#    error: hash mismatch in fixed-output derivation '/nix/store/...-kolu-pnpm-deps.drv':
#             specified: sha256-AAAA...
#                got:    sha256-<NEW>

# 3. Paste <NEW> back into nix/workspace.nix:178.

# 4. Verify EXACTLY as CI does (this is the ci::pnpm-hash-fresh body verbatim):
nix build .#pnpmDeps --no-link
nix build --rebuild .#pnpmDeps --no-link
```

Alternative to steps 1-3 if you'd rather not edit twice: `nix build --rebuild .#pnpmDeps --no-link` on the *existing* hash also forces re-execution and prints the mismatch — but only once the path is already realized, and it errors with `outputs … are not valid, so checking is not possible` when it isn't. The fakeHash route is deterministic.

**Website twin** (only if `website/pnpm-lock.yaml` changed — a separate `pnpm install` run inside `website/`):
```bash
# fakeHash website/default.nix:75, then
nix build ./website#pnpm-deps --no-link -L      # read `got:`
# paste back, then verify:
nix build ./website#pnpm-deps --no-link && nix build --rebuild ./website#pnpm-deps --no-link
```
Note `website/default.nix:49-74` injects a full `pnpm.supportedArchitectures` matrix via `prePnpmInstall` so darwin/linux converge on one hash — the root fetcher has no such injection.

### The osfacts graft (bites every fresh checkout)
`osfacts-client` is a declared workspace member (`pnpm-workspace.yaml`, `nix/workspace.nix` `rawMembers`) with **no directory in the repo** — it is grafted from the npins `osfacts` pin. A bare `pnpm install` fails. Both paths do the graft:
- Nix: `nix/workspace.nix` `src = runCommand … cp -r ${osfactsClientSrc} $out/osfacts-client`
- Working tree / CI: `just _materialize-osfacts-client` (justfile:63), which `ci::install` calls first.
It is excluded from `pnpm -r` everywhere via `pnpm_vendored_filter := '--filter=!osfacts-client'` (justfile:22) and the same filter in root `package.json` scripts.

---

## 3. e2e harness (Cucumber + Playwright)

- **Features**: `packages/tests/features/*.feature` — **58 files**, `packages/tests/scenario-inventory.json` records **606 scenario revisions**.
- **Steps/support**: `packages/tests/step_definitions/**/*.ts`, `packages/tests/support/**/*.ts`.
- **Config**: `packages/tests/cucumber.js` (profile `ui`). Default tags `not @skip and not @recording`; darwin additionally `and not @skip-darwin`. Formats: `progress-bar`, `pretty:/dev/stderr`, `html:reports/report.html`, `message:reports/messages.ndjson`.
- **Entry**: `pnpm test` → `node --import tsx governance/runE2e.ts` → spawns cucumber-js, then reduces `messages.ndjson` into `reports/e2e-timing.json` (a failed reduction fails the run).
- **CI invocation**: `ci::e2e` → `just --no-deps test` (justfile:397). Builds `.#koluBin` once, each worker spawns the binary. `ulimit -n 65536`. Cross-run mutex `/tmp/kolu-e2e-suite.lock` (mkdir-atomic, dead-pid steal, 60-min max-wait then proceed unlocked; `KOLU_E2E_LOCK=0` opts out). Worker count: `par = ceil(cores/3)` clamped to `cap` = **8 linux / 6 darwin**; logs `e2e: workers=N (cores=C cap=K)`. `CUCUMBER_RETRY` = 1 linux / 2 darwin.
- **Local/dev**: `just test-quick [features/foo.feature[:LINE]]` (justfile:482) — no nix build, builds client via pnpm, uses `scripts/kolu-source-wrapper.sh`. `CUCUMBER_PARALLEL` env, default 4. `CUCUMBER_RETRY` unset (0) so real failures surface first attempt.
- **Playwright**: browsers come from the `.#e2e` devShell only (`PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers`, flake.nix). `nix_shell_e2e` (justfile:12) keys on `PLAYWRIGHT_BROWSERS_PATH`, not `IN_NIX_SHELL`. `playwright` is pinned `1.59.0` in `packages/tests/package.json`.
- **Timing** (from `docs/ci-e2e-macos-ralph-report.md`): linux ~**8 min**; darwin healthy ~**7.5–13 min**; degraded/piled-up hosts historically 41–60 min. This is the pipeline's critical path together with `ci::nix`.
- **No ssh lane in CI** — `just e2e-ssh` / `e2e-ssh-2box` are pu-box-only.

### e2e governance (`ci::e2e-governance`) — a real migration hazard
`packages/tests/governance/check.ts` parses the live Gherkin suite and compares it against `packages/tests/scenario-inventory.json` (append-only, schemaVersion 1, 606 records) and `packages/tests/coverage-ledger.yaml` (schemaVersion 2). Any scenario revision that *disappears* requires a landed ledger retirement row naming replacement tests (file + test name + lane + platforms + review evidence), and `validateCollectedTests` asserts those named tests are actually collected. **If the Effect migration renames/edits/deletes any scenario text, this node reds** and you must run `pnpm inventory:update` + author ledger rows.

---

## 4. Unit test layout

- **Runner**: vitest `^4.1.0`, declared once at the root (`package.json` devDependencies). **24 per-package `vitest.config.ts`** files: client, vazhi, surface-map, surface-app, xterm-kit, kolu-cli, kaval, surface-remote, kaval-tui, surface-daemon-supervisor, port-forward, solid-pwa-install, solid-browser, surface-mcp, solid-pierre, solid-markdown, surface, padi, surface-daemon, integrations/{claude-code,git,pty}, solid-browser/example/docsite, surface/example/mini-ci. There is **no** root vitest config or workspace file.
- **Invocation**: `just test-unit` → `pnpm -r --filter=!osfacts-client --workspace-concurrency=1 test:unit`. Root `package.json` `test:unit` carries the same filter for pnpm-entry callers.
- **Packages with a `test:unit` script (46)**: `@kolu/artifact-sdk`, `kolu-client`, `kolu-common`, `@kolu/daemon-test-gate`, `@kolu/heap-diag`, `anyagent`, `anyforge`, `kolu-claude-code`, `kolu-codex`, `kolu-github`, `kolu-git`, `kolu-grok`, `kolu-io`, `kolu-opencode`, `kolu-pty`, `kaval`, `kaval-tui`, `kolu-cli`, `kolu-mcp`, `memorable-names`, `@kolu/padi`, `padi-tui`, `@kolu/port-forward`, `@kolu/serve-dir`, `kolu-server`, `kolu-shared`, `@kolu/shell-quote`, `@kolu/solid-browser-example-docsite`, `@kolu/solid-browser`, `@kolu/solid-markdown`, `@kolu/solid-pierre`, `@kolu/solid-pwa-install`, `@kolu/solid-statepip`, `@kolu/surface-app`, `@kolu/surface-daemon`, `@kolu/surface-daemon-supervisor`, `@kolu/surface-example-mini-ci`, `@kolu/surface-map`, `@kolu/surface-mcp`, `@kolu/surface`, `@kolu/surface-remote`, `@kolu/terminal-protocol`, `terminal-themes`, `@kolu/terminal-vocab`, `kolu-transcript-core`, `@kolu/url-shape`, `vazhi`, `@kolu/xterm-kit`, plus `packages/tests` (node:test, not vitest: `node --import tsx --test support/scenarioSetupRetry.test.ts governance/*.test.ts`).
- **No `test:unit`**: `@kolu/html-escape`, `@kolu/log`, `nonempty`, `@kolu/solid-fileview`, `@kolu/theme`, `kolu-transcript-html`, `@kolu/surface-app-example`, the surface example packages.
- **Daemon-gated suites**: `describeDaemon` keys on `KOLU_DAEMON_TESTS`; `@kolu/daemon-test-gate` owns the gate. `packages/daemon-test-gate/src/daemon-node.test.ts` **reads `ci/mod.just` and asserts a `daemon:` target exists in `default:`** — editing the DAG breaks a unit test. Same pattern in `packages/padi/src/upgradeWindow/ciRecipe.watchdog.test.ts` for `upgrade-window`.
- **Typecheck** is *not* in the unit lane: it is `pnpm typecheck` (`pnpm -r --filter=!osfacts-client typecheck`) run inside a **Nix derivation** (`nix/pnpm-typecheck.nix`), which is a **build input of the `kolu` package** in `default.nix:317-320`. So a type error fails `nix build .#default` / `.#padi` / `.#koluBin` and every wrapper — cascading into `ci::nix`, `ci::smoke`, `ci::e2e`, `ci::home-manager`, `ci::upgrade-window`, `ci::agent-*`. It is also exposed as `checks.<sys>.typecheck` (flake.nix).

---

## 5. The odu front door (how CI is actually invoked)

Mandated by `.apm/skills/ci/SKILL.md` (mirrored at `.claude/skills/ci/SKILL.md`), with runner mechanics in `.claude/skills/odu/SKILL.md`.

**Never `just ci`.** A request to run CI is a request to drive odu, through the MCP server (`.mcp.json` wires `odu mcp`).

```
mcp__odu__run          platforms=["x86_64-linux","aarch64-darwin"]
mcp__odu__wait_for_settle   (fail_fast defaults true; expected_sha to hard-check identity)
ReadMcpResourceTool    surface://collections/logs/ci::<recipe>@<platform>
mcp__odu__node_rerun   (close a red check)
mcp__odu__lease / release   (hold one hot box across reruns)
mcp__odu__cancel / node_cancel / lane_cancel / runs
```

### Hard rules the ci skill mandates
1. **Banned flags — never `--no-post`, `--no-strict`, `--no-snapshot`.** CI here is always strict and always posts commit statuses.
2. **Push before CI.** Remote lanes `git fetch` the pushed SHA; unpushed commits cannot run.
3. **Merge `origin/master` before every run** (skip only if `git merge-base --is-ancestor origin/master HEAD`). Never merge while a review gauntlet round is mid-commit. `website/src/content/changelog/unreleased.mdx` is `merge=union` and never conflicts.
4. **Both platforms, pinned explicitly.** A platform you don't name silently drops; a named platform with no pool entry is *refused* loudly. Confirm the settled run actually carried both.
5. **Fail-fast, don't drain.** `wait_for_settle` returns the instant a node reds (`fail_fast_tripped: true`, `settled: false` — a floor, not the final tally). `passed: true` only from a fully settled run. Don't poll `gh pr checks` in a loop.
6. **`errored` ≠ `failed`.** `errored` = infrastructure death (ssh drop / coordinator interrupt) → `node_rerun`, don't hunt a test bug.
7. **Post e2e evidence** after a two-platform green: one PR comment containing `<!-- kolu-ci-e2e-metrics -->` with `sha7#seq` and a `platform · host · workers · cores · cap · duration` table, sourced from `.ci/<sha7>/runs/<seq>.json` and the last `^e2e: workers=` line in `.ci/<sha7>/<platform>/ci::e2e.log`. Edit the existing marker comment, don't spam.
8. **Green gate** = every context from `just ci::protect --dry-run` green per `gh pr checks`, **plus** zero open code-scanning alerts queried by `?state=open&pr=<n>` (branch-ref queries are always empty = false green).
9. Owed cleanup noted in mod.just: four stale `ci::osfacts…@…` contexts still in `required_status_checks` that nothing posts — re-run `just ci::protect` (non-dry-run) to drop them.

### Venue pools
- Host config resolution: `$ODU_HOSTS` (a **file path** — inline JSON is silently ignored) → `~/.config/odu/hosts.json` → `~/.config/justci/hosts.json`. Inspect with `nix run ./ci#odu -- hosts`.
- **linux**: fixed pool `kolu-ci-1 … kolu-ci-8` of long-lived warm Incus boxes. odu leases natively (remote `flock` via odu-runner, heartbeated over ssh), releases on settle/agent death. Pool saturated → waits in line by default; `no_wait: true` fails immediately. Maintenance: `just ci::pool-ensure` / `just ci::pool-status` (`.apm/skills/ci/pu/pool.sh`, size via `KOLU_CI_POOL`, default 8).
- **darwin**: read the box name **verbatim from `hosts.json`** — the skill has been stale three times. Ask the coordinator before every darwin dispatch (single-tenant). A dead pool entry silently degrades the whole darwin lane. Companion-repo darwin lanes use `--host aarch64-darwin=<box>`, never inline `$ODU_HOSTS`.
- `pu` misbehavior → `.apm/skills/ci/pu/diagnose.sh <stage> <host>` posts to juspay/kolu#1204; never blocks the run.

---

## 6. What CI pins about dependency choices — the Effect-migration checklist

### Lockfile / install
- `ci::install` uses **`pnpm install --frozen-lockfile`** (`ci/mod.just:60`). Lockfile must be committed and exactly consistent with every `package.json`.
- Root `package.json` `pnpm.onlyBuiltDependencies` = **only** `@parcel/watcher`, `esbuild`, `node-pty`. Any new dep needing a postinstall build script will silently not run it.
- Root `package.json` `pnpm.overrides` pins ~20 transitive versions (esbuild, hono, yaml, picomatch, `@anthropic-ai/sdk`, xterm betas…). Effect brings its own transitive graph; watch for override conflicts.
- `pnpm-workspace.yaml` `packageExtensions` marks React peers optional for `@pierre/*`.
- Current dependents to migrate: **`zod ^4.3.6`** in ~20 packages (padi, server, surface, surface-map, surface-app, surface-mcp, surface-daemon, common, transcript-core, integrations/{git,grok,anyagent}, surface-app/example, …); **`@orpc/*` ^1.13.13** in client, padi, server, surface, surface-map, surface-remote, surface-daemon, xterm-kit, common, surface-app/example. Every one of those `package.json` edits moves `pnpm-lock.yaml` → moves the root FOD hash (§2).

### Biome (`biome.jsonc`, run as `biome lint --error-on-warnings .`)
`linter.domains.project: "all"` (type-aware scanner). Rules that will most likely fight Effect idioms:
- `suspicious/noImportCycles: "error"` — **the biggest risk.** Effect Schema class-based / mutually-referential schemas and `Context.Tag` service graphs commonly produce circular module edges.
- `nursery/noFloatingPromises: "error"` and `nursery/noMisusedPromises: "error"` — any unawaited `Effect.runPromise(…)` / `runFork` boundary; Solid `onClick={asyncFn}`.
- `nursery/useExhaustiveSwitchCases: "error"` — `_tag` switches over Effect tagged unions must be exhaustive.
- `suspicious/noExplicitAny` (from `recommended: true`) — currently scoped off **only** for `packages/surface/src/define.ts` (whose comment says "every value flows through **Zod** schemas at the edges" — that comment needs updating). Effect Schema generic plumbing usually needs a new `overrides` entry with a stated reason.
- `style/noRestrictedImports: "error"` bans `@preact/signals-core` outside `packages/surface/src/reactor.ts` and `reactorEngineLaws.test.ts`.
- `performance/useSolidForComponent: "error"` (off for `packages/vazhi/**`, the Ink/React tree).
- Deliberately off: `correctness/useImportExtensions`, `correctness/noUnresolvedImports`, `style/noNonNullAssertion`, `complexity/noImportantStyles`, `suspicious/noControlCharactersInRegex`.
- Because the gate is `--error-on-warnings`, **any** rule promoted in a Biome bump must be fixed-or-explicitly-disabled in the same PR.

### tsconfig strictness (`tsconfig.base.json`, all packages extend it)
```
target/module: ESNext · moduleResolution: bundler · jsx: preserve
strict: true · noUncheckedIndexedAccess: true · isolatedModules: true
skipLibCheck: true · esModuleInterop: true · forceConsistentCasingInFileNames: true
resolveJsonModule · allowImportingTsExtensions · declaration + declarationMap + sourceMap · noEmit
```
Notes for Effect: `strict` is satisfied; **`exactOptionalPropertyTypes` is NOT set** (Effect Schema is happier with it but doesn't require it). `isolatedModules: true` requires `export type` on type-only re-exports — Effect codebases re-export a lot of types. `moduleResolution: "bundler"` handles Effect's `exports` map fine. `skipLibCheck: true` mutes Effect's own `.d.ts` — but *your* usage still type-checks.

### Structural / identity pins
- `nix/workspace.nix` `rawMembers` is the Nix-side workspace index. **INVARIANT: every workspace package with a `typecheck` script must be listed.** Keys are asserted against each `package.json` `name` at eval — a rename fails every `nix eval` loudly. Adding/removing a package requires editing this map.
- `default.nix` `behavioralFileset` / `mkDaemonIdentity` hashes a declared subset of packages into the daemon identity; `@kolu/xterm-kit` and `@kolu/heap-diag` are explicitly excluded. Moving wire-shaped code (oRPC contracts!) between packages can flip the identity key and interact with `ci::upgrade-window`.
- `PTY_HOST_CONTRACT_VERSION` in `packages/kaval/src/ptyHostSurface.ts` gates daemon compatibility; `ci::upgrade-window` boots the previous release's kaval against current padi.
- `packages/surface/src/reactor.ts` is the graph's single exit to the signals engine — enforced by lint, not review.
- `nix flake check --no-build` on root + website + surface example + solid-browser example + ci is a schema/eval gate: a new flake output cannot escape CI (`ci/flake-build` enumerates `attrNames` dynamically).

### Practical migration ordering
1. Change `package.json`s + lockfile → **immediately** background-refresh `nix/workspace.nix:178` per §2 (and `website/default.nix:75` only if `website/pnpm-lock.yaml` moved).
2. `nix develop -c pnpm typecheck` locally (this is what the Nix gate runs).
3. `nix develop -c biome lint --error-on-warnings .` — expect `noImportCycles` and `noExplicitAny` hits; fix or add a scoped `overrides` entry with a written reason.
4. `just test-unit`, then `just test-quick <touched features>`.
5. `just fmt` before declaring done.
6. Push, merge master, then `mcp__odu__run platforms=["x86_64-linux","aarch64-darwin"]` → `wait_for_settle` → drill red logs → `node_rerun`.

## Key file references
- `/home/srid/code/kolu/.worktrees/effect/ci/mod.just` — the DAG (executable source of truth)
- `/home/srid/code/kolu/.worktrees/effect/ci/README.md`, `ci/flake-build`, `ci/flake.nix`
- `/home/srid/code/kolu/.worktrees/effect/justfile` — local entrypoints (`test`:397, `test-quick`:482, `test-unit`:302, `test-daemon`:319, `test-dev`:502, `_fmt-check`:554, `check`:190, `install`:51, `_materialize-osfacts-client`:63)
- `/home/srid/code/kolu/.worktrees/effect/nix/workspace.nix:168-180` — root `fetchPnpmDeps` + **hash line 178**
- `/home/srid/code/kolu/.worktrees/effect/website/default.nix:49-77` — website `fetchPnpmDeps` + **hash line 75**
- `/home/srid/code/kolu/.worktrees/effect/nix/pnpm-typecheck.nix`, `nix/pnpm.nix`, `nix/overlay.nix`, `nix/each-system.nix`, `nix/nixpkgs.nix`
- `/home/srid/code/kolu/.worktrees/effect/flake.nix`, `default.nix:307-320` (typecheck as build input)
- `/home/srid/code/kolu/.worktrees/effect/biome.jsonc`, `tsconfig.base.json`, `package.json`, `pnpm-workspace.yaml`
- `/home/srid/code/kolu/.worktrees/effect/packages/tests/` — `cucumber.js`, `features/`, `governance/`, `scenario-inventory.json`, `coverage-ledger.yaml`, `devSmoke.ts`
- `/home/srid/code/kolu/.worktrees/effect/.apm/skills/ci/SKILL.md` (+ `smoke.sh`, `pu/pool.sh`, `pu/diagnose.sh`), `.claude/skills/odu/SKILL.md`
- Stale docs to fix: `.claude/skills/nix-typescript/SKILL.md`, `.agents/skills/nix-typescript/SKILL.md`, `.claude/skills/be/SKILL.md:61`, `.claude/skills/pierre/SKILL.md:320` all name `nix/modules/typescript.nix`, which does not exist.