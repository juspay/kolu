import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  composeSurfaces,
  serverIdentity,
  surfaceAppSurface,
  surfaceAppSurfaceWith,
} from "./surface";

describe("composeSurfaces", () => {
  it("merges cells and procedures from both fragments", () => {
    const appSpec = {
      cells: {
        serverStats: {
          schema: z.object({ now: z.number() }),
          default: { now: 0 },
        },
      },
      procedures: {
        notes: { create: { input: z.object({}), output: z.void() } },
      },
    };
    const merged = composeSurfaces(surfaceAppSurface, appSpec);

    // surface-app's buildInfo cell + the app's serverStats cell coexist.
    expect(Object.keys(merged.cells).sort()).toEqual([
      "buildInfo",
      "serverStats",
    ]);
    // surface-app's `surfaceApp` namespace + the app's `notes` namespace coexist.
    expect(Object.keys(merged.procedures).sort()).toEqual([
      "notes",
      "surfaceApp",
    ]);
    expect(merged.procedures.surfaceApp.info).toBe(
      serverIdentity.procedures.surfaceApp.info,
    );
    expect(merged.procedures.notes.create).toBe(
      appSpec.procedures.notes.create,
    );
  });

  it("supports an extended buildInfo def via surfaceAppSurfaceWith", () => {
    const def = surfaceAppSurfaceWith({
      cells: {
        buildInfo: {
          schema: z.object({ commit: z.string(), bootId: z.string() }),
          default: { commit: "", bootId: "" },
          verbs: ["get"] as const,
        },
      },
      isStale: () => false,
    });
    const merged = composeSurfaces(def, { cells: {}, procedures: {} });
    expect(merged.cells.buildInfo.default).toEqual({ commit: "", bootId: "" });
    expect(merged.procedures.surfaceApp.info).toBeDefined();
  });

  it("throws on a duplicate top-level cell key", () => {
    expect(() =>
      composeSurfaces(surfaceAppSurface, {
        cells: {
          buildInfo: {
            schema: z.object({ commit: z.string() }),
            default: { commit: "" },
          },
        },
      }),
    ).toThrow(/duplicate cells key "buildInfo"/);
  });

  it("throws on a duplicate procedure verb within a shared namespace", () => {
    expect(() =>
      composeSurfaces(surfaceAppSurface, {
        procedures: {
          surfaceApp: { info: { input: z.object({}), output: z.void() } },
        },
      }),
    ).toThrow(/duplicate procedure verb "surfaceApp.info"/);
  });
});
