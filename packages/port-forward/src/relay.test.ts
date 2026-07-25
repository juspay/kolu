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

/** A report that records nothing — for the cases that only care about bytes. */
const silent = () => ({ lost: () => {}, fault: () => {} });

/** The relay as production builds it: node's own listener, which is what
 *  `nativeMechanisms` hands it. The cases that inject a fake listener call
 *  `openRelay` directly. */
const relayTo = (port: number, report: ForwardReport) =>
  openRelay({
    port,
    report,
    listen: createNetServer,
    lastLocalPort: undefined,
  });

/** A dev server exactly like the ones this exists for: bound to loopback, so
 *  unreachable from any other machine. */
function serveOnLoopback(
  body: string,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: HttpServer = createServer((_req, res) => res.end(body));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
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

  it("cancelling severs it — the door is shut, not just closed to new callers", async () => {
    const origin = await serveOnLoopback("still here");
    cleanups.push(origin.stop);
    const relay = await relayTo(origin.port, silent());

    // A served request leaves a pooled keep-alive socket on the relay; close()
    // must destroy it rather than wait politely for it to end on its own —
    // otherwise close() would hang and the "cancelled" forward would still be
    // carrying bytes.
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
    // Both ends are on this machine: a listener on `0.0.0.0:<port>` relaying to
    // `127.0.0.1:<port>` is pointed at ITSELF. Measured when this was open, one
    // connection opened ~29,000 file descriptors in 1.5s before anything else
    // noticed.
    const free = await pickFreePort();
    const relay = await relayTo(free, silent());
    cleanups.push(relay.close);

    expect(relay.localPort).not.toBe(free);
  });

  it("does not loop when its target never answers", async () => {
    // The self-relay's signature was unbounded accept-then-dial. A connection
    // to a relay whose target is dead must end, and must cost a bounded number
    // of sockets.
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
  /** Open a relay while keeping a handle on its listener, so the test can fail
   *  it the way the kernel would — there is no way to provoke that through a
   *  real socket. */
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

    // Hold a live pair open, then fail the listener the way the kernel would.
    await (await fetch(`http://127.0.0.1:${relay.localPort}/`)).text();
    server.emit("error", new Error("listener exploded"));
    server.emit("error", new Error("and again"));
    await new Promise((done) => setTimeout(done, 50));

    // Reporting without tearing down was the defect: the row disappears while
    // the door is still open.
    await expect(
      fetch(`http://127.0.0.1:${relay.localPort}/`),
    ).rejects.toThrow();
    // And a second notification could delete a REPLACEMENT that reused the key.
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
    // "Already closing" must not answer "done" while the server is still
    // closing: a caller that believed it could then reuse the key, and the
    // late loss would land on the replacement.
    const origin = await serveOnLoopback("bye");
    cleanups.push(origin.stop);
    const losses: string[] = [];
    const { relay, server } = await relayWithHandle(origin.port, {
      lost: (reason) => losses.push(reason),
      fault: () => {},
    });

    server.emit("error", new Error("listener exploded"));
    await relay.close();

    // By the time close() resolves the door really is shut.
    await expect(
      fetch(`http://127.0.0.1:${relay.localPort}/`),
    ).rejects.toThrow();
    expect(losses).toHaveLength(1);
  });

  it("does not report a loss when the teardown itself failed", async () => {
    // `onLost` makes the owner drop its only handle. After a FAILED teardown
    // the relay may still be reachable, so claiming it is gone would strand it.
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
    });
    cleanups.push(async () => {
      refuse = false;
      await relay.close().catch(() => {});
    });

    server?.emit("error", new Error("listener exploded"));
    await new Promise((done) => setTimeout(done, 50));

    expect(losses).toEqual([]);

    // Still owned, and a retry once the mechanism recovers really retries.
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
      // The property links and bookmarks rest on. A relay has no target-number
      // preference to fall back on (that number is the one it may never take), so
      // without this every restart moved the door and silently broke every URL
      // the user had.
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
      });
      cleanups.push(() => again.close());
      expect(again.localPort).toBe(port);
    });

    it("takes a free port when the remembered one is gone", async () => {
      // A forward is never refused over a busy number — the same rule the ssh
      // mechanism follows, and the reason there is no knob for either.
      const origin = await serveOnLoopback("two");
      cleanups.push(origin.stop);
      const squatter = await serveOnLoopback("mine");
      cleanups.push(squatter.stop);

      const relay = await openRelay({
        port: origin.port,
        report: silent(),
        listen: createNetServer,
        lastLocalPort: squatter.port,
      });
      cleanups.push(() => relay.close());
      expect(relay.localPort).not.toBe(squatter.port);
      expect(relay.localPort).toBeGreaterThan(0);
    });

    it("refuses the one number that would point the relay at itself", async () => {
      // Unreachable through the map (a relay can never have HAD this number), so
      // this is a guard on the consequence rather than on a live path: binding
      // `0.0.0.0:<port>` while dialling `127.0.0.1:<port>` opened ~29,000 file
      // descriptors in 1.5 seconds the one time it happened.
      const origin = await serveOnLoopback("three");
      cleanups.push(origin.stop);
      expect(() =>
        openRelay({
          port: origin.port,
          report: silent(),
          listen: createNetServer,
          lastLocalPort: origin.port,
        }),
      ).toThrow(/relay into itself/);
    });
  });
});
