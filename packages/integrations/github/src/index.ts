/** kolu-github — GitHub PR resolution schemas and pure helpers.
 *
 *  Leaf package: depends only on zod + ts-pattern. The server's
 *  `meta/github.ts` wraps these with process spawning (via `KOLU_GH_BIN`)
 *  and the channel publisher. See top comment in `schemas.ts` for the
 *  neutral-vs-gh-specific layout rationale. */

export { classifyGhError, deriveCheckStatus, prResultEqual } from "./github.ts";
export {
  type GitHubPrWatcher,
  resolveGitHubPr,
  subscribeGitHubPr,
} from "./resolve.ts";
export type {
  GhUnavailableCode,
  GitHubCheckStatus,
  GitHubPrInfo,
  GitHubPrState,
  PrResult,
  PrUnavailableSource,
} from "./schemas.ts";
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
} from "./schemas.ts";
