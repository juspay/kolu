/** WHEN TWO CANVAS FRAMES ARE THE SAME FRAME.
 *
 *  `canvasMode` reads the 1 s monotonic tick unconditionally (`useCanvasMode.ts` —
 *  the boot-deadline accrual needs it), so a workspace that has been up for an hour
 *  re-resolves every second and mints a referentially-new `{ kind: "workspace" }`
 *  each time. Without a gate the memo publishes that, waking every `Match` and every
 *  reader under the canvas once a second for a decision that did not move — and
 *  Solid's attribution engine raises `UNSTABLE_MEMO_OUTPUT` after four such re-runs.
 *
 *  The comparison is `kind` plus each arm's OWN payload, by identity:
 *   - `down` carries the daemon's down verdict, re-served from the daemon status;
 *   - `warming` carries the daemon state;
 *   - `boot-stalled` carries its recovery verdict, which the resolver mints fresh
 *     per evaluation — so that arm never compares equal, which is the honest
 *     answer here (a frame we cannot prove identical is a new frame) and is exactly
 *     what the ungated memo did;
 *   - the payload-free arms (`connecting`, `host-failed`, `empty`, `workspace`) are
 *     equal whenever their `kind` is.
 *
 *  Anything else — a new arm added to {@link CanvasMode} — is unequal: the switch is
 *  exhaustive over today's union, and a kind the compiler does not know about here
 *  falls through to "publish", never to a silently-swallowed frame. */

import type { CanvasMode } from "./canvasModeResolver";

export const sameCanvasMode = (a: CanvasMode, b: CanvasMode): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "down":
      return a.down === (b as Extract<CanvasMode, { kind: "down" }>).down;
    case "boot-stalled":
      return (
        a.recovery ===
        (b as Extract<CanvasMode, { kind: "boot-stalled" }>).recovery
      );
    case "warming":
      return (
        a.daemonState ===
        (b as Extract<CanvasMode, { kind: "warming" }>).daemonState
      );
    case "connecting":
    case "host-failed":
    case "empty":
    case "workspace":
      return true;
  }
};
