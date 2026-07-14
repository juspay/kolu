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
 *   5. `clockOffsetFrom` is `remoteEpochMs − localEpochMs`.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clockOffsetFrom, probeSurfaceClockNow } from "./clockNow";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
} from "./server";

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
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
    cells: { state: { store: inMemoryStore({ value: 0 }) } },
    procedures: {
      system: {
        echo: ({ input }: { input: { n: number } }) => ({ n: input.n }),
      },
    },
  });
  return directLink<typeof surface.contract>(router);
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

describe("clockOffsetFrom", () => {
  it("is remoteEpochMs − localEpochMs (so remoteMs − offset maps to local)", () => {
    // A remote clock 5s ahead of ours → +5000 offset; remoteMs − offset = localMs.
    expect(clockOffsetFrom(1_000_500, 1_000_000)).toBe(500);
    expect(clockOffsetFrom(1_000_000, 1_000_500)).toBe(-500);
    const remote = 1_700_000_005_000;
    const local = 1_700_000_000_000;
    const offset = clockOffsetFrom(remote, local);
    expect(remote - offset).toBe(local);
  });
});
