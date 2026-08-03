/**
 * The member face (`face.surface` / `client.procedures`), driven IN-PROCESS over
 * `directDispatch` — no wire, so every failure these tests observe was raised by a
 * handler and carried by the face, never manufactured by a transport.
 *
 * That in-process framing is the point of the central pin. A `Promise` can only
 * reject, and a rejection erases its type: a caller cannot tell "the server
 * declared this and said no" from "the call never got an answer" without
 * re-classifying at runtime. On this face the DECLARED tagged class is in the error
 * CHANNEL, so the compiler carries the distinction — and these tests prove the
 * runtime agrees: a declared failure arrives as its own class, an undeclared throw
 * is still a DEFECT, and neither is ever an `RpcClientError`.
 *
 * The rest pins the properties that make the face worth having:
 *
 *   - it carries every member the SPEC declares, plus the reserved `system` ones;
 *   - the two leaf shapes are the right ones — a unary verb is an `Effect`, a
 *     streaming verb a `Stream`, and each row is minted once;
 *   - the argument is decoded at the EDGE, on the Encoded side (D2/#13);
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
      // Driving the row with the wire-shaped literal is what pins that the face
      // kept its Encoded-in contract (D2/#13).
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

/** Read one unary row off the face. The face is deliberately structural
 *  (per-member precision lives in the spec-derived bound faces), so a raw read is
 *  an index that may miss — and missing is a test-wiring bug, never a value to
 *  soldier on with. */
function unaryRow<I, O, E>(
  face: ReturnType<typeof faceOver>,
  member: string,
  verb: string,
): UnaryEffect<I, O, E> {
  const row = face.surface[member]?.[verb];
  if (typeof row !== "function") {
    throw new Error(`the face carries no "${member}.${verb}"`);
  }
  return row as UnaryEffect<I, O, E>;
}

describe("the face fails with the DECLARED error, in-process", () => {
  it("a declared failure arrives as its own tagged class, data intact", async () => {
    const served = serve();
    const refuse = unaryRow<{ why: string }, void, DemoRefused>(
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
    const refuse = unaryRow<{ why: string }, void, DemoRefused>(
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
    const refuse = unaryRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    // The compiler-side gain, exercised at runtime: no re-classifying helper, no
    // cast — the tag IS the branch.
    const recovered = await Effect.runPromise(
      Effect.catchTag(refuse({ why: "quota" }), "DemoRefused", (err) =>
        Effect.succeed(`refused: ${err.because}`),
      ),
    );
    expect(recovered).toBe("refused: quota");

    await served.runtime.close();
  });

  it("an UNDECLARED throw stays a DEFECT", async () => {
    const served = serve();
    const boom = unaryRow<undefined, void, never>(
      faceOver(served),
      "math",
      "boom",
    );

    const exit = await Effect.runPromiseExit(boom(undefined));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Nothing declared it, so no caller may branch on it as a domain outcome —
      // D4's crash-loudly channel.
      expect(Result.isSuccess(Cause.findError(exit.cause))).toBe(false);
      expect(Result.isSuccess(Cause.findDefect(exit.cause))).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain("undeclared kaboom");
    }

    await served.runtime.close();
  });
});

describe("the face carries what the spec declares", () => {
  it("every declared member, plus the reserved `system` namespace", () => {
    const served = serve();
    const face = faceOver(served);

    // Asserted against the SPEC, not against a second nesting: the face's job is
    // to re-nest exactly the members `defineSurface` minted tags for.
    expect(Object.keys(face.surface).sort()).toEqual(
      ["math", "system", "ticks"].sort(),
    );
    expect(Object.keys(face.surface.math as object).sort()).toEqual(
      ["boom", "double", "hang", "refuse"].sort(),
    );
    // The three framework-reserved members are minted by the same walk, at the
    // same tags `defineSurface` claimed — which is what lets the reserved probes
    // address them structurally.
    expect(Object.keys(face.surface.system as object).sort()).toEqual(
      ["clockNow", "identity", "live"].sort(),
    );
  });

  it("a unary verb is an Effect and a streaming verb is a Stream", () => {
    const served = serve();
    const face = faceOver(served);

    const ticks = face.surface.ticks?.get as (i: { n: number }) => unknown;
    expect(Stream.isStream(ticks({ n: 1 }))).toBe(true);
    // …and the row is minted ONCE, so a consumer that captured it keeps the same
    // reference (the retry fence and the bound faces both rely on that).
    expect(face.surface.ticks?.get).toBe(face.surface.ticks?.get);

    const double = unaryRow<string, number, never>(face, "math", "double");
    expect(Effect.isEffect(double("1"))).toBe(true);
  });

  it("decodes the ENCODED argument at the edge", async () => {
    const served = serve();
    // `NumberFromString`: the wire-shaped `"21"` is what the row accepts, and the
    // handler is handed the decoded `21`. Typing the input decoded would have
    // demanded a `number` the wire never carries (#13).
    const double = unaryRow<string, number, never>(
      faceOver(served),
      "math",
      "double",
    );
    expect(await Effect.runPromise(double("21"))).toBe(42);
    await served.runtime.close();
  });
});

describe("a unary row is a description, and it composes", () => {
  it("building the call dispatches nothing", async () => {
    const served = serve();
    const refuse = unaryRow<{ why: string }, void, DemoRefused>(
      faceOver(served),
      "math",
      "refuse",
    );

    // A `Promise` would have started the call at the call site — there is no other
    // shape it can have. This does not, which is what lets a caller build it once
    // and retry, race or discard it.
    const call = refuse({ why: "unrun" });
    await Effect.runPromise(Effect.sleep(5));
    const exit = await Effect.runPromiseExit(Effect.flip(call));
    expect(Exit.isSuccess(exit)).toBe(true);

    await served.runtime.close();
  });

  it("a deadline INTERRUPTS the handler — what an `await` cannot do", async () => {
    const served = serve();
    const hang = unaryRow<undefined, void, never>(
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
    // in the CLI/TUI tail existed to approximate and could not reach through an
    // `await`.
    expect(served.hangInterrupted()).toBe(true);

    await served.runtime.close();
  });
});

describe("client.procedures — the spec-typed procedure face", () => {
  it("binds every declared procedure, with the declared error in the channel", async () => {
    const served = serve();
    const client = surfaceClient(surface, directDispatch(served.runtime));

    expect(await Effect.runPromise(client.procedures.math.double("4"))).toBe(8);

    const failure = await Effect.runPromise(
      Effect.flip(client.procedures.math.refuse({ why: "typed" })),
    );
    expect(failure).toBeInstanceOf(DemoRefused);

    // The typed face's channel is narrow enough to branch on WITHOUT a cast — the
    // runtime twin of `effectProcedure.test-d.ts`'s type-level pin.
    const recovered = await Effect.runPromise(
      client.procedures.math.refuse({ why: "typed" }).pipe(
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

  it("`.procedures` names the same verbs the raw face carries", async () => {
    const served = serve();
    const client = surfaceClient(surface, directDispatch(served.runtime));
    expect(Object.keys(client.procedures.math).sort()).toEqual(
      Object.keys(client.rpc.surface.math as object).sort(),
    );
    await served.runtime.close();
  });
});
