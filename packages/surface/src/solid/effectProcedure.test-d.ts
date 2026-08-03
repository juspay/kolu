/**
 * TYPE-LEVEL drift-catch for the EFFECT procedure face — `EffectProcedure<S>`,
 * pinned against the SAME two derivations `boundProcedure.test-d.ts` pins its
 * Promise twin against.
 *
 * Three ladders now discriminate ONE axis (how a `ProcedureSpec`'s optional
 * `input`/`output` combine into four callable arms):
 *
 *   - `SurfaceRpcsFor<S>` (`define.ts`) — the type-level image of the runtime `Rpc`
 *     walk the WIRE carries;
 *   - `BoundProcedure<S>` — the Promise callable;
 *   - `EffectProcedure<S>` — the Effect callable, this file's subject.
 *
 * They are structurally unrelated types, so TS catches no drift on its own.
 * Adding a fifth arm, or changing input-optionality semantics, must move all
 * three in lockstep — this file fails to compile if `EffectProcedure` is left
 * behind. `tsc --noEmit` green over it IS the assertion; there is no runtime.
 *
 * WHAT IS PINNED, and why each is not obvious:
 *
 *  1. **Arm parity with `BoundProcedure`.** The Effect face must accept the very
 *     same arguments as the Promise face, or a consumer crossing from `await
 *     client.procedures.ns.verb(x)` to `client.effect.ns.verb(x)` would have to
 *     rewrite the call, and the Promise rows could not be a derived layer.
 *  2. **The ENCODED input side (D2/#13).** The face decodes at its edge, so the
 *     input arm speaks the wire's side, not the decoded one. Pinned positively
 *     (a wire-shaped literal is accepted) and negatively (Effect RPC's own
 *     generated client would have REJECTED it) — the regression the Promise
 *     file exists to catch, restated for the new ladder because a fresh mapped
 *     type is exactly where the inversion could creep back in.
 *  3. **Declared-error PRECISION.** The Effect face's whole gain over the Promise
 *     face is that the declared union rides a channel the compiler tracks rather
 *     than a phantom `safe()` has to recover. So: the declared half of `E`
 *     equals the wire `Rpc`'s error exactly, the framework half
 *     (`SurfaceCallFailure`) is always present so nobody can believe a
 *     `catchTag` sweep left nothing unhandled, and the two halves are DISJOINT —
 *     a declared error is never confusable with a transport death.
 */

import { Effect, Schema } from "effect";
import type { Rpc } from "effect/unstable/rpc";
import { expectTypeOf } from "vitest";
import type { SurfaceCallFailure } from "../client";
import { defineSurface, type SurfaceRpcsFor } from "../define";
import type {
  BoundProcedure,
  EffectProcedure,
  ProcedureEffect,
} from "./surfaceClient";

// A FIXED concrete spec touching all four arms — the same shape
// `boundProcedure.test-d.ts` uses, so the two files pin the same axis.
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

// ── 1. Arm parity: the Effect face takes what the Promise face takes ──────

expectTypeOf<Parameters<EffectProcedure<Procs["both"]>>>().toEqualTypeOf<
  Parameters<BoundProcedure<Procs["both"]>>
>();
expectTypeOf<Parameters<EffectProcedure<Procs["inputOnly"]>>>().toEqualTypeOf<
  Parameters<BoundProcedure<Procs["inputOnly"]>>
>();
expectTypeOf<Parameters<EffectProcedure<Procs["outputOnly"]>>>().toEqualTypeOf<
  Parameters<BoundProcedure<Procs["outputOnly"]>>
>();
expectTypeOf<Parameters<EffectProcedure<Procs["neither"]>>>().toEqualTypeOf<
  Parameters<BoundProcedure<Procs["neither"]>>
>();

// …and resolves the SAME success type as both other ladders, per arm. (`Awaited`
// on the Promise side, `Effect.Success` on this one — same value, two shapes.)
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
expectTypeOf<SuccessOf<EffectProcedure<Procs["both"]>>>().toEqualTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["both"]>>>
>();

// An input-less arm is `(input?: undefined)` on BOTH faces — so a call site that
// passes nothing keeps compiling across the crossing.
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

class Skew extends Schema.TaggedErrorClass<Skew>("test/Skew")("Skew", {
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

// …and it is the SAME union the Promise face carries as a phantom, so `safe()`'s
// narrowing and a `catchTag` on the Effect face agree by construction.
type BoundErrorOf<F extends AnyFn> =
  ReturnType<F> extends { readonly __error?: infer E } ? E : never;
expectTypeOf<DeclaredOf<EffectProcedure<EProcs["both"]>>>().toEqualTypeOf<
  BoundErrorOf<BoundProcedure<EProcs["both"]>>
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
