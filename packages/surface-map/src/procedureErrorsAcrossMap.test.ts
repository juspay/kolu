/**
 * SK6/D4 — the INCIDENT-HOP pin: a declared procedure error minted by a
 * handler BEHIND a surface-map's keyed proxy arrives at the outer client
 * `defined: true` with its data intact, across REAL wires on BOTH hops.
 *
 * This is the exact path the field failure flattened at
 * (bug-remote-kaval-contract-skew defect A): padi's typed skew rejection
 * crossed its unix socket fine, but the map's unary proxy (server.ts's
 * `makeUnaryHandler`) rethrows the leaf rejection into a SECOND wire encode —
 * and before the error was DECLARED, nothing on that hop could do better than
 * `toORPCError`'s `INTERNAL_SERVER_ERROR` collapse. With the error declared
 * on the entry surface, both hops preserve `{ code, defined, data }` — this
 * test is the incident as a permanent regression test. The undeclared-throw
 * companion pins that the old collapse still exists for genuinely undeclared
 * errors (the crash-loudly channel), so the fix is the DECLARATION, not a
 * blanket rewrite of unknown errors.
 */

import { defineSurface } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface } from "@kolu/surface/server";
import { ORPCError } from "@orpc/client";
import { implement } from "@orpc/server";
import type { AnyContractRouter } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurfaceMap } from "./define";
import {
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
  testFailureSchema,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

const daemonSurface = defineSurface({
  procedures: {
    lifecycle: {
      recycle: {
        input: z.object({ id: z.string() }),
        errors: {
          DEMO_CONTRACT_SKEW: {
            data: z.object({
              daemonVersion: z.string(),
              requiredVersion: z.string(),
            }),
          },
        },
      },
      boom: {},
    },
  },
});

/** Serve the leaf over a REAL stdio wire (hop 1 — the padi socket analogue)
 *  and hand back the wire client + teardown. */
function serveLeafOverWire() {
  const { router } = implementSurface(daemonSurface, {
    procedures: {
      lifecycle: {
        recycle: async ({ input, errors }) => {
          throw errors.DEMO_CONTRACT_SKEW({
            message: `daemon ${input.id} speaks 5.0, needs 5.2`,
            data: { daemonVersion: "5.0", requiredVersion: "5.2" },
          });
        },
        boom: async () => {
          throw new Error("undeclared kaboom");
        },
      },
    },
  });
  const pair = createLoopbackPair();
  const serving = serveOverStdio({
    // biome-ignore lint/suspicious/noExplicitAny: runtime-valid final router.
    router: router as any,
    transport: pair.server,
  });
  const client = stdioLink<typeof daemonSurface.contract>({
    read: pair.client.read,
    write: pair.client.write,
  });
  return {
    client,
    done: async () => {
      pair.client.write.end();
      pair.server.write.end();
      await serving;
    },
  };
}

const A = HostKeySchema.parse("a");

describe("a declared error crosses the map's keyed proxy typed (the incident hop)", () => {
  it("arrives defined:true with code + data intact across BOTH real wires", async () => {
    const leaf = serveLeafOverWire();
    const map = defineSurfaceMap({
      key: HostKeySchema,
      entry: daemonSurface,
      codec: identityCodec,
      failure: testFailureSchema,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);

    // Hop 2 — the map itself over a REAL wire (the browser websocket analogue).
    // The served fragment must be RE-ADAPTED against the map's contract for a
    // wire matcher (the same re-adaptation kolu's buildAppRouter performs on
    // the spliced serveHostMap fragment) — a bare fragment has no route meta.
    // biome-ignore lint/suspicious/noExplicitAny: dynamic re-adaptation, runtime-valid per the map contract.
    const host = implement(map.contract as any) as any;
    const wireRouter = host.router({ surface: served.router.surface });
    const outerPair = createLoopbackPair();
    const outerServing = serveOverStdio({
      router: wireRouter,
      transport: outerPair.server,
    });
    const mapLink = stdioLink<AnyContractRouter>({
      read: outerPair.client.read,
      write: outerPair.client.write,
    });

    reg.addSession(A, leaf.client, connected(0));
    await settle();

    // Call the OUTER wire directly with the map's fold envelope
    // (`{ mapKey, input }` at `surface.<ns>.<verb>` — envelope.ts): the browser
    // client's `entry(key).procedures` face encodes exactly this, and errors
    // pass through it untouched, so the raw wire call IS the error-path pin
    // (connectSurfaceMap itself refuses a bare test link by design — the
    // half-open-watchdog law).
    // biome-ignore lint/suspicious/noExplicitAny: raw wire walk at the map's envelope shape.
    const wire = mapLink as any;

    const rejection = await wire.surface.lifecycle
      .recycle({ mapKey: "a", input: { id: "kaval" } })
      .then(
        () => {
          throw new Error("expected a typed rejection");
        },
        (err: unknown) => err,
      );
    expect(rejection).toBeInstanceOf(ORPCError);
    const orpc = rejection as ORPCError<string, unknown>;
    expect(orpc.code).toBe("DEMO_CONTRACT_SKEW");
    expect(orpc.defined).toBe(true);
    expect(orpc.data).toEqual({
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });

    // The crash-loudly channel is untouched: an UNDECLARED plain throw from
    // behind the same two hops still arrives as the generic collapse.
    const boom = await wire.surface.lifecycle.boom({ mapKey: "a" }).then(
      () => {
        throw new Error("expected a rejection");
      },
      (err: unknown) => err,
    );
    expect(boom).toBeInstanceOf(ORPCError);
    expect((boom as ORPCError<string, unknown>).code).toBe(
      "INTERNAL_SERVER_ERROR",
    );
    expect((boom as ORPCError<string, unknown>).defined).toBe(false);

    outerPair.client.write.end();
    outerPair.server.write.end();
    await outerServing;
    await leaf.done();
  });
});
