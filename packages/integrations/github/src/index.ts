/** kolu-github — the gh adapter for anyforge's `ForgeAdapter` contract.
 *
 *  Spawns `gh pr view` (via `KOLU_GH_BIN`), classifies its failures, and
 *  derives the check rollup. The forge-neutral wire schemas, poll loop, and
 *  remote-host grammar live in `anyforge`; host-to-forge detection lives in
 *  the sensor layer (`@kolu/terminal-awareness`). This package never sees its
 *  sibling adapters. */

export { classifyGhError, deriveCheckStatus, extractChecks } from "./github.ts";
export { githubForgeAdapter, resolveGitHubPr } from "./resolve.ts";
