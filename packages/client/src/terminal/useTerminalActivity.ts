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
 *  debounce timer is what flips it back to static.
 *
 *  Not to be merged with `renderRecovery.ts`, which is also a per-terminal
 *  output-debounce primitive fed from the adjacent line of the same attach
 *  sink. They look mergeable but key off different events: this tracker keys to
 *  stream RECEIPT (`noteOutput` fires the instant a chunk arrives), while
 *  `renderRecovery.noteData` keys to xterm PARSE (it runs as `term.write`'s
 *  completion callback, after the chunk has actually landed in the buffer — see
 *  the comment at the `scrollLock.writeData` call in `Terminal.tsx`). That
 *  receipt-vs-parse distinction is load-bearing — a shared "output pulse"
 *  primitive would have to fire on one or the other and be wrong for the other
 *  consumer — and the two also differ in cadence (1000ms idle vs a 250ms
 *  render-stall watchdog), action (flip live=false vs force a repaint), and
 *  lifecycle (an app singleton vs a per-terminal owner-scoped instance). */

import type { TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";
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
        // Natural idle prunes the key entirely (delete, not flag-false) so the
        // store stays bounded — a once-active-then-quiet terminal leaves no
        // residual `false`.
        timers.delete(id);
        setLive(produce((s) => void delete s[id]));
      }, IDLE_AFTER_MS),
    );
  }

  /** Reactive — true while this terminal's output is actively streaming. */
  function isLive(id: TerminalId): boolean {
    return live[id] ?? false;
  }

  /** Drop all state for `id` — clears any pending quiet-period timer and
   *  removes the key from both the timer Map and the store. Called from a
   *  terminal's close path (`Terminal.tsx` onCleanup) so a closed terminal
   *  leaves no dead key and no late `setLive` firing after it's gone. */
  function forget(id: TerminalId): void {
    const pending = timers.get(id);
    if (pending) clearTimeout(pending);
    timers.delete(id);
    setLive(produce((s) => void delete s[id]));
  }

  return { noteOutput, isLive, forget };
});
