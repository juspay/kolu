/** `kolu-common/pr` subpath — re-exports PR schemas and neutral helpers
 *  from `kolu-github` so browser clients can runtime-import them without
 *  pulling the full `kolu-common` barrel (which re-exports `kolu-claude-code`
 *  and transitively drags the Node-only `@anthropic-ai/claude-agent-sdk`
 *  into the browser bundle).
 *
 *  Surface kept narrow on purpose: only schemas, types, and display helpers.
 *  Classifiers (`classifyGhError`, `deriveCheckStatus`, `prResultEqual`)
 *  live in `kolu-github` and stay server-internal — importing them from
 *  here would blur the provider-neutral boundary this subpath represents. */

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
} from "kolu-github";
export type {
  GitHubCheckStatus,
  GitHubPrState,
  GitHubPrInfo,
  GhUnavailableCode,
  PrUnavailableSource,
  PrResult,
} from "kolu-github";
