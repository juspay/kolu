/**
 * The padi failures this client BRANCHES on, matched by `_tag`.
 *
 * D4 replaced oRPC's `ORPCError` + magic code string with a
 * `Schema.TaggedErrorClass` vocabulary (`@kolu/padi/surface`'s `./errors.ts`), so
 * "the server said no, and told you why" is now a `_tag` on a schema-carried
 * value. Three sites in this client act on one — the terminal-exit stream's
 * stale-session swallow, and the Code tab's un-fetched-base and
 * deleted-while-viewing swallows — and they all need the SAME two properties:
 *
 *  - **`isDefinedError` first.** A transport drop is not a declared failure, and
 *    branching on it as if it were is how a dead link gets reported as an
 *    application outcome (the fence's positive-match rule, one layer down).
 *  - **`_tag` compared STRUCTURALLY, never `instanceof`.** Two of these three
 *    sites read a value that crossed a wire hop, where the class identity may
 *    genuinely differ (a relay decodes and re-encodes; a bundle can hold two
 *    copies of a module). On the two per-terminal STREAM members padi states the
 *    asymmetry outright: a `StreamSpec` has no error channel, so `TerminalNotFound`
 *    reaches a consumer as an UNDECLARED failure — a bare defect rather than a
 *    decoded class instance. Matching the tag is what keeps recognition honest
 *    across both. This is padi's own precedent (`terminalEndpoint/reattachingDeltas.ts`'s
 *    `isPtyNotFound`), reused rather than re-derived.
 *
 * The tags are spelled as LITERALS typed against the classes' own `_tag`, so a
 * rename in `@kolu/padi/surface` is a compile error here — the property the
 * magic-code compare never had.
 */

import type {
  FileGone,
  TerminalNotFound,
  WorktreeBaseBranchMissing,
} from "@kolu/padi/surface";
import { isDefinedError } from "@kolu/surface/solid";

/** No terminal with this id — it exited, or the restarted server never had it. */
export const TERMINAL_NOT_FOUND: TerminalNotFound["_tag"] = "TerminalNotFound";

/** The file is GONE — deleted under an open preview. */
export const FILE_GONE: FileGone["_tag"] = "FileGone";

/** Branch mode has no base to compare against — `origin/<default>` exists as a
 *  remote but has never been fetched. Actionable (`git fetch`), so padi declares
 *  it; for a PASSIVE background read it is the ordinary state of a fresh clone. */
export const WORKTREE_BASE_BRANCH_MISSING: WorktreeBaseBranchMissing["_tag"] =
  "WorktreeBaseBranchMissing";

/** Is `err` the DECLARED padi failure `tag` names? */
export function isDeclared(err: unknown, tag: string): boolean {
  return isDefinedError(err) && err._tag === tag;
}
