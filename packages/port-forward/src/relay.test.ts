import { createServer, type Server as HttpServer } from "node:http";
import {
  connect,
  createServer as createNetServer,
  type Server,
} from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ForwardReport, OpenedForward } from "./mechanism.ts";
import { pickFreePort } from "./freePort.ts";
import { openRelay } from "./relay.ts";

const silent = () => ({ lost: () => {}, fault: () => {} });

const relayTo = (port: number, report: ForwardReport) =>
  openRelay({
    port,
    report,
    listen: createNetServer,
    lastLocalPort: undefined,
    loopback: "v4",
  });

/** A dev server exactly like the ones this exists for: bound to loopback, so
 *  unreachable from any other machine. `host` picks WHICH loopback — `::1` is
 *  what vite and several Node versions bind by default, and it is the bind the
 *  relay used to be unable to reach. */
function serveOnLoopback(
  body: string,
  host = "127.0.0.1",
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: HttpServer = createServer((_req, res) => res.end(body));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({
        port: address.port,
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** How many SOCKETS this process holds — how a relay feeding itself shows up.
 *
 *  From libuv's own handle list rather than `/proc/<pid>/fd`, which exists only
 *  on Linux: the first darwin run of this suite failed here, on a macOS box with
 *  no `/proc` at all. Counting sockets is also the closer question — the loop's
 *  signature is unbounded accept-then-dial, not descriptors in general. */
function openSocketCount(): number {
  const report = process.report;
  if (report === undefined) {
    throw new Error(
      "port-forward tests: process.report is unavailable, so sockets cannot be counted.",
    );
  }
  const { libuv } = report.getReport() as { libuv: Array<{ type: string }> };
  return libuv.filter((handle) => handle.type === "tcp").length;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the local TCP relay", () => {
  it("serves a loopback-only server on a port bound to every interface", async () => {
    const origin = await serveOnLoopback("hello from loopback");
    cleanups.push(origin.stop);
    const relay = await relayTo(origin.port, silent());
    cleanups.push(relay.close);

    const response = await fetch(`http://127.0.0.1:${relay.localPort}/`);
    expect(await response.text()).toBe("hello from loopback");
  });

  it("serves a server bound to the V6 loopback — the production defect", async () => {
    const origin = await serveOnLoopback("hello from ::1", "::1");
    cleanups.push(origin.stop);
    const relay = await openRelay({
      port: origin.port,
      report: silent(),
      listen: createNetServer,
      lastLocalPort: undefined,
      loopback: "v6",
    });
    cleanups.push(relay.close);

    const response = await fetch(`http://127.0.0.1:${relay.localPort}/`);
    expect(await response.text()).toBe("hello from ::1");
  });

  it("cancelling severs it — the door is shut, not just closed to new callers", async () => {
    const origin = await serveOnLoopback("still here");
    cleanups.push(origin.stop);
    const relay = await relayTo(origin.port, silent());

    await (await fetch(`http://127.0.0.1:${relay.localPort}/`)).text();
    await relay.close();

    await expect(
      fetch(`http://127.0.0.1:${relay.localPort}/`),
    ).rejects.toThrow();
  });

  it("picks a different local port per forward", async () => {
    const origin = await serveOnLoopback("x");
    cleanups.push(origin.stop);
    const first = await relayTo(origin.port, silent());
    cleanups.push(first.close);
    const second = await relayTo(origin.port, silent());
    cleanups.push(second.close);

    expect(second.localPort).not.toBe(first.localPort);
  });

  it("never binds the port it relays to, even when that number is free", async () => {
    const free = await pickFreePort();
    const relay = await relayTo(free, silent());
    cleanups.push(relay.close);

    expect(relay.localPort).not.toBe(free);
  });

  it("does not loop when its target never answers", async () => {
    const free = await pickFreePort();
    const relay = await relayTo(free, silent());
    cleanups.push(relay.close);
    const before = openSocketCount();

    await new Promise<void>((resolve) => {
      const probe = connect({ host: "127.0.0.1", port: relay.localPort });
      probe.on("close", () => resolve());
      probe.on("error", () => resolve());
      setTimeout(() => {
        probe.destroy();
        resolve();
      }, 500);
    });

    expect(openSocketCount() - before).toBeLessThan(50);
  });
});

describe("pickFreePort", () => {
  it("hands out a port that can then be bound", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", resolve);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("a relay that fails after it was up", () => {
  async function relayWithHandle(
    port: number,
    report: { lost: (r: string) => void; fault: (r: string) => void },
  ): Promise<{ relay: OpenedForward; server: Server }> {
    let server: Server | undefined;
    const relay = await openRelay({
      port,
      report,
      listen: (onConnection) => {
        server = createNetServer(onConnection);
        return server;
      },
      lastLocalPort: undefined,
      loopback: "v4",
    });
    if (server === undefined) throw new Error("no listener was created");
    return { relay, server };
  }

  it("tears itself down, and says so exactly once", async () => {
    const origin = await serveOnLoopback("gone soon");
    cleanups.push(origin.stop);
    const losses: string[] = [];
    const { relay, server } = await relayWithHandle(origin.port, {
      lost: (reason) => losses.push(reason),
      fault: () => {},
    });

    await (await fetch(`http://127.0.0.1:${relay.localPort}/`)).text();
    server.emit("error", new Error("listener exploded"));
    server.emit("error", new Error("and again"));
    await new Promise((done) => setTimeout(done, 50));

    await expect(
      fetch(`http://127.0.0.1:${relay.localPort}/`),
    ).rejects.toThrow();
    expect(losses).toHaveLength(1);
    expect(losses[0]).toContain("listener exploded");
  });

  it("says nothing when WE closed it", async () => {
    const origin = await serveOnLoopback("bye");
    cleanups.push(origin.stop);
    const losses: string[] = [];
    const relay = await relayTo(origin.port, {
      lost: (reason) => losses.push(reason),
      fault: (reason) => losses.push(reason),
    });

    await relay.close();
    await new Promise((done) => setTimeout(done, 20));

    expect(losses).toEqual([]);
  });

  it("makes a concurrent close JOIN the teardown already under way", async () => {
    const origin = await serveOnLoopback("bye");
    cleanups.push(origin.stop);
    const losses: string[] = [];
    const { relay, server } = await relayWithHandle(origin.port, {
      lost: (reason) => losses.push(reason),
      fault: () => {},
    });

    server.emit("error", new Error("listener exploded"));
    await relay.close();

    await expect(
      fetch(`http://127.0.0.1:${relay.localPort}/`),
    ).rejects.toThrow();
    expect(losses).toHaveLength(1);
  });

  it("does not report a loss when the teardown itself failed", async () => {
    const origin = await serveOnLoopback("stuck");
    cleanups.push(origin.stop);
    const losses: string[] = [];
    const faults: string[] = [];
    let refuse = true;
    let server: Server | undefined;
    const relay = await openRelay({
      port: origin.port,
      report: { lost: (r) => losses.push(r), fault: (r) => faults.push(r) },
      listen: (onConnection) => {
        server = createNetServer(onConnection);
        const realClose = server.close.bind(server);
        server.close = ((cb?: (err?: Error) => void) => {
          if (refuse) {
            cb?.(new Error("close refused"));
            return server as Server;
          }
          return realClose(cb);
        }) as Server["close"];
        return server;
      },
      lastLocalPort: undefined,
      loopback: "v4",
    });
    cleanups.push(async () => {
      refuse = false;
      await relay.close().catch(() => {});
    });

    server?.emit("error", new Error("listener exploded"));
    await new Promise((done) => setTimeout(done, 50));

    expect(losses).toEqual([]);

    refuse = false;
    await expect(relay.close()).resolves.toBeUndefined();
  });

  it("is safe to close twice", async () => {
    const origin = await serveOnLoopback("bye");
    cleanups.push(origin.stop);
    const relay = await relayTo(origin.port, silent());

    await relay.close();
    await expect(relay.close()).resolves.toBeUndefined();
  });

  describe("the remembered local port", () => {
    it("comes back on the same number after a restart", async () => {
      const origin = await serveOnLoopback("one");
      cleanups.push(origin.stop);
      const first = await relayTo(origin.port, silent());
      const port = first.localPort;
      await first.close();

      const again = await openRelay({
        port: origin.port,
        report: silent(),
        listen: createNetServer,
        lastLocalPort: port,
        loopback: "v4",
      });
      cleanups.push(() => again.close());
      expect(again.localPort).toBe(port);
    });

    it("takes a free port when the remembered one is gone", async () => {
      const origin = await serveOnLoopback("two");
      cleanups.push(origin.stop);
      // The squatter has to hold the address the RELAY will bind — the wildcard
      // — not just loopback. On linux a loopback holder is enough to make
      // `0.0.0.0:<port>` unbindable; on macOS the two coexist happily, so a
      // loopback-only squatter left the port genuinely free there and the relay
      // correctly kept it. The test was asserting a linux kernel's conflict
      // rules rather than the behaviour it means to pin.
      const squatter = await serveOnLoopback("mine", "0.0.0.0");
      cleanups.push(squatter.stop);

      const relay = await openRelay({
        port: origin.port,
        report: silent(),
        listen: createNetServer,
        lastLocalPort: squatter.port,
        loopback: "v4",
      });
      cleanups.push(() => relay.close());
      expect(relay.localPort).not.toBe(squatter.port);
      expect(relay.localPort).toBeGreaterThan(0);
    });

    it("refuses a KERNEL-CHOSEN port that lands on the target too", async () => {
      const target = await pickFreePort();
      let closed = false;
      const collidingListen = (): Server => {
        const server = createNetServer();
        server.address = () => ({
          address: "0.0.0.0",
          family: "IPv4",
          port: target,
        });
        const realClose = server.close.bind(server);
        server.close = ((cb?: (err?: Error) => void) => {
          closed = true;
          return realClose(cb);
        }) as typeof server.close;
        return server;
      };

      await expect(
        openRelay({
          port: target,
          report: silent(),
          listen: collidingListen,
          lastLocalPort: undefined,
          loopback: "v4",
        }),
      ).rejects.toThrow(/relay into itself/);
      expect(closed).toBe(true);
    });

    it("refuses the one number that would point the relay at itself", async () => {
      const origin = await serveOnLoopback("three");
      cleanups.push(origin.stop);
      expect(() =>
        openRelay({
          port: origin.port,
          report: silent(),
          listen: createNetServer,
          lastLocalPort: origin.port,
          loopback: "v4",
        }),
      ).toThrow(/relay into itself/);
    });
  });
});
