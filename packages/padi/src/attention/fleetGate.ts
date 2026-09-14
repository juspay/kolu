/**
 * THE SERVE-TIME EMPTY SEED, as a thing with a name.
 *
 * padi's `urgency` cell runs once at serve time — before the endpoint has booted
 * and adopted kaval's terminals — so its first frame is an information-free
 * empty registry. Every consumer downstream of that fold treats a frame as
 * evidence: `finishQuiet` spends its bootstrap on it, the settle detector takes
 * it as the baseline it diffs against, the state watch dates every hold from it.
 * Taken as real, that one frame re-announces every already-settled worker on
 * every padi restart.
 *
 * The guard used to live three times, once per consumer, which is one fact
 * remembered by discipline — and the fourth consumer forgets. It lives here now,
 * gated once at the producer, so everything downstream may trust what it is fed.
 *
 * The half that is easy to lose when the guard is inlined as a boolean: once a
 * fleet HAS been seen, an empty map is a real fact — every terminal exited — and
 * must flow through. The gate opens once and stays open; it is not "ignore empty
 * frames".
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

export interface FleetGate {
  /** Should this frame reach the attention consumers? `false` only for the
   *  pre-adopt frame — an empty registry seen before any real one. Opens on the
   *  first non-empty frame and stays open. */
  admit(terminals: ReadonlyMap<TerminalId, PadiTerminal>): boolean;
}

export function createFleetGate(): FleetGate {
  let seen = false;
  return {
    admit(terminals) {
      if (seen) return true;
      if (terminals.size === 0) return false;
      seen = true;
      return true;
    },
  };
}
