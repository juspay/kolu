# kolu-github

The gh adapter for [`anyforge`](../anyforge/README.md)'s `ForgeAdapter` contract — `gh pr view` spawn, stderr classification, CI-rollup derivation. Exports `githubForgeAdapter: ForgeAdapter<GhUnavailableSource>`, the adapter the server injects into `subscribePr`.

## Modules

| Module       | Exports                                                              | Purpose                                                          |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `schemas.ts` | `GhUnavailableCodeSchema`, `GhUnavailableSchema`, `reasonForGhCode`  | The **gh-specific** failure vocabulary (browser-safe: zod only)  |
| `github.ts`  | `deriveCheckStatus`, `extractChecks`, `classifyGhError`             | Pure helpers — no I/O                                            |
| `resolve.ts` | `resolveGitHubPr`, `githubForgeAdapter`                             | `gh pr view` spawn (Node), failure classification + logging      |

The **neutral** wire shapes (`PrInfoSchema`, the generic `PrResult<S>`) and the poll loop (`subscribePr`) live in `anyforge`; the **closed** `PrUnavailableSource` union and the wire `PrResultSchema` compose in `kolu-common` (alongside `AgentInfoSchema`). This package owns only the gh arm — its codes and reason text — mirroring how `kolu-claude-code` owns `ClaudeCodeInfoSchema`. Browser code that needs the gh codes imports `kolu-github/schemas` (zod-only, no `node:` / `KOLU_GH_BIN`); nothing browser-bound should import the package root.

## Server integration

`startPrSensor` (`packages/terminal-workspace/src/sensors.ts`) wires anyforge's `subscribePr` to a dispatching `ForgeAdapter` that routes each resolve through the `FORGE_ADAPTERS` registry keyed by `detectForge(remoteUrl)`. Most hosts resolve here (`gh` handles github.com and GitHub Enterprise), but a recognized non-GitHub forge — `codeberg.org` today — maps to the `unsupported` arm instead, so it never reaches `gh` (a Forgejo repo can't have a GitHub PR; asking `gh` only produces log noise, kolu#1627). `KOLU_GH_BIN` is pinned by Nix in `nix/env.nix` and read lazily by `resolve.ts` (first call, not module load). A second forge (kolu#1240 phase 1) adds a `FORGE_ADAPTERS` entry and re-points the `detectForge` arm from `unsupported` to its adapter; this adapter is unchanged.

## Stderr fragility

`classifyGhError` pattern-matches gh CLI stderr strings (`"not logged in"`, `"authentication"`, `"no pull requests found"`, `"point to a known github host"`). gh's error messages are not versioned — a wording change across major versions silently falls through to `"unknown"`. The parametrized table tests in `github.test.ts` pin the current strings and are the regression tripwire.
