import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachPastedFiles, reattachComposerFiles } from "./attachFiles";
import { clearComposerAttachments, composerAttachments } from "./drafts";

const upload = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./attachmentUpload", () => ({
  sendAttachment: (read: { readonly id: string; readonly bytes: number }) =>
    upload.send(read),
}));

const sonner = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("solid-sonner", () => ({ toast: { error: sonner.error } }));

function clipboard(
  entries: ReadonlyArray<{ kind: string; type: string; file: File | null }>,
): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: entry.kind,
      type: entry.type,
      getAsFile: () => entry.file,
    })),
  } as unknown as DataTransfer;
}

const screenshot = (): File =>
  new File([new Uint8Array(11)], "image.png", { type: "image/png" });

beforeEach(() => {
  clearComposerAttachments();
  sonner.error.mockClear();
  upload.send.mockReset();
  upload.send.mockImplementation((read: { id: string; bytes: number }) =>
    Effect.succeed({
      path: `/state/conductor/attachments/${read.id}`,
      bytes: read.bytes,
    }),
  );
});

describe("attachPastedFiles — the clipboard reaching the draft", () => {
  it("turns a pasted image into a chip the prompt can name", async () => {
    expect(
      attachPastedFiles(
        clipboard([{ kind: "file", type: "image/png", file: screenshot() }]),
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      const [chip] = composerAttachments();
      expect(chip).toBeDefined();
      expect(chip?.name).toMatch(/^pasted-\d{6}\.png$/);
      expect(chip?.mimeType).toBe("image/png");
      expect(chip?.bytes).toBe(11);
      expect(chip?.path).toBe(`/state/conductor/attachments/${chip?.id ?? ""}`);
    });
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it("leaves a paste of plain text to the textarea", async () => {
    expect(
      attachPastedFiles(
        clipboard([{ kind: "string", type: "text/plain", file: null }]),
      ),
    ).toBe(false);
    await Promise.resolve();
    expect(composerAttachments()).toHaveLength(0);
    expect(upload.send).not.toHaveBeenCalled();
  });

  it("shows the chip while the bytes are still going up", async () => {
    upload.send.mockImplementation(() => Effect.never);
    attachPastedFiles(
      clipboard([{ kind: "file", type: "image/png", file: screenshot() }]),
    );

    await vi.waitFor(() => {
      expect(composerAttachments()).toHaveLength(1);
    });
    expect(composerAttachments()[0]?.path).toBeNull();
  });

  it("takes the chip away when the upload is refused, and says why", async () => {
    upload.send.mockImplementation(() =>
      Effect.fail(new Error("that file is larger than one attachment may be")),
    );
    attachPastedFiles(
      clipboard([{ kind: "file", type: "image/png", file: screenshot() }]),
    );

    await vi.waitFor(() => {
      expect(sonner.error).toHaveBeenCalledWith(
        expect.stringContaining("larger than one attachment may be"),
      );
    });
    expect(composerAttachments()).toHaveLength(0);
  });

  it("puts the bytes back under the same id after a refused prompt", async () => {
    attachPastedFiles(
      clipboard([{ kind: "file", type: "image/png", file: screenshot() }]),
    );
    await vi.waitFor(() => {
      expect(composerAttachments()[0]?.path).not.toBeNull();
    });
    const id = composerAttachments()[0]?.id ?? "";

    reattachComposerFiles();

    await vi.waitFor(() => {
      expect(upload.send).toHaveBeenCalledTimes(2);
    });
    expect(upload.send.mock.calls[1]?.[0]).toMatchObject({ id });
    await vi.waitFor(() => {
      expect(composerAttachments()[0]?.path).toBe(
        `/state/conductor/attachments/${id}`,
      );
    });
  });
});
