/**
 * The padi failures this client BRANCHES on, matched by `_tag`.
 *
 * D4 replaced oRPC's `ORPCError` + magic code string with a
 * `Schema.TaggedError` vocabulary (`@kolu/padi/surface`'s `./errors.ts`), so
 * "the server said no, and told you why" is now a `_tag` on a schema-carried
 * value. Three sites in this client act on one — the terminal-exit stream's
 * stale-session swallow, and the Code tab's un-fetched-base and
 * deleted-while-viewing swallows — and they all need the SAME two properties:
 *
 *  - **The transport exclusion first.** A transport drop is not a declared
 *    failure, and branching on it as if it were is how a dead link gets reported
 *    as an application outcome (the fence's positive-match rule, one layer down).
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
 *
 * **Why this is a predicate and not `Effect.catchTag`.** A unary member call now
 * carries its declared union in a real error channel, so a CALL branches on its
 * failure with `catchTag` and never comes here. These three sites are not calls:
 * they hand a `(err: unknown) => boolean` to a stream consumer or a swallow
 * policy, and on the two per-terminal STREAM members the value is not in a typed
 * channel at all — a `StreamSpec` has no error channel, so `TerminalNotFound`
 * arrives as a bare defect. There is nothing for the compiler to narrow, which is
 * exactly why the recognition has to be structural and lives in one place.
 */

import type {
  FileGone,
  TerminalNotFound,
  WorktreeBaseBranchMissing,
} from "@kolu/padi/surface";
import { isTransportError } from "@kolu/surface/client";

/** No terminal with this id — it exited, or the restarted server never had it. */
export const TERMINAL_NOT_FOUND: TerminalNotFound["_tag"] = "TerminalNotFound";

/** The file is GONE — deleted under an open preview. */
export const FILE_GONE: FileGone["_tag"] = "FileGone";

/** Branch mode has no base to compare against — `origin/<default>` exists as a
 *  remote but has never been fetched. Actionable (`git fetch`), so padi declares
 *  it; for a PASSIVE background read it is the ordinary state of a fresh clone. */
export const WORKTREE_BASE_BRANCH_MISSING: WorktreeBaseBranchMissing["_tag"] =
  "WorktreeBaseBranchMissing";

/** Is `err` the DECLARED padi failure `tag` names?
 *
 *  The transport exclusion is spelled even though the tag equality below would
 *  already reject an `RpcClientError`: the rule this function encodes is "a dead
 *  link is never an application answer", and a rule that holds only by accident
 *  of which literals happen to be passed is one the next tag can break. */
export function isDeclared(err: unknown, tag: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    !isTransportError(err) &&
    (err as { readonly _tag?: unknown })._tag === tag
  );
}
