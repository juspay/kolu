/**
 * TYPE-LEVEL drift-catch for the procedure face — `EffectProcedure<S>`, this
 * package's hand-rolled `ProcedureSpec`→callable arm-ladder, pinned against the
 * OTHER derivation of the same axis: `SurfaceRpcsFor<S>` in `define.ts`, the
 * type-level image of the runtime `Rpc` walk the wire actually carries.
 *
 * Both derivations discriminate ONE axis — how a `ProcedureSpec`'s optional
 * `input`/`output` combine into the four callable arms ({input,output} / {input} /
 * {output} / neither). `SurfaceRpcsFor` maps each arm to an `Rpc` (payload /
 * success / error schemas, resolved through `ProcedureInputSchema` et al.);
 * `EffectProcedure` maps each arm to a hand-written client callable. They are
 * structurally unrelated types, so TS catches no drift on its own. Adding a fifth
 * arm, or changing input-optionality semantics, must move BOTH ladders in lockstep
 * — this file fails to compile if only one moves.
 *
 * (It absorbed `boundProcedure.test-d.ts` when the Promise ladder was deleted. The
 * pins below are the union of both files' — nothing that was checked against
 * `BoundProcedure` was dropped; each was re-anchored on the wire derivation, which
 * is what both ladders were ever really being compared to.)
 *
 * WHY these axes and not full mutual assignability: the two derivations
 * deliberately speak DIFFERENT SIDES of the payload schema. `Rpc`'s generated
 * client takes the make-in/`Type` side; the face takes the `Encoded` side and
 * decodes at its edge (PLAN D2, review #13). Pinning mutual assignability would pin
 * the very inversion the face exists to correct. What the two DO share are the
 * facts asserted below:
 *
 *  1. **Arm parity.** Per arm: whether an input is present at all, and the
 *     resolved SUCCESS type.
 *  2. **The ENCODED input side (D2/#13).** For a schema whose Encoded and Type
 *     sides DIVERGE (a decoding default; a transforming codec), the face's input
 *     must be the Encoded side — positively (the wire-shaped literal is accepted)
 *     and negatively (the Rpc client's own make-in side would have REJECTED it,
 *     which is the regression these assertions exist to catch).
 *  3. **Declared-error PRECISION.** The declared union rides a channel the compiler
 *     tracks. So: the declared half of `E` equals the wire `Rpc`'s error exactly,
 *     the framework half (`SurfaceCallFailure`) is always present so nobody can
 *     believe a `catchTag` sweep left nothing unhandled, and the two halves are
 *     DISJOINT — a declared error is never confusable with a transport death.
 *
 * `tsc --noEmit` green over this file IS the assertion; there is no runtime.
 */

import { Effect, Schema } from "effect";
import type { Rpc } from "effect/unstable/rpc";
import { expectTypeOf } from "vitest";
import type { SurfaceCallFailure } from "../client";
import { defineSurface, type SurfaceRpcsFor } from "../define";
import type { EffectProcedure, ProcedureEffect } from "./surfaceClient";

// A FIXED concrete spec touching all four arms. `defineSurface` runs its runtime
// `Rpc` walk over these; `SurfaceRpcsFor` is that walk's type-level image.
const fixture = defineSurface({
  procedures: {
    ns: {
      both: {
        input: Schema.Struct({ a: Schema.String }),
        output: Schema.Number,
      },
      inputOnly: { input: Schema.Struct({ b: Schema.String }) },
      outputOnly: { output: Schema.Boolean },
      neither: {},
    },
  },
});

type Procs = NonNullable<(typeof fixture.spec)["procedures"]>["ns"];
type Rpcs = SurfaceRpcsFor<typeof fixture.spec>;
type WireRpc<V extends string> = Rpc.ExtractTag<Rpcs, `surface/ns/${V}`>;

// ── Extractors ───────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-level extraction over any callable arm.
type AnyFn = (...args: any) => any;
type EffectOf<F extends AnyFn> = ReturnType<F>;
type SuccessOf<F extends AnyFn> = Effect.Success<EffectOf<F>>;
type ErrorOf<F extends AnyFn> = Effect.Error<EffectOf<F>>;
/** The half of the error channel the SPEC declared — the framework's own half
 *  subtracted back out. This is the operation a consumer performs mentally at a
 *  `catchTag`, made checkable. */
type DeclaredOf<F extends AnyFn> = Exclude<ErrorOf<F>, SurfaceCallFailure>;

// The Rpc derivation: an input-less procedure resolves `payload: Schema.Void`, so
// its decoded payload is `void`. `[void] extends [void]` distinguishes it (a real
// payload type is not `void`).
// biome-ignore lint/suspicious/noConfusingVoidType: matching the absent-payload `Schema.Void` marker structurally requires `void` here.
type WireHasInput<R> = [Rpc.Payload<R>] extends [void] ? false : true;
// The face: input-present arms have a REQUIRED first param of the encoded schema
// type; input-absent arms have `input?: undefined`, so the param widens to
// `undefined`. `[undefined] extends [void]` is true, so the same predicate shape
// keyed on `undefined` (the absent-input marker the face uses).
type FaceHasInput<F extends AnyFn> = [Parameters<F>[0]] extends [undefined]
  ? false
  : true;

// ── 1. Arm parity: input PRESENCE and SUCCESS type agree with the wire ────

expectTypeOf<FaceHasInput<EffectProcedure<Procs["both"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"both">>
>();
expectTypeOf<FaceHasInput<EffectProcedure<Procs["inputOnly"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"inputOnly">>
>();
expectTypeOf<
  FaceHasInput<EffectProcedure<Procs["outputOnly"]>>
>().toEqualTypeOf<WireHasInput<WireRpc<"outputOnly">>>();
expectTypeOf<FaceHasInput<EffectProcedure<Procs["neither"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"neither">>
>();

// …and resolves the SAME success type the wire `Rpc` does, per arm.
expectTypeOf<SuccessOf<EffectProcedure<Procs["both"]>>>().toEqualTypeOf<
  Rpc.Success<WireRpc<"both">>
>();
expectTypeOf<SuccessOf<EffectProcedure<Procs["inputOnly"]>>>().toEqualTypeOf<
  Rpc.Success<WireRpc<"inputOnly">>
>();
expectTypeOf<SuccessOf<EffectProcedure<Procs["outputOnly"]>>>().toEqualTypeOf<
  Rpc.Success<WireRpc<"outputOnly">>
>();
expectTypeOf<SuccessOf<EffectProcedure<Procs["neither"]>>>().toEqualTypeOf<
  Rpc.Success<WireRpc<"neither">>
>();

// An input-less arm is `(input?: undefined)` — a call site that passes nothing
// compiles, which is the runtime shape `mintUnary` produces for it.
expectTypeOf<EffectProcedure<Procs["neither"]>>().toBeCallableWith();
expectTypeOf<EffectProcedure<Procs["outputOnly"]>>().toBeCallableWith();

// ── 2. The input arm is the ENCODED side (D2 / #13) ──────────────────────

const divergent = defineSurface({
  procedures: {
    ns: {
      // Encoded `{ pid; signal? }` (signal defaulted) → Type `{ pid; signal }`.
      defaulted: {
        input: Schema.Struct({
          pid: Schema.Number,
          signal: Schema.Literals(["TERM", "KILL"]).pipe(
            Schema.withDecodingDefaultKey(Effect.succeed("TERM" as const)),
          ),
        }),
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      // Encoded `string` (raw) → Type `number` (parsed).
      transformed: {
        input: Schema.NumberFromString,
        output: Schema.Number,
      },
    },
  },
});
type Divergent = NonNullable<(typeof divergent.spec)["procedures"]>["ns"];

type DefaultedInput = Parameters<EffectProcedure<Divergent["defaulted"]>>[0];
// The wire ACCEPTS `{ pid }` (signal filled by the decoding default).
expectTypeOf<{ pid: 1 }>().toMatchTypeOf<DefaultedInput>();
// …and the NEGATIVE half: Effect RPC's own generated client types its payload on
// the make-in side, where the defaulted key is REQUIRED. If `EffectProcedure` ever
// drifted to that side the assertion above would fail — and this one records what
// it would have drifted TO, so the difference is stated, not merely relied on.
type DefaultedMakeIn = Rpc.PayloadConstructor<
  Rpc.ExtractTag<SurfaceRpcsFor<typeof divergent.spec>, "surface/ns/defaulted">
>;
expectTypeOf<{ pid: 1 }>().not.toMatchTypeOf<DefaultedMakeIn>();

// The RAW input is `string`; the parsed `number` is the SUCCESS, never the input.
expectTypeOf<
  Parameters<EffectProcedure<Divergent["transformed"]>>[0]
>().toEqualTypeOf<string>();
expectTypeOf<
  SuccessOf<EffectProcedure<Divergent["transformed"]>>
>().toEqualTypeOf<number>();

// ── 3. Declared-error channel precision ──────────────────────────────────

class Skew extends Schema.TaggedError<Skew>("test/Skew")("Skew", {
  daemonVersion: Schema.String,
  requiredVersion: Schema.String,
}) {}

const withErrors = defineSurface({
  procedures: {
    ns: {
      both: {
        input: Schema.Struct({ a: Schema.String }),
        output: Schema.Number,
        error: Skew,
      },
      inputOnly: { input: Schema.Struct({ b: Schema.String }), error: Skew },
      outputOnly: { output: Schema.Boolean, error: Skew },
      neither: { error: Skew },
    },
  },
});

type EProcs = NonNullable<(typeof withErrors.spec)["procedures"]>["ns"];
type ERpcs = SurfaceRpcsFor<typeof withErrors.spec>;
type EWireRpc<V extends string> = Rpc.ExtractTag<ERpcs, `surface/ns/${V}`>;

// The DECLARED half of the channel is exactly the wire `Rpc`'s error union — for
// every arm, not just the shape one caller happens to use.
expectTypeOf<DeclaredOf<EffectProcedure<EProcs["both"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"both">>
>();
expectTypeOf<DeclaredOf<EffectProcedure<EProcs["inputOnly"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"inputOnly">>
>();
expectTypeOf<DeclaredOf<EffectProcedure<EProcs["outputOnly"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"outputOnly">>
>();
expectTypeOf<DeclaredOf<EffectProcedure<EProcs["neither"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"neither">>
>();

// The declared class's DATA is reachable off the narrowed channel — the read a
// `catchTag("Skew", err => err.daemonVersion)` performs.
expectTypeOf<
  Extract<ErrorOf<EffectProcedure<EProcs["both"]>>, { _tag: "Skew" }>
>().toMatchTypeOf<{ daemonVersion: string; requiredVersion: string }>();

// The FRAMEWORK half is always present, on every arm and on an errors-LESS spec
// too. This is the assertion that stops the channel from quietly narrowing to the
// declared union: a consumer that `catchTag`ed its declared tags must still be
// told, by the compiler, that a transport death remains unhandled.
expectTypeOf<ErrorOf<EffectProcedure<EProcs["both"]>>>().toMatchTypeOf<
  Skew | SurfaceCallFailure
>();
expectTypeOf<SurfaceCallFailure>().toMatchTypeOf<
  ErrorOf<EffectProcedure<Procs["both"]>>
>();

// An errors-LESS spec declares NOTHING — so the declared half is `never` on both
// derivations, and the channel is the framework half alone.
expectTypeOf<
  DeclaredOf<EffectProcedure<Procs["both"]>>
>().toEqualTypeOf<never>();
expectTypeOf<DeclaredOf<EffectProcedure<Procs["both"]>>>().toEqualTypeOf<
  Rpc.Error<WireRpc<"both">>
>();
expectTypeOf<
  ErrorOf<EffectProcedure<Procs["both"]>>
>().toEqualTypeOf<SurfaceCallFailure>();

// The two halves are DISJOINT: subtracting the framework half leaves the declared
// union whole (nothing of `Skew` was absorbed), and subtracting the declared union
// leaves the framework half whole (no transport tag was mistaken for a declared
// one). Without both directions, a channel that had collapsed the two into one
// widened type could still pass the equalities above.
expectTypeOf<
  Exclude<ErrorOf<EffectProcedure<EProcs["both"]>>, SurfaceCallFailure>
>().toEqualTypeOf<Skew>();
expectTypeOf<
  Exclude<ErrorOf<EffectProcedure<EProcs["both"]>>, Skew>
>().toEqualTypeOf<SurfaceCallFailure>();

// `ProcedureEffect` is the shape those arms are built from — pinned directly so a
// change to the alias cannot silently re-shape every arm above.
expectTypeOf<ProcedureEffect<number, Skew>>().toEqualTypeOf<
  Effect.Effect<number, Skew | SurfaceCallFailure>
>();
