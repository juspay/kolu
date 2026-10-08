import type { ProcessMemory } from "kolu-common/surface";
import { MIB } from "@kolu/byte-units";
import { processMemoryMiBEqual, surfaces } from "kolu-common/surface";
import { describe, expect, it } from "vitest";

/** A readout with all three processes `ok`; override per test. */
function mem(over: Partial<ProcessMemory> = {}): ProcessMemory {
  return {
    serverRssBytes: 100 * MIB,
    padi: { status: "ok", rssBytes: 20 * MIB },
    kaval: { status: "ok", rssBytes: 30 * MIB },
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
    // dialogs list — presentation/diagnostic data, NOT a terminal member), and
    // `forwards` (PRT2's open port forwards — listeners in the kolu-server
    // PROCESS, so a fact about this server rather than about any host's
    // terminals, even when the far end of one is a remote host's port), and
    // `viewerMode` (the browser's raw OS light/dark reading — an observation
    // about the VIEWER, and the second input to the new-terminal policy
    // kolu-server derives; a terminal never appears in it), and
    // `agentDistroListing` (the agent-distro profiles THIS kolu's build ships,
    // read once from the floor's profile pickers — a build fact, not a host's).
    // No collections, no events.
    expect(Object.keys(spec.cells ?? {}).sort()).toEqual([
      "agentDistroListing",
      "daemonInventory",
      "forwards",
      "padiLink",
      "preferences",
      "processMemory",
      "processStartedAt",
      "viewerMode",
    ]);
    expect(spec.cells?.session).toBeUndefined();
    expect(spec.cells?.activityFeed).toBeUndefined();
    expect(spec.cells?.terminalList).toBeUndefined();
    expect(spec.collections).toBeUndefined();
    expect(spec.events).toBeUndefined();
  });

  it("koluSurface's only procedures are the two that move the forward map", () => {
    // koluSurface had NO procedures before PRT2 — every mutation the client made
    // rode padi's per-host surface. These two are here rather than there because
    // they act on kolu-SERVER's own machine: the listener a forward opens is a
    // socket in this process, and no host is asked for permission to open it.
    const spec = surfaces.kolu.spec as {
      procedures?: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(spec.procedures ?? {})).toEqual(["forwards"]);
    expect(Object.keys(spec.procedures?.forwards ?? {}).sort()).toEqual([
      "cancel",
      "create",
    ]);
  });
});

describe("processMemoryMiBEqual", () => {
  // The cell carries all three server-side processes (kolu-server + padi + kaval);
  // it dedups at whole-MiB granularity across every one so a sub-MiB wobble on any
  // process never re-publishes to every connected client.
  it("treats sub-MiB wobble as equal (so the cell doesn't re-publish)", () => {
    expect(
      processMemoryMiBEqual(
        mem(),
        mem({
          serverRssBytes: 100 * MIB + 1024,
          padi: { status: "ok", rssBytes: 20 * MIB + 1024 },
        }),
      ),
    ).toBe(true);
  });

  it("treats a whole-MiB move on any process as a change", () => {
    expect(
      processMemoryMiBEqual(mem(), mem({ serverRssBytes: 101 * MIB })),
    ).toBe(false);
    expect(
      processMemoryMiBEqual(
        mem(),
        mem({ padi: { status: "ok", rssBytes: 21 * MIB } }),
      ),
    ).toBe(false);
    expect(
      processMemoryMiBEqual(
        mem(),
        mem({ kaval: { status: "ok", rssBytes: 31 * MIB } }),
      ),
    ).toBe(false);
  });

  it("treats a status flip (ok → absent / error) as a change", () => {
    expect(
      processMemoryMiBEqual(mem(), mem({ kaval: { status: "absent" } })),
    ).toBe(false);
    expect(
      processMemoryMiBEqual(
        mem({ kaval: { status: "absent" } }),
        mem({ kaval: { status: "error" } }),
      ),
    ).toBe(false);
    // Two absent (or two error) readings carry no number — equal.
    expect(
      processMemoryMiBEqual(
        mem({ kaval: { status: "absent" } }),
        mem({ kaval: { status: "absent" } }),
      ),
    ).toBe(true);
  });
});
