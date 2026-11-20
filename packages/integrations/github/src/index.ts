/** kolu-github — the gh adapter for anyforge's `ForgeAdapter` contract.
 *
 *  This package never sees its sibling adapters: the forge-neutral wire
 *  schemas, poll loop, and remote-host grammar live in `anyforge`, and
 *  host-to-forge detection lives in the sensor layer
 *  (`@kolu/terminal-vocab`). */

export { classifyGhError, deriveCheckStatus, extractChecks } from "./github.ts";
export { githubForgeAdapter, resolveGitHubPr } from "./resolve.ts";
