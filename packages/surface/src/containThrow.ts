/**
 * One rule, one implementation: a callback the framework runs on a stack that
 * MUST NOT unwind is bracketed here.
 *
 * Two such stacks exist, and a leaf module is what lets both use the same code
 * without `server.ts` importing the reactor (and with it the engine — a boundary
 * the bridge keeps deliberately):
 *
 *   - the ENGINE's stack — an `effect` body, a source listener inside a batched
 *     `emit`, a publish driven by a rebuild. Atom's batch drain severs a level's
 *     dependent edges before rebuilding them, so a throw mid-drain leaves nodes
 *     orphaned and every FUTURE write to that level finds no dependents and
 *     returns silently. The graph does not crash, it goes quiet — for the life of
 *     the process, with no log line.
 *   - the WRITER's stack — a cell/collection/event publish fanning out to
 *     subscribers. One subscriber that throws would starve every sibling
 *     subscriber of that frame AND unwind into whatever drove the write, which is
 *     usually the drain above.
 *
 * Both were live in the juspay/kolu#2101 deploy-#2 freeze: all hosts stale at
 * once, writes accepted, nothing logged, cured only by a restart.
 *
 * The trade is deliberate. Containing a throw normally risks masking a defect —
 * but here the alternative is not a crash, it is a silent global freeze, so the
 * loud log IS the surfacing the caught-error doctrine asks for
 * (`.agency/code-police.md` → `caught-error-must-not-collapse-to-empty`) and the
 * ruling is `disableFatalDefects`' one layer down: a member's fault is not the
 * frame's.
 */

/** The consequence the two ORIGINAL stacks share. Named, so the parameter below
 *  has an honest default rather than a sentence that happens to be true of the
 *  first callers. */
const GRAPH_STAKE =
  "siblings and future writes keep flowing; unwinding here severs the reactive graph mid-drain and freezes every derivation in the process";

/** Run `body`, containing and LOUDLY logging a throw. `what` names the callback
 *  so the log identifies the member rather than framework code. Never rethrows —
 *  rethrowing is the failure mode this exists to prevent.
 *
 *  `preserves` states what containment BUYS at this call site, and it is a
 *  parameter for a reason discovered in kolu#2101 G8c: a third stack now uses
 *  this rule — the retry/re-dial stack, where unwinding costs a re-subscribe
 *  rather than the graph — and a log line that recited the graph's stake there
 *  would be a message claiming something untrue, which is the exact defect class
 *  that round exists to remove. It defaults to {@link GRAPH_STAKE}, which is what
 *  the engine and writer call sites mean. */
export function containThrow(
  what: string,
  body: () => void,
  preserves: string = GRAPH_STAKE,
): void {
  try {
    body();
  } catch (err) {
    console.error(
      `surface: ${what} threw where the stack must not unwind — CONTAINED (${preserves})`,
      err,
    );
  }
}
