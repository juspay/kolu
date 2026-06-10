/** anyforge — the forge-neutral PR kernel.
 *
 *  Leaf package (deps: kolu-shared types + zod + ts-pattern) owning the
 *  three things that are stable while forges vary: the wire vocabulary
 *  (`./schemas.ts`), the adapter contract + detection (`PrProvider`,
 *  `detectForge`), and the generic poll loop (`subscribePr`). Forge
 *  adapters — kolu-github today, kolu-forgejo in kolu#1240 phase 1 —
 *  implement `PrProvider` against these shapes and never import each
 *  other; `anyagent` is the same move for agents. */

export { detectForge, parseRemoteHost } from "./detect.ts";
export type { ForgeKind, PrGitContext, PrProvider } from "./provider.ts";
export { type PrWatcher, subscribePr } from "./subscribe.ts";
export type {
  CheckRun,
  CheckStatus,
  GhUnavailableCode,
  PrInfo,
  PrResult,
  PrState,
  PrUnavailableSource,
} from "./schemas.ts";
export {
  CheckRunSchema,
  CheckStatusSchema,
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  PrInfoSchema,
  PrResultSchema,
  PrStateSchema,
  PrUnavailableSourceSchema,
  prLabel,
  prResultEqual,
  prUnavailableReason,
  prUnavailableSource,
  prValue,
  reasonForGhCode,
  reasonForSource,
} from "./schemas.ts";
