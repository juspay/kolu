/**
 * Red-first pins for the W6 remediation, items 3 + 4:
 *
 *  - THE PROBING SEQUENCE (item 3): an ssh session opens at `probing` (the arch probe +
 *    warm check, where nothing is being shipped) and advances through the connector's
 *    OWN provisioning vocabulary — `probing → copying → building → connecting → connected`
 *    — each step driven by the connector at a real command boundary (`ctx.provisioning`).
 *    A WARM host that short-circuits from `probing` never enters `copying` (calm path).
 *
 *  - THE EPISODE MARKER (item 4): `sinceMs` (the published episode duration) and the
 *    `log` tail reset ONLY on a down→up crossing (a fresh dial after disconnect/failed),
 *    NOT on a phase-flip within one episode. So the overlay's timer + tail are scoped to
 *    the current provisioning episode, never showing a prior episode's lines under a
 *    fresh timer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedInfo, ConnectContext, Connection } from "./session";
import { makeSession } from "./session";
import type { SshProv } from "./sshConnector";

/** A connector the test drives by hand: it captures the loop's `ctx` (to advance phases
 *  + push log lines the way `nixCopy`'s hooks / stderr forwarding would) and hands back a
 *  {@link Connection} whose death the test can trigger. */
function harness() {
  let ctx: ConnectContext<SshProv> | undefined;
  let resolveDial: ((c: Connection<unknown>) => void) | undefined;
  let settleClosed: ((i: ClosedInfo) => void) | undefined;
  const connectOnce = (
    c: ConnectContext<SshProv>,
  ): Promise<Connection<unknown>> => {
    ctx = c;
    return new Promise((res) => {
      resolveDial = res;
    });
  };
  return {
    connectOnce,
    ctx: () => {
      if (!ctx) throw new Error("connector not dialed yet");
      return ctx;
    },
    /** Hand the loop a live connection (transport up). */
    connect() {
      const closed = new Promise<ClosedInfo>((res) => {
        settleClosed = res;
      });
      resolveDial?.({
        client: {},
        closed,
        isAlive: () => Promise.resolve(),
        teardown: () => settleClosed?.({ kind: "exit", code: 0, signal: null }),
      });
    },
    /** Kill the live link (a dropped connection → the loop reconnects). */
    killLink() {
      settleClosed?.({ kind: "exit", code: null, signal: "SIGTERM" });
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ssh session phase sequence (item 3 — probing)", () => {
  it("opens at `probing` and advances probing → copying → building → connecting → connected", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const phases: string[] = [];
    session.onState((s) => phases.push(s.phase));

    const pinned = session.pin();
    await flush();
    // The connector advances at each real command boundary (as `nixCopy`'s
    // `onCopying`/`onBuilding` hooks do). `probing` is NEVER re-entered from a copy.
    h.ctx().provisioning("copying");
    h.ctx().provisioning("building");
    h.ctx().connecting();
    h.connect();
    await pinned; // the dial resolved — the transport is up, phase `connecting`
    session.markConnected();
    await flush();

    const distinct = phases.filter((p, i) => p !== phases[i - 1]);
    expect(distinct).toEqual([
      "probing",
      "copying",
      "building",
      "connecting",
      "connected",
    ]);
    session.destroy();
  });

  it("a WARM host short-circuits from `probing` straight to connecting — never enters copying/building", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const phases: string[] = [];
    session.onState((s) => phases.push(s.phase));

    const pinned = session.pin();
    await flush();
    // Warm path: the fused realise-probe hits, so the connector NEVER calls
    // `provisioning("copying")` — it goes straight to `connecting`.
    h.ctx().connecting();
    h.connect();
    await pinned;
    session.markConnected();
    await flush();

    expect(phases).not.toContain("copying");
    expect(phases).not.toContain("building");
    const distinct = phases.filter((p, i) => p !== phases[i - 1]);
    expect(distinct).toEqual(["probing", "connecting", "connected"]);
    session.destroy();
  });
});

describe("episode marker: sinceMs + log reset on down→up ONLY (item 4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("log accumulates across phase-flips WITHIN an episode, and sinceMs grows from the episode start", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const latest = () => {
      let s!: {
        phase: string;
        log: readonly { line: string }[];
        sinceMs: number;
      };
      const off = session.onState((v) => {
        s = v;
      });
      off();
      return s;
    };

    session.pin().catch(() => {});
    await Promise.resolve();
    // Episode 1 starts at t=1_000_000. Advance + push log lines across phases.
    vi.setSystemTime(1_000_500);
    h.ctx().provisioning("copying");
    h.ctx().localProgress("copying path a");
    vi.setSystemTime(1_002_000);
    h.ctx().provisioning("building");
    h.ctx().remoteProgress("configurePhase");

    const mid = latest();
    // Log carried across probing→copying→building (NOT reset per phase-flip).
    expect(mid.log.map((e) => e.line)).toEqual([
      "copying path a",
      "configurePhase",
    ]);
    // sinceMs = now − episodeStart, on the server clock.
    expect(mid.sinceMs).toBe(2_000);
    session.destroy();
  });

  it("a down→up crossing (reconnect) RESETS the log and sinceMs — a fresh episode", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      reconnectDelayMs: 10,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const snap = () => {
      let s!: {
        phase: string;
        log: readonly { line: string }[];
        sinceMs: number;
      };
      const off = session.onState((v) => {
        s = v;
      });
      off();
      return s;
    };

    session.pin().catch(() => {});
    await Promise.resolve();
    h.ctx().provisioning("copying");
    h.ctx().localProgress("copying path a");
    h.ctx().connecting();
    h.connect();
    await Promise.resolve();
    session.markConnected();
    expect(snap().log.length).toBeGreaterThan(0);

    // Link dies → disconnected. The failed episode's log is STILL readable (down doesn't
    // reset it — the dialAgentOnce failure-read depends on that).
    h.killLink();
    await Promise.resolve();
    expect(snap().phase).toBe("disconnected");
    expect(snap().log.length).toBeGreaterThan(0);

    // Reconnect (fresh dial, down→up) — a NEW episode: log reset to empty, sinceMs ~0.
    vi.setSystemTime(2_000_000);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    const fresh = snap();
    expect(fresh.phase).toBe("probing");
    expect(fresh.log).toEqual([]);
    expect(fresh.sinceMs).toBe(0);
    session.destroy();
  });
});
