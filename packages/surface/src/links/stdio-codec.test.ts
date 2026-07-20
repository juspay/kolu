/**
 * The send half of the stdio codec: `framedSend` must treat a write whose
 * destination is already gone (a dead ssh pipe → EPIPE, or our own stream
 * destroyed → ERR_STREAM_DESTROYED) as benign during teardown, resolving
 * rather than rejecting. A rejection here escapes the peer's internal send
 * path as an unhandled rejection and crashes the coordinator on lane teardown
 * after a green run (juspay/odu#32, the residual of #25). Any other write
 * error is real and must still propagate.
 */

import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  framedSend,
  isBenignWriteError,
  readFramedLines,
} from "./stdio-codec";

/** A Writable whose write callback fails with a chosen error code, the way a
 *  dead pipe (EPIPE) or a destroyed stream (ERR_STREAM_DESTROYED) does. It
 *  carries a no-op `'error'` listener so the failing write doesn't ALSO crash
 *  via the unrelated stream-'error' path (the real link/peer attach exactly
 *  such a lifecycle guard) — this isolates the send-promise path under test. */
function failingWrite(code: string): Writable {
  const w = new Writable({
    write(_chunk, _enc, cb) {
      cb(Object.assign(new Error(`write ${code}`), { code }));
    },
  });
  w.on("error", () => {});
  return w;
}

describe("isBenignWriteError", () => {
  it("treats a dead-pipe write (EPIPE / ERR_STREAM_DESTROYED) as benign", () => {
    expect(
      isBenignWriteError(Object.assign(new Error(), { code: "EPIPE" })),
    ).toBe(true);
    expect(
      isBenignWriteError(
        Object.assign(new Error(), { code: "ERR_STREAM_DESTROYED" }),
      ),
    ).toBe(true);
  });

  it("does not swallow other write errors", () => {
    expect(
      isBenignWriteError(Object.assign(new Error(), { code: "ENOSPC" })),
    ).toBe(false);
    expect(isBenignWriteError(new Error("boom"))).toBe(false);
    expect(isBenignWriteError(undefined)).toBe(false);
    expect(isBenignWriteError(null)).toBe(false);
  });
});

describe("framedSend", () => {
  it("resolves AND notifies onPeerGone when the write dies with EPIPE — the #32 teardown race", async () => {
    let peerGone = 0;
    await expect(
      framedSend(failingWrite("EPIPE"), "hello", () => peerGone++),
    ).resolves.toBeUndefined();
    expect(peerGone).toBe(1);
  });

  it("resolves AND notifies onPeerGone when the write dies with ERR_STREAM_DESTROYED", async () => {
    let peerGone = 0;
    await expect(
      framedSend(failingWrite("ERR_STREAM_DESTROYED"), "bye", () => peerGone++),
    ).resolves.toBeUndefined();
    expect(peerGone).toBe(1);
  });

  it("still rejects a non-benign write error (it's a real failure) — no peer-gone notification", async () => {
    let peerGone = 0;
    await expect(
      framedSend(failingWrite("ENOSPC"), "x", () => peerGone++),
    ).rejects.toThrow(/ENOSPC/);
    expect(peerGone).toBe(0);
  });

  it("resolves normally on a healthy write — no peer-gone notification", async () => {
    const written: string[] = [];
    const ok = new Writable({
      write(chunk, _enc, cb) {
        written.push(String(chunk));
        cb();
      },
    });
    let peerGone = 0;
    await expect(
      framedSend(ok, "payload", () => peerGone++),
    ).resolves.toBeUndefined();
    // The frame went out as one base64 line + newline (framing unchanged).
    expect(written.join("")).toMatch(/\n$/);
    expect(peerGone).toBe(0);
  });
});

/**
 * The read half's lifecycle invariant (#1859): SETTLED ⟹ STOPPED. The promise
 * never settles while the reader is still live. `'end'`/`'close'` resolve (the
 * stream has already terminated); every reject goes through `stopAndReject`,
 * which destroys the reader FIRST (Node sets `destroyed` synchronously) and only
 * then rejects — so "stopped" strictly precedes "settled", by construction, for
 * any `Readable`. Before the fix the frame-handler arm was a bare `reject()`
 * that left the `'data'` listener attached and the stream flowing, so the loop
 * kept decoding and dispatching frames the consumer's promise had already
 * reported as "done" (on the override arm: a zombie connection, bookkeeping
 * dead / socket alive).
 */
describe("readFramedLines — settled ⇒ reader stopped (#1859)", () => {
  it("on a synchronous onFrame failure, dispatches NO later frame and destroys the read stream", async () => {
    const read = new PassThrough();
    const received: string[] = [];
    // `onFrame` throwing is the shape a synchronous frame-processing failure
    // takes — it is the sole trigger of this arm (`decodeFrame`'s lenient
    // `Buffer.from(…, "base64")` never throws; a real consumer throws from
    // `onFrame`, e.g. a throwing `onFirstRequest`). All three lines ride in ONE
    // chunk, so a reader that merely detached its listener on settle would
    // still finish the in-progress `while` loop and leak the two valid frames:
    // the invariant is the stronger "the loop STOPS and the stream is
    // destroyed", not just "no future event".
    const settled = readFramedLines(read, (frame) => {
      const text = Buffer.from(frame).toString("utf-8");
      if (text === "POISON") {
        throw new Error("simulated synchronous frame-processing failure");
      }
      received.push(text);
    });
    read.write(
      `${encodeFrame("POISON")}\n${encodeFrame("valid-1")}\n${encodeFrame(
        "valid-2",
      )}\n`,
    );
    await expect(settled).rejects.toMatchObject({
      code: "SURFACE_STDIO_FRAME_HANDLER_FAILED",
    });
    expect(received).toEqual([]);
    expect(read.destroyed).toBe(true);
  });

  it("stops FUTURE dispatch only — a frame BEFORE the poison in the same chunk still dispatches", async () => {
    // The over-rotation guard (R2): "stop the reader" must not undo dispatch
    // that already happened. `valid-0` precedes the poison in the SAME chunk;
    // it is indistinguishable from a frame delivered in a prior chunk, so it
    // MUST have dispatched. A fix that dropped the whole chunk would wrongly
    // leave `received` empty here yet still pass the poison-first test above.
    const read = new PassThrough();
    const received: string[] = [];
    const settled = readFramedLines(read, (frame) => {
      const text = Buffer.from(frame).toString("utf-8");
      if (text === "POISON") throw new Error("boom");
      received.push(text);
    });
    read.write(
      `${encodeFrame("valid-0")}\n${encodeFrame("POISON")}\n${encodeFrame(
        "valid-1",
      )}\n`,
    );
    await expect(settled).rejects.toMatchObject({
      code: "SURFACE_STDIO_FRAME_HANDLER_FAILED",
    });
    expect(received).toEqual(["valid-0"]);
    expect(read.destroyed).toBe(true);
  });

  it("resolves when the stream is destroyed WITHOUT an error (the 'close' contract)", async () => {
    // The docstring warns that peer-server's error-free `endServing()` teardown
    // load-bears on resolve-on-`'close'` (a no-error `destroy()` emits neither
    // `'end'` nor `'error'`). Pin it here, at the codec, where the refactor
    // risk lives — not only in a peer-server test one layer up.
    const read = new PassThrough();
    const settled = readFramedLines(read, () => {});
    read.destroy(); // no error: emits 'close', never 'error'
    await expect(settled).resolves.toBeUndefined();
  });

  it("resolves and discards a buffered partial (newline-less) line on an error-free destroy", async () => {
    const read = new PassThrough();
    const received: string[] = [];
    const settled = readFramedLines(read, (frame) =>
      received.push(Buffer.from(frame).toString("utf-8")),
    );
    read.write(`${encodeFrame("a-frame-with-no-trailing-newline")}`); // stays buffered
    read.destroy();
    await expect(settled).resolves.toBeUndefined();
    expect(received).toEqual([]); // the partial line is never dispatched
  });

  it("a handler that throws a NON-Error (throw null) still stops the reader — the catch must be total", async () => {
    // The catch must not dereference the caught value: `throw null` (or any
    // non-Error) would make `(err as Error).message` throw INSIDE the catch,
    // before the reader is stopped — re-creating the exact zombie (promise
    // pending, stream alive, listener attached). The message is carried on
    // `cause`, so the arm never reads `.message` off an unknown throw.
    const read = new PassThrough();
    const received: string[] = [];
    // A non-Error throw value, via a binding so the runtime `throw` is a plain
    // `throw null` without tripping the static "throw only errors" lint.
    const nonError: unknown = null;
    const settled = readFramedLines(read, (frame) => {
      if (Buffer.from(frame).toString("utf-8") === "POISON") {
        throw nonError;
      }
      received.push(Buffer.from(frame).toString("utf-8"));
    });
    read.write(`${encodeFrame("POISON")}\n${encodeFrame("valid")}\n`);
    await expect(settled).rejects.toMatchObject({
      code: "SURFACE_STDIO_FRAME_HANDLER_FAILED",
    });
    expect(received).toEqual([]);
    expect(read.destroyed).toBe(true);
  });

  it("rejects (never resolves) even when the stream's _destroy swallows the error", async () => {
    // Settling correctly must not depend on `destroy()` echoing an 'error'
    // event: a Readable whose `_destroy` completes with `cb()` (no error) emits
    // only 'close'. If the reject depended on the 'error' re-entry, a handler
    // failure here would RESOLVE (misclassified clean end). `stopAndReject`
    // rejects explicitly after destroy, so it rejects regardless of the stream
    // impl.
    const read = new PassThrough({
      destroy(_err, cb) {
        cb(); // swallow: complete cleanup with NO error → only 'close', no 'error'
      },
    });
    const settled = readFramedLines(read, () => {
      throw new Error("handler boom");
    });
    read.write(`${encodeFrame("anything")}\n`);
    await expect(settled).rejects.toMatchObject({
      code: "SURFACE_STDIO_FRAME_HANDLER_FAILED",
    });
    expect(read.destroyed).toBe(true);
  });

  it("an 'error' emitted while the stream stays open still stops the reader (no post-settle dispatch)", async () => {
    // Node does not define every 'error' as termination — a Readable can emit
    // 'error' while remaining open. The settle path must stop the reader itself,
    // not assume the event already did, or a later frame leaks (the zombie
    // again). Real transports autoDestroy on 'error'; this pins the general
    // `Readable` contract the codec advertises.
    const read = new PassThrough();
    const received: string[] = [];
    const settled = readFramedLines(read, (frame) =>
      received.push(Buffer.from(frame).toString("utf-8")),
    );
    read.emit("error", new Error("open-stream error")); // manual: does NOT destroy
    await expect(settled).rejects.toThrow(/open-stream error/);
    expect(read.destroyed).toBe(true);
    read.write(`${encodeFrame("after-settle")}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([]);
  });
});
