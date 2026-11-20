/**
 * THE CLAUDE CODE AGENT, as one package — everything both products know about
 * it behind one door.
 *
 * ## What is on THIS side of the wall, and what is not
 *
 * Here: the leg that reads this adapter's wire ({@link ./leg.ts}), what its
 * model picker calls things ({@link ./models.ts}), the variables its CLI reads
 * as "this person is somewhere else" ({@link REMOTE_SIGNALS}), where it keeps
 * its signature on a host ({@link configDirIn}), and the name a person reads
 * ({@link NAME}). Beside those, in `./adapter/`, the npm shim, the two patches
 * over it and the Nix facts that build it — because WHICH adapter is pinned is
 * a fact about this agent, and two products pinning the same one must not each
 * keep a copy of the answer.
 *
 * Not here, and never: a session, a prompt, a transcript, and the sentence a
 * machine without this engine is owed. `@kolu/acp-harness` does the talking,
 * and the not-found sentence names kolu's padi — a fact about kolu's product
 * rather than about this agent — so it lives in kolu's agent registry.
 *
 * ## The leg is a SUPERSET, because this package is shared
 *
 * [olai](https://github.com/juspay/olai) vendors this directory as raw
 * TypeScript and runs the same adapter, and its panel reads two things kolu's
 * conductor does not: {@link CLAUDE}'s `listedIn` (a stored conversation's
 * message count and what clearing produced it) and its `terminalOutput` flag (a
 * Bash result as a terminal block rather than a fenced string). kolu may add to
 * this package; kolu may not take away — the rule `@kolu/acp` states at length,
 * and for the same reason: a type-level contract whose consumer is in another
 * repository has no compiler watching it.
 */

export {
  COMPACTION_OVERRIDES,
  configDirIn,
  REMOTE_SIGNALS,
} from "./env.ts";
export {
  CLAUDE,
  COMPACT_RESERVE,
  compactingAt,
  compactsPast,
  spelling,
} from "./leg.ts";
export { MODELS, modelNameIn } from "./models.ts";
export { NAME } from "./name.ts";
