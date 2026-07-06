/**
 * The active-connection manager's MACHINERY (the generic core kolu's `binding/` module
 * used to carry). Pins: keyed cache with one active + rebuild-if-retired, flip-then-retire
 * on `setActive`, pick-epoch last-intent-wins over overlapping async warms (incl. re-pick
 * as cancel), the server-rejected-close fallback predicate, and persistence restore.
 */

import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  createActiveConnectionManager,
  type ManagedConnection,
} from "./activeConnectionManager";

interface FakeConn extends ManagedConnection {
  key: string;
  ws: { addEventListener: (t: "close", cb: (ev: { code?: number }) => void) => void };
}

/** A connection factory whose sockets fire `close` on command + whose disposes are recorded. */
function fakeConns() {
  const built: string[] = [];
  const disposed: string[] = [];
  const closeCbs = new Map<FakeConn, ((ev: { code?: number }) => void)[]>();
  function makeConnection(key: string): FakeConn {
    built.push(key);
    const cbs: ((ev: { code?: number }) => void)[] = [];
    const conn: FakeConn = {
      key,
      retired: false,
      dispose() {
        conn.retired = true;
        disposed.push(key);
      },
      ws: {
        addEventListener: (t, cb) => {
          if (t === "close") cbs.push(cb);
        },
      },
    };
    closeCbs.set(conn, cbs);
    return conn;
  }
  return {
    makeConnection,
    built,
    disposed,
    fireClose: (conn: FakeConn, code: number) => {
      for (const cb of closeCbs.get(conn) ?? []) cb({ code });
    },
  };
}

const base = (f: ReturnType<typeof fakeConns>) => ({
  initialKey: "local",
  makeConnection: f.makeConnection,
  socketOf: (c: FakeConn) => c.ws,
  isFallbackKey: (k: string) => k === "local",
  fallbackKey: "local",
  serverRejectedCloseCode: 1008,
});

describe("createActiveConnectionManager", () => {
  it("caches the active connection and rebuilds it once retired", () => {
    createRoot((dispose) => {
      const f = fakeConns();
      const m = createActiveConnectionManager({
        ...base(f),
        onServerRejected: vi.fn(),
      });
      const c1 = m.activeConnection();
      expect(f.built).toEqual(["local"]);
      expect(m.activeConnection()).toBe(c1); // cached
      c1.dispose(); // retire it
      const c2 = m.activeConnection();
      expect(c2).not.toBe(c1); // rebuilt
      expect(f.built).toEqual(["local", "local"]);
      dispose();
    });
  });

  it("setActive flips the key and retires the outgoing connection", () => {
    createRoot((dispose) => {
      const f = fakeConns();
      const m = createActiveConnectionManager({
        ...base(f),
        onServerRejected: vi.fn(),
      });
      const local = m.activeConnection();
      m.setActive("zest");
      expect(m.activeKey()).toBe("zest");
      expect(local.retired).toBe(true);
      expect(f.disposed).toEqual(["local"]);
      dispose();
    });
  });

  it("switchTo: a superseded slow warm bows out — last-intent-wins", async () => {
    await createRoot(async (dispose) => {
      const f = fakeConns();
      let resolveA!: () => void;
      let resolveB!: () => void;
      const warm = vi.fn((key: string) =>
        key === "a"
          ? new Promise<void>((r) => {
              resolveA = r;
            })
          : new Promise<void>((r) => {
              resolveB = r;
            }),
      );
      const m = createActiveConnectionManager({
        ...base(f),
        warm,
        onServerRejected: vi.fn(),
      });
      const pA = m.switchTo("a"); // epoch 1
      const pB = m.switchTo("b"); // epoch 2 — the latest intent
      resolveB();
      await pB;
      expect(m.activeKey()).toBe("b");
      resolveA(); // A's warm resolves LATE — stale epoch, must NOT yank back to "a"
      await pA;
      expect(m.activeKey()).toBe("b");
      dispose();
    });
  });

  it("switchTo: re-picking the CURRENT key cancels an in-flight warm", async () => {
    await createRoot(async (dispose) => {
      const f = fakeConns();
      let resolveA!: () => void;
      const warm = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveA = r;
          }),
      );
      const m = createActiveConnectionManager({
        ...base(f),
        warm,
        onServerRejected: vi.fn(),
      });
      const pA = m.switchTo("a"); // epoch 1, awaiting warm
      void m.switchTo("local"); // epoch 2 — re-pick current: bumps epoch, same-key return
      resolveA(); // A's warm resolves — but epoch is stale now → bows out
      await pA;
      expect(m.activeKey()).toBe("local"); // the re-pick cancelled the switch to "a"
      dispose();
    });
  });

  it("switchTo: onWarmError fires with superseded=false when the pick is still latest", async () => {
    await createRoot(async (dispose) => {
      const f = fakeConns();
      const onWarmError = vi.fn();
      const m = createActiveConnectionManager({
        ...base(f),
        warm: () => Promise.reject(new Error("boom")),
        onWarmError,
        onServerRejected: vi.fn(),
      });
      await m.switchTo("a");
      expect(onWarmError).toHaveBeenCalledWith("a", expect.any(Error), false);
      expect(m.activeKey()).toBe("local"); // warm failed → no switch
      dispose();
    });
  });

  it("fires onServerRejected only for the active, non-fallback key on the rejection close code", () => {
    createRoot((dispose) => {
      const f = fakeConns();
      const onServerRejected = vi.fn();
      const m = createActiveConnectionManager({
        ...base(f),
        onServerRejected,
      });
      m.setActive("zest");
      const zest = m.activeConnection(); // builds zest + installs its close listener
      f.fireClose(zest, 1000); // wrong code — ignored
      expect(onServerRejected).not.toHaveBeenCalled();
      f.fireClose(zest, 1008); // the rejection code, active + non-fallback
      expect(onServerRejected).toHaveBeenCalledWith("zest");
      dispose();
    });
  });

  it("restore re-reads persistence and adopts a differing key", () => {
    createRoot((dispose) => {
      const f = fakeConns();
      let stored: string | undefined;
      const m = createActiveConnectionManager({
        ...base(f),
        onServerRejected: vi.fn(),
        persistence: {
          read: () => stored,
          store: (k) => {
            stored = k;
          },
        },
      });
      expect(m.activeKey()).toBe("local"); // nothing stored at construction
      stored = "box5";
      m.restore();
      expect(m.activeKey()).toBe("box5");
      dispose();
    });
  });
});
