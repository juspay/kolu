/** THE FRAME INVARIANT, for the conversation's uploads.
 *
 *  An attachment's bytes may never ride one frame. Effect RPC's ndjson decoder
 *  answers an oversized frame by CLOSING THE SOCKET with 1009, which takes
 *  every subscription in the tab with it — so a 12 MiB paste must arrive as a
 *  sequence of bounded appends or the transcript, the fleet and the terminals
 *  all go dark together. These assertions are the ones that would have caught
 *  the version of this feature that sent the whole base64 on
 *  `conductor.prompt`: there, `attach` is called exactly once with the
 *  entire file in `data`.
 *
 *  The mirror of `terminal/pasteDelivery.test.ts`, which pins the same
 *  invariant for the terminal's drop. */

import {
  FRAME_CHUNK_BASE64_CHARS,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { uploadAttachment } from "./attachmentUpload";

interface AttachArgs {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  appendTo?: string;
}

/** `megabytes` of base64 — the encoded size, which is what a frame carries. */
const base64OfSize = (megabytes: number): string =>
  "a".repeat(megabytes * 1024 * 1024);

const upload = (base64: string, attach: (args: AttachArgs) => unknown) =>
  uploadAttachment({
    id: "att-1",
    name: "screenshot.png",
    mimeType: "image/png",
    base64,
    attach: attach as (
      args: AttachArgs,
    ) => Effect.Effect<{ path: string; bytes: number }, unknown>,
  });

describe("uploadAttachment — bounded frames, in order", () => {
  it("splits a 12 MiB attachment across several bounded calls instead of one huge one", async () => {
    const attach = vi.fn((_args: AttachArgs) =>
      Effect.succeed({
        path: "/state/conductor/attachments/att-1",
        bytes: 1,
      }),
    );

    await Effect.runPromise(upload(base64OfSize(12), attach));

    expect(attach.mock.calls.length).toBeGreaterThan(1);
    // THE invariant: every frame this upload put on the wire fits the cap.
    for (const [args] of attach.mock.calls) {
      expect(args.data.length).toBeLessThanOrEqual(FRAME_CHUNK_BASE64_CHARS);
      expect(frameBytesFor(args.data.length)).toBeLessThan(RPC_MAX_FRAME_BYTES);
    }
  });

  it("creates on the first chunk and appends to the returned path on the rest", async () => {
    const attach = vi.fn((_args: AttachArgs) =>
      Effect.succeed({
        path: "/state/conductor/attachments/att-1",
        bytes: 7,
      }),
    );

    await Effect.runPromise(upload(base64OfSize(8), attach));

    const calls = attach.mock.calls.map(([args]) => args);
    // The first chunk CREATES: anything else would append to a file that does
    // not exist yet.
    expect(calls[0]?.appendTo).toBeUndefined();
    for (const args of calls.slice(1)) {
      expect(args.appendTo).toBe("/state/conductor/attachments/att-1");
    }
  });

  it("never has two chunks in flight — kolu-server appends to one growing file", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const attach = vi.fn((_args: AttachArgs) =>
      Effect.gen(function* () {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        yield* Effect.sleep("1 millis");
        inFlight -= 1;
        return { path: "/state/conductor/attachments/att-1", bytes: 3 };
      }),
    );

    await Effect.runPromise(upload(base64OfSize(8), attach));

    expect(maxInFlight).toBe(1);
  });

  it("answers with PADI's count of what it wrote, not the sender's", async () => {
    const attach = vi.fn((_args: AttachArgs) =>
      Effect.succeed({
        path: "/state/conductor/attachments/att-1",
        bytes: 4242,
      }),
    );

    const written = await Effect.runPromise(upload("aGVsbG8=", attach));

    expect(written).toEqual({
      path: "/state/conductor/attachments/att-1",
      bytes: 4242,
    });
    // A small paste must not grow a round trip.
    expect(attach).toHaveBeenCalledOnce();
    expect(attach.mock.calls[0]?.[0].appendTo).toBeUndefined();
  });

  it("refuses before the first byte when a chunk would not fit a frame", async () => {
    const attach = vi.fn((_args: AttachArgs) =>
      Effect.succeed({
        path: "/state/conductor/attachments/att-1",
        bytes: 1,
      }),
    );

    const exit = await Effect.runPromiseExit(
      uploadAttachment({
        id: "att-1",
        name: "screenshot.png",
        mimeType: "image/png",
        base64: base64OfSize(40),
        attach,
        // The failure the guard exists for: a chunk size nobody re-derived
        // correctly. Driving it is the only way to know the guard works.
        chunkChars: 32 * 1024 * 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    // Nothing was written: a refusal halfway up would leave a partial file a
    // prompt could still name.
    expect(attach).not.toHaveBeenCalled();
  });
});
