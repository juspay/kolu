import { createServer, type Server } from "node:http";
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

  it("takes the target's own port number when that number is free here", async () => {
    // Nothing is listening on this number, so the relay's preference holds and
    // the local port is predictable rather than random.
    const free = await pickFreePort();
    const relay = await openRelay(free, () => {});
    cleanups.push(relay.close);

    expect(relay.localPort).toBe(free);
  });

  it("falls back rather than failing when that number is taken", async () => {
    // The usual case for a LOCAL target: the server we relay to already owns
    // the number on this machine, so `0.0.0.0:<same>` cannot bind beside it.
    const origin = await serveOnLoopback("busy");
    cleanups.push(origin.stop);
    const relay = await openRelay(origin.port, () => {});
    cleanups.push(relay.close);

    expect(relay.localPort).not.toBe(origin.port);
    const response = await fetch(`http://127.0.0.1:${relay.localPort}/`);
    expect(await response.text()).toBe("busy");
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
