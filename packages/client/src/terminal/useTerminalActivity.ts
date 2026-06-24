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

/** Output quiet-period before a terminal reads as static again. This is a raw
 *  byte-motion signal with a ~1s trailing window: a stream with sub-second gaps
 *  (compiles, `tail -f`) stays lit, while one that pauses longer than ~1s blinks
 *  off then back on when it resumes — by design, since this tracks bytes moving,
 *  not whether a session is conceptually working (that distinction from the
 *  agent border is drawn in `LiveActivityDot.tsx`). So an agent that pauses
 *  >1s between thinking and emitting tokens will flicker, and that's correct. */
const IDLE_AFTER_MS = 1000;

export const useTerminalActivity = createSharedRoot(() => {
  // createStore for per-terminal fine-grained reactivity: setting one
  // terminal's flag wakes only the dots reading that terminal, not every row.
  const [live, setLive] = createStore<Record<TerminalId, boolean>>({});
  const timers = new Map<TerminalId, ReturnType<typeof setTimeout>>();
  // Terminals whose output should NOT count as "live" right now — a window the
  // caller arms around output IT caused, not the user/agent. The motivating case:
  // revealing or resizing a tile resizes the server PTY (SIGWINCH), and the shell
  // REPAINTS in response — a genuine PTY delta, but not real activity. Without
  // this, switching to a quiet terminal blips its live ring for a beat off that
  // repaint. See `noteOutput` (it early-returns while suppressed).
  const suppressTimers = new Map<TerminalId, ReturnType<typeof setTimeout>>();
  const suppressed = new Set<TerminalId>();

  /** Record a chunk of PTY output for `id` — lights its live flag and arms
   *  (or re-arms) the quiet-period timer that flips it back to static. Output
   *  arriving inside a `suppress` window is ignored (it's repaint noise from a
   *  resize the client triggered, not real activity). */
  function noteOutput(id: TerminalId): void {
    if (suppressed.has(id)) return;
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

  /** Suppress activity for `id` for the next `ms` — output that lands in the
   *  window won't light the live flag. The caller arms this around output it
   *  KNOWS isn't real activity (a resize-triggered shell repaint on reveal), so
   *  a quiet terminal doesn't falsely flash live when you switch to it. A fresh
   *  call re-arms the window. Genuine output after the window lights it as usual. */
  function suppress(id: TerminalId, ms: number): void {
    suppressed.add(id);
    const prev = suppressTimers.get(id);
    if (prev) clearTimeout(prev);
    suppressTimers.set(
      id,
      setTimeout(() => {
        suppressTimers.delete(id);
        suppressed.delete(id);
      }, ms),
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
    const pendingSuppress = suppressTimers.get(id);
    if (pendingSuppress) clearTimeout(pendingSuppress);
    suppressTimers.delete(id);
    suppressed.delete(id);
    setLive(produce((s) => void delete s[id]));
  }

  return { noteOutput, isLive, suppress, forget };
});
