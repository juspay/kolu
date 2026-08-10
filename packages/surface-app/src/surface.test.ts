/**
 * `surfaceAppSurface` — the standalone surface (the buildInfo cell, and nothing
 * else).
 *
 * The contract assertions ride the tag axis: a surface carries a flat `RpcGroup`
 * now (PLAN D1), so what a surface serves is a statement about the tags the group
 * minted. The `identity.info` probe that used to sit beside the cell is gone —
 * `@kolu/surface`'s reserved `system/identity` carries the process id, so the
 * duplicate member (and its byte fixtures, which now live with the reserved
 * schema in `@kolu/surface`'s `identity` suite) came out with it.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { surfaceAppSurface, surfaceAppSurfaceWith } from "./surface";

describe("surfaceAppSurface — a standalone surface", () => {
  it("carries the buildInfo cell and NO identity member of its own", () => {
    // It's a built Surface: spec + group, not a mergeable fragment.
    expect(Object.keys(surfaceAppSurface.spec.cells ?? {})).toEqual([
      "buildInfo",
    ]);
    // The restart axis rides the RESERVED `surface/system/identity` every surface
    // carries — there is no `surface/identity/info` beside it to disagree with.
    const tags = [...surfaceAppSurface.group.requests.keys()].sort();
    expect(tags).toEqual([
      "surface/buildInfo/get",
      "surface/system/clockNow",
      "surface/system/identity",
      "surface/system/live",
    ]);
  });

  it("exposes the buildInfo cell read-only (get, no set)", () => {
    expect(surfaceAppSurface.spec.cells?.buildInfo.verbs).toEqual(["get"]);
    // Route-set identity, not just the declaration: no `set` tag was minted.
    expect(surfaceAppSurface.group.requests.has("surface/buildInfo/set")).toBe(
      false,
    );
  });

  it("supports an extended buildInfo def via surfaceAppSurfaceWith", () => {
    const surface = surfaceAppSurfaceWith({
      cells: {
        buildInfo: {
          schema: Schema.Struct({
            commit: Schema.String,
            bootId: Schema.String,
          }),
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
    expect(surface.group.requests.has("surface/system/identity")).toBe(true);
  });
});
