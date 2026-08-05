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

/** Run `body`, containing and LOUDLY logging a throw. `what` names the callback
 *  so the log identifies the member rather than framework code. Never rethrows —
 *  rethrowing is the failure mode this exists to prevent. */
export function containThrow(what: string, body: () => void): void {
  try {
    body();
  } catch (err) {
    console.error(
      `surface: ${what} threw where the stack must not unwind — CONTAINED (siblings and future writes keep flowing; unwinding here severs the reactive graph mid-drain and freezes every derivation in the process)`,
      err,
    );
  }
}
