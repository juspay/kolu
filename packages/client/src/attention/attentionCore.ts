/** The attention ENGINE — the stateful detect→fire core of `useAttention`, off
 *  the wire so it is unit-testable. It owns the per-host previous-frame, the
 *  fire-once latch, and the unseen-finished sets; the app-facing effects
 *  (`useAttention`) feed it urgency frames and supply the side-effects as `hooks`.
 *
 *  This is the path `__koluSimulateAlert` (and therefore e2e) BYPASSES — simulate
 *  calls `hooks.deliver` directly — so its only real coverage is the unit tests
 *  that drive `observe` with frames and assert the `deliver` calls. */

import type { PadiUrgency } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  attentionTransitions,
  nextUnseenFinished,
} from "./attentionTransitions";

export interface AttentionHooks {
  /** The master gate — the `attentionAlerts` preference. */
  alertsEnabled(): boolean;
  /** Is this host the one on screen right now. */
  isActiveHost(encHost: string): boolean;
  /** Is the user looking right AT this terminal (active host + active tile +
   *  focus) — a live gate they've already "seen". */
  isWatched(encHost: string, id: TerminalId): boolean;
  /** Reach the user for one terminal (sound + OS popup + dock unread) — the
   *  channel the engine decides to fire. */
  deliver(encHost: string, id: TerminalId, asking: boolean): void;
  /** Publish a host's unseen-finished count (the quiet host-tab dot). */
  writeMark(encHost: string, unseenFinished: number): void;
}

export interface AttentionCore {
  /** Feed one host's latest `urgency` frame. The FIRST frame per host is the
   *  baseline (records only, never fires — attention is a transition, not a
   *  discovery); every later frame diffs and may fire. */
  observe(encHost: string, cur: PadiUrgency): void;
  /** The host left the pool — drop all its state. */
  forgetHost(encHost: string): void;
  /** The user switched TO this host — clear its unseen-finished dot ("you looked"). */
  markHostSeen(encHost: string): void;
}

export function createAttentionCore(hooks: AttentionHooks): AttentionCore {
  const prevByHost = new Map<string, PadiUrgency>();
  const unseenByHost = new Map<string, Set<TerminalId>>();
  // Per-host fire-once latch — same `Map<encHost, …>` shape as its two siblings, so
  // a host's latch is data the structure holds directly (a `forgetHost` delete),
  // never something replayed from `prevByHost`.
  const latched = new Map<string, Set<TerminalId>>();
  /** This host's latch set, created on first touch — one place for the get-or-create. */
  const latchOf = (encHost: string): Set<TerminalId> => {
    let set = latched.get(encHost);
    if (!set) {
      set = new Set();
      latched.set(encHost, set);
    }
    return set;
  };

  const observe = (encHost: string, cur: PadiUrgency): void => {
    const prev = prevByHost.get(encHost) ?? null;
    const { candidates, ended } = attentionTransitions(prev, cur);

    // The quiet host-tab dot — folded every frame so it tracks back to zero. Reuses
    // the `candidates` already computed above (the ONE transition per frame) rather
    // than re-diffing prev↔cur inside the fold.
    const unseen = nextUnseenFinished(
      unseenByHost.get(encHost) ?? new Set(),
      candidates,
      cur.finishedIds,
      hooks.isActiveHost(encHost),
    );
    unseenByHost.set(encHost, unseen);
    hooks.writeMark(encHost, unseen.size);

    // Episode end: a terminal back to work clears its latch, so its NEXT
    // finish/ask is a fresh episode that fires again.
    for (const id of ended) latched.get(encHost)?.delete(id);

    // BASELINE pre-latch: on the first frame per host, PRE-LATCH ids already
    // ASKING, so a settle-flap around a PRE-EXISTING gate (asking→waiting→asking
    // — e.g. an app reload that catches a terminal mid-ask) does not phantom-chime
    // on the re-escalation. This is per-terminal, restoring the retired machine's
    // guarantee. A baseline FINISHED id is deliberately NOT pre-latched, so a later
    // genuine finished→asking gate over it still fires (#1177); and the latch clears
    // when the terminal leaves both sets (`ended`), so a real NEW episode chimes.
    if (prev === null && cur.awaitingIds.length > 0) {
      for (const id of cur.awaitingIds) latchOf(encHost).add(id);
    }

    // `candidates` is empty on the baseline (a finish already present when a host
    // binds is a discovery, not a transition — enforced in `attentionTransitions`),
    // so this loop records-only on the first frame with no guard here.
    for (const { id, asking } of candidates) {
      if (latched.get(encHost)?.has(id) ?? false) continue;
      const seen = hooks.isWatched(encHost, id);
      const alerted = hooks.alertsEnabled() && !seen;
      if (alerted) hooks.deliver(encHost, id, asking);
      // Latch once the user has been MADE AWARE — an actual alert, OR looking
      // right at a live gate (eyes work with sound off). A `finished` seen
      // while watched is NOT latched, so a later real gate still fires (#1177).
      if (alerted || (asking && seen)) latchOf(encHost).add(id);
    }

    // SNAPSHOT the frame — never keep a reference. The live surface delivers this
    // value via SolidJS `reconcile`, mutating ONE object in place across frames;
    // storing the reference would make the next frame's `prev` and `cur` the SAME
    // mutated object, so no transition is ever seen and nothing fires. Copy the id
    // arrays so the diff compares a frozen prior frame against the live current one.
    prevByHost.set(encHost, {
      awaitingIds: [...cur.awaitingIds],
      finishedIds: [...cur.finishedIds],
      // Carried for type-fidelity only — the engine diffs the two attention
      // lists; the activity lists are marks the per-host root writes directly.
      workingIds: [...cur.workingIds],
      lingerIds: [...cur.lingerIds],
    });
  };

  const forgetHost = (encHost: string): void => {
    prevByHost.delete(encHost);
    unseenByHost.delete(encHost);
    latched.delete(encHost);
    // The mark is cleared by the caller's `onCleanup` (which DELETES the host's
    // record), so the engine does not also write a 0 here — one clear, one place.
  };

  const markHostSeen = (encHost: string): void => {
    const set = unseenByHost.get(encHost);
    if (set && set.size > 0) {
      set.clear();
      hooks.writeMark(encHost, 0);
    }
  };

  return { observe, forgetHost, markHostSeen };
}
