/** The two decisions a person can trip over on the way to sending a file: what
 *  a paste actually contained, and whether one more attachment fits. */

import { MIB } from "@kolu/byte-units";
import {
  ATTACHMENT_BYTE_CAP,
  PROMPT_ATTACHMENT_BYTE_CAP,
} from "kolu-common/orchestrator";
import { describe, expect, it } from "vitest";
import {
  attachmentRefusal,
  pastedAttachmentName,
  pastedAttachments,
} from "./attachments";
import { forgetThumbnail, rememberThumbnail, thumbnailOf } from "./thumbnails";

describe("pastedAttachments — what a paste carried", () => {
  it("takes the files and leaves the strings", () => {
    expect(
      pastedAttachments([
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png" },
      ]),
    ).toEqual([{ kind: "file", type: "image/png" }]);
  });

  it("takes a non-image file too — an attachment is not only a screenshot", () => {
    expect(
      pastedAttachments([{ kind: "file", type: "application/pdf" }]),
    ).toHaveLength(1);
  });

  it("takes nothing from a plain text paste, so the box keeps it", () => {
    expect(
      pastedAttachments([
        { kind: "string", type: "text/plain" },
        { kind: "string", type: "text/html" },
      ]),
    ).toEqual([]);
  });
});

describe("attachmentRefusal — the caps, in the wire contract's own words", () => {
  it("admits a file at exactly the per-attachment cap", () => {
    expect(
      attachmentRefusal({ name: "shot.png", bytes: ATTACHMENT_BYTE_CAP }, 0),
    ).toBeNull();
  });

  it("refuses one byte past it, naming both the file and the limit", () => {
    const why = attachmentRefusal(
      { name: "shot.png", bytes: ATTACHMENT_BYTE_CAP + 1 },
      0,
    );
    expect(why).toMatch(/shot\.png/);
    expect(why).toMatch(/10 MiB/);
  });

  it("admits a batch that lands exactly on the per-message cap", () => {
    expect(
      attachmentRefusal(
        { name: "third.png", bytes: 4 * MIB },
        PROMPT_ATTACHMENT_BYTE_CAP - 4 * MIB,
      ),
    ).toBeNull();
  });

  it("refuses the one that would take the message past it", () => {
    const why = attachmentRefusal(
      { name: "third.png", bytes: 8 * MIB },
      15 * MIB,
    );
    // The sentence is the one kolu-server refuses with, so it reports the TOTAL
    // rather than the file — the move it asks for is to drop an attachment,
    // not to shrink this one.
    expect(why).toMatch(/23 MiB/);
    expect(why).toMatch(/20 MiB/);
  });

  it("judges each file against what is ALREADY attached, not against itself", () => {
    // Three 7 MiB files: each passes the per-attachment cap on its own, and
    // the third is the one the per-message cap stops.
    const seven = { name: "a.png", bytes: 7 * MIB };
    expect(attachmentRefusal(seven, 0)).toBeNull();
    expect(attachmentRefusal(seven, 7 * MIB)).toBeNull();
    expect(attachmentRefusal(seven, 14 * MIB)).not.toBeNull();
  });
});

describe("pastedAttachmentName — telling three screenshots apart", () => {
  it("stamps the time and keeps the kind", () => {
    const at = new Date(2026, 10, 11, 9, 5, 3);
    expect(pastedAttachmentName("image/png", at)).toBe("pasted-090503.png");
  });

  it("drops a structured suffix", () => {
    const at = new Date(2026, 10, 11, 23, 59, 59);
    expect(pastedAttachmentName("image/svg+xml", at)).toBe("pasted-235959.svg");
  });

  it("names unknown bytes rather than nothing", () => {
    expect(pastedAttachmentName("", new Date(2026, 10, 11, 0, 0, 0))).toBe(
      "pasted-000000.bin",
    );
  });
});

describe("thumbnailOf — what a chip can actually draw", () => {
  it("draws the image this browser read itself", () => {
    rememberThumbnail(
      { id: "att-1", mimeType: "image/png" },
      "data:image/png;base64,x",
    );
    expect(thumbnailOf({ id: "att-1" })).toBe("data:image/png;base64,x");
  });

  it("draws nothing for a row this browser never minted — the restored case", () => {
    expect(thumbnailOf({ id: "att-from-another-tab" })).toBeUndefined();
  });

  it("holds nothing for a file that was never an image", () => {
    rememberThumbnail(
      { id: "att-pdf", mimeType: "application/pdf" },
      "data:application/pdf;base64,x",
    );
    expect(thumbnailOf({ id: "att-pdf" })).toBeUndefined();
  });

  it("lets go when the chip never became a row", () => {
    rememberThumbnail(
      { id: "att-dropped", mimeType: "image/png" },
      "data:image/png;base64,x",
    );
    forgetThumbnail("att-dropped");
    expect(thumbnailOf({ id: "att-dropped" })).toBeUndefined();
  });
});
