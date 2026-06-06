import { describe, expect, it } from "vitest";
import { z } from "zod";
import { surfaceAppSurface, surfaceAppSurfaceWith } from "./surface";

describe("surfaceAppSurface — a standalone surface", () => {
  it("carries the buildInfo cell + the identity.info probe under its own surface", () => {
    // It's a built Surface: spec + contract, not a mergeable fragment.
    expect(Object.keys(surfaceAppSurface.spec.cells ?? {})).toEqual([
      "buildInfo",
    ]);
    expect(surfaceAppSurface.spec.procedures?.identity?.info).toBeDefined();
    // The probe lives in the surface's OWN `identity` namespace, so a consumer
    // registering it under key `surfaceApp` gets `surface.surfaceApp.identity.info`.
    const inner = (
      surfaceAppSurface.contract as { surface: Record<string, unknown> }
    ).surface;
    expect(inner.identity).toBeDefined();
    expect(inner.buildInfo).toBeDefined();
  });

  it("exposes the buildInfo cell read-only (get, no set)", () => {
    expect(surfaceAppSurface.spec.cells?.buildInfo.verbs).toEqual(["get"]);
  });

  it("supports an extended buildInfo def via surfaceAppSurfaceWith", () => {
    const surface = surfaceAppSurfaceWith({
      cells: {
        buildInfo: {
          schema: z.object({ commit: z.string(), bootId: z.string() }),
          default: { commit: "", bootId: "" },
          verbs: ["get"] as const,
        },
      },
      isStale: () => false,
    });
    expect(surface.spec.cells?.buildInfo.default).toEqual({
      commit: "",
      bootId: "",
    });
    expect(surface.spec.procedures?.identity?.info).toBeDefined();
  });
});
