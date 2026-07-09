/** Pins the canvas-surface precedence the App shell delegates to
 *  `resolveCanvasMode` (#1340 thin-shell extraction; Skew-UX discriminated
 *  facts). The facts are keyed on the ACTIVE entry's connection state, and the
 *  arm ORDER is load-bearing correctness — the loading guard beats every arm; on
 *  the `connected` arm `down` and `warming` each beat `empty` so a dead/degraded
 *  or restarting kaval never masquerades as "you have no terminals" (#1034
 *  empty-canvas lie + restart-drain). Imports the pure resolver only, so the
 *  precedence is exercised without mounting the daemon-status subscription. */

import type { DaemonState } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import { type CanvasFacts, resolveCanvasMode } from "./canvasModeResolver";

/** The liveness facts every arm carries — daemon up, session loaded, not timed
 *  out, local host. Each factory below spreads these and adds its arm's own
 *  facts, so only the fact under test flips the outcome. */
const liveness = {
  isLoading: false,
  daemonPending: false,
  pendingTimedOut: false,
  isLocalHost: true,
} as const;

/** A fully "ready" CONNECTED-arm snapshot — one terminal — that resolves to
 *  `workspace`. Each test overrides only the connected-arm facts under test. */
function connected(
  overrides: Partial<Extract<CanvasFacts, { entry: "connected" }>> = {},
): CanvasFacts {
  return {
    ...liveness,
    entry: "connected",
    down: undefined,
    warming: false,
    warmingLabel: "Connecting…",
    daemonState: "connected",
    terminalCount: 1,
    recordsAwaited: 0,
    channelLive: true,
    ...overrides,
  };
}

describe("resolveCanvasMode loading guard (#1340)", () => {
  it("connecting wins while the session is loading, ahead of any connected-arm fact", () => {
    // Without the guard these connected facts would resolve to `down`…
    expect(
      resolveCanvasMode(
        connected({ down: "dead", warming: true, terminalCount: 0 }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
    // …but with isLoading the guard fires first.
    expect(
      resolveCanvasMode(
        connected({ isLoading: true, down: "dead", terminalCount: 0 }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("connecting wins while daemon status is still pending", () => {
    // The #1034 gate: pending must beat a not-yet-arrived down/empty so a dead
    // boot never flashes the normal empty workspace first.
    expect(
      resolveCanvasMode(connected({ daemonPending: true, terminalCount: 0 })),
    ).toEqual({ kind: "connecting" });
  });

  it("a still-pending daemon status resolves to down/dead once past the connect timeout — never an eternal spinner", () => {
    // The #1713 adopt-path sibling's canvas symptom: a local padi that never comes
    // up at boot leaves `daemonPending` true FOREVER (no value ever published).
    // Bounded by `pendingTimedOut`, the canvas resolves honestly to `down` (dead).
    expect(
      resolveCanvasMode(
        connected({
          daemonPending: true,
          pendingTimedOut: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
    // The SAME facts before the timeout still hold the neutral connecting surface.
    expect(
      resolveCanvasMode(
        connected({
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
        connected({ isLoading: true, pendingTimedOut: true, terminalCount: 0 }),
      ),
    ).toEqual({ kind: "down", state: "dead" });
  });

  it("a REMOTE binding coming up (connectPhase copying/building) resolves to `warming` off its OWN connection cell — never a mute 'Connecting…' (W6 items 3+5)", () => {
    // srid's exact class: `copying`/`building` (nix-copy + build) legitimately outlasts
    // the LOCAL connect watchdog, and the re-served daemon-status never yields until it
    // CONNECTS — so `daemonPending` stays true the whole time. W6: the overlay routes on
    // the ACTIVE host's OWN `connectPhase` (the SAME channel ConnectCanvas narrates off),
    // so a provisioning phase resolves to `warming` regardless of the loading gate. Pre-W6
    // this returned a mute `{ kind: "connecting" }` — indistinguishable from a hang.
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "warming",
        warmingLabel: "Connecting…",
        connectPhase: "copying",
        daemonPending: true,
        pendingTimedOut: true,
        isLocalHost: false,
      }),
    ).toEqual({
      kind: "warming",
      label: "Connecting…",
      daemonState: undefined,
    });
  });

  it("a LOCAL binding wedged past its connect ceiling still earns down/dead — the #1713 safety survives the connectPhase routing", () => {
    // The overlay routes on `connectPhase`, but a LOCAL endpoint's own connect watchdog
    // still earns the `pendingTimedOut` → down/dead verdict rather than a forever-
    // narrating overlay (a remote's ssh + nix copy + build legitimately outlasts it).
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "warming",
        warmingLabel: "Connecting…",
        connectPhase: "connecting",
        daemonPending: true,
        pendingTimedOut: true,
        isLocalHost: true,
      }),
    ).toEqual({ kind: "down", state: "dead" });
  });

  it("A' — a CONNECTED entry can NEVER show the connect overlay (the green-chip / Building-forever trap is unspellable)", () => {
    // THE LIVE BUG (srid, deployed 5ec5347): EntryStatus `connected` (green chip) while the
    // lagging/stale connection cell still read `building` routed the canvas to ConnectCanvas
    // FOREVER — the connected arm's workspace path was structurally unreachable. A' removes
    // `connectPhase` from the connected arm entirely, so a connected host with terminals
    // resolves straight to the workspace; the contradiction is a TYPE error, not a runtime
    // tie (pinned in `canvasModeResolver.test-d.ts`). The connect overlay routes off the cell
    // ONLY while the entry itself is pre-connected (the warming/not-a-member arms below).
    expect(resolveCanvasMode(connected({ terminalCount: 5 }))).toEqual({
      kind: "workspace",
    });
    // A connected-but-idle host still reaches `empty`, never a trapped overlay.
    expect(resolveCanvasMode(connected({ terminalCount: 0 }))).toEqual({
      kind: "empty",
    });
    // The cell flipped to `connected` but EntryStatus still says `warming` → the overlay does
    // NOT show; the warming label shows. `connectPhase` is typed `ConnectPhase`, so a
    // `connected` cell phase is UNCONSTRUCTIBLE on this arm — `useCanvasMode` narrows it to
    // `undefined` at the facts boundary, which is what the resolver sees (no overlay).
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "warming",
        warmingLabel: "Restarting kaval…",
        connectPhase: undefined,
      }),
    ).toEqual({
      kind: "warming",
      label: "Restarting kaval…",
      daemonState: undefined,
    });
  });

  it("a FAILED entry reaches host-failed even with daemonPending + past the ceiling — the loading gate never intercepts a failed host (step-5 fix)", () => {
    // A failed host BINDING has no daemon-status coming (`daemonPending` stays true
    // forever), so the loading gate must NOT strand it at connecting/down — it falls
    // straight through to the cause-typed host-down card. Regression: a real
    // cross-supervisor host rendered "Connecting…" / the kaval-dead card instead of
    // "Another kolu owns this host" because the gate's `entry === "failed"` ceiling
    // intercepted it before the `failed` arm (caught driving a live sincereintent).
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "failed",
        cause: "cross-supervisor",
        reason: "another kolu owns this host",
        daemonPending: true,
        pendingTimedOut: true,
        isLocalHost: false,
      }),
    ).toEqual({
      kind: "host-failed",
      cause: "cross-supervisor",
      reason: "another kolu owns this host",
    });
    // And a link-failed host binding likewise reaches its card, not the kaval-dead one.
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "failed",
        cause: "link-failed",
        reason: "host unreachable",
        daemonPending: true,
        pendingTimedOut: true,
        isLocalHost: false,
      }),
    ).toEqual({
      kind: "host-failed",
      cause: "link-failed",
      reason: "host unreachable",
    });
  });
});

describe("resolveCanvasMode entry-state arms (Skew-UX)", () => {
  it("a warming entry (host binding coming up) shows the warming surface with no kaval daemonState", () => {
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "warming",
        warmingLabel: "Connecting…",
        connectPhase: undefined,
      }),
    ).toEqual({
      kind: "warming",
      label: "Connecting…",
      daemonState: undefined,
    });
  });

  it("a failed entry resolves to host-failed carrying the typed cause + reason (never `down`, which is a dead KAVAL)", () => {
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "failed",
        cause: "contract-skew-refused",
        reason: "remote padi contract skew",
      }),
    ).toEqual({
      kind: "host-failed",
      cause: "contract-skew-refused",
      reason: "remote padi contract skew",
    });
    // cross-supervisor rides the SAME arm — it is a first-class cause, not `other`.
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "failed",
        cause: "cross-supervisor",
        reason: "another supervisor owns this host",
      }),
    ).toMatchObject({ kind: "host-failed", cause: "cross-supervisor" });
  });

  it("a not-a-member entry (mid host-switch) holds the neutral connecting surface", () => {
    expect(
      resolveCanvasMode({
        ...liveness,
        entry: "not-a-member",
        connectPhase: undefined,
      }),
    ).toEqual({
      kind: "connecting",
    });
  });
});

describe("resolveCanvasMode connected-arm precedence (#1034)", () => {
  it("down beats empty and carries its dead/degraded sub-state", () => {
    expect(
      resolveCanvasMode(connected({ down: "dead", terminalCount: 0 })),
    ).toEqual({ kind: "down", state: "dead" });
    expect(
      resolveCanvasMode(connected({ down: "degraded", terminalCount: 5 })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("down beats warming when both are set", () => {
    expect(
      resolveCanvasMode(connected({ down: "degraded", warming: true })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("warming beats empty and carries its label + daemonState payload", () => {
    const daemonState: DaemonState = "restarting";
    expect(
      resolveCanvasMode(
        connected({
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
      resolveCanvasMode(connected({ warming: true, daemonState: undefined })),
    ).toMatchObject({ kind: "warming", daemonState: undefined });
  });

  it("empty wins once up and idle with zero terminals", () => {
    expect(resolveCanvasMode(connected({ terminalCount: 0 }))).toEqual({
      kind: "empty",
    });
  });

  it("workspace is the ready default with terminals present", () => {
    expect(resolveCanvasMode(connected({ terminalCount: 3 }))).toEqual({
      kind: "workspace",
    });
  });

  it("reload: records still awaited hold `connecting`, then workspace once they compose", () => {
    // The restore-card-flash fix. On a browser reload the live terminals' records
    // are in flight after the key list resolves — `terminalCount` is transiently 0
    // while `recordsAwaited` is 7. `empty` here would flash the restore card; the
    // census holds `connecting` above it instead.
    expect(
      resolveCanvasMode(connected({ terminalCount: 0, recordsAwaited: 7 })),
    ).toEqual({ kind: "connecting" });
    expect(
      resolveCanvasMode(connected({ terminalCount: 7, recordsAwaited: 0 })),
    ).toEqual({ kind: "workspace" });
  });

  it("reboot: records all settled (parked) with zero tiles resolves to `empty`/restore", () => {
    // The case the card EXISTS for: a genuine reboot's records arrive PARKED, so
    // they're fully settled (`recordsAwaited === 0`) yet contribute no tile
    // (`terminalCount` 0). This falls THROUGH the reload arm to `empty`.
    expect(
      resolveCanvasMode(connected({ terminalCount: 0, recordsAwaited: 0 })),
    ).toEqual({ kind: "empty" });
  });

  it("floors `empty` on channel liveness — a dead channel never paints a stale 'no terminals'", () => {
    // The #1568 SHAPE A class: "no terminals" is a claim a dead channel can't
    // confirm, so over a not-live channel the canvas shows the neutral connecting
    // surface (0 terminals) or the last-good workspace (terminals on screen) — never
    // `empty` with its active Restore / new-terminal affordances.
    expect(
      resolveCanvasMode(connected({ channelLive: false, terminalCount: 0 })),
    ).toEqual({ kind: "connecting" });
    expect(
      resolveCanvasMode(connected({ channelLive: false, terminalCount: 3 })),
    ).toEqual({ kind: "workspace" });
    // Sanity: the SAME facts over a LIVE channel still resolve to `empty`.
    expect(
      resolveCanvasMode(connected({ channelLive: true, terminalCount: 0 })),
    ).toEqual({ kind: "empty" });
  });
});
