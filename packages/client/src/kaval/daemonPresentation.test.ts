import type { DaemonStatus } from "@kolu/padi-client/surface";
import {
  ENDPOINT_STATES,
  isDownEndpointState,
} from "@kolu/surface-daemon-supervisor/states";
import { describe, expect, it } from "vitest";
import {
  channelLive,
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  formatLifetime,
  kavalPresencePresentation,
  liveDownState,
  liveWarming,
  offerRestartVerb,
  presenceState,
  serverDot,
  toKavalPresence,
  toneDot,
} from "./daemonPresentation";
import { kavalAttention } from "./kavalCurrency";

const down = (state: "dead" | "degraded"): DaemonStatus => ({ state });

const incompatibleStatus = (): DaemonStatus => ({
  state: "incompatible",
  daemonVersion: "5.0",
  requiredVersion: "5.2",
});

const minimalConnected = (): DaemonStatus => ({
  state: "connected",
  identity: { staleKey: "k", navigableCommit: "c".repeat(40) },
  contractVersion: "5.2",
  startedAt: 1,
});

describe("DAEMON_STATE_PRESENTATION.down — the table's VALUES equal the states' home classification", () => {
  it("every state's `down` flag equals isDownEndpointState(state)", () => {
    for (const s of ENDPOINT_STATES) {
      expect(DAEMON_STATE_PRESENTATION[s].down).toBe(isDownEndpointState(s));
    }
  });
});

describe("serverDot — the server-connection dot's green FLOORED on the watchdog fact", () => {
  it("paints green (ok) only when LIVE; a half-open (open but not-live) reads reconnecting, never green", () => {
    expect(serverDot("open", true)).toBe(toneDot.ok);
    expect(serverDot("open", false)).toBe(toneDot.warming);
    expect(serverDot("open", false)).not.toBe(toneDot.ok);
  });

  it("a genuine closed/connecting keeps its own honest tone — the floor only withholds the open→green claim", () => {
    expect(serverDot("closed", false)).toBe(toneDot.down);
    expect(serverDot("connecting", false)).toBe(toneDot.warming);
    expect(serverDot("connecting", true)).toBe(toneDot.warming);
  });
});

describe("liveWarming / liveDownState — daemon-state claims FLOORED on transport liveness", () => {
  it("liveWarming is true ONLY over a live link", () => {
    expect(liveWarming("restarting", true)).toBe(true);
    expect(liveWarming("connecting", true)).toBe(true);
    expect(liveWarming("restarting", false)).toBe(false);
    expect(liveWarming("connecting", false)).toBe(false);
    expect(liveWarming("connected", true)).toBe(false);
    expect(liveWarming(undefined, true)).toBe(false);
  });

  it("liveDownState is the down sub-state ONLY over a live link, else undefined (unknown ≠ down)", () => {
    expect(liveDownState(down("dead"), true)).toEqual({ state: "dead" });
    expect(liveDownState(down("degraded"), true)).toEqual({
      state: "degraded",
    });
    expect(liveDownState(incompatibleStatus(), true)).toEqual({
      state: "incompatible",
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });
    expect(liveDownState(down("dead"), false)).toBeUndefined();
    expect(liveDownState(down("degraded"), false)).toBeUndefined();
    expect(liveDownState(incompatibleStatus(), false)).toBeUndefined();
    expect(liveDownState(minimalConnected(), true)).toBeUndefined();
    expect(liveDownState(undefined, true)).toBeUndefined();
  });
});

describe("the active-entry leg — the SECOND floor on the host-scoped kaval daemonStatus (#1568, remote)", () => {
  it("channelLive: the channel is live ONLY when the transport AND the active entry are both connected", () => {
    expect(channelLive(true, true)).toBe(true);
    expect(channelLive(true, false)).toBe(false);
    expect(channelLive(false, true)).toBe(false);
    expect(channelLive(false, false)).toBe(false);
  });

  it("the dot: a `connected` daemon over a live transport but a non-connected active entry reads UNKNOWN, not green", () => {
    expect(
      kavalPresencePresentation(
        toKavalPresence(minimalConnected(), channelLive(true, false)),
      ).dot,
    ).toBe(DAEMON_UNKNOWN_DOT);
    expect(
      kavalPresencePresentation(
        toKavalPresence(minimalConnected(), channelLive(true, false)),
      ).dot,
    ).not.toBe(toneDot.ok);
    expect(
      kavalPresencePresentation(
        toKavalPresence(minimalConnected(), channelLive(true, true)),
      ).dot,
    ).toBe(toneDot.ok);
  });

  it("liveDownState/liveWarming, fed channelLive directly: a non-connected entry ⇒ unknown, not down/warming", () => {
    const dead = channelLive(true, false);
    expect(liveDownState(down("dead"), dead)).toBeUndefined();
    expect(liveWarming("restarting", dead)).toBe(false);
  });
});

describe("the daemon-rail floor is now host-UNIFORM (W4 daemon-rail unification — the padi-link leg retired)", () => {
  it("liveWarming/liveDownState take no host input — a LOCAL padi drain and a REMOTE ssh flap (identical channelLive) verdict identically", () => {
    const localDrain = channelLive(true, false);
    const remoteFlap = channelLive(true, false);
    expect(liveWarming("connected", localDrain)).toBe(
      liveWarming("connected", remoteFlap),
    );
    expect(liveDownState(down("degraded"), localDrain)).toBe(
      liveDownState(down("degraded"), remoteFlap),
    );
    expect(liveWarming("connected", localDrain)).toBe(false);
    expect(liveDownState(down("degraded"), localDrain)).toBeUndefined();
  });
});

describe("toKavalPresence — P4: connected ⇒ identity present, by construction", () => {
  const connectedStatus = (identity: DaemonStatus["identity"]): DaemonStatus =>
    ({
      state: "connected",
      identity,
      contractVersion: "5.0",
      startedAt: 1000,
      socketPath: "/run/user/1000/kaval-abcd/pty-host.sock",
    }) as DaemonStatus;

  it("a genuinely connected, identified daemon over a live channel reads `connected` with its identity", () => {
    const status = connectedStatus({
      staleKey: "abc",
      navigableCommit: "deadbeef",
    });
    expect(toKavalPresence(status, true)).toEqual({
      kind: "connected",
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      contractVersion: "5.0",
      startedAt: 1000,
      socketPath: "/run/user/1000/kaval-abcd/pty-host.sock",
    });
  });

  it("a pre-fragment honest-unknown identity stays connected, restartable, and nudging", () => {
    const status = connectedStatus({
      staleKey: "",
      navigableCommit: "",
    });
    const presence = toKavalPresence(status, true);

    expect(presence).toMatchObject({ kind: "connected" });
    expect(offerRestartVerb(presence)).toBe(true);
    expect(kavalAttention("current-build", status, true)).toEqual({
      kind: "stale",
    });
  });

  it("RED→GREEN repro: a `connected` status whose identity has not (yet) arrived NEVER reads `connected` — it folds to `warming`, never a synthesized dash beside a claimed-live daemon", () => {
    const status = connectedStatus(undefined);
    const presence = toKavalPresence(status, true);
    expect(presence).toEqual({ kind: "warming", state: "connected" });
    expect(presence).not.toMatchObject({ kind: "connected" });
  });

  it("RED→GREEN repro: the drain/reconnect class — a dead/half-open channel never reads `connected`, even over a retained `connected` wire status", () => {
    const status = connectedStatus({
      staleKey: "abc",
      navigableCommit: "deadbeef",
    });
    expect(toKavalPresence(status, false)).toEqual({ kind: "unknown" });
    expect(toKavalPresence(status, true)).toMatchObject({ kind: "connected" });
  });

  it("pre-first-value (status undefined) and a genuinely down daemon each read their own honest kind — never `connected`", () => {
    expect(toKavalPresence(undefined, true)).toEqual({ kind: "unknown" });
    expect(toKavalPresence({ state: "dead" } as DaemonStatus, true)).toEqual({
      kind: "down",
      state: "dead",
    });
    expect(
      toKavalPresence({ state: "degraded" } as DaemonStatus, true),
    ).toEqual({ kind: "down", state: "degraded" });
    expect(
      toKavalPresence({ state: "connecting" } as DaemonStatus, true),
    ).toEqual({ kind: "warming", state: "connecting" });
  });

  it("carries the wire `lifetime` onto the connected presence (and leaves it undefined for a survivor predating the field)", () => {
    const live = {
      state: "connected",
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      contractVersion: "5.0",
      startedAt: 1000,
      lifetime: { kind: "boundToPid", pid: 4321 },
    } as DaemonStatus;
    expect(toKavalPresence(live, true)).toMatchObject({
      kind: "connected",
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    const survivor = {
      state: "connected",
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      contractVersion: "5.0",
      startedAt: 1000,
    } as DaemonStatus;
    const presence = toKavalPresence(survivor, true);
    expect(presence).toMatchObject({ kind: "connected" });
    expect(
      presence.kind === "connected" ? presence.lifetime : "unreachable",
    ).toBeUndefined();
  });
});

describe("kavalPresencePresentation — the dialog's dot + word + text tone, ONE match over presence (no raw state/live at the render site)", () => {
  it("dot: unknown is grey, connected is ok, the fine transient/down state drives the tone", () => {
    expect(kavalPresencePresentation({ kind: "unknown" }).dot).toBe(
      DAEMON_UNKNOWN_DOT,
    );
    expect(
      kavalPresencePresentation({
        kind: "connected",
        identity: { staleKey: "k", navigableCommit: "c" },
        contractVersion: "5.2",
        startedAt: 1,
        socketPath: undefined,
        lifetime: undefined,
      }).dot,
    ).toBe(toneDot.ok);
    expect(
      kavalPresencePresentation({ kind: "warming", state: "restarting" }).dot,
    ).toBe(toneDot.warming);
    expect(
      kavalPresencePresentation({ kind: "warming", state: "connected" }).dot,
    ).toBe(toneDot.ok);
    expect(kavalPresencePresentation({ kind: "down", state: "dead" }).dot).toBe(
      toneDot.down,
    );
    expect(kavalPresencePresentation({ kind: "incompatible" }).dot).toBe(
      toneDot.down,
    );
  });

  it("label + text tone: unknown reads 'unknown'/text-fg-3; every other arm's fine state reads its own word/text-fg (restarting… stays restarting…)", () => {
    expect(kavalPresencePresentation({ kind: "unknown" }).label).toBe(
      "unknown",
    );
    expect(kavalPresencePresentation({ kind: "unknown" }).textClass).toBe(
      "text-fg-3",
    );
    expect(
      kavalPresencePresentation({ kind: "warming", state: "connecting" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.connecting.label);
    expect(
      kavalPresencePresentation({ kind: "warming", state: "restarting" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.restarting.label);
    expect(
      kavalPresencePresentation({ kind: "warming", state: "connected" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.connected.label);
    expect(
      kavalPresencePresentation({ kind: "down", state: "degraded" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.degraded.label);
    expect(
      kavalPresencePresentation({ kind: "down", state: "degraded" }).textClass,
    ).toBe("text-fg");
  });

  it("#1793: a not-live channel projects to grey 'unknown' — never a green dot or a 'running' word painted off a stale value", () => {
    const stale = minimalConnected();
    const dead = toKavalPresence(stale, false);
    expect(dead).toEqual({ kind: "unknown" });
    expect(kavalPresencePresentation(dead).dot).toBe(DAEMON_UNKNOWN_DOT);
    expect(kavalPresencePresentation(dead).label).toBe("unknown");
  });
});

describe("formatLifetime — the shared humanizer for the Kaval/Padi dialog lifetime row", () => {
  it("renders each lifetime arm, and a survivor predating the field reads the dash", () => {
    expect(formatLifetime({ kind: "forever" })).toBe("forever");
    expect(formatLifetime({ kind: "boundToPid", pid: 4321 })).toBe(
      "bound to run pid 4321",
    );
    expect(formatLifetime({ kind: "idleTimeout", ms: 5000 })).toBe(
      "idle timeout (5s)",
    );
    expect(formatLifetime(undefined)).toBe("—");
  });
});

describe("the incompatible arm (SK4) — a proven skew is its own verdict, never a warming pulse", () => {
  it("toKavalPresence maps incompatible to its OWN payload-less arm — not warming, not down", () => {
    expect(toKavalPresence(incompatibleStatus(), true)).toEqual({
      kind: "incompatible",
    });
  });

  it("over a dead link the retained skew folds to unknown like every stale claim (unknown ≠ incompatible)", () => {
    expect(toKavalPresence(incompatibleStatus(), false)).toEqual({
      kind: "unknown",
    });
  });

  it("the presentation row is a DOWN tone (red dot, down: true) — never the warming pulse the old fallthrough painted", () => {
    expect(DAEMON_STATE_PRESENTATION.incompatible.tone).toBe("down");
    expect(DAEMON_STATE_PRESENTATION.incompatible.down).toBe(true);
    expect(kavalPresencePresentation({ kind: "incompatible" }).dot).toBe(
      toneDot.down,
    );
  });
});

describe("presenceState — the rail mark's data-daemon-state, projected from presence (behavior-identical to the retired raw pair)", () => {
  it("names each arm; warming/down expose the fine state; a dead channel reads 'unknown'", () => {
    expect(presenceState(toKavalPresence(minimalConnected(), true))).toBe(
      "connected",
    );
    expect(presenceState({ kind: "warming", state: "restarting" })).toBe(
      "restarting",
    );
    expect(presenceState({ kind: "warming", state: "connected" })).toBe(
      "connected",
    );
    expect(presenceState({ kind: "down", state: "degraded" })).toBe("degraded");
    expect(presenceState({ kind: "incompatible" })).toBe("incompatible");
    expect(presenceState(toKavalPresence(minimalConnected(), false))).toBe(
      "unknown",
    );
  });
});

describe("offerRestartVerb — the Restart affordance is a total function of the PRESENCE sum, floored on liveness (D5c, #1793)", () => {
  const connected = toKavalPresence(minimalConnected(), true);

  it("offered on a live-confirmed connected/down; withheld while warming", () => {
    expect(offerRestartVerb(connected)).toBe(true);
    expect(offerRestartVerb({ kind: "down", state: "dead" })).toBe(true);
    expect(offerRestartVerb({ kind: "down", state: "degraded" })).toBe(true);
    expect(offerRestartVerb({ kind: "warming", state: "connecting" })).toBe(
      false,
    );
  });

  it("#1793 (affordance axis): NEVER offered over an `unknown` (dead/half-open) channel — an action the channel can't carry out", () => {
    expect(offerRestartVerb({ kind: "unknown" })).toBe(false);
  });

  it("withheld against a PROVEN skew — never the dead-end restart the skew card replaces", () => {
    expect(offerRestartVerb({ kind: "incompatible" })).toBe(false);
  });
});
