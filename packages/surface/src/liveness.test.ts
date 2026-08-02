/**
 * The framework-reserved liveness probe (`./liveness`): every surface built by
 * `defineSurface` carries `surface.system.live`, auto-answered by
 * `implementSurface`, so a client-side liveness watchdog has a contract-agnostic
 * round-trip with zero app wiring. These pins:
 *   1. every surface answers `system.live` (end-to-end through the served handler);
 *   2. `probeSurfaceLive` resolves against it;
 *   3. it MERGES into an app-owned `system` namespace (kaval-style) rather than
 *      colliding with it;
 *   4. an app that tries to claim `system.live` itself gets a loud boot-time
 *      collision (reserved verbs can't be silently clobbered).
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { callUnary } from "./handlerDispatch.testlib";
import { probeSurfaceLive } from "./liveness";
import {
  implementSurface,
  inMemoryStore,
  type SurfaceHandlers,
} from "./server";

// A surface that ALSO declares its own `system.*` verb (mirrors kaval's
// `system.heartbeat`), to prove the reserved `system.live` merges into an
// app-owned `system` namespace rather than displacing it.
function buildSurface() {
  return defineSurface({
    cells: {
      state: {
        schema: Schema.Struct({ value: Schema.Number }),
        default: { value: 0 },
      },
    },
    procedures: {
      system: {
        echo: {
          input: Schema.Struct({ n: Schema.Number }),
          output: Schema.Struct({ n: Schema.Number }),
        },
      },
    },
  });
}

function serve(surface: ReturnType<typeof buildSurface>): SurfaceHandlers {
  return implementSurface(surface, {
    cells: { state: { store: inMemoryStore({ value: 0 }) } },
    procedures: {
      system: {
        echo: ({ input }) => Effect.succeed({ n: input.n }),
      },
    },
  }).handlers;
}

/** The MINIMAL nested face `probeSurfaceLive` walks structurally
 *  (`client.surface.system.live(input)`), built straight over the served
 *  handlers. Stage 3 owns the real client face; this is only enough of its shape
 *  to prove the SERVED half answers the probe. */
function probeFace(handlers: SurfaceHandlers) {
  return {
    surface: {
      system: {
        live: (input: unknown) =>
          callUnary(handlers, "surface/system/live", input),
      },
    },
  };
}

describe("framework-reserved system.live liveness probe", () => {
  it("every surface answers surface/system/live with {}", async () => {
    const handlers = serve(buildSurface());
    await expect(
      callUnary(handlers, "surface/system/live", {}),
    ).resolves.toEqual({});
  });

  it("probeSurfaceLive resolves against the served surface", async () => {
    const handlers = serve(buildSurface());
    await expect(
      probeSurfaceLive(probeFace(handlers) as never),
    ).resolves.toEqual({});
  });

  it("coexists with an app's own system.* verb (merge, not collision)", async () => {
    const handlers = serve(buildSurface());
    // Both live under the same reserved namespace, at distinct tags.
    expect(Object.keys(handlers)).toContain("surface/system/echo");
    expect(Object.keys(handlers)).toContain("surface/system/live");
    // The app verb still works...
    await expect(
      callUnary(handlers, "surface/system/echo", { n: 7 }),
    ).resolves.toEqual({ n: 7 });
    // ...AND the reserved verb is answered alongside it.
    await expect(
      callUnary(handlers, "surface/system/live", {}),
    ).resolves.toEqual({});
  });

  it("rejects an app that tries to claim the reserved `system.live` verb", () => {
    expect(() =>
      defineSurface({
        procedures: {
          system: {
            live: { input: Schema.Struct({}), output: Schema.Struct({}) },
          },
        },
      }),
    ).toThrow(/duplicate verb "live"/);
  });
});
