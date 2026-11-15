/**
 * WHETHER PADI'S ROSTER IS EVIDENCE — the one fact, held once, and now said out
 * loud on the wire.
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
 * must flow through. It is not "ignore empty frames".
 *
 * ## The fourth consumer was across a wire (#2376)
 *
 * kolu-server's Conductor watch reads the roster of every host that holds a
 * member terminal and concluded `gone` for every id not in it. A redeploy
 * replaces padi; the fresh one serves that same pre-adopt frame; both of a
 * work's live terminals were recorded as having LEFT, and the work was ended as
 * abandoned. The guard could not help it: it was a boolean inside one process.
 *
 * So the gate OWNS the fact and PUBLISHES it ({@link PadiRoster} on the `roster`
 * cell, `padiSurface` 7.4). Three things open it, and one closes it:
 *
 *  - a first non-empty frame — the registry has content, so it was adopted;
 *  - {@link FleetGate.establish} — the boot finished (`bootLocalEndpoint`:
 *    endpoint up, saved session reconciled), which is what makes a GENUINELY
 *    EMPTY roster evidence rather than a daemon that has not looked yet;
 *  - the same call at the end of a kaval recycle, once the captured session has
 *    been re-parked;
 *  - {@link FleetGate.settling} closes it for the recycle's own drain window,
 *    where `killAllTerminals` clears the registry on purpose. An id missing
 *    THERE is a terminal about to be restored, not one that died.
 */

import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

export interface FleetGate {
  /** Should this frame reach the attention consumers? `false` only while the
   *  roster is settling — an empty registry before anything was adopted, or the
   *  drain window of a recycle. A non-empty frame ESTABLISHES the roster (and
   *  publishes that). */
  admit(terminals: ReadonlyMap<TerminalId, PadiTerminal>): boolean;
  /** padi has finished adopting: the roster is evidence even if it is EMPTY.
   *  Idempotent — a second call re-publishes nothing. */
  establish(): void;
  /** The roster is being rebuilt (a kaval recycle's capture → drain → re-park):
   *  nothing it lists, or fails to list, is evidence until {@link establish}. */
  settling(): void;
  /** The standing as it would be read off the wire — what the cell carries. */
  roster(): PadiRoster;
}

export function createFleetGate(
  opts: {
    /** Publish a CHANGED standing (the `roster` cell). Omitted in tests of the
     *  gate itself and in a serve with no ctx wired yet. */
    readonly publish?: (roster: PadiRoster) => void;
    /** The clock the `established` stamp is read from — injected so a test can
     *  state the epoch it expects. */
    readonly now?: () => number;
  } = {},
): FleetGate {
  const now = opts.now ?? Date.now;
  let roster: PadiRoster = { kind: "settling" };
  const move = (next: PadiRoster): void => {
    if (next.kind === roster.kind) return;
    roster = next;
    opts.publish?.(next);
  };
  return {
    admit(terminals) {
      if (roster.kind === "established") return true;
      if (terminals.size === 0) return false;
      move({ kind: "established", at: now() });
      return true;
    },
    establish() {
      move({ kind: "established", at: now() });
    },
    settling() {
      move({ kind: "settling" });
    },
    roster: () => roster,
  };
}

/** THE SERVING padi's gate — the one a BOOT PHASE reaches.
 *
 *  The gate is per-serve (a `servePadi` rebuild in tests must start unseeded
 *  exactly as a fresh daemon does), but the two moments that establish a roster
 *  for real — the boot's `ensureLocalEndpoint`, and the recycle routine — are
 *  modules away from the surface deps and have no handle to pass one through.
 *  Registered here, exactly like padi's other process-wide injections
 *  (`setPadiSessionStore`, `setPadiServeSocketPath`), and cleared with the
 *  serve it belongs to so a stale gate can never be published through. */
let serving: FleetGate | null = null;

export function setServingFleetGate(gate: FleetGate | null): void {
  serving = gate;
}

/** padi finished adopting — see {@link FleetGate.establish}. A no-op before the
 *  surface is served (nothing is subscribed to tell). */
export function markRosterEstablished(): void {
  serving?.establish();
}

/** padi is rebuilding its roster — see {@link FleetGate.settling}. */
export function markRosterSettling(): void {
  serving?.settling();
}
