import { BYTES_PER_MB as MB } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { processMemoryMbEqual } from "./surface.ts";

describe("processMemoryMbEqual", () => {
  it("treats sub-MB wobble as equal (so the cell doesn't re-publish)", () => {
    expect(
      processMemoryMbEqual(
        {
          serverRssBytes: 100 * MB,
          kavalMemory: { status: "ok", rssBytes: 30 * MB },
        },
        {
          serverRssBytes: 100 * MB + 1024,
          kavalMemory: { status: "ok", rssBytes: 30 * MB - 512 },
        },
      ),
    ).toBe(true);
  });

  it("treats a whole-MB move as a change", () => {
    expect(
      processMemoryMbEqual(
        {
          serverRssBytes: 100 * MB,
          kavalMemory: { status: "ok", rssBytes: 30 * MB },
        },
        {
          serverRssBytes: 101 * MB,
          kavalMemory: { status: "ok", rssBytes: 30 * MB },
        },
      ),
    ).toBe(false);
  });

  it("distinguishes each kaval state — absent, error, and ok never dedup together", () => {
    const server = { serverRssBytes: 100 * MB };
    // absent vs ok@0 — the no-daemon state must compare distinctly from a real value.
    expect(
      processMemoryMbEqual(
        { ...server, kavalMemory: { status: "absent" } },
        { ...server, kavalMemory: { status: "ok", rssBytes: 0 } },
      ),
    ).toBe(false);
    // error vs absent — a failed poll must never fold into "no daemon".
    expect(
      processMemoryMbEqual(
        { ...server, kavalMemory: { status: "error" } },
        { ...server, kavalMemory: { status: "absent" } },
      ),
    ).toBe(false);
    // Same state on both sides dedups.
    expect(
      processMemoryMbEqual(
        { ...server, kavalMemory: { status: "absent" } },
        { ...server, kavalMemory: { status: "absent" } },
      ),
    ).toBe(true);
    expect(
      processMemoryMbEqual(
        { ...server, kavalMemory: { status: "error" } },
        { ...server, kavalMemory: { status: "error" } },
      ),
    ).toBe(true);
  });
});
