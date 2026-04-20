# kolu-github

GitHub PR resolution — Zod schemas, gh-error classifier, CI-status deriver. Pure leaf package (deps: zod + ts-pattern).

## Modules

| Module       | Exports                                                                                   | Purpose                                                         |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `schemas.ts` | `GitHubPrInfoSchema`, `PrResultSchema`, `PrUnavailableSourceSchema`, `reasonForSource`, … | Zod schemas + provider-neutral `PrResult`                       |
| `github.ts`  | `deriveCheckStatus`, `classifyGhError`, `prResultEqual`                                   | Pure helpers — no I/O                                           |
| `resolve.ts` | `resolveGitHubPr`, `subscribeGitHubPr`                                                    | `gh pr view` spawn + branch-change watcher with 30s poll (Node) |

## Neutral-vs-gh-specific layout

`PrResult.ok.value` is `GitHubPrInfo`-shaped today. Rather than invert the package dep direction (`kolu-common` → `kolu-github` would become circular), the provider-neutral scaffolding (`PrResult`, `PrUnavailableSourceSchema`, `reasonForSource`, extractors) lives in this package alongside the gh-specific schemas. When a second provider (`bkt`) lands — [srid/agency#10](https://github.com/srid/agency/issues/10) — promote the neutrals to their own leaf (or to `kolu-common`) and have each provider package import them. The FUTURE box in `packages/server/src/meta/github.ts` sketches the `PrProvider` interface the dispatch will take.

## Server integration

The server's `meta/github.ts` is a thin adapter around `subscribeGitHubPr`:

1. Calls `subscribeGitHubPr(onChange, log)` — the integration owns the `gh pr view` spawn, branch-change dedup, pending-on-branch-change emission, the 30s polling loop, and failure classification/logging.
2. On each terminal's `git:` channel emit, calls `watcher.setGit(repoRoot, branch)` — the integration handles dedup internally.
3. On `onChange`, publishes the resolved `PrResult` into terminal metadata via `updateServerMetadata`.

`KOLU_GH_BIN` is pinned by Nix in `nix/env.nix` and read lazily by `resolve.ts` (first call, not at module load — so browser bundles that reach through `kolu-common/pr` don't blow up on `process.env` access).

## Consumer imports

- Server & non-browser code: `import { … } from "kolu-github"` directly, or via `kolu-common` re-exports.
- Browser code: `import { … } from "kolu-common/pr"` — subpath re-export that avoids dragging `kolu-claude-code` → `@anthropic-ai/claude-agent-sdk` (Node-only) into the browser bundle.

## Stderr fragility

`classifyGhError` pattern-matches gh CLI stderr strings (`"not logged in"`, `"authentication"`, `"no pull requests found"`). gh's error messages are not versioned — a wording change across major versions silently falls through to `"unknown"`. The parametrized table tests in `github.test.ts` pin the current strings and are the regression tripwire.
