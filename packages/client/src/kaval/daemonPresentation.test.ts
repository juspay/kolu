import type { DaemonState, DaemonStatus } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import {
  channelLive,
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  formatLifetime,
  kavalDot,
  liveDownState,
  liveWarming,
  serverDot,
  toKavalPresence,
  toneDot,
} from "./daemonPresentation";

describe("kavalDot — the kaval dot's tone is FLOORED on transport liveness (#1568 green-dot class)", () => {
  it("paints the daemon-state tone only when the transport is LIVE", () => {
    // A connected daemon over a live link → its 'ok' tone; a transient state → warming.
    expect(kavalDot("connected", true)).toBe(toneDot.ok);
    expect(kavalDot("connected", true)).not.toBe(DAEMON_UNKNOWN_DOT);
    expect(kavalDot("restarting", true)).toBe(toneDot.warming);
    expect(kavalDot("dead", true)).toBe(toneDot.down);
  });

  it("FLOORS to the unknown grey when the transport is NOT live — never bg-ok over a dead/half-open channel", () => {
    // The bug Reviewer 2 confirmed: a dead ws leaves the retained 'connected' state
    // stale, but the dot painted bg-ok off it — a definite 'running' the dead channel
    // can't confirm. Floored: grey (unknown), for EVERY state — a known state can
    // only REFINE the tone WITHIN a live link, never claim a verdict over a dead one.
    for (const state of Object.keys(
      DAEMON_STATE_PRESENTATION,
    ) as DaemonState[]) {
      expect(kavalDot(state, false)).toBe(DAEMON_UNKNOWN_DOT);
    }
    // Specifically: a connected daemon over a dead link is NOT painted 'running'.
    expect(kavalDot("connected", false)).not.toBe(toneDot.ok);
  });

  it("is the unknown grey for a pre-first-yield state, live or not", () => {
    expect(kavalDot(undefined, true)).toBe(DAEMON_UNKNOWN_DOT);
    expect(kavalDot(undefined, false)).toBe(DAEMON_UNKNOWN_DOT);
  });

  it("the unknown grey is distinct from the `down` (dead-daemon) tone — unknown ≠ dead", () => {
    // A dead LINK reads 'unknown' (grey), a dead DAEMON over a live link reads
    // 'down' (red): the two failures must not collapse into one verdict.
    expect(DAEMON_UNKNOWN_DOT).not.toBe(toneDot.down);
    expect(kavalDot("dead", true)).not.toBe(DAEMON_UNKNOWN_DOT);
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
    expect(liveDownState("dead", true)).toBe("dead");
    expect(liveDownState("degraded", true)).toBe("degraded");
    // Dead link: a retained down state is stale → unknown, NOT a definite "down"
    // (so DegradedCanvas never paints over a link we can't see through).
    expect(liveDownState("dead", false)).toBeUndefined();
    expect(liveDownState("degraded", false)).toBeUndefined();
    // A non-down or unknown state is not down regardless.
    expect(liveDownState("connected", true)).toBeUndefined();
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

  it("kavalDot: a `connected` daemon over a live transport but a non-connected active entry reads UNKNOWN, not green", () => {
    // The concrete defect: server-published `connected` + live ws, but the active REMOTE
    // entry is not connected → the dot must be grey "unknown", never bg-ok "running".
    expect(kavalDot("connected", channelLive(true, false))).toBe(
      DAEMON_UNKNOWN_DOT,
    );
    expect(kavalDot("connected", channelLive(true, false))).not.toBe(
      toneDot.ok,
    );
    // Both legs live → the daemon state refines the tone as before.
    expect(kavalDot("connected", channelLive(true, true))).toBe(toneDot.ok);
  });

  it("liveDownState/liveWarming, fed channelLive directly: a non-connected entry ⇒ unknown, not down/warming", () => {
    // `downState`/`daemonWarming` (useDaemonStatus.ts) feed `daemonChannelLive()` straight
    // into these — no intermediate padi-link fold any more (W4 daemon-rail unification, see
    // the describe block below). A dead entry reads unknown (undefined down-state,
    // not-warming) — `daemonConnected()` therefore reads false.
    const dead = channelLive(true, false);
    expect(liveDownState("dead", dead)).toBeUndefined();
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
    expect(liveDownState("degraded", localDrain)).toBe(
      liveDownState("degraded", remoteFlap),
    );
    // Concretely: neither reads a stale claim over the dropped channel — unknown, not a
    // frozen "running"/"degraded" (the #1034 never-show-a-stale-verdict invariant, now
    // enforced identically for every host by construction, not by a per-host gate).
    expect(liveWarming("connected", localDrain)).toBe(false);
    expect(liveDownState("degraded", localDrain)).toBeUndefined();
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
    expect(presence.kind).toBe("warming");
    expect(presence).not.toMatchObject({ kind: "connected" });
  });

  it("RED→GREEN repro: the drain/reconnect class — a dead/half-open channel never reads `connected`, even over a retained `connected` wire status", () => {
    // The reproduced live bug: an AbortError drain burst kills the channel; the retained
    // (stale) `connected` status must not be shown as a confirmed-connected identity.
    const status = connectedStatus({
      staleKey: "abc",
      navigableCommit: "deadbeef",
    });
    expect(toKavalPresence(status, false)).toEqual({ kind: "warming" });
    // Reconnect (channel live again, status unchanged) — identity is confirmed again.
    expect(toKavalPresence(status, true)).toMatchObject({ kind: "connected" });
  });

  it("pre-first-value (status undefined) and a genuinely down daemon each read their own honest kind — never `connected`", () => {
    expect(toKavalPresence(undefined, true)).toEqual({ kind: "warming" });
    expect(toKavalPresence({ state: "dead" } as DaemonStatus, true)).toEqual({
      kind: "down",
      state: "dead",
    });
    expect(
      toKavalPresence({ state: "degraded" } as DaemonStatus, true),
    ).toEqual({ kind: "down", state: "degraded" });
    expect(
      toKavalPresence({ state: "connecting" } as DaemonStatus, true),
    ).toEqual({ kind: "warming" });
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
