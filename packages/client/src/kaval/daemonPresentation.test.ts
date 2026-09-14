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

// ── Wire-status fixtures — `liveDownState` takes the FULL status since SK4 (the
// `incompatible` arm's version pair rides the same wire value). ──────────────

/** A payload-less down/transient wire status. */
const down = (state: "dead" | "degraded"): DaemonStatus => ({ state });

/** The proven-skew wire arm (SK4) — both versions as REQUIRED typed fields. */
const incompatibleStatus = (): DaemonStatus => ({
  state: "incompatible",
  daemonVersion: "5.0",
  requiredVersion: "5.2",
});

/** A minimal connected wire status (identity present). */
const minimalConnected = (): DaemonStatus => ({
  state: "connected",
  identity: { staleKey: "k", navigableCommit: "c".repeat(40) },
  contractVersion: "5.2",
  startedAt: 1,
});

describe("DAEMON_STATE_PRESENTATION.down — the table's VALUES equal the states' home classification", () => {
  // The table's rows are already compile-forced (Record<DaemonState, …>); this
  // pins the down FLAGS to `isDownEndpointState`, the classification declared at
  // the states' home (`@kolu/surface-daemon-supervisor/states`). A future state
  // classified at the home therefore can't silently diverge in this client table.
  it("every state's `down` flag equals isDownEndpointState(state)", () => {
    for (const s of ENDPOINT_STATES) {
      expect(DAEMON_STATE_PRESENTATION[s].down).toBe(isDownEndpointState(s));
    }
  });
});

describe("serverDot — the server-connection dot's green FLOORED on the watchdog fact", () => {
  // The round-4 sibling of kavalDot: the srv/mobile connection dot read the
  // half-open-blind open/close lifecycle (wsDot), so a silent half-open the watchdog
  // already caught (live=false) still read status="open" → green. serverDot floors it.

  it("paints green (ok) only when LIVE; a half-open (open but not-live) reads reconnecting, never green", () => {
    expect(serverDot("open", true)).toBe(toneDot.ok); // genuinely connected
    // The half-open: lifecycle still "open" but the watchdog flipped live false →
    // NOT a definite green; show the reconnecting (warming) tone instead.
    expect(serverDot("open", false)).toBe(toneDot.warming);
    expect(serverDot("open", false)).not.toBe(toneDot.ok);
  });

  it("a genuine closed/connecting keeps its own honest tone — the floor only withholds the open→green claim", () => {
    // A real close IS known-down (red), not floored to "unknown"; the floor targets
    // only the lifecycle's optimistic open→green over a watchdog-detected half-open.
    expect(serverDot("closed", false)).toBe(toneDot.down);
    expect(serverDot("connecting", false)).toBe(toneDot.warming);
    expect(serverDot("connecting", true)).toBe(toneDot.warming);
  });
});

describe("liveWarming / liveDownState — daemon-state claims FLOORED on transport liveness", () => {
  // The round-3 relocation: the canvas + the ⌘T lockout (refuseIfWarming) + the
  // command gate all read "is the daemon warming/down" through these source folds, so
  // flooring HERE floors every consumer at once — a stale "restarting…"/"dead" can't
  // reach the canvas ("Restarting kaval…") or the lockout ("Daemon is starting") over
  // a dead/half-open link.

  it("liveWarming is true ONLY over a live link", () => {
    expect(liveWarming("restarting", true)).toBe(true);
    expect(liveWarming("connecting", true)).toBe(true);
    // Dead link: a retained warming state is stale → not warming.
    expect(liveWarming("restarting", false)).toBe(false);
    expect(liveWarming("connecting", false)).toBe(false);
    // A non-warming or unknown state is not warming regardless.
    expect(liveWarming("connected", true)).toBe(false);
    expect(liveWarming(undefined, true)).toBe(false);
  });

  it("liveDownState is the down sub-state ONLY over a live link, else undefined (unknown ≠ down)", () => {
    expect(liveDownState(down("dead"), true)).toEqual({ state: "dead" });
    expect(liveDownState(down("degraded"), true)).toEqual({
      state: "degraded",
    });
    // The proven skew (SK4) is a DOWN verdict carrying its typed version pair
    // through to the skew card — never collapsed to a bare dead/degraded.
    expect(liveDownState(incompatibleStatus(), true)).toEqual({
      state: "incompatible",
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });
    // Dead link: a retained down state is stale → unknown, NOT a definite "down"
    // (so DegradedCanvas never paints over a link we can't see through).
    expect(liveDownState(down("dead"), false)).toBeUndefined();
    expect(liveDownState(down("degraded"), false)).toBeUndefined();
    expect(liveDownState(incompatibleStatus(), false)).toBeUndefined();
    // A non-down or unknown state is not down regardless.
    expect(liveDownState(minimalConnected(), true)).toBeUndefined();
    expect(liveDownState(undefined, true)).toBeUndefined();
  });
});

describe("the active-entry leg — the SECOND floor on the host-scoped kaval daemonStatus (#1568, remote)", () => {
  // W4 scopes daemonStatus to `useEntry(activeHost)`. On a remote ssh flap the browser↔
  // kolu-server ws stays up while the remote entry's own ssh link dies and its re-served
  // daemonStatus FREEZES at `connected`. Without this leg the kaval dot paints green
  // "running" over a dead remote beside a red host chip — the #1568 lie.

  it("channelLive: the channel is live ONLY when the transport AND the active entry are both connected", () => {
    expect(channelLive(true, true)).toBe(true);
    // The active entry is NOT connected (remote ssh flap): the channel is dead even though
    // the browser transport is live — this is the exact defect the leg closes.
    expect(channelLive(true, false)).toBe(false);
    // A dead transport floors regardless of the entry.
    expect(channelLive(false, true)).toBe(false);
    expect(channelLive(false, false)).toBe(false);
  });

  it("the dot: a `connected` daemon over a live transport but a non-connected active entry reads UNKNOWN, not green", () => {
    // The concrete defect: server-published `connected` + live ws, but the active REMOTE
    // entry is not connected → the dot must be grey "unknown", never bg-ok "running". The
    // floor now rides `toKavalPresence` (folded on `channelLive`), read by the ONE
    // `kavalPresencePresentation` projection both the dialog and the rail mark share.
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
    // Both legs live → the daemon state refines the tone as before.
    expect(
      kavalPresencePresentation(
        toKavalPresence(minimalConnected(), channelLive(true, true)),
      ).dot,
    ).toBe(toneDot.ok);
  });

  it("liveDownState/liveWarming, fed channelLive directly: a non-connected entry ⇒ unknown, not down/warming", () => {
    // `downState`/`daemonWarming` (useDaemonStatus.ts) feed `daemonChannelLive()` straight
    // into these — no intermediate padi-link fold any more (W4 daemon-rail unification, see
    // the describe block below). A dead entry reads unknown (undefined down-state,
    // not-warming) — `daemonConnected()` therefore reads false.
    const dead = channelLive(true, false);
    expect(liveDownState(down("dead"), dead)).toBeUndefined();
    expect(liveWarming("restarting", dead)).toBe(false);
  });
});

describe("the daemon-rail floor is now host-UNIFORM (W4 daemon-rail unification — the padi-link leg retired)", () => {
  // Before this fix, `downState`/`daemonWarming` folded a THIRD, host-gated signal — the
  // local session's re-served `padiLink` cell, masked to a no-op for a remote active host
  // by `localPadiLinkOnly` — alongside `channelLive`. But `padiLink` and `channelLive` are
  // BOTH projections of the exact SAME underlying session state for LOCAL_HOST (the local
  // padi's `Session`, shared verbatim by `serveHostMap`'s per-host `entries` projection and
  // kolu-server's `padiLink` cell — see `packages/server/src/padi/padiBinding.ts` /
  // `packages/surface-remote/src/serveHostMap.ts`): whenever `padiLink !== "connected"`,
  // the LOCAL_HOST entry is ALSO not `connected`, so `channelLive` is ALSO already false —
  // the padi-link fold's extra "OR" term was multiplied by an already-false floor and could
  // never fire. `channelLive` alone was always the complete, sufficient fact; the extra
  // fold was dead weight (and a false promise the doc comments made but the composition
  // didn't keep). Retiring it removes a host special-case with NO behavior change: a LOCAL
  // `daemon.restart` drain and a REMOTE ssh flap now read through the exact same function,
  // with no host key anywhere in this module — `liveWarming`/`liveDownState` don't even
  // HAVE a host parameter to special-case.
  it("liveWarming/liveDownState take no host input — a LOCAL padi drain and a REMOTE ssh flap (identical channelLive) verdict identically", () => {
    const localDrain = channelLive(true, false); // local session leaves `connected`
    const remoteFlap = channelLive(true, false); // remote entry leaves `connected`
    expect(liveWarming("connected", localDrain)).toBe(
      liveWarming("connected", remoteFlap),
    );
    expect(liveDownState(down("degraded"), localDrain)).toBe(
      liveDownState(down("degraded"), remoteFlap),
    );
    // Concretely: neither reads a stale claim over the dropped channel — unknown, not a
    // frozen "running"/"degraded" (the #1034 never-show-a-stale-verdict invariant, now
    // enforced identically for every host by construction, not by a per-host gate).
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
    // The pre-identity-survivor case `@kolu/padi`'s backward-compat seam allows at the
    // wire level. Before P4, the dialog read `props.status?.identity?.navigableCommit`
    // directly and rendered a bare "—" while the dot/label still said "running" — the
    // exact "connected but identity unknown" escape hatch. `toKavalPresence` makes that
    // combination unrepresentable: it is never `{ kind: "connected", identity: undefined }`
    // (a type that does not exist), so the dialog can only show "—" for a NON-connected
    // presence, never beside a connected one.
    const status = connectedStatus(undefined);
    const presence = toKavalPresence(status, true);
    // `warming` with `state: "connected"` — still reads "running"/green (a live pre-identity
    // kaval IS up), but the facts are NOT trustworthy: `kind !== "connected"`.
    expect(presence).toEqual({ kind: "warming", state: "connected" });
    expect(presence).not.toMatchObject({ kind: "connected" });
  });

  it("RED→GREEN repro: the drain/reconnect class — a dead/half-open channel never reads `connected`, even over a retained `connected` wire status", () => {
    // The reproduced live bug: an AbortError drain burst kills the channel; the retained
    // (stale) `connected` status must not be shown as a confirmed-connected identity.
    const status = connectedStatus({
      staleKey: "abc",
      navigableCommit: "deadbeef",
    });
    // A dead channel can't confirm ANY state → `unknown` (grey), distinct from `warming`
    // (a live link coming up): a stale `connected` must never paint a warming pulse either.
    expect(toKavalPresence(status, false)).toEqual({ kind: "unknown" });
    // Reconnect (channel live again, status unchanged) — identity is confirmed again.
    expect(toKavalPresence(status, true)).toMatchObject({ kind: "connected" });
  });

  it("pre-first-value (status undefined) and a genuinely down daemon each read their own honest kind — never `connected`", () => {
    // No value yet ⇒ `unknown` (grey), same as a dead channel — not `warming`.
    expect(toKavalPresence(undefined, true)).toEqual({ kind: "unknown" });
    expect(toKavalPresence({ state: "dead" } as DaemonStatus, true)).toEqual({
      kind: "down",
      state: "dead",
    });
    expect(
      toKavalPresence({ state: "degraded" } as DaemonStatus, true),
    ).toEqual({ kind: "down", state: "degraded" });
    // A live transient carries its fine `state` so the dot/label stay lossless.
    expect(
      toKavalPresence({ state: "connecting" } as DaemonStatus, true),
    ).toEqual({ kind: "warming", state: "connecting" });
  });

  it("carries the wire `lifetime` onto the connected presence (and leaves it undefined for a survivor predating the field)", () => {
    // The end of the mirror chain kaval → system.version → connection metadata →
    // DaemonStatus: the projected lifetime must reach the presence the dialog row
    // reads, not be dropped en route. A live daemon's value flows through…
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
    // …while a survivor whose status carries no lifetime reads `undefined`, which
    // `formatLifetime` renders as "—".
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
    // A LIVE pre-identity `connected` is up → green, even though facts aren't trustworthy.
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
    // pre-identity connected still reads "running" (lossless vs the old raw-state label).
    expect(
      kavalPresencePresentation({ kind: "warming", state: "connected" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.connected.label);
    expect(
      kavalPresencePresentation({ kind: "down", state: "degraded" }).label,
    ).toBe(DAEMON_STATE_PRESENTATION.degraded.label);
    // A known arm reads the standard text tone, never the unknown grey.
    expect(
      kavalPresencePresentation({ kind: "down", state: "degraded" }).textClass,
    ).toBe("text-fg");
  });

  it("#1793: a not-live channel projects to grey 'unknown' — never a green dot or a 'running' word painted off a stale value", () => {
    const stale = minimalConnected(); // truthy, connected-era
    const dead = toKavalPresence(stale, false); // …but the channel is dead
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
    // idleTimeout renders through the shared `formatUptime` ladder (5000ms → "5s").
    expect(formatLifetime({ kind: "idleTimeout", ms: 5000 })).toBe(
      "idle timeout (5s)",
    );
    // `undefined` is a survivor predating the wire field — an honest dash, never a
    // fabricated policy.
    expect(formatLifetime(undefined)).toBe("—");
  });
});

describe("the incompatible arm (SK4) — a proven skew is its own verdict, never a warming pulse", () => {
  it("toKavalPresence maps incompatible to its OWN payload-less arm — not warming, not down", () => {
    // Payload-less by design: the versions are rendered by the canvas card
    // (DaemonDownState) and the attention chip/banner (KavalAttention); the
    // presence's one consumer (the dialog) extracts only `connected`.
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
    // A live pre-identity `connected` still reads "connected" (the warming arm carries it).
    expect(presenceState({ kind: "warming", state: "connected" })).toBe(
      "connected",
    );
    expect(presenceState({ kind: "down", state: "degraded" })).toBe("degraded");
    expect(presenceState({ kind: "incompatible" })).toBe("incompatible");
    // A dead channel (or no value) reads "unknown", never a stale state.
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
    // The axis the presence-only FACT fix left open: the old `(warming, down)` shape
    // collapsed a dead channel to `(false, undefined)` and returned `true`.
    expect(offerRestartVerb({ kind: "unknown" })).toBe(false);
  });

  it("withheld against a PROVEN skew — never the dead-end restart the skew card replaces", () => {
    expect(offerRestartVerb({ kind: "incompatible" })).toBe(false);
  });
});
