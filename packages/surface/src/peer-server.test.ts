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
import { oc } from "@orpc/contract";
import type { Router } from "@orpc/server";
import { implement } from "@orpc/server";
import type { StandardRequest } from "@orpc/standard-server";
import { ClientPeer } from "@orpc/standard-server-peer";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { stdioLink } from "./links/stdio";
import { encodeFrame } from "./links/stdio-codec";
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

  it("resolves with reason 'end' on a benign death of a SHARED duplex (the unix-socket shape)", async () => {
    // `serveOverUnixSocket` passes ONE `net.Socket` as both read and write.
    // Node marks a duplex destroyed BEFORE emitting 'error', so the write
    // funnel's destroyed-guard defers and the same peer-gone EPIPE arrives
    // as the READ-side rejection instead. The terminal classification must
    // read it as clean teardown, exactly like the separate-stream shape —
    // otherwise the identical death gets a different reason by shape.
    const duplex = new PassThrough();
    const serving = serveOverStdio({
      router: buildRouter(),
      transport: { read: duplex, write: duplex },
    });
    duplex.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("resolves with reason 'end' when a response hits a write stream destroyed WITHOUT an error", async () => {
    // destroy() with no error emits NO 'error' event — Node reports
    // ERR_STREAM_DESTROYED only to the write() callback — so the funnel
    // never fires. Without framedSend's onPeerGone the serve promise would
    // sit pending forever (on the default arm: the immortal orphan,
    // re-spelled). A live request forces a response write into the dead
    // stream; serving must settle as clean teardown.
    const contract = {
      add: oc
        .input(z.object({ a: z.number(), b: z.number() }))
        .output(z.number()),
    };
    const t = implement(contract);
    const router = t.router({
      add: t.add.handler(({ input }) => input.a + input.b),
    });

    const toServer = new PassThrough();
    const deadEnd = new PassThrough();
    const serving = serveOverStdio({
      router,
      transport: { read: toServer, write: deadEnd },
    });
    deadEnd.destroy(); // silent: no 'error' event, callback-only failure

    const client = stdioLink<typeof contract>({
      read: new PassThrough(), // the response can never arrive
      write: toServer,
    });
    // Intentional swallow: this call exists only to force the server's
    // response write into the dead stream; its own rejection (the link
    // tearing down under it) is the expected byproduct, and the assertion
    // below on `serving` is the test's real observable.
    void client.add({ a: 2, b: 3 }).catch(() => {});

    await expect(serving).resolves.toEqual({ reason: "end" });
  });
});

/**
 * The #1859 zombie, one level up: when `serveOverStdio` settles
 * `{ reason: "error" }` because the read loop hit a synchronous failure, the
 * transport must actually be CLOSED — otherwise the socket stays alive while
 * the server-side accounting believes the connection is over, and later frames
 * keep reaching the (already closed) `ServerPeer`. This is the override-arm
 * harm the issue names (`serveOverUnixSocket`'s per-connection serves over one
 * shared `net.Socket`).
 *
 * Reproduction note (repo rule #1690 — the inherited diagnosis is a hypothesis
 * until reproduced): a *corrupt inbound frame* does NOT reach this reject arm
 * through `serveOverStdio` today — `peer.message()` swallows a bad frame as a
 * caught rejection, never a synchronous throw, so the serve stays pending. The
 * only reject-arm trigger reachable through the real serve path is a
 * SYNCHRONOUS `onFrame` throw, of which the documented `onFirstRequest` hook is
 * the one production lever. The zombie itself is real: before the fix, with the
 * serve settled, a later genuine request still invoked the router handler.
 */
describe("serveOverStdio — settled ⇒ transport closed (the #1859 zombie)", () => {
  it("a serve settled {reason:'error'} closes the transport and stops reaching the router", async () => {
    const contract = {
      add: oc.input(z.object({ a: z.number() })).output(z.number()),
    };
    const t = implement(contract);
    let handlerCalls = 0;
    const router = t.router({
      add: t.add.handler(({ input }) => {
        handlerCalls++;
        return input.a;
      }),
    });

    // Capture ONE genuine encoded request frame to replay AFTER the serve has
    // settled — the decisive "did a later frame still reach the peer?" probe.
    // A garbage frame can't witness this (peer.message swallows it with no
    // router side effect); only a valid request invokes the handler.
    const captured: Uint8Array[] = [];
    const clientPeer = new ClientPeer((m) => {
      captured.push(m as Uint8Array);
    });
    const request: StandardRequest = {
      method: "POST",
      url: new URL("http://orpc/add"),
      headers: {},
      body: { json: { a: 7 }, meta: [] },
      signal: undefined,
    };
    void clientPeer.request(request).catch(() => {});
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    // The unix-socket shape: ONE duplex is both read and write. `onFirstRequest`
    // throwing is the reachable synchronous read-loop failure (see the note
    // above) that drives readFramedLines' frame-handler-failure reject arm.
    const duplex = new PassThrough();
    duplex.on("error", () => {}); // absorb the post-settle write on a destroyed stream
    const serving = serveOverStdio({
      router,
      transport: { read: duplex, write: duplex },
      onFirstRequest: () => {
        throw new Error("synchronous read-loop failure");
      },
    });
    duplex.write(`${encodeFrame("first")}\n`);

    await expect(serving).resolves.toMatchObject({ reason: "error" });

    // The transport is actually closed — no zombie (dead by accounting yet
    // alive by socket).
    expect(duplex.destroyed).toBe(true);

    // …and a later genuine request does NOT reach the router: the destroyed
    // stream delivers no further 'data', so the handler is never invoked.
    duplex.write(`${encodeFrame(captured[0] as Uint8Array)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlerCalls).toBe(0);
  });
});
