import { readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { pickFreePort } from "./freePort.ts";
import { openRelay } from "./relay.ts";

/** A dev server exactly like the ones this exists for: bound to loopback, so
 *  unreachable from any other machine. */
function serveOnLoopback(
  body: string,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => res.end(body));
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

/** How many descriptors this process holds — the cheapest way to see a relay
 *  that is feeding itself. Linux-only, which is where the loop was measured. */
function openFdCount(): number {
  return readdirSync(`/proc/${process.pid}/fd`).length;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the local TCP relay", () => {
  it("serves a loopback-only server on a port bound to every interface", async () => {
    const origin = await serveOnLoopback("hello from loopback");
    cleanups.push(origin.stop);
    const relay = await openRelay(origin.port, () => {});
    cleanups.push(relay.close);

    const response = await fetch(`http://127.0.0.1:${relay.localPort}/`);
    expect(await response.text()).toBe("hello from loopback");
  });

  it("cancelling severs it — the door is shut, not just closed to new callers", async () => {
    const origin = await serveOnLoopback("still here");
    cleanups.push(origin.stop);
    const relay = await openRelay(origin.port, () => {});

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
    const first = await openRelay(origin.port, () => {});
    cleanups.push(first.close);
    const second = await openRelay(origin.port, () => {});
    cleanups.push(second.close);

    expect(second.localPort).not.toBe(first.localPort);
  });

  it("rejects a target port that is not a port", () => {
    expect(() => openRelay(0, () => {})).toThrow(/between 1 and 65535/);
  });

  it("never binds the port it relays to, even when that number is free", async () => {
    // Both ends are on this machine: a listener on `0.0.0.0:<port>` relaying to
    // `127.0.0.1:<port>` is pointed at ITSELF. Measured when this was open, one
    // connection opened ~29,000 file descriptors in 1.5s before anything else
    // noticed.
    const free = await pickFreePort();
    const relay = await openRelay(free, () => {});
    cleanups.push(relay.close);

    expect(relay.localPort).not.toBe(free);
  });

  it("does not loop when its target never answers", async () => {
    // The self-relay's signature was unbounded accept-then-dial. A connection
    // to a relay whose target is dead must end, and must cost a bounded number
    // of sockets.
    const free = await pickFreePort();
    const relay = await openRelay(free, () => {});
    cleanups.push(relay.close);
    const before = openFdCount();

    await new Promise<void>((resolve) => {
      const probe = connect({ host: "127.0.0.1", port: relay.localPort });
      probe.on("close", () => resolve());
      probe.on("error", () => resolve());
      setTimeout(() => {
        probe.destroy();
        resolve();
      }, 500);
    });

    expect(openFdCount() - before).toBeLessThan(50);
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
