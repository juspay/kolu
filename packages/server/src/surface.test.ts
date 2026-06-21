import { BYTES_PER_MB as MB } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { processMemoryMbEqual } from "./surface.ts";

describe("processMemoryMbEqual", () => {
  it("treats sub-MB wobble as equal (so the cell doesn't re-publish)", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: 30 * MB },
        { serverRssBytes: 100 * MB + 1024, kavalRssBytes: 30 * MB - 512 },
      ),
    ).toBe(true);
  });

  it("treats a whole-MB move as a change", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: 30 * MB },
        { serverRssBytes: 101 * MB, kavalRssBytes: 30 * MB },
      ),
    ).toBe(false);
  });

  it("distinguishes a null kaval reading from any real value", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
        { serverRssBytes: 100 * MB, kavalRssBytes: 0 },
      ),
    ).toBe(false);
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
      ),
    ).toBe(true);
  });
});
