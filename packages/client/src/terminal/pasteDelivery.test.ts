import {
  base64CharsFor,
  FRAME_CHUNK_BASE64_CHARS,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
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
    const scratchWrite = vi.fn(() =>
      Effect.succeed({ path: "/scratch/image.png" }),
    );
    const sendInput = vi.fn(() => Effect.void);

    await expect(
      Effect.runPromise(
        deliverScratchPaste({
          ...base,
          scratchWrite,
          isActive: () => false,
          sendInput,
        }),
      ),
    ).rejects.toThrow(/no longer active/);

    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(sendInput).not.toHaveBeenCalled();
  });
});

type WriteArgs = {
  terminalId: TerminalId;
  name: string;
  data: string;
  appendTo?: string;
};

describe("chunked upload — no single frame scales with the file (G9a)", () => {
  const base64OfSize = (mib: number) =>
    "A".repeat(base64CharsFor(mib * 1024 * 1024));

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

    expect(scratchWrite.mock.calls.length).toBeGreaterThan(1);

    for (const [args] of scratchWrite.mock.calls) {
      expect(args.data.length).toBeLessThanOrEqual(FRAME_CHUNK_BASE64_CHARS);
      expect(frameBytesFor(args.data.length)).toBeLessThan(RPC_MAX_FRAME_BYTES);
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
    expect(calls[0]?.appendTo).toBeUndefined();
    for (const call of calls.slice(1)) {
      expect(call.appendTo).toBe("/scratch/t1/big.webm");
    }
  });

  it("sends chunks strictly in order — a concurrent write would interleave bytes", async () => {
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

    const chunk = (c: string) => c.repeat(FRAME_CHUNK_BASE64_CHARS);
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

describe("pre-send frame refusal (G9b)", () => {
  it("passes a chunk-sized frame — the refusal must not fire on normal traffic", () => {
    expect(oversizedFrameRefusal("big.webm", FRAME_CHUNK_BASE64_CHARS)).toBe(
      null,
    );
  });

  it("refuses an over-cap frame with honest copy naming both sizes", () => {
    const refusal = oversizedFrameRefusal("bugbug.mov", RPC_MAX_FRAME_BYTES);
    expect(refusal).not.toBe(null);
    expect(refusal).toMatch(/Couldn't upload "bugbug\.mov"/);
    expect(refusal).toMatch(/16\.0 MiB/);
    expect(refusal).toMatch(/Nothing was sent/);
    expect(refusal).toMatch(/report it/);
  });
});
