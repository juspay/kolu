/**
 * The one statement of the protocol `kolu debrief` bakes in.
 *
 * ```
 * kolu debrief <id> [--quiet <ms>] [--tail <N>]
 *   ≡  kolu wait <id> --until awaiting,waiting --settled <quiet> --snapshot <tail>
 * ```
 *
 * Two modules need these three facts and they must not disagree: `cli.ts` reads
 * them for the flags' defaults and for the `--help` line that PROMISES the
 * expansion, and `verbs/debrief.ts` reads them to PERFORM it. A help text that
 * advertises one invocation while the verb runs another is the exact drift a
 * definitional alias is only worth shipping without — so the facts live here, in
 * a leaf with no imports, rather than being spelled twice.
 *
 * It sits beside `cli.ts` rather than under `verbs/` because the command tree
 * reads it at MODULE LOAD (a flag's default is part of the parse), and the whole
 * point of `verbs/` is that nothing there loads until its handler runs.
 */

/** The buckets that mean "the worker's turn is over": `awaiting` (it is asking
 *  the human something) and `waiting` (it finished and is idle at its prompt).
 *  NOT `working` — and deliberately not derived from `WAIT_STATES`, because
 *  "every bucket" would include the one this verb waits to LEAVE.
 *
 *  Spelled as the `--until` STRING the expansion passes, so `wait`'s own
 *  `planUntil` is the only thing that ever decides what it means; a pre-parsed
 *  condition here would be a second route into that grammar. */
export const DEBRIEF_UNTIL = "awaiting,waiting";

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
 *  built from the same constants the verb passes. */
export const debriefExpansion = (quiet: number, tail: number): string =>
  `kolu wait <id> --until ${DEBRIEF_UNTIL} --settled ${quiet} --snapshot ${tail}`;
