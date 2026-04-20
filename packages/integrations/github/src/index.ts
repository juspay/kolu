/** kolu-github — GitHub PR resolution schemas and pure helpers.
 *
 *  Leaf package: depends only on zod + ts-pattern. The server's
 *  `meta/github.ts` wraps these with process spawning (via `KOLU_GH_BIN`)
 *  and the channel publisher. See top comment in `schemas.ts` for the
 *  neutral-vs-gh-specific layout rationale. */

export {
  GitHubCheckStatusSchema,
  GitHubPrStateSchema,
  GitHubPrInfoSchema,
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  PrUnavailableSourceSchema,
  PrResultSchema,
  reasonForGhCode,
  reasonForSource,
  prValue,
  prUnavailableReason,
  prUnavailableSource,
} from "./schemas.ts";
export type {
  GitHubCheckStatus,
  GitHubPrState,
  GitHubPrInfo,
  GhUnavailableCode,
  PrUnavailableSource,
  PrResult,
} from "./schemas.ts";

export { deriveCheckStatus, classifyGhError, prResultEqual } from "./github.ts";
