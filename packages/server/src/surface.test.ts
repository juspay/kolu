import { BYTES_PER_MB as MB, surfaces } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { processMemoryMbEqual } from "./surface.ts";

describe("surfaces map — two siblings (the W1 padi seam)", () => {
  it("serves exactly the kolu / surfaceApp siblings — terminalWorkspace retired", () => {
    // The dormant `terminalWorkspace` sibling was retired: the client reads padi's
    // `terminals` collection, and pulam-tui dials the pulam daemon directly, so
    // kolu-server's copy had zero consumers. kolu-server adds `padi` locally.
    expect(Object.keys(surfaces).sort()).toEqual(["kolu", "surfaceApp"]);
    expect(Object.keys(surfaces)).not.toContain("terminalWorkspace");
  });

  it("koluSurface serves ONLY preferences + processMemory — no terminal-derived member", () => {
    const spec = surfaces.kolu.spec as {
      cells?: Record<string, unknown>;
      collections?: Record<string, unknown>;
      events?: Record<string, unknown>;
    };
    // Every terminal-derived wire member — `session`, `activityFeed`, `terminalList`,
    // and the `terminalExit` event — relocated onto `padiSurface` (the W1 padi
    // seam). koluSurface keeps only its two non-terminal cells, no collections, no
    // events.
    expect(Object.keys(spec.cells ?? {}).sort()).toEqual([
      "preferences",
      "processMemory",
    ]);
    expect(spec.cells?.session).toBeUndefined();
    expect(spec.cells?.activityFeed).toBeUndefined();
    expect(spec.cells?.terminalList).toBeUndefined();
    expect(spec.collections).toBeUndefined();
    expect(spec.events).toBeUndefined();
  });
});

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
