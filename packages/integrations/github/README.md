# kolu-github

The gh adapter for [`anyforge`](../anyforge/README.md)'s `PrProvider` contract — `gh pr view` spawn, stderr classification, CI-rollup derivation. Exports `githubPrProvider`, the registry entry the server dispatches to.

## Modules

| Module       | Exports                                                 | Purpose                                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------ |
| `github.ts`  | `deriveCheckStatus`, `extractChecks`, `classifyGhError` | Pure helpers — no I/O                                         |
| `resolve.ts` | `resolveGitHubPr`, `githubPrProvider`                   | `gh pr view` spawn (Node), failure classification + logging   |

The wire vocabulary (`PrInfoSchema`, `PrResultSchema`, the `Gh*` unavailable codes) and the generic poll loop (`subscribePr`) live in `anyforge` — this package only produces those shapes. Browser code imports `anyforge/schemas`; nothing browser-bound should import this package.

## Server integration

`startPrProvider` (`packages/server/src/terminalBackend/providers.ts`) runs anyforge's `subscribePr` with a `ForgeKind → PrProvider` registry; each resolve dispatches on `detectForge(remoteUrl)`, and `githubPrProvider` is the github entry (and the fallback for unregistered kinds). `KOLU_GH_BIN` is pinned by Nix in `nix/env.nix` and read lazily by `resolve.ts` (first call, not module load).

## Stderr fragility

`classifyGhError` pattern-matches gh CLI stderr strings (`"not logged in"`, `"authentication"`, `"no pull requests found"`, `"point to a known github host"`). gh's error messages are not versioned — a wording change across major versions silently falls through to `"unknown"`. The parametrized table tests in `github.test.ts` pin the current strings and are the regression tripwire.
