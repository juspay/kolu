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
import { serveOverStdio } from "./peer-server";
import { implementSurface } from "./server";

// biome-ignore lint/suspicious/noExplicitAny: the shape `serveOverStdio` accepts, mirroring its own `Router<any, T>` param.
function buildRouter(): Router<any, any> {
  const surface = defineSurface({
    procedures: {
      sys: { ping: { output: z.object({ ok: z.boolean() }) } },
    },
  });
  const runtime = implementSurface(surface, {
    procedures: { sys: { ping: async () => ({ ok: true }) } },
  });
  // biome-ignore lint/suspicious/noExplicitAny: runtime.router is typed `unknown`; narrow to the `Router<any, any>` serving wants.
  return runtime.router as Router<any, any>;
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

  it("resolves — never rejects — on a NON-benign write failure (reason 'error')", async () => {
    // The write half is the symmetric footgun to the read half above: a
    // failed write emits 'error' on the write stream, and an 'error' with no
    // listener is a hard crash — the same `process.exit(1)`-on-unhandled
    // death the read side already guards. A write failure that is NOT a
    // benign peer-gone death (no EPIPE/ERR_STREAM_DESTROYED code — e.g. an
    // EIO/EACCES on a redirected stdout) is genuinely abnormal: serving ends
    // as a settled `{ reason: "error", error }`, never a crash.
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      router: buildRouter(),
      transport: { read, write },
    });
    const broken = Object.assign(new Error("write EIO"), { code: "EIO" });
    write.destroy(broken);
    await expect(serving).resolves.toEqual({ reason: "error", error: broken });
  });

  it("resolves with reason 'end' on a BENIGN write death (peer-gone EPIPE)", async () => {
    // The other write-error arm: a real broken pipe (the parent exited, the
    // unix-socket peer reset) carries code EPIPE, which the codec's
    // `isBenignWriteError` classifies as clean peer-gone teardown. The
    // funnel destroys the read stream WITHOUT the error, so the serve
    // settles `{ reason: "end" }` — exactly like a clean EOF, on BOTH arms
    // (this pins the override arm at the unit level; the default arm's
    // exit-0 twin lives in peer-server.lifetime.test.ts).
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      router: buildRouter(),
      transport: { read, write },
    });
    const gone = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    write.destroy(gone);
    await expect(serving).resolves.toEqual({ reason: "end" });
  });
});
