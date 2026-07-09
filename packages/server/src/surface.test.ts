import type { ProcessMemory } from "kolu-common/surface";
import { BYTES_PER_MB as MB, surfaces } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { processMemoryMbEqual } from "./surface.ts";

/** A readout with all three processes `ok`; override per test. */
function mem(over: Partial<ProcessMemory> = {}): ProcessMemory {
  return {
    serverRssBytes: 100 * MB,
    padi: { status: "ok", rssBytes: 20 * MB },
    kaval: { status: "ok", rssBytes: 30 * MB },
    ...over,
  };
}

describe("surfaces map — two siblings (the W1 padi seam)", () => {
  it("serves exactly the kolu / surfaceApp siblings — terminalWorkspace retired", () => {
    // The dormant `terminalWorkspace` sibling was retired: the client reads padi's
    // `terminals` collection, and pulam-tui dials the pulam daemon directly, so
    // kolu-server's copy had zero consumers. kolu-server adds `padi` locally.
    expect(Object.keys(surfaces).sort()).toEqual(["kolu", "surfaceApp"]);
    expect(Object.keys(surfaces)).not.toContain("terminalWorkspace");
  });

  it("koluSurface serves only kolu-server's OWN non-terminal cells — no terminal-derived member", () => {
    const spec = surfaces.kolu.spec as {
      cells?: Record<string, unknown>;
      collections?: Record<string, unknown>;
      events?: Record<string, unknown>;
    };
    // Every terminal-derived wire member — `session`, `activityFeed`, `terminalList`,
    // and the `terminalExit` event — relocated onto `padiSurface` (the W1 padi
    // seam). koluSurface keeps only kolu-server's OWN cells: `preferences`,
    // `processMemory`, `padiLink` (kolu-server's live view of its binding to padi
    // — a #1034 honesty leg, server-authored, NOT a terminal member),
    // `processStartedAt` (the server + padi boot times the rail renders as uptime),
    // `daemonInventory` (the read-only host-daemon enumeration the Kaval/Padi
    // dialogs list — presentation/diagnostic data, NOT a terminal member).
    // No collections, no events.
    expect(Object.keys(spec.cells ?? {}).sort()).toEqual([
      "daemonInventory",
      "padiLink",
      "preferences",
      "processMemory",
      "processStartedAt",
    ]);
    expect(spec.cells?.session).toBeUndefined();
    expect(spec.cells?.activityFeed).toBeUndefined();
    expect(spec.cells?.terminalList).toBeUndefined();
    expect(spec.collections).toBeUndefined();
    expect(spec.events).toBeUndefined();
  });
});

describe("processMemoryMbEqual", () => {
  // The cell carries all three server-side processes (kolu-server + padi + kaval);
  // it dedups at whole-MB granularity across every one so a sub-MB wobble on any
  // process never re-publishes to every connected client.
  it("treats sub-MB wobble as equal (so the cell doesn't re-publish)", () => {
    expect(
      processMemoryMbEqual(
        mem(),
        mem({
          serverRssBytes: 100 * MB + 1024,
          padi: { status: "ok", rssBytes: 20 * MB + 1024 },
        }),
      ),
    ).toBe(true);
  });

  it("treats a whole-MB move on any process as a change", () => {
    expect(processMemoryMbEqual(mem(), mem({ serverRssBytes: 101 * MB }))).toBe(
      false,
    );
    expect(
      processMemoryMbEqual(
        mem(),
        mem({ padi: { status: "ok", rssBytes: 21 * MB } }),
      ),
    ).toBe(false);
    expect(
      processMemoryMbEqual(
        mem(),
        mem({ kaval: { status: "ok", rssBytes: 31 * MB } }),
      ),
    ).toBe(false);
  });

  it("treats a status flip (ok → absent / error) as a change", () => {
    expect(
      processMemoryMbEqual(mem(), mem({ kaval: { status: "absent" } })),
    ).toBe(false);
    expect(
      processMemoryMbEqual(
        mem({ kaval: { status: "absent" } }),
        mem({ kaval: { status: "error" } }),
      ),
    ).toBe(false);
    // Two absent (or two error) readings carry no number — equal.
    expect(
      processMemoryMbEqual(
        mem({ kaval: { status: "absent" } }),
        mem({ kaval: { status: "absent" } }),
      ),
    ).toBe(true);
  });
});
