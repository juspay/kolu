/**
 * WHY A CALL ABOUT A PIECE OF WORK WAS REFUSED — the whole vocabulary and the
 * thing that is thrown, in one place.
 *
 * Every kind is a READING OF THE RECORD: no work by that id, the work has
 * ended, the setup does not carry what the mode needs, this terminal is not
 * one kolu drives, it is already in the state the call would put it in. That
 * is why it lives here and not in a face: the fleet's MCP tools turn it into a
 * `ToolFailure`, kolu-server turns it into a `ConductorRefused`, and both
 * `instanceof` the same class the host threw rather than reading a thrown
 * value's fields and hoping.
 *
 * What is NOT here is the SENTENCES. `why` is composed by whoever raises the
 * refusal (`kolu-conductor`), because the sentence names that caller's
 * vocabulary — `work_open`, `given`, the tool call — and a model package has
 * no business spelling an agent's instructions.
 */

/**
 * The refusals, as the tuple every end is built from.
 *
 * - `unknown-work` — no work by that id. The Conductor is naming something it
 *   never opened, or one that fell off the history.
 * - `work-ended` — the work is finished: nothing joins it, nothing is asked
 *   about it, nothing is noted on it. Its record stands as it ended.
 * - `missing-setup` — `work_open` did not carry a setup question the mode it
 *   is about to run needs. Refused BEFORE the work exists, so a half-set-up
 *   work is never created.
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
 * this tuple because the tuple is the KIND vocabulary {@link WorkRefusal} is
 * built from, and a kind spelled on one side only is a refusal nothing
 * recognises.
 */
export const WORK_REFUSALS = [
  "unknown-work",
  "work-ended",
  "missing-setup",
  "role-taken",
  "not-driven",
  "already-yours",
  "already-conductors",
] as const;

/** Why a call about a work was refused. */
export type WorkRefusalKind = (typeof WORK_REFUSALS)[number];

/**
 * A CALL ABOUT A WORK, REFUSED — and the caller told exactly what to fix.
 *
 * An Error subclass rather than a declared wire error: the faces are the only
 * callers, and each turns this into the failure its own protocol carries.
 * `kind` is what a face branches on; `why` is the whole sentence it shows,
 * because a refusal an agent cannot act on costs the same turn as silence.
 */
export class WorkRefusal extends Error {
  readonly kind: WorkRefusalKind;
  readonly why: string;
  constructor(kind: WorkRefusalKind, why: string) {
    super(why);
    this.name = "WorkRefusal";
    this.kind = kind;
    this.why = why;
  }
}
