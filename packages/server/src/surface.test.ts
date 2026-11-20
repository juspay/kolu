import type { ProcessMemory } from "kolu-common/surface";
import { MIB } from "@kolu/byte-units";
import { processMemoryMiBEqual, surfaces } from "kolu-common/surface";
import { describe, expect, it } from "vitest";

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
    expect(Object.keys(surfaces).sort()).toEqual(["kolu", "surfaceApp"]);
    expect(Object.keys(surfaces)).not.toContain("terminalWorkspace");
  });

  it("koluSurface serves only kolu-server's OWN non-terminal cells — no terminal-derived member", () => {
    const spec = surfaces.kolu.spec as {
      cells?: Record<string, unknown>;
      collections?: Record<string, unknown>;
      events?: Record<string, unknown>;
    };
    expect(Object.keys(spec.cells ?? {}).sort()).toEqual([
      "agentDistroListing",
      "agentProfiles",
      "conductor",
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
    expect(Object.keys(spec.collections ?? {}).sort()).toEqual([
      "memberReadings",
      "workMembers",
      "works",
    ]);
    expect(spec.events).toBeUndefined();
    const streams = (
      surfaces.kolu.spec as { streams?: Record<string, unknown> }
    ).streams;
    expect(Object.keys(streams ?? {})).toEqual(["conductorTranscript"]);
  });

  it("koluSurface's only procedures move the forward map and deliver agents", () => {
    const spec = surfaces.kolu.spec as {
      procedures?: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(spec.procedures ?? {})).toEqual([
      "forwards",
      "agentDistro",
      "conductor",
    ]);
    expect(Object.keys(spec.procedures?.forwards ?? {}).sort()).toEqual([
      "cancel",
      "create",
    ]);
    expect(Object.keys(spec.procedures?.agentDistro ?? {})).toEqual([
      "deliver",
    ]);
    expect(Object.keys(spec.procedures?.conductor ?? {})).toEqual([
      "prompt",
      "attach",
      "cancel",
      "answer",
      "answerWork",
      "signIn",
      "signInInput",
      "signInCancel",
      "askSignIn",
      "reloadAgent",
      "setOption",
      "newSession",
      "clearSession",
      "takeOver",
      "handBack",
      "stopWork",
      "reopenWork",
      "recoverStore",
    ]);
  });
});

describe("processMemoryMiBEqual", () => {
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
    expect(
      processMemoryMiBEqual(
        mem({ kaval: { status: "absent" } }),
        mem({ kaval: { status: "absent" } }),
      ),
    ).toBe(true);
  });
});
