/**
 * SK6 runtime pins — the DECLARED error channel on `defineSurface` procedures,
 * over a REAL wire (`serveOverStdio` + `stdioLink`, the same ndjson encode and
 * decode a socket link runs), never an in-process shortcut.
 *
 * The class this kills (bug-remote-kaval-contract-skew defect A): a typed
 * domain error raised by a handler crossed the wire as an opaque internal
 * failure because nothing on the contract declared it, so no hop could do
 * better than collapse it. With `error` on the {@link ProcedureSpec} the
 * handler FAILS with an instance of the declared `Schema.TaggedError` and
 * the caller receives it decoded — same class, same `_tag`, data intact — and
 * narrows on `_tag` with no cast.
 *
 * The two complementary pins:
 *  - an UNDECLARED throw stays a DEFECT (D4's fail-fast crash-loudly channel),
 *    never a declared failure a caller could mistake for a domain outcome;
 *  - a TRANSPORT death is neither: it is the leg's own
 *    `SurfaceStdioTransportClosed`, so "the daemon died" and "the daemon said
 *    no" are distinguishable at the call site.
 */

import { Cause, Effect, Exit, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { SurfaceStdioTransportClosed } from "./errors";
import { stdioLink } from "./links/stdio";
import { createLoopbackPair, greetLoopback } from "./loopback";
import { serveOverStdio } from "./peer-server";
import { implementSurface } from "./server";

class DemoContractSkew extends Schema.TaggedError<DemoContractSkew>(
  "@kolu/surface/test/DemoContractSkew",
)("DemoContractSkew", {
  daemonVersion: Schema.String,
  requiredVersion: Schema.String,
}) {
  override get message(): string {
    return `daemon speaks ${this.daemonVersion}, needs ${this.requiredVersion}`;
  }
}

const daemonSurface = defineSurface({
  procedures: {
    daemon: {
      // The incident's shape: a recycle that proves a contract skew and must
      // refuse TYPED, versions as data.
      recycle: {
        input: Schema.Struct({ id: Schema.String }),
        error: DemoContractSkew,
      },
      // No declared error — the crash-loudly channel.
      boom: {},
    },
  },
});

async function buildWiredClient() {
  const runtime = implementSurface(daemonSurface, {
    procedures: {
      daemon: {
        recycle: ({ input }) =>
          Effect.fail(
            new DemoContractSkew({
              daemonVersion: `5.0 (${input.id})`,
              requiredVersion: "5.2",
            }),
          ),
        boom: () =>
          Effect.sync(() => {
            throw new Error("undeclared kaboom");
          }),
      },
    },
  });

  const pair = createLoopbackPair();
  const serving = serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: pair.server,
  });
  const readiness = await greetLoopback(pair);
  const link = await stdioLink({
    group: daemonSurface.group,
    read: pair.client.read,
    write: pair.client.write,
    readiness,
  });
  return {
    link,
    pair,
    serving,
    done: async () => {
      await link.dispose();
      pair.client.write.end();
      pair.server.write.end();
      await serving;
      await runtime.close();
    },
  };
}

describe("declared procedure errors cross the wire typed (SK6)", () => {
  it("a declared error arrives as its own class, with its data intact", async () => {
    const { link, done } = await buildWiredClient();

    const failure = await Effect.runPromise(
      Effect.flip(
        link.dispatch.unary("surface/daemon/recycle", { id: "kaval" }),
      ),
    );

    // Same class on both sides — decoded against the declared schema, not
    // rehydrated as a bag of fields.
    expect(failure).toBeInstanceOf(DemoContractSkew);
    const skew = failure as DemoContractSkew;
    expect(skew._tag).toBe("DemoContractSkew");
    expect(skew.daemonVersion).toBe("5.0 (kaval)");
    expect(skew.requiredVersion).toBe("5.2");
    // …and NOT confusable with a transport death.
    expect(failure).not.toBeInstanceOf(SurfaceStdioTransportClosed);

    await done();
  });

  it("narrows on `_tag` at the call site with no cast", async () => {
    const { link, done } = await buildWiredClient();

    const exit = await Effect.runPromiseExit(
      link.dispatch.unary("surface/daemon/recycle", { id: "k" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.findError(exit.cause);
      expect(Result.isSuccess(error)).toBe(true);
      const value = Result.isSuccess(error) ? error.success : undefined;
      if (
        value !== null &&
        typeof value === "object" &&
        "_tag" in value &&
        value._tag === "DemoContractSkew"
      ) {
        expect((value as DemoContractSkew).requiredVersion).toBe("5.2");
      } else {
        throw new Error(`expected a DemoContractSkew, got ${String(value)}`);
      }
    }

    await done();
  });

  it("an UNDECLARED throw stays a DEFECT — it never reaches the error channel", async () => {
    const { link, done } = await buildWiredClient();

    const exit = await Effect.runPromiseExit(
      link.dispatch.unary("surface/daemon/boom", undefined),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // A defect, not a failure: nothing declared it, so no caller may branch
      // on it as a domain outcome.
      expect(Result.isSuccess(Cause.findError(exit.cause))).toBe(false);
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      expect(JSON.stringify(Cause.pretty(exit.cause))).toContain(
        "undeclared kaboom",
      );
    }

    await done();
  });

  it("a transport death is its own vocabulary, not a declared error", async () => {
    const { link, pair, serving } = await buildWiredClient();
    // One good call first, so this exercises the dead-transport path rather
    // than a link that never worked.
    await expect(
      Effect.runPromise(
        Effect.flip(link.dispatch.unary("surface/daemon/recycle", { id: "x" })),
      ),
    ).resolves.toBeInstanceOf(DemoContractSkew);

    // The agent exits: its stdout ends.
    pair.server.write.end();
    await serving;

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/daemon/recycle", { id: "x" })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    expect(failure).not.toBeInstanceOf(DemoContractSkew);
    await link.dispose();
  });
});
