import {
  UPLOAD_CHUNK_BASE64_CHARS,
  UPLOAD_CHUNK_BYTES,
} from "@kolu/padi/upload";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { deliverScratchPaste, oversizedFrameRefusal } from "./pasteDelivery";

const base = {
  terminalId: "t1" as TerminalId,
  name: "image.png",
  base64: "AAAA",
  wrapPath: (p: string) => `<start>${p}<end>`,
};

describe("deliverScratchPaste", () => {
  it("writes then bracketed-pastes the path when the terminal is still active", async () => {
    const scratchWrite = vi.fn(() =>
      Effect.succeed({ path: "/scratch/image.png" }),
    );
    const sendInput = vi.fn(() => Effect.void);

    await Effect.runPromise(
      deliverScratchPaste({
        ...base,
        scratchWrite,
        isActive: () => true,
        sendInput,
      }),
    );

    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(sendInput).toHaveBeenCalledWith({
      id: base.terminalId,
      data: "<start>/scratch/image.png<end>",
    });
  });

  it("fails (and never sends) when the terminal dies between the write and the send", async () => {
    // Proves Fix 2: sendInput quiet-drops on a non-active terminal, so without
    // this gate the write succeeds, sendInput silently no-ops, and the paste is
    // lost with NO error. The failure is what the caller's recovery turns into a
    // toast.error.
    const scratchWrite = vi.fn(() =>
      Effect.succeed({ path: "/scratch/image.png" }),
    );
    const sendInput = vi.fn(() => Effect.void);

    await expect(
      Effect.runPromise(
        deliverScratchPaste({
          ...base,
          scratchWrite,
          isActive: () => false, // terminal no longer active after the write
          sendInput,
        }),
      ),
    ).rejects.toThrow(/no longer active/);

    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(sendInput).not.toHaveBeenCalled();
  });
});

/** The argument shape `deliverScratchPaste` hands its writer — named so the
 *  mocks below carry it and `mock.calls` stays typed. */
type WriteArgs = {
  terminalId: TerminalId;
  name: string;
  data: string;
  appendTo?: string;
};

/**
 * G9c(i) at the delivery seam — the incident, in a unit test.
 *
 * PRE-FIX SIGNATURE, verbatim, from the production recording: dropping a 26 MB
 * file produced
 *
 *   Failed to upload "bugbug.mov": SocketCloseError: 1009: MaxBufferSizeExceeded: RPC serialization buffer exceeded the maximum size of 16777216
 *
 * and the terminal pane blanked, because 1009 closes the whole multiplexed
 * socket rather than failing the one call. On the pre-fix code these tests fail
 * at the FIRST assertion — `scratchWrite` was called exactly once, with the
 * entire file in `data` and no `appendTo` — which is precisely the single
 * oversized frame the decoder answers with 1009.
 */
describe("chunked upload — no single frame scales with the file (G9a)", () => {
  /** A base64 string standing in for `mib` MiB of file content. Content is
   *  irrelevant here; only its LENGTH drives the chunking. */
  const base64OfSize = (mib: number) =>
    "A".repeat(Math.ceil(((mib * 1024 * 1024) / 3) * 4));

  it("splits a 26 MB drop across several bounded calls instead of one huge one", async () => {
    const scratchWrite = vi.fn((_args: WriteArgs) =>
      Effect.succeed({ path: "/scratch/t1/bugbug.mov" }),
    );
    const sendInput = vi.fn(() => Effect.void);

    await Effect.runPromise(
      deliverScratchPaste({
        ...base,
        name: "bugbug.mov",
        base64: base64OfSize(26),
        scratchWrite,
        isActive: () => true,
        sendInput,
      }),
    );

    // 26 MiB of content at 3 MiB per chunk — nine calls, not one.
    expect(scratchWrite.mock.calls.length).toBeGreaterThan(1);

    // THE invariant: every frame this upload put on the wire fits the cap.
    for (const [args] of scratchWrite.mock.calls) {
      expect(args.data.length).toBeLessThanOrEqual(UPLOAD_CHUNK_BASE64_CHARS);
      expect(args.data.length + 64 * 1024).toBeLessThan(RPC_MAX_FRAME_BYTES);
    }
  });

  it("creates on the first chunk and appends to the returned path on the rest", async () => {
    const scratchWrite = vi.fn((_args: WriteArgs) =>
      Effect.succeed({ path: "/scratch/t1/big.webm" }),
    );

    await Effect.runPromise(
      deliverScratchPaste({
        ...base,
        name: "big.webm",
        base64: base64OfSize(10),
        scratchWrite,
        isActive: () => true,
        sendInput: () => Effect.void,
      }),
    );

    const calls = scratchWrite.mock.calls.map(([a]) => a);
    // First chunk CREATES: no appendTo. Anything else would append to a file
    // that does not exist yet.
    expect(calls[0]?.appendTo).toBeUndefined();
    // Every later chunk appends to the path the server just handed back.
    for (const call of calls.slice(1)) {
      expect(call.appendTo).toBe("/scratch/t1/big.webm");
    }
  });

  it("sends chunks strictly in order — a concurrent write would interleave bytes", async () => {
    // The server appends to one growing file, so ordering is not a nicety: two
    // chunks in flight corrupt the upload silently. Prove each call is awaited
    // before the next is issued.
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: string[] = [];
    const scratchWrite = vi.fn((args: { data: string }) =>
      Effect.gen(function* () {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        yield* Effect.sleep("1 millis");
        inFlight -= 1;
        seen.push(args.data.slice(0, 1));
        return { path: "/scratch/t1/ordered.bin" };
      }),
    );

    // Distinguishable chunks: a block of "a", then "b", then "c".
    const chunk = (c: string) => c.repeat(UPLOAD_CHUNK_BASE64_CHARS);
    await Effect.runPromise(
      deliverScratchPaste({
        ...base,
        name: "ordered.bin",
        base64: chunk("a") + chunk("b") + chunk("c"),
        scratchWrite,
        isActive: () => true,
        sendInput: () => Effect.void,
      }),
    );

    expect(maxInFlight).toBe(1);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("still performs exactly one write for a small file", async () => {
    // The common case must not grow a round trip.
    const scratchWrite = vi.fn((_args: WriteArgs) =>
      Effect.succeed({ path: "/scratch/n.md" }),
    );
    await Effect.runPromise(
      deliverScratchPaste({
        ...base,
        name: "notes.md",
        base64: "aGVsbG8gZHJvcA==",
        scratchWrite,
        isActive: () => true,
        sendInput: () => Effect.void,
      }),
    );
    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(scratchWrite.mock.calls[0]?.[0].appendTo).toBeUndefined();
  });
});

/** G9c(iii) — the pre-send refusal. The transport must never be the thing that
 *  discovers a frame is too big. */
describe("pre-send frame refusal (G9b)", () => {
  it("passes a chunk-sized frame — the refusal must not fire on normal traffic", () => {
    expect(oversizedFrameRefusal("big.webm", UPLOAD_CHUNK_BASE64_CHARS)).toBe(
      null,
    );
  });

  it("refuses an over-cap frame with honest copy naming both sizes", () => {
    const refusal = oversizedFrameRefusal("bugbug.mov", RPC_MAX_FRAME_BYTES);
    expect(refusal).not.toBe(null);
    // Names what happened, the real limit, and that nothing was sent — no
    // "SocketCloseError: 1009" leaking a transport detail at the user.
    expect(refusal).toMatch(/Couldn't upload "bugbug\.mov"/);
    expect(refusal).toMatch(/16\.0 MB/);
    expect(refusal).toMatch(/Nothing was sent/);
    expect(refusal).toMatch(/report it/);
  });

  it("refuses BEFORE any byte is written, not partway through", async () => {
    // A refusal mid-upload would leave a truncated file on disk that the agent
    // could read as whole. Simulate the one thing that can defeat the
    // derivation — a chunk size someone bumped past the cap — and prove the
    // upload dies at the client with a toast instead of on the wire with a
    // 1009. `chunkChars` must be a multiple of 4 to reach the frame guard at
    // all; RPC_MAX_FRAME_BYTES is 16 MiB, so it already is.
    const scratchWrite = vi.fn(() => Effect.succeed({ path: "/scratch/x" }));
    await expect(
      Effect.runPromise(
        deliverScratchPaste({
          ...base,
          name: "huge.bin",
          base64: "A".repeat(RPC_MAX_FRAME_BYTES + 4),
          chunkChars: RPC_MAX_FRAME_BYTES,
          scratchWrite,
          isActive: () => true,
          sendInput: () => Effect.void,
        }),
      ),
    ).rejects.toThrow(/Couldn't upload/);
    expect(scratchWrite).not.toHaveBeenCalled();
  });
});

describe("the chunk size derivation holds against the wire cap", () => {
  it("keeps a full chunk's frame under RPC_MAX_FRAME_BYTES with margin", () => {
    // The derivation in `@kolu/padi/upload`, re-checked as arithmetic rather
    // than trusted as a comment: base64 expansion + envelope must clear the cap
    // with room. If someone raises UPLOAD_CHUNK_BYTES past its margin, this
    // fails here rather than as a closed socket in production.
    const frame = UPLOAD_CHUNK_BASE64_CHARS + 64 * 1024;
    expect(frame).toBeLessThan(RPC_MAX_FRAME_BYTES);
    expect(RPC_MAX_FRAME_BYTES / frame).toBeGreaterThan(2.5);
  });

  it("expands base64 by exactly 4/3, and lands on a 4-char boundary", () => {
    expect(UPLOAD_CHUNK_BASE64_CHARS).toBe((UPLOAD_CHUNK_BYTES / 3) * 4);
    expect(UPLOAD_CHUNK_BASE64_CHARS % 4).toBe(0);
  });
});
