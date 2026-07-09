/**
 * `ClosedInfo` classification for the NON-`exit` transport deaths — the two
 * variants added so a link death has ONE honest shape instead of an overloaded
 * `exit`:
 *
 *   - `transport-failed` — the ssh transport's own connection failure (ssh's exit
 *     255, mapped at `sshConnector` so no magic literal leaks into this loop).
 *     Always `"network"` (retry forever).
 *   - `endpoint-down`    — a non-process endpoint link death (no child, so no exit
 *     code/signal). Honest reason instead of "agent exited (code=null,
 *     signal=null)" — the both-null `exit` inhabitant this variant replaces.
 *
 * A hand-built connector resolves `closed` with each variant; the test reads the
 * resulting `disconnected` frame off `onState`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClosedInfo,
  type ConnectContext,
  type Connection,
  type DownSessionState,
  makeSession,
  type Session,
  type SessionState,
} from "./session";
import type { SshProv } from "./sshConnector";

/** The latest state frame the session has published (snapshot-then-delta). */
function latest<C>(session: Session<C, SshProv>): SessionState<SshProv> {
  let cur!: SessionState<SshProv>;
  session.onState((s) => {
    cur = s;
  })();
  return cur;
}

/** A down-arm narrowing so the test can read `error` / `cause`. */
function down(s: SessionState<SshProv>): DownSessionState {
  if (s.phase !== "disconnected" && s.phase !== "failed") {
    throw new Error(`expected a down arm, got ${s.phase}`);
  }
  return s;
}

/** A connector that comes straight up (`connecting`) and hands back a live link
 *  whose death the test drives by resolving `closed` with a chosen {@link
 *  ClosedInfo}. Never dies on its own. */
function drivableConnector(): {
  connectOnce: (ctx: ConnectContext) => Promise<Connection<unknown>>;
  die: (info: ClosedInfo) => void;
} {
  let resolveClosed!: (info: ClosedInfo) => void;
  const closed = new Promise<ClosedInfo>((r) => {
    resolveClosed = r;
  });
  return {
    connectOnce: (ctx) => {
      ctx.connecting();
      return Promise.resolve({
        client: {},
        closed,
        isAlive: () => Promise.resolve(),
        teardown: () => {},
      });
    },
    die: (info) => resolveClosed(info),
  };
}

describe("ClosedInfo non-exit transport deaths", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("endpoint-down classifies remote (bounded) when never connected, with an honest reason", async () => {
    const { connectOnce, die } = drivableConnector();
    const session = makeSession<unknown, SshProv>({
      initialConnection: "copying",
      connectOnce,
      reconnectDelayMs: 60_000, // keep the follow-on redial out of the window
      label: "ep",
    });
    await session.pin();
    die({ kind: "endpoint-down" });
    await vi.advanceTimersByTimeAsync(0);

    const d = down(latest(session));
    expect(d.phase).toBe("disconnected");
    // Never connected → the endpoint refused to come up → bounded `"remote"`.
    expect(d.cause).toBe("remote");
    // Honest: NOT the both-null "agent exited (code=null, signal=null)" lie.
    expect(d.error).toBe("endpoint link down (no process exit)");
    expect(d.error).not.toContain("code=null");

    session.destroy();
  });

  it("transport-failed classifies network (retry forever)", async () => {
    const { connectOnce, die } = drivableConnector();
    const session = makeSession<unknown, SshProv>({
      initialConnection: "copying",
      connectOnce,
      reconnectDelayMs: 60_000,
      label: "tf",
    });
    await session.pin();
    die({ kind: "transport-failed" });
    await vi.advanceTimersByTimeAsync(0);

    const d = down(latest(session));
    expect(d.phase).toBe("disconnected");
    expect(d.cause).toBe("network");
    expect(d.error).toMatch(/ssh transport connection failed/i);

    session.destroy();
  });
});
