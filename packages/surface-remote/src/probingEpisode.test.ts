/**
 * Phase-sequence + episode-clock pins.
 *
 *  - THE PROBING SEQUENCE: an ssh session opens at `probing` (the arch probe + the
 *    ask-only warm check, where nothing is being shipped) and advances through the
 *    connector's OWN vocabulary — `probing → provisioning → connecting →
 *    connected` — each step driven by the connector at a real command boundary
 *    (`ctx.provisioning`). A WARM host short-circuits from `probing` (calm path).
 *
 *  - THE EPISODE CLOCK (#1908 D3/R7, REWRITTEN): `sinceMs` (the published episode
 *    duration) and the `log` tail are stamped/reset at CAMPAIGN BIRTH (`startEpisode`),
 *    NOT per dial. A backoff RETRY within an ongoing connect campaign does NOT reset
 *    them — so a 10-minute wedge reads 10 minutes, not the per-attempt ~1s the incident
 *    showed, and the log survives retries (D2's attempt display depends on it). A
 *    connected-link drop begins a fresh campaign whose clock spans from the drop. (This
 *    file previously pinned the OLD per-attempt reset; R7 rewrites it deliberately.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "./loggerStubs.testutil";
import {
  type ClosedInfo,
  type ConnectContext,
  ConnectError,
  type Connection,
  makeSession,
} from "./session";
import type { SshProv } from "./sshConnector";

/** A connector the test drives by hand: it captures the loop's `ctx` (to advance phases
 *  + push log lines the way `nixCopy`'s hooks / stderr forwarding would) and hands back a
 *  {@link Connection} whose death the test can trigger — or REJECTS the dial (a failed
 *  provision, never-connected). */
function harness() {
  let ctx: ConnectContext<SshProv> | undefined;
  let resolveDial: ((c: Connection<unknown>) => void) | undefined;
  let rejectDial: ((e: unknown) => void) | undefined;
  let settleClosed: ((i: ClosedInfo) => void) | undefined;
  const connectOnce = (
    c: ConnectContext<SshProv>,
  ): Promise<Connection<unknown>> => {
    ctx = c;
    return new Promise((res, rej) => {
      resolveDial = res;
      rejectDial = rej;
    });
  };
  return {
    connectOnce,
    ctx: () => {
      if (!ctx) throw new Error("connector not dialed yet");
      return ctx;
    },
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
    /** Reject the current dial (a classified provision failure, never-connected). */
    failDial(reason: string, cause: "network" | "remote") {
      rejectDial?.(new ConnectError(reason, cause));
    },
    killLink() {
      settleClosed?.({ kind: "exit", code: null, signal: "SIGTERM" });
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ssh session phase sequence (probing)", () => {
  it("opens at `probing` and advances through provisioning to connected", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });
    const phases: string[] = [];
    session.onState((s) => phases.push(s.phase));

    const pinned = session.pin();
    await flush();
    h.ctx().provisioning("provisioning");
    h.ctx().connecting();
    h.connect();
    await pinned;
    session.markConnected();
    await flush();

    const distinct = phases.filter((p, i) => p !== phases[i - 1]);
    expect(distinct).toEqual([
      "probing",
      "provisioning",
      "connecting",
      "connected",
    ]);
    session.destroy();
  });

  it("a resolver-cache hit plus target warm hit skips provisioning", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });
    const phases: string[] = [];
    session.onState((s) => phases.push(s.phase));

    const pinned = session.pin();
    await flush();
    // Fully warm path: source resolution was cached and the target ask-only
    // check hits, so the connector goes straight to `connecting`.
    h.ctx().connecting();
    h.connect();
    await pinned;
    session.markConnected();
    await flush();

    expect(phases).not.toContain("provisioning");
    const distinct = phases.filter((p, i) => p !== phases[i - 1]);
    expect(distinct).toEqual(["probing", "connecting", "connected"]);
    session.destroy();
  });
});

describe("episode clock spans the CAMPAIGN, not the dial (#1908 D3/R7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const snapOf = (session: ReturnType<typeof makeSession>) => () => {
    let s!: {
      phase: string;
      log: readonly { line: string }[];
      sinceMs: number;
    };
    const off = session.onState((v) => {
      s = v as typeof s;
    });
    off();
    return s;
  };

  it("log accumulates across phase-flips within a campaign, and sinceMs grows from campaign start", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });
    const latest = snapOf(session);

    session.pin().catch(() => {});
    await Promise.resolve();
    vi.setSystemTime(1_000_500);
    h.ctx().provisioning("provisioning");
    h.ctx().localProgress("copying path a");
    vi.setSystemTime(1_002_000);
    h.ctx().remoteProgress("configurePhase");

    const mid = latest();
    expect(mid.log.map((e) => e.line)).toEqual([
      "copying path a",
      "configurePhase",
    ]);
    expect(mid.sinceMs).toBe(2_000);
    session.destroy();
  });

  it("a never-connected RETRY does NOT reset the clock — sinceMs spans the wedge, log carries (the incident's 10-min-reads-10-min)", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      reconnectDelayMs: 10,
      log: silentLogger,
    });
    const snap = snapOf(session);

    session.pin().catch(() => {});
    await Promise.resolve();
    h.ctx().localProgress("checking for a cached agent…");
    // First dial fails, host unreachable — NEVER connected.
    vi.setSystemTime(1_000_100);
    h.failDial("unreachable", "network");
    await Promise.resolve();
    expect(snap().phase).toBe("disconnected");

    // The retry fires later. The campaign clock was stamped at the FIRST dial
    // (1_000_000), so the retry's probing frame reads time-since-campaign-start (NOT
    // reset to ~0), and the log carries the prior attempt's tail.
    vi.setSystemTime(1_000_500);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    const retry = snap();
    expect(retry.phase).toBe("probing");
    expect(retry.sinceMs).toBeGreaterThanOrEqual(500);
    expect(retry.log.map((e) => e.line)).toContain(
      "checking for a cached agent…",
    );
    session.destroy();
  });

  it("a connected-link DROP begins a fresh campaign whose clock spans from the drop", async () => {
    const h = harness();
    const session = makeSession<unknown, SshProv>({
      connectOnce: h.connectOnce,
      initialConnection: "probing",
      liveness: false,
      reconnectDelayMs: 10,
      log: silentLogger,
    });
    const snap = snapOf(session);

    session.pin().catch(() => {});
    await Promise.resolve();
    h.ctx().provisioning("provisioning");
    h.ctx().localProgress("copying path a");
    h.ctx().connecting();
    h.connect();
    await Promise.resolve();
    session.markConnected();
    expect(snap().log.length).toBeGreaterThan(0);

    // Link dies at a known time → a fresh campaign is stamped at the DROP. The
    // just-dropped episode's log is still readable on the down frame.
    vi.setSystemTime(1_005_000);
    h.killLink();
    await Promise.resolve();
    expect(snap().phase).toBe("disconnected");
    expect(snap().log.length).toBeGreaterThan(0);

    // Reconnect fires later; the clock was stamped at the drop (1_005_000), so the fresh
    // probing frame reads time-since-drop (NOT ~0) and its log is reset.
    vi.setSystemTime(1_006_000);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    const fresh = snap();
    expect(fresh.phase).toBe("probing");
    expect(fresh.log).toEqual([]);
    expect(fresh.sinceMs).toBeGreaterThanOrEqual(1_000);
    session.destroy();
  });
});
