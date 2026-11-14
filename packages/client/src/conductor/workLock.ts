/** THE LOCK — the ONE gate every person-input site passes through, and the
 *  nudge a blocked keystroke raises.
 *
 *  A terminal the Conductor DRIVES (an active member of a work in progress
 *  whose mode runs a waterfall) is read-only to the person until they take it
 *  over. Reading is untouched — scroll, select, copy, search, Look, resize all
 *  work; only INPUT is gated.
 *
 *  Why here and not at the server: the lock guards against ACCIDENTAL typing,
 *  which only happens in a browser, and the browser is where the nudge has to
 *  appear. The programmatic senders (the `kolu` CLI on padi's socket, the MCP
 *  fleet face, the Conductor itself) dial the SAME served host map in-process,
 *  so a refusal in padi's `lifecycle.sendInput` — which has no error channel
 *  and no notion of a work — could not tell this browser's keystroke from the
 *  Conductor's own.
 *
 *  ONE function, so a new input site cannot invent a second rule: every
 *  person-input path calls {@link personInput} with the terminal it is about
 *  to write to and sends nothing when it answers false. The decision itself is
 *  {@link inputAllowed}, a fold over the driver alone — stated once, testable
 *  without a browser.
 *
 *  Programmatic sends are NOT person input and never call this: a new
 *  worktree's initial command, a session restore replaying what a terminal was
 *  running. Those are kolu typing on its own behalf, and they target terminals
 *  it just made. */

import type { TerminalId } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { createSignal } from "solid-js";
import { encActiveHost } from "../wire";
import { useMembership } from "./useWorks";
import { inputAllowed } from "./workReadings";

/** The fleet ref of a terminal on the ACTIVE host — the key the membership
 *  index is read by. Every person-input site is a view of the active host (a
 *  canvas tile, the phone's tile, the Inspector, the palette), which is why
 *  the sites hand over an id and this module names it. */
export function activeTerminalRef(id: TerminalId): string {
  return fleetTerminalRef(encActiveHost(), id);
}

/** THE NUDGE — the terminal whose lock was just typed at. Module level: it
 *  outlives the tile that raised it being re-rendered, and there is exactly
 *  one at a time (a person types into one terminal). */
const [nudged, setNudged] = createSignal<string | null>(null);

/** How long the nudge stays up. Long enough to read one line, short enough
 *  that it is gone before the next thing a person does. A second blocked
 *  keystroke re-arms it rather than letting it expire mid-typing. */
const NUDGE_MS = 4000;

let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

function raiseNudge(terminal: string): void {
  setNudged(terminal);
  clearTimeout(nudgeTimer ?? undefined);
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    setNudged(null);
  }, NUDGE_MS);
}

/** MAY THIS PERSON'S INPUT GO to `id`? Answers true and lets the caller send;
 *  answers false and raises the nudge that points at Take over.
 *
 *  Reads the ONE membership derivation every mark reads, so what the tile's
 *  banner says and what the keyboard does are the same fact. */
export function personInput(id: TerminalId): boolean {
  const terminal = activeTerminalRef(id);
  if (inputAllowed(useMembership()().get(terminal)?.driver)) return true;
  raiseNudge(terminal);
  return false;
}

/** Is the nudge up for this terminal? The banner rings itself and shows its
 *  one line from this. */
export function nudgedTerminal(terminal: string): boolean {
  return nudged() === terminal;
}
