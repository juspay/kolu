/** THE PASTE→CHIP SEAM: what a person sees between pressing ⌘V and having
 *  something to send.
 *
 *  The upload is mocked, deliberately — the wire is `attachmentUpload.ts`'s
 *  subject, and what is under test here is everything on either side of it:
 *  that a clipboard carrying a file becomes a chip with that file's name, kind
 *  and size; that a clipboard carrying only words is left to the textarea; that
 *  a chip says it is still going up until kolu-server answers; and that an upload
 *  which fails takes its chip away rather than leaving one with no file behind
 *  it. */

import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachPastedFiles, reattachComposerFiles } from "./attachFiles";
import { clearComposerAttachments, composerAttachments } from "./drafts";

// `vi.mock` is hoisted above these imports, so the upload and the toast are
// already stubbed by the time `attachFiles` loads — which also keeps `../wire`
// (a live socket at module scope) out of this test entirely.
const upload = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./attachmentUpload", () => ({
  sendAttachment: (read: { readonly id: string; readonly bytes: number }) =>
    upload.send(read),
}));

const sonner = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("solid-sonner", () => ({ toast: { error: sonner.error } }));

/** A clipboard, as `attachPastedFiles` reads one: the two fields the rule turns
 *  on plus `getAsFile`. A real `DataTransfer` cannot be built with a file in it
 *  outside a browser, and the seam does not need one. */
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
      path: `/state/orchestrator/attachments/${read.id}`,
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
      // Renamed on the way in: every pasted screenshot arrives as `image.png`,
      // and three chips with one name are three chips nobody can tell apart.
      expect(chip?.name).toMatch(/^pasted-\d{6}\.png$/);
      expect(chip?.mimeType).toBe("image/png");
      expect(chip?.bytes).toBe(11);
      // A path means kolu-server is holding the bytes — the whole of what the prompt
      // will carry.
      expect(chip?.path).toBe(
        `/state/orchestrator/attachments/${chip?.id ?? ""}`,
      );
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
    // An upload that never answers: the chip must exist anyway, marked, or a
    // person pastes again and sends two copies of one screenshot.
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
    // No chip survives a file kolu-server never wrote: one that looked ready would
    // put a path-less attachment on the next prompt.
    expect(composerAttachments()).toHaveLength(0);
  });

  it("puts the bytes back under the same id after a refused prompt", async () => {
    // kolu-server deletes what a refused prompt named, so the chips that survive a
    // refusal have to be re-uploaded or the next Send is refused for a file
    // the person cannot see is gone.
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
    // The SAME id — kolu-server's create truncates, so the chip keeps pointing at the
    // file it already names.
    expect(upload.send.mock.calls[1]?.[0]).toMatchObject({ id });
    await vi.waitFor(() => {
      expect(composerAttachments()[0]?.path).toBe(
        `/state/orchestrator/attachments/${id}`,
      );
    });
  });
});
