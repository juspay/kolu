/**
 * The send half of the stdio codec: `framedSend` must treat a write whose
 * destination is already gone (a dead ssh pipe → EPIPE, or our own stream
 * destroyed → ERR_STREAM_DESTROYED) as benign during teardown, resolving
 * rather than rejecting. A rejection here escapes the peer's internal send
 * path as an unhandled rejection and crashes the coordinator on lane teardown
 * after a green run (juspay/odu#32, the residual of #25). Any other write
 * error is real and must still propagate.
 */

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { framedSend, isBenignWriteError } from "./stdio-codec";

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
  it("resolves when the write dies with EPIPE — the #32 teardown race", async () => {
    await expect(
      framedSend(failingWrite("EPIPE"), "hello"),
    ).resolves.toBeUndefined();
  });

  it("resolves when the write dies with ERR_STREAM_DESTROYED", async () => {
    await expect(
      framedSend(failingWrite("ERR_STREAM_DESTROYED"), "bye"),
    ).resolves.toBeUndefined();
  });

  it("still rejects a non-benign write error (it's a real failure)", async () => {
    await expect(framedSend(failingWrite("ENOSPC"), "x")).rejects.toThrow(
      /ENOSPC/,
    );
  });

  it("resolves normally on a healthy write", async () => {
    const written: string[] = [];
    const ok = new Writable({
      write(chunk, _enc, cb) {
        written.push(String(chunk));
        cb();
      },
    });
    await expect(framedSend(ok, "payload")).resolves.toBeUndefined();
    // The frame went out as one base64 line + newline (framing unchanged).
    expect(written.join("")).toMatch(/\n$/);
  });
});
