import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { deliverScratchPaste } from "./pasteDelivery";

const base = {
  terminalId: "t1" as TerminalId,
  name: "image.png",
  base64: "AAAA",
  wrapPath: (p: string) => `<start>${p}<end>`,
};

describe("deliverScratchPaste", () => {
  it("writes then bracketed-pastes the path when the terminal is still active", async () => {
    const scratchWrite = vi.fn(async () => ({ path: "/scratch/image.png" }));
    const sendInput = vi.fn(async () => {});

    await deliverScratchPaste({
      ...base,
      scratchWrite,
      isActive: () => true,
      sendInput,
    });

    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(sendInput).toHaveBeenCalledWith({
      id: base.terminalId,
      data: "<start>/scratch/image.png<end>",
    });
  });

  it("throws (and never sends) when the terminal dies between the write and the send", async () => {
    // Proves Fix 2: sendInput quiet-drops on a non-active terminal, so without
    // this gate the write succeeds, sendInput silently no-ops, and the paste is
    // lost with NO error. The throw is what the caller's catch turns into a
    // toast.error.
    const scratchWrite = vi.fn(async () => ({ path: "/scratch/image.png" }));
    const sendInput = vi.fn(async () => {});

    await expect(
      deliverScratchPaste({
        ...base,
        scratchWrite,
        isActive: () => false, // terminal no longer active after the write
        sendInput,
      }),
    ).rejects.toThrow(/no longer active/);

    expect(scratchWrite).toHaveBeenCalledOnce();
    expect(sendInput).not.toHaveBeenCalled();
  });
});
