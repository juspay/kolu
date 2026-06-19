/** kolu-github — the gh adapter for anyforge's `ForgeAdapter` contract.
 *
 *  Spawns `gh pr view` (via `KOLU_GH_BIN`), classifies its failures, and
 *  derives the check rollup. The forge-neutral wire schemas, poll loop,
 *  and detection live in `anyforge`; this package never sees its sibling
 *  adapters. */

export { classifyGhError, deriveCheckStatus, extractChecks } from "./github.ts";
export { githubForgeAdapter, resolveGitHubPr } from "./resolve.ts";
