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
 * - `role-taken` — the work already has a terminal in the `planner` or
 *   `implementor` part, and a work has one of each. Refused rather than
 *   written: a store with two is one `./store.ts` would not read back.
 * - `not-driven` — a hand-over was asked for a terminal the Conductor does not
 *   drive: it is not an active member of a work in progress, or that work is a
 *   `watch` (the person's own terminal) or has no mode decided yet.
 * - `agents-not-ready` — the setup asks which harness runs a role on a host
 *   whose agents are switched off, not there yet, or failed to land. Refused
 *   before anything exists, naming the host and what to do: there is no
 *   harness on it to choose.
 * - `not-offered` — an answer to a question kolu draws the options for
 *   (a role's harness or model) is not one of those options: a harness this
 *   kolu does not carry, a model the host did not list. Refused where it is
 *   recorded, so a work never holds a setup it cannot start. The mode and
 *   what to do on green are refused the same way when the answer is not one
 *   of kolu's words for them.
 * - `nothing-answered` — an answer that fills in no question of the ask. A
 *   question left blank stays asked, so an answer with every question blank
 *   would record nothing; it is refused rather than reported as settled.
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
  "agents-not-ready",
  "not-offered",
  "nothing-answered",
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
