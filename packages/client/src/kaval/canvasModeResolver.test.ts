/** Pins the canvas-surface precedence the App shell delegates to
 *  `resolveCanvasMode` (#1340 thin-shell extraction; Skew-UX discriminated
 *  facts), plus the #1763 boot-deadline escape. The facts are keyed on the ACTIVE
 *  entry's connection state, and the arm ORDER is load-bearing correctness — the
 *  loading guard beats every arm; on the `connected` arm `down` and `warming` each
 *  beat `empty` so a dead/degraded or restarting kaval never masquerades as "you
 *  have no terminals" (#1034 empty-canvas lie + restart-drain).
 *
 *  `resolveCanvasMode(facts, { exceeded })` returns `{ mode, tag }`: `mode` is the
 *  surface to render, `tag` the boot-overlay classification the caller feeds to the
 *  per-host deadline anchor. `mode(f)` / `mode(f, true)` and `tag(f)` below are thin
 *  readers so the precedence and the escape are each pinned without repeating the
 *  wrapper shape. */

import type { DaemonState } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import { type CanvasFacts, resolveCanvasMode } from "./canvasModeResolver";

/** The liveness facts every arm carries — daemon up, session loaded, local host.
 *  Each factory below spreads these and adds its arm's own facts, so only the fact
 *  under test flips the outcome. */
const liveness = {
  isLoading: false,
  daemonPending: false,
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
    daemonState: "connected",
    terminalCount: 1,
    recordsAwaited: 0,
    channelLive: true,
    ...overrides,
  };
}

/** The rendered surface for `facts`, with the boot deadline NOT exceeded (default) or
 *  exceeded — the two readers every precedence/escape pin uses. */
const mode = (facts: CanvasFacts, exceeded = false) =>
  resolveCanvasMode(facts, { exceeded }).mode;
/** The boot-overlay classification the caller feeds to the per-host anchor. */
const tag = (facts: CanvasFacts) =>
  resolveCanvasMode(facts, { exceeded: false }).tag;

describe("resolveCanvasMode loading guard (#1340)", () => {
  it("connecting wins while the session is loading, ahead of any connected-arm fact", () => {
    // Without the guard these connected facts would resolve to `down`…
    expect(
      mode(
        connected({
          down: { state: "dead" as const },
          warming: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "down", down: { state: "dead" } });
    // …but with isLoading the guard fires first.
    expect(
      mode(
        connected({
          isLoading: true,
          down: { state: "dead" as const },
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("connecting wins while daemon status is still pending", () => {
    // The #1034 gate: pending must beat a not-yet-arrived down/empty so a dead
    // boot never flashes the normal empty workspace first.
    expect(mode(connected({ daemonPending: true, terminalCount: 0 }))).toEqual({
      kind: "connecting",
    });
  });

  it("a still-pending daemon status escapes to down/dead once past the boot deadline — never an eternal spinner (#1713)", () => {
    // A local padi that never comes up at boot leaves `daemonPending` true FOREVER.
    // Past the deadline the DAEMON leg on a LOCAL host escapes to the byte-identical
    // down/dead card (leg `daemon` + `isLocalHost`).
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), true),
    ).toEqual({ kind: "down", down: { state: "dead" } });
    // The SAME facts before the deadline still hold the neutral connecting surface.
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), false),
    ).toEqual({ kind: "connecting" });
  });

  it("isLoading past the boot deadline escapes to boot-stalled(session) — the Hole B leg (migrated from the daemon-only ceiling)", () => {
    // A connected host whose SESSION/list leg hung while the daemon delivered: past the
    // deadline this is the honest boot-stalled(session) card, NOT down/dead (that is the
    // daemon leg). Pre-#1763 this whole class had no escape at all.
    expect(
      mode(connected({ isLoading: true, terminalCount: 0 }), true),
    ).toEqual({ kind: "boot-stalled", leg: "session", phase: undefined });
  });

  it("a REMOTE binding coming up (connectPhase copying/building) resolves to `warming` off its OWN connection cell — never a mute 'Connecting…' (W6 items 3+5)", () => {
    // `copying`/`building` (nix-copy + build) legitimately outlasts the LOCAL connect ceiling
    // and accrues against the generous remote-provisioning cell instead — so BEFORE its
    // deadline it narrates warming, not an escape.
    expect(
      mode({
        ...liveness,
        entry: "warming",
        connectPhase: "copying",
        daemonPending: true,
        isLocalHost: false,
      }),
    ).toEqual({ kind: "warming", daemonState: undefined });
  });

  it("a LOCAL binding wedged past its ceiling still escapes to down/dead — the #1713 safety survives the connectPhase routing (:176-180 bindingUp path)", () => {
    // The overlay routes on `connectPhase`, but a LOCAL binding's own connect watchdog still
    // earns the down/dead verdict past the deadline (leg `daemon` + local) rather than a
    // forever-narrating overlay.
    expect(
      mode(
        {
          ...liveness,
          entry: "warming",
          connectPhase: "connecting",
          daemonPending: true,
          isLocalHost: true,
        },
        true,
      ),
    ).toEqual({ kind: "down", down: { state: "dead" } });
  });

  it("A' — a CONNECTED entry can NEVER show the connect overlay (the green-chip / Building-forever trap is unspellable)", () => {
    // A' removes `connectPhase` from the connected arm entirely, so a connected host with
    // terminals resolves straight to the workspace; the contradiction is a TYPE error
    // (pinned in `canvasModeResolver.test-d.ts`).
    expect(mode(connected({ terminalCount: 5 }))).toEqual({
      kind: "workspace",
    });
    // A connected-but-idle host still reaches `empty`, never a trapped overlay.
    expect(mode(connected({ terminalCount: 0 }))).toEqual({ kind: "empty" });
    // The cell flipped to `connected` but EntryStatus still says `warming` → the neutral
    // warming surface shows (its copy derived at render), no overlay.
    expect(
      mode({ ...liveness, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("a FAILED entry reaches host-failed even past the boot deadline — the loading gate never intercepts a failed host (step-5 fix)", () => {
    // A failed host BINDING has no daemon-status coming, so the deadline must NOT strand it —
    // it falls straight through to the cause-typed host-down card (and `failed` is `clear`,
    // so `exceeded` can't escape it).
    expect(
      mode(
        {
          ...liveness,
          entry: "failed",
          cause: "cross-supervisor",
          reason: "another kolu owns this host",
          daemonPending: true,
          isLocalHost: false,
        },
        true,
      ),
    ).toEqual({
      kind: "host-failed",
      cause: "cross-supervisor",
      reason: "another kolu owns this host",
    });
    expect(
      mode(
        {
          ...liveness,
          entry: "failed",
          cause: "link-failed",
          reason: "host unreachable",
          daemonPending: true,
          isLocalHost: false,
        },
        true,
      ),
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
      mode({ ...liveness, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("a failed entry resolves to host-failed carrying the typed cause + reason (never `down`, which is a dead KAVAL)", () => {
    expect(
      mode({
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
    expect(
      mode({
        ...liveness,
        entry: "failed",
        cause: "cross-supervisor",
        reason: "another supervisor owns this host",
      }),
    ).toMatchObject({ kind: "host-failed", cause: "cross-supervisor" });
  });

  it("a not-a-member entry (mid host-switch) holds the neutral connecting surface", () => {
    expect(
      mode({ ...liveness, entry: "not-a-member", connectPhase: undefined }),
    ).toEqual({
      kind: "connecting",
    });
  });
});

describe("resolveCanvasMode connected-arm precedence (#1034)", () => {
  it("down beats empty and carries its dead/degraded sub-state", () => {
    expect(
      mode(connected({ down: { state: "dead" as const }, terminalCount: 0 })),
    ).toEqual({ kind: "down", down: { state: "dead" } });
    expect(
      mode(
        connected({ down: { state: "degraded" as const }, terminalCount: 5 }),
      ),
    ).toEqual({ kind: "down", down: { state: "degraded" } });
  });

  it("down beats warming when both are set", () => {
    expect(
      mode(connected({ down: { state: "degraded" as const }, warming: true })),
    ).toEqual({ kind: "down", down: { state: "degraded" } });
  });

  it("warming beats empty and carries its daemonState payload (copy is derived at render)", () => {
    const daemonState: DaemonState = "restarting";
    expect(
      mode(connected({ warming: true, daemonState, terminalCount: 0 })),
    ).toEqual({ kind: "warming", daemonState: "restarting" });
  });

  it("warming preserves an undefined daemonState (pre-first-yield)", () => {
    expect(
      mode(connected({ warming: true, daemonState: undefined })),
    ).toMatchObject({ kind: "warming", daemonState: undefined });
  });

  it("empty wins once up and idle with zero terminals", () => {
    expect(mode(connected({ terminalCount: 0 }))).toEqual({ kind: "empty" });
  });

  it("workspace is the ready default with terminals present", () => {
    expect(mode(connected({ terminalCount: 3 }))).toEqual({
      kind: "workspace",
    });
  });

  it("reload: records still awaited hold `connecting`, then workspace once they compose", () => {
    expect(mode(connected({ terminalCount: 0, recordsAwaited: 7 }))).toEqual({
      kind: "connecting",
    });
    expect(mode(connected({ terminalCount: 7, recordsAwaited: 0 }))).toEqual({
      kind: "workspace",
    });
  });

  it("reboot: records all settled (parked) with zero tiles resolves to `empty`/restore", () => {
    expect(mode(connected({ terminalCount: 0, recordsAwaited: 0 }))).toEqual({
      kind: "empty",
    });
  });

  it("floors `empty` on channel liveness — a dead channel never paints a stale 'no terminals'", () => {
    expect(mode(connected({ channelLive: false, terminalCount: 0 }))).toEqual({
      kind: "connecting",
    });
    expect(mode(connected({ channelLive: false, terminalCount: 3 }))).toEqual({
      kind: "workspace",
    });
    expect(mode(connected({ channelLive: true, terminalCount: 0 }))).toEqual({
      kind: "empty",
    });
  });
});

describe("resolveCanvasMode — #1763 boot-deadline escape (flipped REDs + the leg map)", () => {
  // Hole B — flipped RED (was `it.fails` pinning the no-escape hole).
  it("Hole B — a CONNECTED host stuck on the session leg past the boot deadline escapes to boot-stalled(session)", () => {
    expect(
      mode(
        connected({ isLoading: true, daemonPending: false, terminalCount: 0 }),
        true,
      ),
    ).toEqual({ kind: "boot-stalled", leg: "session", phase: undefined });
  });

  // Hole A — flipped RED. Membership never grounded ⇒ not-a-member ⇒ escapes.
  it("Hole A — a NOT-A-MEMBER active host past the boot deadline escapes to boot-stalled(membership)", () => {
    expect(
      mode(
        { ...liveness, entry: "not-a-member", connectPhase: undefined },
        true,
      ),
    ).toEqual({ kind: "boot-stalled", leg: "membership", phase: undefined });
  });

  it("a hung REMOTE provisioning binding past its (generous) ceiling escapes to boot-stalled(provisioning) carrying the phase (C4 phase-render)", () => {
    expect(
      mode(
        {
          ...liveness,
          entry: "warming",
          connectPhase: "building",
          isLocalHost: false,
        },
        true,
      ),
    ).toEqual({ kind: "boot-stalled", leg: "provisioning", phase: "building" });
  });

  it("a hung REMOTE connected daemon leg escapes to boot-stalled(daemon) — only the LOCAL daemon leg takes down/dead", () => {
    expect(
      mode(
        connected({
          daemonPending: true,
          isLocalHost: false,
          terminalCount: 0,
        }),
        true,
      ),
    ).toEqual({ kind: "boot-stalled", leg: "daemon", phase: undefined });
  });

  it("C3(a) — a not-a-member entry that reaches the bindingUp warming return is still leg `membership`", () => {
    // A not-a-member with a defined connectPhase reaches the `bindingUp` warming return in the
    // shared block; its leg must stay `membership`, not `daemon`.
    expect(
      tag({ ...liveness, entry: "not-a-member", connectPhase: "connecting" }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "local",
    });
    expect(
      mode(
        { ...liveness, entry: "not-a-member", connectPhase: "connecting" },
        true,
      ),
    ).toEqual({ kind: "boot-stalled", leg: "membership", phase: "connecting" });
  });

  it("C3(c) — a HUNG local kaval-restart drain (entry warming, local) escapes to down/dead", () => {
    // A local daemon.restart drain drops the entry out of connected → it rides the warming arm
    // (leg `daemon`, ceiling local). A hung one escapes to the byte-identical down/dead card.
    expect(
      mode({ ...liveness, entry: "warming", connectPhase: undefined }, true),
    ).toEqual({ kind: "down", down: { state: "dead" } });
  });
});

describe("resolveCanvasMode — #1763 R2 exclusions (retain overlays never escape)", () => {
  it("a kaval-restart warming (connected arm, daemonState defined) is `retain` and does NOT escape past the deadline", () => {
    const restart = connected({
      warming: true,
      daemonState: "restarting",
      terminalCount: 0,
    });
    expect(tag(restart)).toEqual({ accrual: "retain" });
    expect(mode(restart, true)).toEqual({
      kind: "warming",
      daemonState: "restarting",
    });
  });

  it("a records-awaited connecting is `retain` and does NOT escape past the deadline", () => {
    const records = connected({ terminalCount: 0, recordsAwaited: 7 });
    expect(tag(records)).toEqual({ accrual: "retain" });
    expect(mode(records, true)).toEqual({ kind: "connecting" });
  });

  it("a !channelLive connecting (mid-session transport drop — the transport overlay owns it) is `retain` and does NOT escape", () => {
    const dropped = connected({ channelLive: false, terminalCount: 0 });
    expect(tag(dropped)).toEqual({ accrual: "retain" });
    expect(mode(dropped, true)).toEqual({ kind: "connecting" });
  });

  it("a settled workspace / empty / host-failed is `clear`", () => {
    expect(tag(connected({ terminalCount: 3 }))).toEqual({ accrual: "clear" });
    expect(tag(connected({ terminalCount: 0 }))).toEqual({ accrual: "clear" });
    expect(
      tag({
        ...liveness,
        entry: "failed",
        cause: "link-failed",
        reason: "x",
      }),
    ).toEqual({ accrual: "clear" });
  });
});

describe("resolveCanvasMode — #1763 R4 ceiling-class × leg table (exhaustive)", () => {
  // Every FINITE cell of the ceiling table, plus the leg each boot overlay declares.
  it("local boot overlays accrue against the `local` cell", () => {
    expect(
      tag({ ...liveness, entry: "not-a-member", connectPhase: undefined }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "local",
    });
    expect(
      tag({ ...liveness, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      accrual: "accrue",
      leg: "daemon",
      ceiling: "local",
    });
    expect(tag(connected({ isLoading: true, terminalCount: 0 }))).toEqual({
      accrual: "accrue",
      leg: "session",
      ceiling: "local",
    });
    expect(
      tag(
        connected({ daemonPending: true, isLoading: false, terminalCount: 0 }),
      ),
    ).toEqual({ accrual: "accrue", leg: "daemon", ceiling: "local" });
  });

  it("a remote provisioning binding (copying/building) accrues against `remote-provisioning` with leg `provisioning`", () => {
    expect(
      tag({
        ...liveness,
        entry: "warming",
        connectPhase: "copying",
        isLocalHost: false,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "provisioning",
      ceiling: "remote-provisioning",
    });
    expect(
      tag({
        ...liveness,
        entry: "warming",
        connectPhase: "building",
        isLocalHost: false,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "provisioning",
      ceiling: "remote-provisioning",
    });
  });

  it("a remote handshake (probing/connecting/undefined) and a remote connected/not-a-member accrue against `remote-handshake`", () => {
    for (const connectPhase of ["probing", "connecting", undefined] as const) {
      expect(
        tag({
          ...liveness,
          entry: "warming",
          connectPhase,
          isLocalHost: false,
        }),
      ).toMatchObject({ accrual: "accrue", ceiling: "remote-handshake" });
    }
    expect(
      tag({
        ...liveness,
        entry: "not-a-member",
        connectPhase: undefined,
        isLocalHost: false,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "remote-handshake",
    });
    expect(
      tag(connected({ isLoading: true, isLocalHost: false, terminalCount: 0 })),
    ).toEqual({
      accrual: "accrue",
      leg: "session",
      ceiling: "remote-handshake",
    });
  });
});

describe("resolveCanvasMode — the incompatible (proven-skew) verdict, SK4", () => {
  it("flows to the down mode WITH its typed version payload — the skew card renders both versions", () => {
    expect(
      mode(
        connected({
          down: {
            state: "incompatible" as const,
            daemonVersion: "5.0",
            requiredVersion: "5.2",
          },
          terminalCount: 0,
        }),
      ),
    ).toEqual({
      kind: "down",
      down: {
        state: "incompatible",
        daemonVersion: "5.0",
        requiredVersion: "5.2",
      },
    });
  });

  it("beats warming and empty exactly like dead/degraded — a terminal verdict, not a transient", () => {
    expect(
      mode(
        connected({
          down: {
            state: "incompatible" as const,
            daemonVersion: "5.0",
            requiredVersion: "5.2",
          },
          warming: true,
          terminalCount: 3,
        }),
      ).kind,
    ).toBe("down");
  });
});
