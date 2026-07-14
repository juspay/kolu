/**
 * The framework-reserved clock probe (`./clockNow`): every surface built by
 * `defineSurface` carries `surface.system.clockNow`, auto-answered by
 * `implementSurface` with the server's own wall clock, so a consumer can measure
 * the far-end clock offset at admit with zero app wiring. These pins:
 *   1. every surface answers `system.clockNow` with a fresh `{ epochMs }`;
 *   2. `probeSurfaceClockNow` resolves against it;
 *   3. it MERGES into an app-owned `system` namespace (beside `live`/`identity`)
 *      rather than colliding with it;
 *   4. an app that tries to claim `system.clockNow` itself gets a loud boot-time
 *      collision (reserved verbs can't be silently clobbered);
 *   5. `measureSurfaceClockOffset` returns the RTT-compensated far-end offset.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { measureSurfaceClockOffset, probeSurfaceClockNow } from "./clockNow";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { implementSurface, inMemoryStore } from "./server";

// A surface that ALSO declares its own `system.*` verb, to prove the reserved
// `system.clockNow` merges into an app-owned `system` namespace rather than
// displacing it.
function buildSurface() {
  return defineSurface({
    cells: {
      state: { schema: z.object({ value: z.number() }), default: { value: 0 } },
    },
    procedures: {
      system: {
        echo: {
          input: z.object({ n: z.number() }),
          output: z.object({ n: z.number() }),
        },
      },
    },
  });
}

function makeClient(surface: ReturnType<typeof buildSurface>) {
  const { router } = implementSurface(surface, {
    cells: { state: { store: inMemoryStore({ value: 0 }) } },
    procedures: {
      system: {
        echo: ({ input }: { input: { n: number } }) => ({ n: input.n }),
      },
    },
  });
  return directLink<typeof surface.contract>(router as never);
}

describe("framework-reserved system.clockNow probe", () => {
  it("every surface answers surface.system.clockNow with a fresh wall clock", async () => {
    const client = makeClient(buildSurface());
    const before = Date.now();
    const { epochMs } = await client.surface.system.clockNow({});
    const after = Date.now();
    expect(epochMs).toBeGreaterThanOrEqual(before);
    expect(epochMs).toBeLessThanOrEqual(after);
  });

  it("probeSurfaceClockNow resolves against the served surface", async () => {
    const client = makeClient(buildSurface());
    await expect(probeSurfaceClockNow(client)).resolves.toMatchObject({
      epochMs: expect.any(Number),
    });
  });

  it("coexists with an app's own system.* verb (merge, not collision)", async () => {
    const client = makeClient(buildSurface());
    await expect(client.surface.system.echo({ n: 7 })).resolves.toEqual({
      n: 7,
    });
    await expect(client.surface.system.clockNow({})).resolves.toMatchObject({
      epochMs: expect.any(Number),
    });
  });

  it("rejects an app that tries to claim the reserved `system.clockNow` verb", () => {
    expect(() =>
      defineSurface({
        procedures: {
          system: {
            clockNow: { input: z.object({}), output: z.object({}) },
          },
        },
      }),
    ).toThrow(/duplicate verb "clockNow"/);
  });
});

describe("measureSurfaceClockOffset", () => {
  it("yields ~0 against a local server (same wall clock, RTT-compensated)", async () => {
    // The in-memory server answers with THIS process's own `Date.now()`, so the
    // measured offset must be ~0 — the RTT-midpoint sampling keeps it from being
    // biased by the round-trip latency.
    const client = makeClient(buildSurface());
    const offset = await measureSurfaceClockOffset(client);
    expect(Math.abs(offset)).toBeLessThan(100);
  });
});
