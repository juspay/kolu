/** `kolu-common/pr` subpath — re-exports PR schemas and neutral helpers
 *  from `kolu-github`'s browser-safe `./schemas` entry (no node imports).
 *
 *  Two layers of narrowing:
 *  1. We import from `kolu-github/schemas`, not the main barrel — the main
 *     barrel also exports `resolve.ts` which pulls `node:util` /
 *     `node:child_process` and blows up vite's browser build.
 *  2. Classifiers (`classifyGhError`, `deriveCheckStatus`, `prResultEqual`)
 *     live in `kolu-github`'s main barrel and stay server-internal —
 *     importing them through this subpath would blur the provider-neutral
 *     boundary. */

export type {
  GhUnavailableCode,
  GitHubCheckStatus,
  GitHubPrInfo,
  GitHubPrState,
  PrResult,
  PrUnavailableSource,
} from "kolu-github/schemas";
export {
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  GitHubCheckStatusSchema,
  GitHubPrInfoSchema,
  GitHubPrStateSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  prValue,
  reasonForGhCode,
  reasonForSource,
} from "kolu-github/schemas";
