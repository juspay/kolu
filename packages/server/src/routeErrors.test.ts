/** `installRouteErrorLogging` — the catch-all that makes an error thrown AFTER a
 *  handler returns (the artifact-sdk HTML decorator draining a faulting preview
 *  stream) a LOGGED 500 instead of Hono's default, unlogged one. */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { installRouteErrorLogging } from "./routeErrors.ts";

/** A `text/html`-shaped body that yields one chunk then FAULTS — mimics a remote
 *  preview whose per-chunk dial drops mid-stream. */
function faultingHtmlStream(): ReadableStream {
  let pulls = 0;
  return new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new TextEncoder().encode("<html>"));
        return;
      }
      throw new Error("remote preview chunk bytes=6-11 faulted mid-stream");
    },
  });
}

/** Mimic `mountArtifactSdk`'s decorator seam: after the route runs, buffer any
 *  `text/html` body via `res.text()` (which drains the stream — and throws if it
 *  faults) before re-emitting it. */
function htmlDecorator(app: Hono): void {
  app.use("/preview/*", async (c, next) => {
    await next();
    if ((c.res.headers.get("content-type") ?? "").startsWith("text/html")) {
      const body = await c.res.text(); // faults here if the stream errored
      c.res = new Response(body, { status: 200, headers: c.res.headers });
    }
  });
}

describe("installRouteErrorLogging", () => {
  it("LOGS + 500s a fault thrown after the handler returns (HTML decorator draining a faulting stream)", async () => {
    const log = { error: vi.fn() };
    const app = new Hono();
    installRouteErrorLogging(app, log);
    htmlDecorator(app);
    app.get(
      "/preview/x",
      () =>
        new Response(faultingHtmlStream(), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );

    const res = await app.request("/preview/x");

    // Loud to the client...
    expect(res.status).toBe(500);
    // ...AND logged (the operator sees the real link fault — this is the assertion
    // that fails without the handler, where Hono's default 500 never touches `log`).
    expect(log.error).toHaveBeenCalledOnce();
    const [payload] = log.error.mock.calls[0] as [{ err: Error }];
    expect(String(payload.err)).toMatch(/faulted mid-stream/);
    expect(payload).toMatchObject({ method: "GET", path: "/preview/x" });
  });

  it("passes a clean response through untouched (only faults are intercepted)", async () => {
    const log = { error: vi.fn() };
    const app = new Hono();
    installRouteErrorLogging(app, log);
    app.get("/ok", (c) => c.text("fine"));

    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fine");
    expect(log.error).not.toHaveBeenCalled();
  });
});
