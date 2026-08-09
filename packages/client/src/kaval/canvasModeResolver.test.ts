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
  transportLive: true,
} as const;

/** The NOT-YET-CONNECTED arms' base: liveness plus the connection cell's retained output
 *  tail, which only those arms carry (the connected arm has neither it nor `connectPhase`).
 *  The tail is payload the boot-stalled connector card renders, never an input to a
 *  precedence decision — so every PRECEDENCE pin leaves it empty and overrides only the
 *  fact under test. The one exception is deliberate: "the connector card carries the
 *  episode's LOG" sets a non-empty tail, because a base that only ever supplies `undefined`
 *  cannot tell a working thread-through from a severed one. `connectLogAbsence` is
 *  `undefined` throughout — the base case, "these lines ARE what it printed"; the one pin
 *  that exercises a real reason sets it explicitly. */
const notYetConnected = {
  ...liveness,
  connectLog: [],
  connectLogAbsence: undefined,
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
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
  });

  it("a REMOTE binding provisioning resolves to `warming` off its OWN connection cell — never a mute 'Connecting…' (W6 items 3+5)", () => {
    // Provisioning legitimately outlasts the LOCAL connect ceiling
    // and accrues against the generous remote-provisioning cell instead — so BEFORE its
    // deadline it narrates warming, not an escape.
    expect(
      mode({
        ...notYetConnected,
        entry: "warming",
        connectPhase: "provisioning",
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
          ...notYetConnected,
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
      mode({ ...notYetConnected, entry: "warming", connectPhase: undefined }),
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
          daemonPending: true,
          isLocalHost: false,
        },
        true,
      ),
    ).toEqual({ kind: "host-failed" });
  });
});

describe("resolveCanvasMode entry-state arms (Skew-UX)", () => {
  it("a warming entry (host binding coming up) shows the warming surface with no kaval daemonState", () => {
    expect(
      mode({ ...notYetConnected, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("a failed entry resolves to host-failed (never `down`, which is a dead KAVAL) — a ROUTING verdict with no failure payload", () => {
    // The episode the card renders is read as one value by `failedEpisode` — so the
    // resolver decides only WHICH surface, and this arm carries nothing to go stale.
    expect(mode({ ...liveness, entry: "failed" })).toEqual({
      kind: "host-failed",
    });
  });

  it("a not-a-member entry (mid host-switch) holds the neutral connecting surface", () => {
    expect(
      mode({
        ...notYetConnected,
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
  it("Hole B — a CONNECTED host stuck on the session leg past the boot deadline escapes to boot-stalled(client/session)", () => {
    expect(
      mode(
        connected({ isLoading: true, daemonPending: false, terminalCount: 0 }),
        true,
      ),
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
  });

  // Hole A — flipped RED. Membership never grounded ⇒ not-a-member ⇒ escapes.
  it("Hole A — a NOT-A-MEMBER active host past the boot deadline escapes to boot-stalled(client/membership)", () => {
    expect(
      mode(
        { ...notYetConnected, entry: "not-a-member", connectPhase: undefined },
        true,
      ),
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "membership" },
    });
  });

  it("D2 — a hung REMOTE provisioning binding escapes to the NON-terminal CONNECTOR card carrying the phase (never the reload lie)", () => {
    expect(
      mode(
        {
          ...notYetConnected,
          entry: "warming",
          connectPhase: "provisioning",
          isLocalHost: false,
        },
        true,
      ),
    ).toEqual({
      kind: "boot-stalled",
      recovery: {
        via: "connector",
        phase: "provisioning",
        log: [],
        logAbsence: undefined,
      },
    });
  });

  it("D2 — the connector card carries the episode's LOG, not just its phase", () => {
    // The pin that the rest of the D2 cases cannot provide: every other fixture leaves
    // `connectLog` undefined, and vitest treats a missing key as `undefined`, so a
    // regression that stopped threading `f.connectLog` through the accrue tag into the
    // recovery would still typecheck AND stay green — while the stalled-provisioning card
    // silently went back to showing a phase with no evidence, which is the whole defect
    // this change exists to close. Assert the tail arrives by REFERENCE, so a future
    // copy/slice at the seam has to be a deliberate edit here too.
    const connectLog = [
      {
        source: "local" as const,
        line: "zest: provisioning '/nix/store/…drv' on remote…",
      },
      {
        source: "remote" as const,
        line: "error: builder for '…kolu-typecheck.drv' failed",
      },
    ];
    const m = mode(
      {
        ...notYetConnected,
        entry: "warming",
        connectPhase: "provisioning",
        isLocalHost: false,
        connectLog,
      },
      true,
    );
    expect(m).toEqual({
      kind: "boot-stalled",
      recovery: {
        via: "connector",
        phase: "provisioning",
        log: connectLog,
        logAbsence: undefined,
      },
    });
    expect((m as { recovery: { log: unknown } }).recovery.log).toBe(connectLog);
  });

  it("D2 — ANY warming-remote phase escapes to the CONNECTOR card", () => {
    // Pre-D2 a warming-remote handshake phase mislabeled `daemon` and rendered the TERMINAL
    // "agent isn't responding — Reload" card over a connector still retrying. Now every warming
    // REMOTE phase is the connector-owned campaign → the non-terminal Reconnect card.
    for (const connectPhase of ["probing", "connecting"] as const) {
      expect(
        mode(
          {
            ...notYetConnected,
            entry: "warming",
            connectPhase,
            isLocalHost: false,
          },
          true,
        ),
      ).toEqual({
        kind: "boot-stalled",
        recovery: {
          via: "connector",
          phase: connectPhase,
          log: [],
          logAbsence: undefined,
        },
      });
    }
  });

  it("a hung REMOTE connected daemon leg escapes to boot-stalled(client/daemon) — genuinely client-side (Reload); only the LOCAL daemon leg takes down/dead", () => {
    expect(
      mode(
        connected({
          daemonPending: true,
          isLocalHost: false,
          terminalCount: 0,
        }),
        true,
      ),
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "daemon" },
    });
  });

  it("C3(a) — a not-a-member entry that reaches the bindingUp warming return is still leg `membership` (client card)", () => {
    // A not-a-member with a defined connectPhase reaches the `bindingUp` warming return in the
    // shared block; its leg must stay `membership`, not `provisioning`/`daemon`.
    expect(
      tag({
        ...notYetConnected,
        entry: "not-a-member",
        connectPhase: "connecting",
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "local",
      phase: "connecting",
      log: [],
    });
    expect(
      mode(
        {
          ...notYetConnected,
          entry: "not-a-member",
          connectPhase: "connecting",
        },
        true,
      ),
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "membership" },
    });
  });

  it("C3(c) — a HUNG local kaval-restart drain (entry warming, local) escapes to down/dead", () => {
    // A local daemon.restart drain drops the entry out of connected → it rides the warming arm
    // (leg `daemon`, ceiling local). A hung one escapes to the byte-identical down/dead card.
    expect(
      mode(
        { ...notYetConnected, entry: "warming", connectPhase: undefined },
        true,
      ),
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
    expect(tag({ ...liveness, entry: "failed" })).toEqual({
      accrual: "clear",
    });
  });
});

describe("resolveCanvasMode — #1763 R4 ceiling-class × leg table (exhaustive)", () => {
  // Every FINITE cell of the ceiling table, plus the leg each boot overlay declares.
  it("local boot overlays accrue against the `local` cell", () => {
    expect(
      tag({
        ...notYetConnected,
        entry: "not-a-member",
        connectPhase: undefined,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "local",
      log: [],
    });
    expect(
      tag({ ...notYetConnected, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      accrual: "accrue",
      leg: "daemon",
      ceiling: "local",
      log: [],
    });
    expect(tag(connected({ isLoading: true, terminalCount: 0 }))).toEqual({
      accrual: "accrue",
      leg: "session",
      ceiling: "local",
      log: [],
    });
    expect(
      tag(
        connected({ daemonPending: true, isLoading: false, terminalCount: 0 }),
      ),
    ).toEqual({
      accrual: "accrue",
      leg: "daemon",
      ceiling: "local",
      log: [],
    });
  });

  it("a remote provisioning binding accrues against the remote-provisioning ceiling", () => {
    expect(
      tag({
        ...notYetConnected,
        entry: "warming",
        connectPhase: "provisioning",
        isLocalHost: false,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "provisioning",
      ceiling: "remote-provisioning",
      phase: "provisioning",
      log: [],
    });
  });

  it("a remote handshake (probing/connecting/undefined) and a remote connected/not-a-member accrue against `remote-handshake`", () => {
    for (const connectPhase of ["probing", "connecting", undefined] as const) {
      // D2: a warming REMOTE entry is the connector-owned `provisioning` leg for EVERY phase
      // (its ceiling still keys on the phase → remote-handshake outside provisioning).
      expect(
        tag({
          ...notYetConnected,
          entry: "warming",
          connectPhase,
          isLocalHost: false,
        }),
      ).toMatchObject({
        accrual: "accrue",
        leg: "provisioning",
        ceiling: "remote-handshake",
      });
    }
    expect(
      tag({
        ...notYetConnected,
        entry: "not-a-member",
        connectPhase: undefined,
        isLocalHost: false,
      }),
    ).toEqual({
      accrual: "accrue",
      leg: "membership",
      ceiling: "remote-handshake",
      log: [],
    });
    expect(
      tag(connected({ isLoading: true, isLocalHost: false, terminalCount: 0 })),
    ).toEqual({
      accrual: "accrue",
      leg: "session",
      ceiling: "remote-handshake",
      log: [],
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

describe("resolveCanvasMode — a transport-down browser makes NO boot claim (#2129)", () => {
  // THE FIELD BUG: a fullscreen game backgrounded the tab, Chrome throttled its timers
  // to ~1/min, and the ws to kolu-server dropped for minutes at a time. The retry fence
  // re-pends every subscription on a drop, so `daemonPending` read true for the whole
  // outage — while the boot deadline's MONOTONIC clock kept advancing in the throttled
  // tab. 30s later the resolver converted a DROPPED SOCKET into "kaval didn't start",
  // stacked under the honest "Reconnecting…" overlay. kaval had been running for 12
  // hours with all 10 PTYs alive.
  //
  // The law these pin: a boot deadline may accrue ONLY while THIS browser's link to the
  // server is live. With the link down we cannot observe a boot, so we make no claim
  // about one — the surface is unchanged (the transport overlay owns the screen) and the
  // anchor is RELEASED, so observation restarts with a fresh window on reconnect rather
  // than firing the instant the socket returns.

  it("a re-pended daemon status over a DEAD transport never escapes to down/dead", () => {
    const outage = connected({
      daemonPending: true,
      terminalCount: 0,
      channelLive: false,
      transportLive: false,
    });
    // Not a boot overlay at all: nothing to accrue, anchor released.
    expect(tag(outage)).toEqual({ accrual: "clear" });
    // …so even long past the ceiling it stays the neutral surface, never the dead card.
    expect(mode(outage, true)).toEqual({ kind: "connecting" });
  });

  it("a re-pended SESSION leg over a DEAD transport never escapes to boot-stalled(session)", () => {
    const outage = connected({
      isLoading: true,
      terminalCount: 0,
      channelLive: false,
      transportLive: false,
    });
    expect(tag(outage)).toEqual({ accrual: "clear" });
    expect(mode(outage, true)).toEqual({ kind: "connecting" });
  });

  it("a membership snapshot lost to a DEAD transport never escapes to boot-stalled(membership)", () => {
    // The map's own entries are floored on transport liveness, so an outage can demote the
    // active host to `not-a-member` — which accrued the membership leg and, past the
    // ceiling, blamed a wedged membership for what was a dropped socket.
    const outage: CanvasFacts = {
      ...notYetConnected,
      transportLive: false,
      entry: "not-a-member",
      connectPhase: undefined,
    };
    expect(tag(outage)).toEqual({ accrual: "clear" });
    expect(mode(outage, true)).toEqual({ kind: "connecting" });
  });

  it("a LOCAL warming entry over a DEAD transport never escapes to the dead card", () => {
    // The warming arm reaches the same down/dead escape via leg `daemon` + local, so the
    // floor has to hold there too — a kaval restart-drain and a dropped socket look
    // identical from a browser that cannot reach the server.
    const outage: CanvasFacts = {
      ...notYetConnected,
      transportLive: false,
      entry: "warming",
      connectPhase: undefined,
    };
    expect(tag(outage)).toEqual({ accrual: "clear" });
    expect(mode(outage, true)).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("keeps painting the WORKSPACE behind the overlay — the floor neutralizes the clock, never the surface", () => {
    // The transport overlay dims but passes clicks through so scrollback stays readable;
    // blanking the canvas on every drop would be a worse lie than the one being fixed.
    const outage = connected({
      terminalCount: 3,
      channelLive: false,
      transportLive: false,
    });
    expect(mode(outage, true)).toEqual({ kind: "workspace" });
  });

  it("a LIVE transport still escapes exactly as before — the honest wedge is untouched", () => {
    // The regression guard for the floor itself: with the link up, a daemon that never
    // reports IS a real boot failure and must still reach the dead card at the ceiling.
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), true),
    ).toEqual({ kind: "down", down: { state: "dead" } });
  });
});
