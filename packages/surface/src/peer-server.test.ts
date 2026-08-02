/**
 * Pins `serveOverStdio`'s settled-result contract: serving ends when the
 * transport does, and EVERY way it can end resolves — never rejects. The error
 * path is the regression that matters: a rejecting serve promise turned any
 * flaky peer (a reset socket, a pipe torn mid-frame) into an unhandled
 * rejection in the serving process, fatal under
 * `process.exit(1)`-on-unhandledRejection policies (it crashed kolu-server
 * twice from `serveOverUnixSocket`'s per-connection serves before this contract
 * was pinned).
 */
import { PassThrough } from "node:stream";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { stdioLink } from "./links/stdio";
import { createLoopbackPair } from "./loopback";
import { serveOverStdio } from "./peer-server";
import { implementSurface } from "./server";

const surface = defineSurface({
  procedures: {
    sys: { ping: { output: Schema.Struct({ ok: Schema.Boolean }) } },
  },
});

function buildServed(onPing?: () => void) {
  const runtime = implementSurface(surface, {
    procedures: {
      sys: {
        ping: () =>
          Effect.sync(() => {
            onPing?.();
            return { ok: true };
          }),
      },
    },
  });
  return { group: runtime.group, handlers: runtime.handlers };
}

describe("serveOverStdio — settled-result contract", () => {
  it("resolves with reason 'end' on a clean EOF (peer disconnected)", async () => {
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read, write },
    });
    read.end();
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("resolves — never rejects — when the read stream errors (peer reset)", async () => {
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read, write },
    });
    const reset = new Error("read ECONNRESET");
    read.destroy(reset);
    await expect(serving).resolves.toEqual({ reason: "error", error: reset });
  });

  it("resolves — never rejects — on a NON-benign write failure (reason 'error')", async () => {
    // The write half is the symmetric footgun to the read half: a failed write
    // emits 'error' on the write stream, and an 'error' with no listener is a
    // hard crash. A write failure that is NOT a benign peer-gone death (an
    // EIO/EACCES on a redirected stdout) is genuinely abnormal.
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read, write },
    });
    const broken = Object.assign(new Error("write EIO"), { code: "EIO" });
    write.destroy(broken);
    await expect(serving).resolves.toEqual({ reason: "error", error: broken });
  });

  it("resolves with reason 'end' on a BENIGN write death (peer-gone EPIPE)", async () => {
    // A real broken pipe (the parent exited, the unix-socket peer reset)
    // carries EPIPE, which IS clean peer-gone teardown: on a parent death a
    // pushing agent often sees stdout-EPIPE before stdin delivers EOF, and
    // carrying that race as an error would nondeterministically flip the same
    // teardown between exit 0 and exit 1 on the default arm.
    const read = new PassThrough();
    const write = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read, write },
    });
    const gone = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    write.destroy(gone);
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("resolves with reason 'end' on a benign death of a SHARED duplex (the unix-socket shape)", async () => {
    // One `net.Socket` is both read and write. Node marks a duplex destroyed
    // BEFORE emitting 'error', so the same peer-gone EPIPE can arrive on
    // either half — the terminal classification must read it as clean teardown
    // either way, or the identical death gets a different reason by shape.
    const duplex = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read: duplex, write: duplex },
    });
    duplex.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("resolves with reason 'end' when the write stream is destroyed WITHOUT an error", async () => {
    // destroy() with no error emits NO 'error' event — Node reports
    // ERR_STREAM_DESTROYED only to the write() callback — so nothing but the
    // stream's 'close' can tell us the peer's read side is gone. Without that
    // edge the serve promise would sit pending forever (on the default arm:
    // the immortal orphan, re-spelled).
    const read = new PassThrough();
    const deadEnd = new PassThrough();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: { read, write: deadEnd },
    });
    deadEnd.destroy(); // silent: no 'error' event, callback-only failure
    await expect(serving).resolves.toEqual({ reason: "end" });
  });

  it("fires onFirstRequest when the first inbound bytes arrive", async () => {
    const pair = createLoopbackPair();
    let firstSeen = false;
    const serving = serveOverStdio({
      ...buildServed(),
      transport: pair.server,
      onFirstRequest: () => {
        firstSeen = true;
      },
    });
    expect(firstSeen).toBe(false);

    const link = await stdioLink({
      group: surface.group,
      read: pair.client.read,
      write: pair.client.write,
    });
    await expect(
      Effect.runPromise(link.dispatch.unary("surface/sys/ping", undefined)),
    ).resolves.toEqual({ ok: true });
    expect(firstSeen).toBe(true);

    await link.dispose();
    pair.client.write.end();
    pair.server.write.end();
    await serving;
  });
});

/**
 * The #1859 zombie: when `serveOverStdio` settles `{ reason: "error" }` the
 * transport must actually be CLOSED — otherwise the socket stays alive while
 * the serving accounting believes the connection is over, and later frames keep
 * reaching handlers that nobody is supervising. This is the override-arm harm
 * the issue names (`serveOverUnixSocket`'s per-connection serves over one
 * shared `net.Socket`).
 */
describe("serveOverStdio — settled ⇒ transport closed (the #1859 zombie)", () => {
  it("a serve settled {reason:'error'} closes the transport and stops reaching the handlers", async () => {
    let handlerCalls = 0;
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      ...buildServed(() => {
        handlerCalls++;
      }),
      transport: pair.server,
      onFirstRequest: () => {
        throw new Error("synchronous read-loop failure");
      },
    });

    const link = await stdioLink({
      group: surface.group,
      read: pair.client.read,
      write: pair.client.write,
    });
    // The call's own fate is not what is pinned here (the transport dies under
    // it); the observable is the serve's verdict plus the handler count.
    void Effect.runPromise(
      link.dispatch.unary("surface/sys/ping", undefined),
    ).catch(() => {});

    await expect(serving).resolves.toMatchObject({ reason: "error" });
    expect(pair.server.read.destroyed).toBe(true);
    expect(handlerCalls).toBe(0);

    // …and a later request cannot reach the handlers either.
    void Effect.runPromise(
      link.dispatch.unary("surface/sys/ping", undefined),
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlerCalls).toBe(0);
    await link.dispose();
  });

  it("an async onFirstRequest is rejected loudly (→ reason 'error'), not left to escape", async () => {
    // `onFirstRequest` is typed `() => void`, but TS's void-return
    // compatibility lets an `async () => {}` satisfy it. Such a hook's
    // rejection would escape as an unhandled rejection; the call site instead
    // throws on a thenable return, routing it through the same classified arm a
    // synchronous throw takes.
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      ...buildServed(),
      transport: pair.server,
      onFirstRequest: async () => {},
    });
    pair.client.write.write("{}\n");

    const end = await serving;
    expect(end).toMatchObject({ reason: "error" });
    expect(((end as { error: Error }).error as Error).message).toMatch(
      /onFirstRequest must be synchronous/,
    );
  });
});
