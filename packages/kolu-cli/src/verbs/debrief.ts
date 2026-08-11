/**
 * `kolu debrief <id>` — the orchestrator's debrief, as one verb.
 *
 * ```
 * kolu debrief <id> [--quiet <ms>] [--tail <N>] [--timeout <ms>] [--json]
 *   ≡  kolu wait <id> --until awaiting,waiting --settled <quiet> --snapshot <tail>
 * ```
 *
 * ## Why a verb and not a documented incantation
 *
 * That `wait` invocation is the step every driving orchestrator should make, and
 * **each flag forgotten re-opens a live failure mode** (kolu#2139): drop
 * `--settled` and you nudge an agent whose subagent is still running — the field
 * incident, where a worker three minutes into a deliberate "wait for it, then
 * push once" plan was preempted; drop `--snapshot` and you act without having
 * read what the worker believes happened. A protocol whose correctness depends
 * on remembering three flags is a protocol that will be got wrong at 3am, so it
 * is baked into a name instead.
 *
 * The name is what an orchestrator DOES to a worker: wait until they have
 * actually finished, then hear what they think happened. (`settle` collides with
 * the flag it wraps, `checkin` implies non-blocking, and `report`/`harvest` read
 * as read-only.)
 *
 * ## Sugar, and provably nothing more
 *
 * This module holds no logic of its own: it projects its flags onto
 * {@link WaitArgs} and calls `wait`'s own {@link runWait}. So the outcome
 * contract, the exit codes (0 met · 2 timeout · 3 gone · 130 interrupted · 1
 * link-closed), the `--json` frame, and the "stdout is the screen, stderr is the
 * trailer" rule are inherited rather than restated — there is no second face to
 * drift. The precedent is bare `kolu`, which was the documented alias of `kolu
 * web`; the constraint is the one this CLI earned by retiring two near-duplicate
 * TUIs, that a new verb pulls its weight only if it can never diverge.
 *
 * Its vocabulary is reused too: `--tail` is `snapshot`'s flag name, and
 * `--quiet` is the sugared spelling of the `--settled` primitive. The buckets,
 * the defaults (`--quiet 15000`, `--tail 40`), and the human spelling of the
 * expansion are all `../debriefProtocol.ts`'s — read by the command tree for its
 * flags and `--help`, and by this module to perform it, so what `--help`
 * promises is what runs.
 */

import type { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { debriefFlags } from "../cli.ts";
import { DEBRIEF_UNTIL } from "../debriefProtocol.ts";
import type { Endpoint } from "../endpoint.ts";
import { run as runWait } from "./wait.ts";

/** What the command tree hands this verb — DERIVED from `debriefFlags` in
 *  `cli.ts`, which carries the defaults and the timer/line-count rules, so every
 *  field arrives here already legal (or the parse already refused). */
export type DebriefArgs = Command.Command.Config.Infer<typeof debriefFlags>;

/**
 * Expand to the `wait` invocation and run it. Every branch below `wait`'s entry
 * — the parse, the dial, the engine, the outcome mapping — is the same code path
 * `kolu wait` takes, so this verb cannot report an outcome `wait` would not.
 */
export function run(
  endpoint: Endpoint,
  args: DebriefArgs,
): Effect.Effect<void, unknown> {
  return runWait(endpoint, {
    id: args.id,
    until: DEBRIEF_UNTIL,
    settled: args.quiet,
    snapshot: args.tail,
    timeout: args.timeout,
    json: args.json,
  });
}
