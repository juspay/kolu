/**
 * The EFFECT-native member face (`face.effect` / `client.effect`), driven
 * IN-PROCESS over `directDispatch` — no wire, so every failure these tests
 * observe was raised by a handler and carried by the face, never manufactured by
 * a transport.
 *
 * That in-process framing is the point of the central pin. The Promise face can
 * only reject, and a rejection erases its type: a caller cannot tell "the server
 * declared this and said no" from "the call never got an answer" without
 * `safe()`/`isDefinedError` re-classifying at runtime. On the Effect face the
 * DECLARED tagged class is in the error CHANNEL, so the compiler carries the
 * distinction — and these tests prove the runtime agrees: a declared failure
 * arrives as its own class, an undeclared throw is still a DEFECT, and neither is
 * ever an `RpcClientError`.
 *
 * The rest pins the properties that make the Effect face worth having and the
 * Promise face safe to keep beside it:
 *
 *   - the two nestings carry the SAME members (a mirror, not a subset), with the
 *     streaming rows literally the same references;
 *   - a Promise row IS its Effect twin, run — same tag, same decode, same failure;
 *   - the call is a DESCRIPTION: building it dispatches nothing;
 *   - it composes — a deadline actually interrupts the handler, which is exactly
 *     what an `await` cannot do.
 */

import { Cause, Effect, Exit, Result, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildSurfaceFace,
  isTransportError,
  type SurfaceCallFailure,
  type UnaryEffect,
} from "./client";
import { defineSurface } from "./define";
import { directDispatch } from "./links/direct";
import { implementSurface } from "./server";
import { surfaceClient } from "./solid/surfaceClient";

class DemoRefused extends Schema.TaggedErrorClass<DemoRefused>(
  "@kolu/surface/test/DemoRefused",
)("DemoRefused", {
  because: Schema.String,
}) {}

const surface = defineSurface({
  streams: {
    ticks: {
      inputSchema: Schema.Struct({ n: Schema.Number }),
      outputSchema: Schema.Struct({ i: Schema.Number }),
    },
  },
  procedures: {
    math: {
      // `Schema.NumberFromString` DIVERGES across the parse: the Encoded side the
      // face accepts is a string, the decoded side a handler sees is a number.
      // Driving the Effect row with the wire-shaped literal is what pins that the
      // new rows kept the face's Encoded-in contract (D2/#13).
      double: { input: Schema.NumberFromString, output: Schema.Number },
      // The declared-failure channel.
      refuse: {
        input: Schema.Struct({ why: Schema.String }),
        error: DemoRefused,
      },
      // The crash-loudly channel — nothing declared, so nothing may branch on it.
      boom: {},
      // Never answers: the composition tests bound it from OUTSIDE.
      hang: {},
    },
  },
});

/** A latch the `hang` handler flips when its fiber is interrupted — the observable
 *  proof that bounding the CALL bounded the WORK, rather than abandoning it. */
interface Served {
  readonly runtime: ReturnType<typeof implementSurface<typeof surface.spec>>;
  readonly hangInterrupted: () => boolean;
}

function serve(): Served {
  let interrupted = false;
  const runtime = implementSurface(surface, {
    procedures: {
      math: {
        double: ({ input }) => Effect.succeed(input * 2),
        refuse: ({ input }) =>
          Effect.fail(new DemoRefused({ because: input.why })),
        boom: () =>
          Effect.sync(() => {
            throw new Error("undeclared kaboom");
          }),
        hang: () =>
          Effect.onInterrupt(Effect.never, () =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
      },
    },
    streams: {
      ticks: {
        source: (input) =>
          Stream.fromIterable(
            Array.from({ length: input.n }, (_, i) => ({ i })),
          ),
      },
    },
  });
  return { runtime, hangInterrupted: () => interrupted };
}

function faceOver(served: Served) {
  return buildSurfaceFace(surface, directDispatch(served.runtime));
}

/** Read one row off the EFFECT nesting. The face is deliberately structural
 *  (per-member precision lives in the spec-derived bound faces), so a raw read is
 *  an index that may miss — and missing is a test-wiring bug, never a value to
 *  soldier on with. */
function effectRow<I, O, E>(
  face: ReturnType<typeof faceOver>,
  member: string,
  verb: string,
): UnaryEffect<I, O, E> {
  const row = face.effect[member]?.[verb];
  if (typeof row !== "function") {
    throw new Error(`the face's effect nesting carries no "${member}.${verb}"`);
  }
  return row as UnaryEffect<I, O, E>;
}

describe("the Effect face fails with the DECLARED error, in-process", () => {
  it("a declared failure arrives as its own tagged class, data intact", async () => {
    const served = serve();
    const refuse = effectRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    const failure = await Effect.runPromise(
      Effect.flip(refuse({ why: "not today" })),
    );

    expect(failure).toBeInstanceOf(DemoRefused);
    expect((failure as DemoRefused)._tag).toBe("DemoRefused");
    expect((failure as DemoRefused).because).toBe("not today");
    // …and NOT the transport class. In-process there is no transport at all, so
    // an `RpcClientError` here could only mean the face invented one — the exact
    // confusion that made a Promise rejection un-narrowable.
    expect(isTransportError(failure)).toBe(false);

    await served.runtime.close();
  });

  it("the declared failure rides the ERROR channel, not the defect channel", async () => {
    const served = serve();
    const refuse = effectRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    const exit = await Effect.runPromiseExit(refuse({ why: "policy" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // A FAILURE (recoverable, declared, `catchTag`-able) — the whole reason the
      // channel is typed. A defect here would mean no consumer could handle it.
      const error = Cause.findError(exit.cause);
      expect(Result.isSuccess(error)).toBe(true);
      expect(Result.isSuccess(Cause.findDefect(exit.cause))).toBe(false);
    }

    await served.runtime.close();
  });

  it("`catchTag` on the declared tag recovers it, and reads its data", async () => {
    const served = serve();
    const refuse = effectRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    // The compiler-side gain, exercised at runtime: no `safe()`, no
    // `isDefinedError`, no cast — the tag IS the branch.
    const recovered = await Effect.runPromise(
      Effect.catchTag(refuse({ why: "quota" }), "DemoRefused", (err) =>
        Effect.succeed(`refused: ${err.because}`),
      ),
    );
    expect(recovered).toBe("refused: quota");

    await served.runtime.close();
  });

  it("an UNDECLARED throw stays a DEFECT on the Effect row", async () => {
    const served = serve();
    const boom = effectRow<undefined, void, never>(
      faceOver(served),
      "math",
      "boom",
    );

    const exit = await Effect.runPromiseExit(boom(undefined));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Nothing declared it, so no caller may branch on it as a domain outcome —
      // D4's crash-loudly channel, unchanged by the new row.
      expect(Result.isSuccess(Cause.findError(exit.cause))).toBe(false);
      expect(Result.isSuccess(Cause.findDefect(exit.cause))).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain("undeclared kaboom");
    }

    await served.runtime.close();
  });
});

describe("the two nestings are one face", () => {
  it("carry exactly the same members and verbs", () => {
    const served = serve();
    const face = faceOver(served);

    expect(Object.keys(face.effect).sort()).toEqual(
      Object.keys(face.surface).sort(),
    );
    for (const member of Object.keys(face.surface)) {
      const promiseVerbs = Object.keys(
        face.surface[member] as Record<string, unknown>,
      ).sort();
      const effectVerbs = Object.keys(
        face.effect[member] as Record<string, unknown>,
      ).sort();
      expect(effectVerbs).toEqual(promiseVerbs);
    }
    // The reserved members are minted through the same helper, so they mirror too
    // — which is what will let the three probes cross without a second walk.
    expect(Object.keys(face.effect)).toContain("system");
  });

  it("a STREAMING row is the identical reference (a Stream is already Effect-native)", () => {
    const served = serve();
    const face = faceOver(served);
    expect(face.effect.ticks?.get).toBe(face.surface.ticks?.get);
  });

  it("a UNARY Promise row IS its Effect twin, run", async () => {
    const served = serve();
    const face = faceOver(served);

    // Distinct functions (one wraps the other) …
    expect(face.effect.math?.double).not.toBe(face.surface.math?.double);
    // … over the same tag, the same decode and the same failure.
    const asPromise = face.surface.math?.double as (
      i: string,
    ) => Promise<number>;
    const asEffect = effectRow<string, number, never>(face, "math", "double");
    expect(await asPromise("21")).toBe(42);
    expect(await Effect.runPromise(asEffect("21"))).toBe(42);

    const refusePromise = face.surface.math?.refuse as (i: {
      why: string;
    }) => Promise<void>;
    await expect(refusePromise({ why: "same" })).rejects.toBeInstanceOf(
      DemoRefused,
    );

    await served.runtime.close();
  });

  it("decodes the ENCODED argument at the edge, on the Effect row too", async () => {
    const served = serve();
    // `NumberFromString`: the wire-shaped `"21"` is what the row accepts, and the
    // handler is handed the decoded `21`. Typing the input decoded would have
    // demanded a `number` the wire never carries (#13).
    const double = effectRow<string, number, never>(
      faceOver(served),
      "math",
      "double",
    );
    expect(await Effect.runPromise(double("21"))).toBe(42);
    await served.runtime.close();
  });
});

describe("an Effect row is a description, and it composes", () => {
  it("building the call dispatches nothing", async () => {
    const served = serve();
    const refuse = effectRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    // The Promise row starts the call at the call site — there is no other shape a
    // `Promise` can have. The Effect row does not, which is what lets a caller
    // build it once and retry, race or discard it.
    const call = refuse({ why: "unrun" });
    await Effect.runPromise(Effect.sleep(5));
    const exit = await Effect.runPromiseExit(Effect.flip(call));
    expect(Exit.isSuccess(exit)).toBe(true);

    await served.runtime.close();
  });

  it("a deadline INTERRUPTS the handler — what an `await` cannot do", async () => {
    const served = serve();
    const hang = effectRow<undefined, void, never>(
      faceOver(served),
      "math",
      "hang",
    );

    const exit = await Effect.runPromiseExit(
      Effect.timeout(hang(undefined), 20),
    );
    // The bound fired …
    expect(Exit.isFailure(exit)).toBe(true);
    // … and the WORK stopped, rather than running on unobserved behind an
    // abandoned promise. This is the property every hand-rolled `AbortController`
    // in the CLI/TUI tail exists to approximate and cannot reach through an
    // `await`.
    expect(served.hangInterrupted()).toBe(true);

    await served.runtime.close();
  });
});

describe("client.effect — the spec-typed Effect procedures", () => {
  it("binds every declared procedure, with the declared error in the channel", async () => {
    const served = serve();
    const client = surfaceClient(surface, directDispatch(served.runtime));

    expect(await Effect.runPromise(client.effect.math.double("4"))).toBe(8);

    const failure = await Effect.runPromise(
      Effect.flip(client.effect.math.refuse({ why: "typed" })),
    );
    expect(failure).toBeInstanceOf(DemoRefused);

    // The typed face's channel is narrow enough to branch on WITHOUT a cast — the
    // runtime twin of `effectProcedure.test-d.ts`'s type-level pin.
    const recovered = await Effect.runPromise(
      client.effect.math.refuse({ why: "typed" }).pipe(
        Effect.catchTag("DemoRefused", (err: DemoRefused) =>
          Effect.succeed(err.because),
        ),
        Effect.catch((residual: SurfaceCallFailure) =>
          Effect.succeed(`framework: ${residual._tag}`),
        ),
      ),
    );
    expect(recovered).toBe("typed");

    await served.runtime.close();
  });

  it("`.procedures` and `.effect` name the same verbs", async () => {
    const served = serve();
    const client = surfaceClient(surface, directDispatch(served.runtime));
    expect(Object.keys(client.effect.math).sort()).toEqual(
      Object.keys(client.procedures.math).sort(),
    );
    await served.runtime.close();
  });
});
