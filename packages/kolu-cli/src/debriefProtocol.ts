/**
 * The one statement of the protocol `kolu debrief` bakes in.
 *
 * ```
 * kolu debrief <id> [--quiet <ms>] [--tail <N>]
 *   ≡  kolu wait <id> --until awaiting,waiting --settled <quiet> --snapshot <tail>
 * ```
 *
 * The fact that genuinely crosses the per-face fence is {@link DEBRIEF_UNTIL}:
 * `cli.ts` renders it into the `--help` line that PROMISES the expansion, and
 * `verbs/debrief.ts` passes it to PERFORM one. A help text advertising an
 * invocation the verb does not make is the exact drift a definitional alias is
 * only worth shipping without, so that string is declared once, here.
 *
 * The two defaults keep it company rather than sitting on the flags in
 * `cli.ts`, because the protocol reads as one thing — which buckets, how long
 * quiet, how much screen — and splitting it across two modules would leave the
 * `--help` sentence assembled from facts a reader has to go and find.
 *
 * It sits beside `cli.ts` rather than under `verbs/` because the command tree
 * reads it at MODULE LOAD (a flag's default is part of the parse), and the whole
 * point of `verbs/` is that nothing there loads until its handler runs. Its one
 * import is `import type`, so it is erased and the per-face fence is untouched.
 */

import type { WaitState } from "@kolu/padi/dial";

/** The buckets that mean "the worker's turn is over": `awaiting` (it is asking
 *  the human something) and `waiting` (it finished and is idle at its prompt).
 *  NOT `working` — and deliberately not derived from `WAIT_STATES`, because
 *  "every bucket" would include the one this verb waits to LEAVE.
 *
 *  Spelled as the `--until` STRING the expansion passes, so `wait`'s own
 *  `planUntil` is the only thing that ever decides what it means; a pre-parsed
 *  condition here would be a second route into that grammar. The bucket NAMES
 *  are typed against padi's own vocabulary all the same — a `WaitState` typo
 *  would otherwise be a plain string that fails at runtime, on the one verb
 *  whose whole promise is that it cannot be spelled wrong. `import type` keeps
 *  this a zero-import leaf: the annotation is fully erased. */
const DEBRIEF_BUCKETS = [
  "awaiting",
  "waiting",
] as const satisfies readonly WaitState[];

export const DEBRIEF_UNTIL = DEBRIEF_BUCKETS.join(",");

/** How long `debrief` waits for quiet before believing the turn is over.
 *
 *  15s is the field-calibrated number from kolu#2139: an agent's main loop that
 *  ends its turn while an async subagent is still running reads as `waiting`
 *  within milliseconds, and the subagent's own output — a spinner, a footer, a
 *  tool line — keeps arriving for as long as it runs. Anything much shorter
 *  re-opens the failure this verb exists to close (an orchestrator nudged a
 *  worker whose subagent was three minutes into a deliberate plan); anything
 *  much longer makes a genuinely finished agent feel unresponsive. `--quiet` is
 *  there for a caller who knows their own workload better. */
export const DEBRIEF_QUIET_MS = 15_000;

/** How much screen `debrief` hands back. 40 lines is `kolu snapshot --tail 40`'s
 *  own working number — about a screenful of an agent's reply, which is what a
 *  driving loop reads before deciding whether to act. */
export const DEBRIEF_TAIL_LINES = 40;

/** The `wait` invocation `debrief` IS, spelled for a human — the `--help` line,
 *  built from the same constants the verb passes.
 *
 *  A CONSTANT, not a function of them: its one caller passed the two constants
 *  declared just above it, and a parameter with one possible argument is
 *  variability that is not volatility — it would let some future caller render
 *  an expansion the verb does not perform, which is the exact drift this module
 *  exists to prevent. */
export const DEBRIEF_EXPANSION = `kolu wait <id> --until ${DEBRIEF_UNTIL} --settled ${DEBRIEF_QUIET_MS} --snapshot ${DEBRIEF_TAIL_LINES}`;
