/**
 * `inProcessSurfaceClient` is the identity transport: it composes a surface's
 * handlers with `createRouterClient` so a consumer holds the exact
 * `ContractRouterClient<contract>` it would hold against a socket, but every
 * call is a direct in-process invocation. These tests pin that both a
 * request/response procedure AND a stream round-trip through it with no wire.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import {
  type Channel,
  inMemoryChannel,
  inProcessSurfaceClient,
} from "./server";

function buildClient() {
  const surface = defineSurface({
    streams: {
      ticks: {
        inputSchema: z.object({ n: z.number() }),
        outputSchema: z.object({ i: z.number() }),
      },
    },
    procedures: {
      math: {
        double: {
          input: z.object({ x: z.number() }),
          output: z.object({ y: z.number() }),
        },
      },
    },
  });
  const { client } = inProcessSurfaceClient(surface, {
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
    procedures: {
      math: { double: async ({ input }) => ({ y: input.x * 2 }) },
    },
    streams: {
      ticks: {
        source: async function* (input) {
          for (let i = 0; i < input.n; i++) yield { i };
        },
      },
    },
  });
  return client;
}

describe("inProcessSurfaceClient", () => {
  it("round-trips a request/response procedure with no wire", async () => {
    const client = buildClient();
    expect(await client.surface.math.double({ x: 21 })).toEqual({ y: 42 });
  });

  it("round-trips a stream as an async iterable", async () => {
    const client = buildClient();
    const stream = await client.surface.ticks.get({ n: 3 });
    const got: number[] = [];
    for await (const ev of stream) got.push(ev.i);
    expect(got).toEqual([0, 1, 2]);
  });
});
