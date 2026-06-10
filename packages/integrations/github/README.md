# kolu-github

The gh adapter for [`anyforge`](../anyforge/README.md)'s `PrProvider` contract — `gh pr view` spawn, stderr classification, CI-rollup derivation. Exports `githubPrProvider: PrProvider<GhUnavailableSource>`, the provider the server injects into `subscribePr`.

## Modules

| Module       | Exports                                                              | Purpose                                                          |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `schemas.ts` | `GhUnavailableCodeSchema`, `GhUnavailableSchema`, `reasonForGhCode`  | The **gh-specific** failure vocabulary (browser-safe: zod only)  |
| `github.ts`  | `deriveCheckStatus`, `extractChecks`, `classifyGhError`             | Pure helpers — no I/O                                            |
| `resolve.ts` | `resolveGitHubPr`, `githubPrProvider`                               | `gh pr view` spawn (Node), failure classification + logging      |

The **neutral** wire shapes (`PrInfoSchema`, the generic `PrResult<S>`) and the poll loop (`subscribePr`) live in `anyforge`; the **closed** `PrUnavailableSource` union and the wire `PrResultSchema` compose in `kolu-common` (alongside `AgentInfoSchema`). This package owns only the gh arm — its codes and reason text — mirroring how `kolu-claude-code` owns `ClaudeCodeInfoSchema`. Browser code that needs the gh codes imports `kolu-github/schemas` (zod-only, no `node:` / `KOLU_GH_BIN`); nothing browser-bound should import the package root.

## Server integration

`startPrProvider` (`packages/server/src/terminalBackend/providers.ts`) injects `githubPrProvider` into anyforge's `subscribePr` — one watcher per terminal, no registry and no detection (there is one forge). `KOLU_GH_BIN` is pinned by Nix in `nix/env.nix` and read lazily by `resolve.ts` (first call, not module load). When a second forge lands (kolu#1240 phase 1), the server gains a `detectForge`-keyed registry; this adapter is unchanged.

## Stderr fragility

`classifyGhError` pattern-matches gh CLI stderr strings (`"not logged in"`, `"authentication"`, `"no pull requests found"`, `"point to a known github host"`). gh's error messages are not versioned — a wording change across major versions silently falls through to `"unknown"`. The parametrized table tests in `github.test.ts` pin the current strings and are the regression tripwire.
