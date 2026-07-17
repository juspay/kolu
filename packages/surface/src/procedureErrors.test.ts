/**
 * SK6 runtime pins — the DECLARED error channel on `defineSurface` procedures.
 *
 * The class this kills (bug-remote-kaval-contract-skew defect A): a typed
 * domain error thrown by a handler crossed the wire as an opaque
 * `INTERNAL_SERVER_ERROR` because nothing on the contract declared it, so no
 * hop could do better than oRPC's `toORPCError` collapse. With `errors` on
 * the {@link ProcedureSpec}, the handler mints the declared code via its
 * typed `opts.errors` constructors and the client receives it `defined: true`
 * with its data schema-validated and intact — across a REAL wire
 * (`serveOverStdio` + `stdioLink`, the same encode/decode a socket link
 * runs), not an in-process shortcut.
 *
 * The complementary pin: an UNDECLARED plain throw still arrives as
 * `INTERNAL_SERVER_ERROR` — that is the fail-fast crash-loudly channel,
 * deliberately untouched.
 */

import { isDefinedError, ORPCError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { stdioLink } from "./links/stdio";
import { createLoopbackPair } from "./loopback";
import { mirrorRemoteSurface } from "./mirrorRemoteSurface";
import { serveOverStdio } from "./peer-server";
import { implementSurface } from "./server";

const daemonSurface = defineSurface({
  procedures: {
    daemon: {
      // The incident's shape: a recycle that proves a contract skew and
      // must refuse TYPED, versions as data.
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
      // No declared errors — the crash-loudly channel.
      boom: {},
    },
  },
});

function buildWiredClient() {
  const runtime = implementSurface(daemonSurface, {
    procedures: {
      daemon: {
        recycle: async ({ input, errors }) => {
          // The typed constructor the contract-first handler receives (the
          // framework spreads oRPC's handler opts through, so `errors` arrives
          // with per-code constructors — no surface plumbing).
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
    // biome-ignore lint/suspicious/noExplicitAny: runtime.router is the final served router; serveOverStdio takes Router<any, any>.
    router: runtime.router as any,
    transport: pair.server,
  });
  const client = stdioLink<typeof daemonSurface.contract>({
    read: pair.client.read,
    write: pair.client.write,
  });
  const done = async () => {
    pair.client.write.end();
    pair.server.write.end();
    await serving;
  };
  return { client, done };
}

describe("declared procedure errors cross the wire typed (SK6)", () => {
  it("a declared error arrives defined:true with its code and data intact", async () => {
    const { client, done } = buildWiredClient();

    const rejection = await client.surface.daemon.recycle({ id: "kaval" }).then(
      () => {
        throw new Error("expected a typed rejection");
      },
      (err: unknown) => err,
    );

    expect(rejection).toBeInstanceOf(ORPCError);
    const orpc = rejection as ORPCError<string, unknown>;
    expect(orpc.code).toBe("DEMO_CONTRACT_SKEW");
    // `defined: true` is the whole point — the wire recognized the contract's
    // declared code, so the client can narrow on it (`isDefinedError`).
    expect(orpc.defined).toBe(true);
    expect(orpc.data).toEqual({
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });
    expect(orpc.message).toBe("daemon kaval speaks 5.0, needs 5.2");

    await done();
  });

  it("safe() + isDefinedError narrow a declared rejection to its typed data", async () => {
    const { client, done } = buildWiredClient();

    const { error } = await safe(client.surface.daemon.recycle({ id: "k" }));
    expect(error).toBeTruthy();
    if (error && isDefinedError(error)) {
      // Narrowed: the declared union's data shape, no casts.
      expect(error.data).toEqual({
        daemonVersion: "5.0",
        requiredVersion: "5.2",
      });
    } else {
      throw new Error("expected a defined (declared) error");
    }

    await done();
  });

  it("an UNDECLARED plain throw still collapses to INTERNAL_SERVER_ERROR (the loud channel)", async () => {
    const { client, done } = buildWiredClient();

    const rejection = await client.surface.daemon.boom().then(
      () => {
        throw new Error("expected a rejection");
      },
      (err: unknown) => err,
    );

    expect(rejection).toBeInstanceOf(ORPCError);
    const orpc = rejection as ORPCError<string, unknown>;
    expect(orpc.code).toBe("INTERNAL_SERVER_ERROR");
    expect(orpc.defined).toBe(false);

    await done();
  });
});

describe("declared errors cross mirrorRemoteSurface's forwarders typed (SK6/D4)", () => {
  it("a forwarder rejection keeps code/defined/data; serve∘mirror keeps them across a second wire", async () => {
    // The mirror leg of the incident hop: a downstream consumer (drishti-style)
    // mirrors a remote surface and re-serves it. The forwarder passes the
    // remote rejection through UNTOUCHED, and the re-served surface (same
    // declaration) re-declares the union — so a declared error survives BOTH
    // the mirror stub and a second wire encode, `defined: true`, data intact.
    const remote = buildWiredClient();
    // The mirror consumes the same declaration + the remote's wire client.
    const mirror = mirrorRemoteSurface(daemonSurface, remote.client, {});

    // Leg 1 — the bare forwarder.
    const viaMirror = await mirror.procedures.daemon
      .recycle({ id: "kaval" })
      .then(
        () => {
          throw new Error("expected a typed rejection");
        },
        (err: unknown) => err,
      );
    expect(viaMirror).toBeInstanceOf(ORPCError);
    expect((viaMirror as ORPCError<string, unknown>).code).toBe(
      "DEMO_CONTRACT_SKEW",
    );
    expect((viaMirror as ORPCError<string, unknown>).defined).toBe(true);
    expect((viaMirror as ORPCError<string, unknown>).data).toEqual({
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });

    // Leg 2 — re-serve the mirror (serve ∘ mirror) over a SECOND real wire.
    const { router: reRouter } = implementSurface(daemonSurface, {
      procedures: {
        daemon: {
          recycle: ({ input }) => mirror.procedures.daemon.recycle(input),
          boom: () => mirror.procedures.daemon.boom(),
        },
      },
    });
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      // biome-ignore lint/suspicious/noExplicitAny: runtime-valid final router.
      router: reRouter as any,
      transport: pair.server,
    });
    const reServed = stdioLink<typeof daemonSurface.contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    const viaReServe = await reServed.surface.daemon
      .recycle({ id: "kaval" })
      .then(
        () => {
          throw new Error("expected a typed rejection");
        },
        (err: unknown) => err,
      );
    expect(viaReServe).toBeInstanceOf(ORPCError);
    expect((viaReServe as ORPCError<string, unknown>).code).toBe(
      "DEMO_CONTRACT_SKEW",
    );
    expect((viaReServe as ORPCError<string, unknown>).defined).toBe(true);
    expect((viaReServe as ORPCError<string, unknown>).data).toEqual({
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });

    pair.client.write.end();
    pair.server.write.end();
    await serving;
    await remote.done();
  });
});
