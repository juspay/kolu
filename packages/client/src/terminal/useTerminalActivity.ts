/** Live-output activity tracker — the sub-second "is this terminal moving
 *  bytes *right now*" signal behind the dock/title live dots.
 *
 *  This is deliberately NOT `lastActivityAt`: that field bumps only on agent
 *  semantic-key transitions (see `staleness.ts`) and is an hours-scale
 *  staleness clock, so a plain `npm run build`, a `tail -f`, or any non-agent
 *  shell churning output would never light it up. The only honest source for
 *  raw output motion is the PTY data stream itself, so `noteOutput(id)` is
 *  called from `Terminal.tsx`'s attach-stream sink on every chunk that lands
 *  in xterm.
 *
 *  A terminal reads as "live" from the moment a chunk arrives until
 *  `IDLE_AFTER_MS` pass with no further output — each chunk resets that timer.
 *  The flag is an explicit boolean rather than a `now - lastOutputAt`
 *  comparison so reactivity needs no global ticking clock: the per-terminal
 *  debounce timer is what flips it back to static. */

import type { TerminalId } from "kolu-common/surface";
import { createStore } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";

/** Output quiet-period before a terminal reads as static again. ~1s keeps a
 *  steady stream (compiles, `tail -f`, an agent printing tokens) lit while a
 *  single prompt-and-stop blips off promptly. */
const IDLE_AFTER_MS = 1000;

export const useTerminalActivity = createSharedRoot(() => {
  // createStore for per-terminal fine-grained reactivity: setting one
  // terminal's flag wakes only the dots reading that terminal, not every row.
  const [live, setLive] = createStore<Record<TerminalId, boolean>>({});
  const timers = new Map<TerminalId, ReturnType<typeof setTimeout>>();

  /** Record a chunk of PTY output for `id` — lights its live flag and arms
   *  (or re-arms) the quiet-period timer that flips it back to static. */
  function noteOutput(id: TerminalId): void {
    if (!live[id]) setLive(id, true);
    const pending = timers.get(id);
    if (pending) clearTimeout(pending);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        setLive(id, false);
      }, IDLE_AFTER_MS),
    );
  }

  /** Reactive — true while this terminal's output is actively streaming. */
  function isLive(id: TerminalId): boolean {
    return live[id] ?? false;
  }

  return { noteOutput, isLive };
});
