/** The pure canvas-surface precedence — type + total resolver, with NO reactive
 *  or wire imports, so the load-bearing arm order is unit-testable in isolation
 *  (see `canvasModeResolver.test.ts`). `useCanvasMode.ts` gathers the live
 *  daemon/session facts and delegates the decision here; keeping the decision in
 *  its own dependency-free module is what lets the test import it without
 *  mounting the `daemonStatus` subscription (which drags in `../wire`).
 *
 *  The arm ORDER is correctness, not cosmetics:
 *    - `down` beats `empty` so a dead/degraded kaval never masquerades as
 *      "you have no terminals" — the #1034 empty-canvas lie.
 *    - `warming` beats `empty` so a restart's `drain` (which empties the
 *      terminal list) shows the neutral warming surface, not EmptyState with
 *      its enabled Restore / new-terminal affordances — a fast click there
 *      would spawn/restore into the daemon the recycle is about to kill
 *      (terminal creation must wait for `connected`). */

import type { DaemonState } from "@kolu/padi/surface";

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state and the warming label travel WITH the choice — the
 *  renderer reads neither `downState()` nor `warmingCanvasLabel()` a second
 *  time. */
export type CanvasMode =
  | { kind: "connecting" }
  | { kind: "down"; state: "dead" | "degraded" }
  | { kind: "warming"; label: string; daemonState: DaemonState | undefined }
  | { kind: "empty" }
  | { kind: "workspace" };

/** The flat snapshot the precedence decision needs — every fact as a plain
 *  value, no accessors and no module reads. Separating this from the live
 *  accessors is what makes {@link resolveCanvasMode} a pure, exhaustively
 *  testable total function. */
export interface CanvasFacts {
  isLoading: boolean;
  daemonPending: boolean;
  down: "dead" | "degraded" | undefined;
  warming: boolean;
  warmingLabel: string;
  daemonState: DaemonState | undefined;
  terminalCount: number;
  /** How many listed terminals' composed records have NOT arrived yet (the
   *  `awaited` arm of the metadata census). Non-zero means the key list resolved
   *  but per-terminal metadata is still in flight — the reload window where
   *  `terminalCount` is transiently 0 because records haven't composed. Gating
   *  `empty` on this (below) is what stops the restore card from flashing before a
   *  reload's live terminals appear; a genuine reboot arrives with records PARKED
   *  (awaited 0, count 0), so it falls through to `empty` as it should. */
  recordsAwaited: number;
  /** True once `daemonPending` has held for longer than the local endpoint's own
   *  connect timeout — i.e. the daemon-status stream has NEVER produced a first
   *  value and the wait has structurally run past the ceiling the padi session
   *  itself uses to decide a dial is wedged. Bounds the `connecting` arm below: a
   *  local padi endpoint that never comes up at boot (a spawn/adopt failure — the
   *  #1713 adopt-path sibling is one cause) would otherwise leave `daemonPending`
   *  true FOREVER (no value is ever published), and the canvas would spin at
   *  "Connecting…" with no way out. Always `false` while genuinely still within
   *  the window (the common, near-instant case) — computed by the wall-clock-aware
   *  caller; this module stays pure (see the header). */
  pendingTimedOut: boolean;
  /** The FULL channel liveness of the daemonStatus stream — the ws transport AND the
   *  ACTIVE ENTRY's own connection (`daemonChannelLive()` = ws ∧ `activeEntryConnected`). The
   *  `down` and `warming` facts arrive ALREADY floored on this at their source accessors
   *  (`downState`/`daemonWarming` → `liveDownState`/`liveWarming`, both on `daemonChannelLive`);
   *  this fact floors the remaining daemon-derived claim — `empty` ("no terminals"), which a
   *  dead channel also can't confirm — so a dead/half-open ws OR a dead active REMOTE entry
   *  (whose re-served daemonStatus freezes STALE at `connected`) makes NO unconfirmable canvas
   *  claim (the #1568 SHAPE A class the rail dot already floors, now on the entry leg too). */
  channelLive: boolean;
}

/** The pure precedence partition — total over {@link CanvasFacts}, exclusive,
 *  order load-bearing (see the module header). No reactive reads, so the whole
 *  #1034 / restart-drain precedence is unit-testable without mounting the
 *  daemon-status subscription. */
export function resolveCanvasMode(facts: CanvasFacts): CanvasMode {
  // Neutral "connecting" until BOTH the session cell AND the daemon-status
  // stream have produced their first value. Gating on daemon-status-pending
  // (not just `down`, which is undefined while pending) stops a `dead` boot
  // from flashing the normal empty workspace before the degraded surface takes
  // over (#1034). BOUNDED: once the daemon-status wait has run past the local
  // endpoint's own connect timeout, "still pending" no longer means "about to
  // arrive" — nothing will ever be published (a local padi that never came up
  // at boot), so resolve honestly to `down` (the reason surfaced — "dead", never
  // came up) instead of spinning at "Connecting…" forever (never a silent
  // spinner — the #1713 adopt-path sibling's canvas symptom).
  if (facts.isLoading || facts.daemonPending) {
    return facts.pendingTimedOut
      ? { kind: "down", state: "dead" }
      : { kind: "connecting" };
  }
  // `down` and `warming` arrive ALREADY floored on transport liveness (their source
  // accessors `downState`/`daemonWarming` return undefined/false when the link is
  // dead), so a stale daemon state never reaches these arms over a dead channel.
  if (facts.down) return { kind: "down", state: facts.down };
  if (facts.warming)
    return {
      kind: "warming",
      label: facts.warmingLabel,
      daemonState: facts.daemonState,
    };
  // Terminals on screen → show them. Otherwise "no terminals" is the remaining
  // daemon-derived claim, and it too is unconfirmable over a dead channel: show `empty`
  // only when the CHANNEL is LIVE (ws ∧ the active entry — it can confirm the set really is
  // empty), else the neutral connecting surface — never a stale "no terminals" with active
  // Restore / new-terminal affordances over a dead ws OR a dead active REMOTE entry (whose
  // frozen daemonStatus would otherwise read as an authoritative empty). The post-grace
  // TransportOverlay owns the disconnect messaging.
  if (facts.terminalCount > 0) return { kind: "workspace" };
  // Records still arriving after the key list resolved → a reload's live terminals
  // are mid-compose, so `terminalCount === 0` is a NOT-YET-settled claim, not "no
  // terminals". Hold the neutral connecting surface instead of flashing `empty`'s
  // restore card — ordered ABOVE `empty` for the same reason `down`/`warming` are.
  // A genuine reboot's records arrive PARKED (awaited hits 0 with no live tile), so
  // this falls through to `empty` and the restore card, exactly as intended.
  if (facts.recordsAwaited > 0) return { kind: "connecting" };
  return facts.channelLive ? { kind: "empty" } : { kind: "connecting" };
}
