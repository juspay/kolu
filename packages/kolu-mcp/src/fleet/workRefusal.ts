/**
 * WHY A CALL ABOUT A PIECE OF WORK WAS REFUSED — the whole vocabulary, in one
 * place.
 *
 * This word crosses two boundaries, as `./watchJoin.ts`'s joins do: the
 * conductor RAISES it (`kolu-conductor`'s `WorkRefusal`, which carries one of
 * these kinds and the sentence that goes with it), and the fleet face TURNS it
 * into a `ToolFailure` the agent can branch on. Spelled once per side, a new
 * kind would compile on both and then arrive at an agent as a refusal nothing
 * recognises.
 *
 * **A LEAF with no imports at all**, for the same reason `./ref.ts` and
 * `./watchJoin.ts` are: `kolu-conductor` reaches it as `kolu-mcp/workRefusal`
 * and must not take an edge to the MCP SDK or to effect to learn a handful of
 * words.
 */

/**
 * The refusals, as the tuple both ends are built from.
 *
 * - `unknown-work` — no work by that id. The Conductor is naming something it
 *   never opened, or one that fell off the history.
 * - `work-ended` — the work is finished: nothing joins it, nothing is asked
 *   about it, nothing is noted on it. Its record stands as it ended.
 * - `missing-setup` — `work_open` did not carry a setup question the mode it
 *   is about to run needs. Refused BEFORE the work exists, so a half-set-up
 *   work is never created.
 * - `no-role` — a terminal was created or adopted without saying what it is
 *   there to do. Refused before the terminal is made: a member with no role is
 *   the thing the whole model exists to prevent.
 * - `not-driven` — a hand-over was asked for a terminal the Conductor does not
 *   drive: it is not an active member of a work in progress, or that work is a
 *   `watch` (the person's own terminal) or has no mode decided yet.
 * - `already-yours` / `already-conductors` — the terminal is already in the
 *   state the call would put it in. Said rather than shrugged off, because two
 *   tabs looking at the same tile is the ordinary way to get here.
 *
 * The last three never reach the fleet face as a tool failure — only the
 * `conductor.takeOver` / `handBack` procedures raise them, and kolu-server
 * turns them into `ConductorRefused` carrying the same sentence. They are in
 * this tuple because the tuple is the KIND vocabulary `WorkRefusal` is built
 * from, and a kind spelled on one side only is a refusal nothing recognises.
 */
export const WORK_REFUSALS = [
  "unknown-work",
  "work-ended",
  "missing-setup",
  "no-role",
  "not-driven",
  "already-yours",
  "already-conductors",
] as const;
