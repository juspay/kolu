/**
 * `directLink` is the identity element of the link family: given a served
 * router (from `implementSurface`), it builds the exact
 * `ContractRouterClient<contract>` a consumer would hold against a socket —
 * but every call is a direct in-process invocation, no wire. These tests pin
 * that both a request/response procedure AND a stream round-trip through it.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";
import { type Channel, implementSurface, inMemoryChannel } from "../server";
import { directLink } from "./direct";

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
  const { router } = implementSurface(surface, {
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
  return directLink<typeof surface.contract>(router);
}

describe("directLink — the in-process identity link", () => {
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
