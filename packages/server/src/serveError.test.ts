import { createServer, type Server } from "node:http";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { attachServeErrorHandler, describeServeError } from "./serveError.ts";

describe("describeServeError", () => {
  it("explains a port-in-use failure with the port and a remedy", () => {
    const msg = describeServeError(
      { code: "EADDRINUSE" } as NodeJS.ErrnoException,
      {
        host: "127.0.0.1",
        port: 7681,
      },
    );
    expect(msg).toContain("7681");
    expect(msg).toMatch(/already in use/i);
    expect(msg).toContain("--port");
  });

  it("explains a permission failure with the bind target", () => {
    const msg = describeServeError(
      { code: "EACCES" } as NodeJS.ErrnoException,
      {
        host: "0.0.0.0",
        port: 80,
      },
    );
    expect(msg).toContain("0.0.0.0:80");
    expect(msg).toMatch(/permission denied/i);
  });

  it("returns null for an unrecognized error so the caller logs it raw", () => {
    const msg = describeServeError(
      { code: "ECONNRESET" } as NodeJS.ErrnoException,
      {
        host: "127.0.0.1",
        port: 7681,
      },
    );
    expect(msg).toBeNull();
  });
});

describe("attachServeErrorHandler", () => {
  // Reproduces the bug: a second listen on an occupied port emits EADDRINUSE
  // on the http.Server returned by serve(). Before the fix there was no
  // listener, so Node rethrew it as an uncaught fatal. The handler turns it
  // into a friendly fatal + clean exit(1).
  const open: Server[] = [];

  afterEach(() => {
    for (const s of open.splice(0)) s.close();
  });

  function occupyFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const blocker = createServer();
      open.push(blocker);
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        const addr = blocker.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port assigned"));
      });
    });
  }

  it("surfaces EADDRINUSE as a friendly fatal and exits cleanly", async () => {
    const port = await occupyFreePort();

    const fatals: string[] = [];
    const exits: number[] = [];

    const result = await new Promise<{ message: string }>((resolve) => {
      const server = serve({
        fetch: () => new Response("ok"),
        hostname: "127.0.0.1",
        port,
      }) as unknown as Server;
      open.push(server);

      attachServeErrorHandler(server, {
        host: "127.0.0.1",
        port,
        log: { fatal: (arg: unknown) => fatals.push(String(arg)) } as never,
        exit: (code) => {
          exits.push(code);
          resolve({ message: fatals.join("\n") });
        },
      });
    });

    expect(exits).toEqual([1]);
    expect(result.message).toMatch(/already in use/i);
    expect(result.message).toContain(String(port));
  });
});
