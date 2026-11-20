import type { DaemonState } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { type CanvasFacts, resolveCanvasMode } from "./canvasModeResolver";

const liveness = {
  isLoading: false,
  daemonPending: false,
  isLocalHost: true,
} as const;

const notYetConnected = {
  ...liveness,
  connectLog: [],
  connectLogAbsence: undefined,
  connectQuiet: undefined,
} as const;

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

const NO_EARNED_BOOT = { earnedBoot: undefined } as const;

const mode = (facts: CanvasFacts, exceeded = false) =>
  resolveCanvasMode(facts, { ...NO_EARNED_BOOT, transportLive: true, exceeded })
    .mode;
const tag = (facts: CanvasFacts) =>
  resolveCanvasMode(facts, {
    ...NO_EARNED_BOOT,
    transportLive: true,
    exceeded: false,
  }).tag;

const modeOffline = (facts: CanvasFacts, exceeded = false) =>
  resolveCanvasMode(facts, {
    ...NO_EARNED_BOOT,
    transportLive: false,
    exceeded,
  }).mode;
const tagOffline = (facts: CanvasFacts) =>
  resolveCanvasMode(facts, {
    ...NO_EARNED_BOOT,
    transportLive: false,
    exceeded: false,
  }).tag;

describe("resolveCanvasMode loading guard (#1340)", () => {
  it("connecting wins while the session is loading, ahead of any connected-arm fact", () => {
    expect(
      mode(
        connected({
          down: { state: "dead" as const },
          warming: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "down", down: { state: "dead" } });
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
    expect(mode(connected({ daemonPending: true, terminalCount: 0 }))).toEqual({
      kind: "connecting",
    });
  });

  it("a still-pending daemon status escapes to down/dead once past the boot deadline — never an eternal spinner (#1713)", () => {
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), true),
    ).toEqual({ kind: "down", down: { state: "dead" } });
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), false),
    ).toEqual({ kind: "connecting" });
  });

  it("isLoading past the boot deadline escapes to boot-stalled(session) — the Hole B leg (migrated from the daemon-only ceiling)", () => {
    expect(
      mode(connected({ isLoading: true, terminalCount: 0 }), true),
    ).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
  });

  it("a REMOTE binding provisioning resolves to `warming` off its OWN connection cell — never a mute 'Connecting…' (W6 items 3+5)", () => {
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
    expect(mode(connected({ terminalCount: 5 }))).toEqual({
      kind: "workspace",
    });
    expect(mode(connected({ terminalCount: 0 }))).toEqual({ kind: "empty" });
    expect(
      mode({ ...notYetConnected, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("a FAILED entry reaches host-failed even past the boot deadline — the loading gate never intercepts a failed host (step-5 fix)", () => {
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

  it("keeps the WORKSPACE mounted while the census catches up — a creation must not unmount it", () => {
    const mid = connected({ terminalCount: 3, recordsAwaited: 1 });
    expect(mode(mid)).toEqual({ kind: "workspace" });
    expect(mode(mid, false)).toEqual({ kind: "workspace" });
  });

  it("a record that never composes escapes to the boot-stalled card rather than wedging the canvas silently", () => {
    const wedged = connected({ terminalCount: 3, recordsAwaited: 1 });
    expect(tag(wedged)).toMatchObject({
      accrual: "accrue",
      boot: { leg: "session" },
    });
    expect(mode(wedged, true)).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
  });

  it("a census over a DEAD channel is unchanged from master — retained, never certified", () => {
    const blind = connected({
      terminalCount: 0,
      recordsAwaited: 7,
      channelLive: false,
    });
    expect(tag(blind)).toEqual({ accrual: "retain" });
    expect(mode(blind, true)).toEqual({ kind: "connecting" });

    const blindWithTiles = connected({
      terminalCount: 3,
      recordsAwaited: 1,
      channelLive: false,
    });
    expect(tag(blindWithTiles)).toEqual({ accrual: "clear" });
    expect(mode(blindWithTiles, true)).toEqual({ kind: "workspace" });
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
        quiet: undefined,
      },
    });
  });

  it("D2 — the connector card carries the episode's LOG, not just its phase", () => {
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
        quiet: undefined,
      },
    });
    expect((m as { recovery: { log: unknown } }).recovery.log).toBe(connectLog);
  });

  it("D2 — ANY warming-remote phase escapes to the CONNECTOR card", () => {
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
          quiet: undefined,
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
    expect(
      tag({
        ...notYetConnected,
        entry: "not-a-member",
        connectPhase: "connecting",
      }),
    ).toEqual({
      accrual: "accrue",
      boot: {
        leg: "membership",
        ceiling: "local",
        phase: "connecting",
        log: [],
      },
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

  it("a records-awaited connecting over a DEAD channel is `retain` and does NOT escape", () => {
    const records = connected({
      terminalCount: 0,
      recordsAwaited: 7,
      channelLive: false,
    });
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
  it("local boot overlays accrue against the `local` cell", () => {
    expect(
      tag({
        ...notYetConnected,
        entry: "not-a-member",
        connectPhase: undefined,
      }),
    ).toEqual({
      accrual: "accrue",
      boot: {
        leg: "membership",
        ceiling: "local",
        log: [],
      },
    });
    expect(
      tag({ ...notYetConnected, entry: "warming", connectPhase: undefined }),
    ).toEqual({
      accrual: "accrue",
      boot: {
        leg: "daemon",
        ceiling: "local",
        log: [],
      },
    });
    expect(tag(connected({ isLoading: true, terminalCount: 0 }))).toEqual({
      accrual: "accrue",
      boot: {
        leg: "session",
        ceiling: "local",
        log: [],
      },
    });
    expect(
      tag(
        connected({ daemonPending: true, isLoading: false, terminalCount: 0 }),
      ),
    ).toEqual({
      accrual: "accrue",
      boot: {
        leg: "daemon",
        ceiling: "local",
        log: [],
      },
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
      boot: {
        leg: "provisioning",
        ceiling: "remote-provisioning",
        phase: "provisioning",
        log: [],
      },
    });
  });

  it("a remote handshake (probing/connecting/undefined) and a remote connected/not-a-member accrue against `remote-handshake`", () => {
    for (const connectPhase of ["probing", "connecting", undefined] as const) {
      expect(
        tag({
          ...notYetConnected,
          entry: "warming",
          connectPhase,
          isLocalHost: false,
        }),
      ).toMatchObject({
        accrual: "accrue",
        boot: {
          leg: "provisioning",
          ceiling: "remote-handshake",
        },
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
      boot: {
        leg: "membership",
        ceiling: "remote-handshake",
        log: [],
      },
    });
    expect(
      tag(connected({ isLoading: true, isLocalHost: false, terminalCount: 0 })),
    ).toEqual({
      accrual: "accrue",
      boot: {
        leg: "session",
        ceiling: "remote-handshake",
        log: [],
      },
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
  it("a re-pended daemon status over a DEAD transport never escapes to down/dead", () => {
    const outage = connected({
      daemonPending: true,
      terminalCount: 0,
      channelLive: false,
    });
    expect(tagOffline(outage)).toEqual({ accrual: "clear" });
    expect(modeOffline(outage)).toEqual({ kind: "connecting" });
  });

  it("a re-pended SESSION leg over a DEAD transport never escapes to boot-stalled(session)", () => {
    const outage = connected({
      isLoading: true,
      terminalCount: 0,
      channelLive: false,
    });
    expect(tagOffline(outage)).toEqual({ accrual: "clear" });
    expect(modeOffline(outage)).toEqual({ kind: "connecting" });
  });

  it("a membership snapshot lost to a DEAD transport never escapes to boot-stalled(membership)", () => {
    const outage: CanvasFacts = {
      ...notYetConnected,
      entry: "not-a-member",
      connectPhase: undefined,
    };
    expect(tagOffline(outage)).toEqual({ accrual: "clear" });
    expect(modeOffline(outage)).toEqual({ kind: "connecting" });
  });

  it("a LOCAL warming entry over a DEAD transport never escapes to the dead card", () => {
    const outage: CanvasFacts = {
      ...notYetConnected,
      entry: "warming",
      connectPhase: undefined,
    };
    expect(tagOffline(outage)).toEqual({ accrual: "clear" });
    expect(modeOffline(outage)).toEqual({
      kind: "warming",
      daemonState: undefined,
    });
  });

  it("the arm production ACTUALLY produces — an `unobservable` entry — makes no claim and starts no clock", () => {
    const blind: CanvasFacts = {
      ...notYetConnected,
      entry: "unobservable",
      connectPhase: undefined,
      connectLogAbsence: "link-down",
      connectQuiet: undefined,
    };
    expect(tagOffline(blind)).toEqual({ accrual: "clear" });
    expect(modeOffline(blind)).toEqual({ kind: "connecting" });
    expect(modeOffline(blind, true)).toEqual({ kind: "connecting" });
  });

  it("neutralizes the clock, never the surface — the floor returns the mode it was given", () => {
    const outage = connected({ terminalCount: 3, channelLive: false });
    expect(modeOffline(outage)).toEqual({ kind: "workspace" });
  });

  it("a LIVE transport still escapes exactly as before — the honest wedge is untouched", () => {
    expect(
      mode(connected({ daemonPending: true, terminalCount: 0 }), true),
    ).toEqual({ kind: "down", down: { state: "dead" } });
  });
});

describe("resolveCanvasMode — the floor governs reaching a verdict, not keeping one (AFP C6)", () => {
  it("an ALREADY-exceeded daemon verdict survives a transport drop, card and recovery verb intact", () => {
    const earned = connected({
      daemonPending: true,
      terminalCount: 0,
      channelLive: false,
    });
    expect(
      resolveCanvasMode(earned, {
        transportLive: false,
        exceeded: true,
        earnedBoot: { leg: "daemon", ceiling: "local" },
      }).mode,
    ).toEqual({
      kind: "down",
      down: { state: "dead" },
    });
  });

  it("an already-exceeded CONNECTOR verdict likewise survives, keeping its Retry affordance", () => {
    const earned: CanvasFacts = {
      ...notYetConnected,
      isLocalHost: false,
      entry: "warming",
      connectPhase: "provisioning",
    };
    expect(
      resolveCanvasMode(earned, {
        transportLive: false,
        exceeded: true,
        earnedBoot: { leg: "provisioning", ceiling: "remote-provisioning" },
      }).mode,
    ).toMatchObject({
      kind: "boot-stalled",
      recovery: { via: "connector" },
    });
  });

  it("a held verdict that cannot NAME its boot makes no claim — the exemption has no fallback", () => {
    const blind: CanvasFacts = {
      ...notYetConnected,
      entry: "unobservable",
      connectPhase: undefined,
      connectLogAbsence: "link-down",
      connectQuiet: undefined,
    };
    expect(modeOffline(blind, true)).toEqual({ kind: "connecting" });
    expect(
      resolveCanvasMode(blind, {
        ...NO_EARNED_BOOT,
        transportLive: false,
        exceeded: true,
      }).tag,
    ).toEqual({ accrual: "clear" });
  });

  it("holds the earned boot's IDENTITY while blind, but keeps the narration live", () => {
    const demoted: CanvasFacts = {
      ...notYetConnected,
      isLocalHost: false,
      entry: "warming",
      connectPhase: undefined,
      connectLogAbsence: "link-down",
      connectQuiet: undefined,
    };
    const earnedBoot = { leg: "session", ceiling: "remote-handshake" } as const;
    const held = resolveCanvasMode(demoted, {
      transportLive: false,
      exceeded: true,
      earnedBoot,
    });
    expect(held.mode).toEqual({
      kind: "boot-stalled",
      recovery: { via: "client", leg: "session" },
    });
    expect(held.tag).toMatchObject({ boot: earnedBoot });
    expect(
      resolveCanvasMode(demoted, {
        transportLive: true,
        exceeded: true,
        earnedBoot,
      }).tag,
    ).toMatchObject({ boot: { leg: "provisioning" } });
  });

  it("but a NOT-yet-exceeded deadline is still floored — the false card stays fixed", () => {
    const unearned = connected({
      daemonPending: true,
      terminalCount: 0,
      channelLive: false,
    });
    expect(tagOffline(unearned)).toEqual({ accrual: "clear" });
    expect(modeOffline(unearned)).toEqual({ kind: "connecting" });
  });
});

describe("resolveCanvasMode — while unobservable, no anchor: one rule, every variant", () => {
  it("a `retain` frame over a dead link releases the anchor like any other", () => {
    const retained = connected({
      terminalCount: 0,
      warming: true,
      daemonState: "restarting",
    });
    expect(tag(retained)).toEqual({ accrual: "retain" });
    expect(tagOffline(retained)).toEqual({ accrual: "clear" });
    expect(modeOffline(retained)).toEqual({
      kind: "warming",
      daemonState: "restarting",
    });
  });

  it("a settled `clear` frame over a dead link is still just clear", () => {
    const settled = connected({ terminalCount: 3 });
    expect(modeOffline(settled)).toEqual({ kind: "workspace" });
    expect(tagOffline(settled)).toEqual({ accrual: "clear" });
  });
});
