/**
 * The framework-reserved liveness probe (`./liveness`): every surface built by
 * `defineSurface` carries `surface.system.live`, auto-answered by
 * `implementSurface`, so a client-side liveness watchdog has a contract-agnostic
 * round-trip with zero app wiring. These pins:
 *   1. every surface answers `system.live` (end-to-end over directLink);
 *   2. `probeSurfaceLive` resolves against it;
 *   3. it MERGES into an app-owned `system` namespace (kaval-style) rather than
 *      colliding with it;
 *   4. an app that tries to claim `system.live` itself gets a loud boot-time
 *      collision (reserved verbs can't be silently clobbered).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { probeSurfaceLive } from "./liveness";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
} from "./server";

// A surface that ALSO declares its own `system.*` verb (mirrors kaval's
// `system.heartbeat`), to prove the reserved `system.live` merges into an
// app-owned `system` namespace rather than displacing it.
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

describe("framework-reserved system.live liveness probe", () => {
  it("every surface answers surface.system.live with {}", async () => {
    const client = makeClient(buildSurface());
    await expect(client.surface.system.live({})).resolves.toEqual({});
  });

  it("probeSurfaceLive resolves against the served surface", async () => {
    const client = makeClient(buildSurface());
    await expect(probeSurfaceLive(client)).resolves.toEqual({});
  });

  it("coexists with an app's own system.* verb (merge, not collision)", async () => {
    const client = makeClient(buildSurface());
    // The app verb still works...
    await expect(client.surface.system.echo({ n: 7 })).resolves.toEqual({
      n: 7,
    });
    // ...AND the reserved verb is answered alongside it.
    await expect(client.surface.system.live({})).resolves.toEqual({});
  });

  it("rejects an app that tries to claim the reserved `system.live` verb", () => {
    expect(() =>
      defineSurface({
        procedures: {
          system: { live: { input: z.object({}), output: z.object({}) } },
        },
      }),
    ).toThrow(/duplicate verb "live"/);
  });
});
