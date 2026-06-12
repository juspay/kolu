/**
 * Pins `serveOverStdio`'s settled-result contract: serving ends when the
 * read stream does, and BOTH ways it can end resolve — never reject. The
 * error path is the regression that matters: a rejecting serve promise
 * turned any flaky peer (a reset socket, a pipe torn mid-frame) into an
 * unhandled rejection in the serving process, fatal under
 * `process.exit(1)`-on-unhandledRejection policies (it crashed kolu-server
 * twice from `serveOverUnixSocket`'s per-connection serves before this
 * contract was pinned).
 */
import { PassThrough } from "node:stream";
import type { Router } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { implement, serveOverStdio } from "./peer-server";
import { type Channel, implementSurface, inMemoryChannel } from "./server";

// biome-ignore lint/suspicious/noExplicitAny: the shape `serveOverStdio` accepts, mirroring its own `Router<any, T>` param.
function buildRouter(): Router<any, any> {
  const surface = defineSurface({
    procedures: {
      sys: { ping: { output: z.object({ ok: z.boolean() }) } },
    },
  });
  const fragment = implementSurface(surface, {
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
    procedures: { sys: { ping: async () => ({ ok: true }) } },
  });
  return implement(surface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: fragment procedure-context vs. contract-derived param mismatch; runtime shape is valid (same cast as mini-ci and kolu's servePtyHostRouter).
    { ...fragment.router } as any,
    // biome-ignore lint/suspicious/noExplicitAny: narrow back to the `Router<any, any>` serving wants (see above).
  ) as Router<any, any>;
}

describe("serveOverStdio — settled-result contract", () => {
  it("resolves with reason 'end' on a clean EOF (peer disconnected)", async () => {
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      router: buildRouter(),
      transport: { read, write },
    });
    read.end();
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("resolves — never rejects — when the read stream errors (peer reset)", async () => {
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      router: buildRouter(),
      transport: { read, write },
    });
    const reset = new Error("read ECONNRESET");
    read.destroy(reset);
    await expect(serving).resolves.toEqual({ reason: "error", error: reset });
  });
});
