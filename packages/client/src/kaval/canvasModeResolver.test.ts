/** Pins the canvas-surface precedence the App shell delegates to
 *  `resolveCanvasMode` (#1340 thin-shell extraction). The arm ORDER is
 *  load-bearing correctness — `down` and `warming` must each beat `empty` so a
 *  dead/degraded or restarting kaval never masquerades as "you have no
 *  terminals" (#1034 empty-canvas lie + restart-drain). Imports the pure
 *  resolver only, so the precedence is exercised without mounting the
 *  daemon-status subscription. */

import type { DaemonState } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import { type CanvasFacts, resolveCanvasMode } from "./canvasModeResolver";

/** A fully "ready" snapshot — daemon up, session loaded, one terminal — that
 *  resolves to `workspace`. Each test overrides only the facts under test, so
 *  the precedence (not an incidental field) is what flips the outcome. */
function facts(overrides: Partial<CanvasFacts> = {}): CanvasFacts {
  return {
    isLoading: false,
    daemonPending: false,
    down: undefined,
    warming: false,
    warmingLabel: "Connecting…",
    daemonState: "connected",
    terminalCount: 1,
    recordsAwaited: 0,
    channelLive: true,
    pendingTimedOut: false,
    isLocalHost: true,
    activeEntryFailed: false,
    ...overrides,
  };
}

describe("resolveCanvasMode precedence (#1340)", () => {
  it("connecting wins while the session is loading, regardless of all else", () => {
    expect(
      resolveCanvasMode(
        facts({
          isLoading: true,
          down: "dead",
          warming: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("connecting wins while daemon status is still pending", () => {
    // The #1034 gate: pending must beat a not-yet-arrived `down`/empty so a
    // dead boot never flashes the normal empty workspace first.
    expect(
      resolveCanvasMode(facts({ daemonPending: true, terminalCount: 0 })),
    ).toEqual({ kind: "connecting" });
  });

  it("a still-pending daemon status resolves to down/dead once past the connect timeout — never an eternal spinner", () => {
    // The #1713 adopt-path sibling's canvas symptom: a local padi that never comes
    // up at boot leaves `daemonPending` true FOREVER (no value is ever published).
    // Bounded by `pendingTimedOut`, the canvas must stop lying with "Connecting…"
    // and resolve honestly to `down` (dead — it never came up), reason surfaced.
    expect(
      resolveCanvasMode(
        facts({
          daemonPending: true,
          pendingTimedOut: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
    // The SAME facts before the timeout still hold the neutral connecting surface —
    // a merely-slow (but not yet abandoned) wait must not flash `down` early.
    expect(
      resolveCanvasMode(
        facts({
          daemonPending: true,
          pendingTimedOut: false,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("isLoading past the timeout also resolves to down/dead (the same bounded gate)", () => {
    expect(
      resolveCanvasMode(
        facts({ isLoading: true, pendingTimedOut: true, terminalCount: 0 }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
  });

  it("a REMOTE host past the local 30s ceiling stays `connecting` while its entry is merely provisioning — never a false 'kaval didn't start'", () => {
    // srid's exact class: `copying`/`warming` (nix-copy + build) legitimately outlasts the
    // LOCAL connect watchdog the ceiling mirrors. `activeEntryFailed` is false here — the
    // map projects `copying` to its `warming` entry status (never `failed`) — so the
    // ceiling must NOT fire for a remote host.
    expect(
      resolveCanvasMode(
        facts({
          daemonPending: true,
          pendingTimedOut: true,
          terminalCount: 0,
          isLocalHost: false,
          activeEntryFailed: false,
        }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("a REMOTE host past the ceiling resolves to down/dead once its entry is PROVEN failed", () => {
    // A genuine ssh dial/handshake failure — not "still provisioning" — still earns the
    // honest down/dead verdict, exactly like a local host past its ceiling.
    expect(
      resolveCanvasMode(
        facts({
          daemonPending: true,
          pendingTimedOut: true,
          terminalCount: 0,
          isLocalHost: false,
          activeEntryFailed: true,
        }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
  });

  it("down beats empty and carries its dead/degraded sub-state", () => {
    expect(
      resolveCanvasMode(facts({ down: "dead", terminalCount: 0 })),
    ).toEqual({ kind: "down", state: "dead" });
    expect(
      resolveCanvasMode(facts({ down: "degraded", terminalCount: 5 })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("down beats warming when both are set", () => {
    expect(
      resolveCanvasMode(facts({ down: "degraded", warming: true })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("warming beats empty and carries its label + daemonState payload", () => {
    const daemonState: DaemonState = "restarting";
    expect(
      resolveCanvasMode(
        facts({
          warming: true,
          warmingLabel: "Restarting kaval…",
          daemonState,
          terminalCount: 0,
        }),
      ),
    ).toEqual({
      kind: "warming",
      label: "Restarting kaval…",
      daemonState: "restarting",
    });
  });

  it("warming preserves an undefined daemonState (pre-first-yield label)", () => {
    expect(
      resolveCanvasMode(facts({ warming: true, daemonState: undefined })),
    ).toMatchObject({ kind: "warming", daemonState: undefined });
  });

  it("empty wins once up and idle with zero terminals", () => {
    expect(resolveCanvasMode(facts({ terminalCount: 0 }))).toEqual({
      kind: "empty",
    });
  });

  it("workspace is the ready default with terminals present", () => {
    expect(resolveCanvasMode(facts({ terminalCount: 3 }))).toEqual({
      kind: "workspace",
    });
  });

  it("reload: records still awaited hold `connecting`, then workspace once they compose", () => {
    // The restore-card-flash fix. On a browser reload the 7 live terminals' records
    // are in flight after the key list resolves — `terminalCount` is transiently 0
    // (metadata hasn't composed) while `recordsAwaited` is 7. `empty` here would flash
    // the restore card; the census holds `connecting` above it instead.
    expect(
      resolveCanvasMode(facts({ terminalCount: 0, recordsAwaited: 7 })),
    ).toEqual({ kind: "connecting" });
    // A beat later every record has composed live → the tiles show. No card was seen.
    expect(
      resolveCanvasMode(facts({ terminalCount: 7, recordsAwaited: 0 })),
    ).toEqual({ kind: "workspace" });
  });

  it("reboot: records all settled (parked) with zero tiles resolves to `empty`/restore", () => {
    // The case the card EXISTS for, and the reason `recordsAwaited` (not a bare
    // count==0) is the gate: a genuine reboot's records arrive PARKED, so they're
    // fully settled (`recordsAwaited === 0`) yet contribute no tile (`terminalCount`
    // 0). This must fall THROUGH the reload arm to `empty` so the restore card shows.
    expect(
      resolveCanvasMode(facts({ terminalCount: 0, recordsAwaited: 0 })),
    ).toEqual({ kind: "empty" });
  });

  it("floors `empty` on channel liveness (ws ∧ the active entry) — a dead ws OR a dead active remote entry never paints a stale 'no terminals'", () => {
    // The #1568 SHAPE A class (the canvas counterpart of the rail dot's kavalDot floor): "no
    // terminals" is a claim a dead channel can't confirm, so over a not-live channel the canvas
    // shows the neutral connecting surface (0 terminals) or the last-good workspace (terminals
    // on screen) — never `empty` with its active Restore / new-terminal affordances.
    // `channelLive` = ws ∧ the ACTIVE ENTRY's own connection, so this floors on BOTH a dead ws
    // AND a dead active REMOTE entry (whose re-served daemonStatus + terminal list freeze STALE
    // at connected/last-count — the RS5 gap this fix closed: the arm previously floored on the
    // ws leg alone and painted an authoritative empty over a dead remote). The post-grace
    // TransportOverlay owns the disconnect messaging. (`down`/`warming` arrive pre-floored from
    // their source accessors, so this gates the remaining arm.)
    // channelLive false = a dead ws OR a dead active remote entry (ws still live) → connecting:
    expect(
      resolveCanvasMode(facts({ channelLive: false, terminalCount: 0 })),
    ).toEqual({ kind: "connecting" });
    expect(
      resolveCanvasMode(facts({ channelLive: false, terminalCount: 3 })),
    ).toEqual({ kind: "workspace" });
    // Sanity: the SAME facts over a LIVE link still resolve to `empty` — the floor
    // only withholds the claim when the link is dead, never otherwise.
    expect(
      resolveCanvasMode(facts({ channelLive: true, terminalCount: 0 })),
    ).toEqual({ kind: "empty" });
  });
});
