/**
 * TYPE-LEVEL drift-catch — `BoundProcedure<S>` (this package's hand-rolled
 * ProcedureSpec→callable arm-ladder) is pinned against the OTHER derivation of the
 * same axis: `SurfaceRpcsFor<S>` in `define.ts`, the type-level image of the
 * runtime `Rpc` walk the wire actually carries.
 *
 * Both derivations discriminate ONE axis — how a `ProcedureSpec`'s optional
 * `input`/`output` combine into the four callable arms ({input,output} / {input} /
 * {output} / neither). `SurfaceRpcsFor` maps each arm to an `Rpc` (payload /
 * success / error schemas, resolved through `ProcedureInputSchema` et al.);
 * `BoundProcedure` maps each arm to a hand-written client callable. They are
 * structurally unrelated types, so TS catches no drift on its own. Adding a fifth
 * arm, or changing input-optionality semantics, must move BOTH ladders in lockstep
 * — this file fails to compile if only one moves.
 *
 * WHY the two axes and not full mutual assignability: the two derivations
 * deliberately speak DIFFERENT SIDES of the payload schema. `Rpc`'s generated
 * client takes the make-in/`Type` side; the face takes the `Encoded` side and
 * decodes at its edge (PLAN D2, review #13). Pinning mutual assignability would
 * pin the very inversion the face exists to correct. What the two DO share are the
 * three facts below, asserted per arm: whether an input is present at all, the
 * resolved SUCCESS type, and the resolved declared-ERROR union.
 *
 * The last section is the #13 spec proper: for a schema whose Encoded and Type
 * sides DIVERGE (a decoding default; a transforming codec), the face's input must
 * be the Encoded side — positively (the wire-shaped literal is accepted) and
 * negatively (the Rpc client's own make-in side would have REJECTED it, which is
 * the regression this file exists to catch).
 *
 * The catch lives HERE, in the package that owns both derivations, for a FIXED
 * concrete spec exercising all four arms. `tsc --noEmit` green over this file IS
 * the assertion; there is no runtime.
 */

import { Effect, Schema } from "effect";
import type { Rpc } from "effect/unstable/rpc";
import { expectTypeOf } from "vitest";
import { defineSurface, type SurfaceRpcsFor } from "../define";
import type { BoundProcedure, ProcedureResult } from "./surfaceClient";

// Exact (invariant) equality is vitest's `expectTypeOf().toEqualTypeOf()` and
// assignability its `toMatchTypeOf()` — both tsc-native (they error under
// `tsc --noEmit`, so this file needs no vitest run).

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

// The `Rpc` the WIRE actually carries, per arm — extracted from the spec's own Rpc
// union by the tag `defineSurface` minted (`surface/<ns>/<verb>`). This is the
// derivation `BoundProcedure` must not drift from.
type Rpcs = SurfaceRpcsFor<typeof fixture.spec>;
type WireRpc<V extends string> = Rpc.ExtractTag<Rpcs, `surface/ns/${V}`>;

// ── The three shared facts, read off each derivation ─────────────────────

// The Rpc derivation: an input-less procedure resolves `payload: Schema.Void`, so
// its decoded payload is `void`. `[void] extends [void]` distinguishes it (a real
// payload type is not `void`).
// biome-ignore lint/suspicious/noConfusingVoidType: matching the absent-payload `Schema.Void` marker structurally requires `void` here.
type WireHasInput<R> = [Rpc.Payload<R>] extends [void] ? false : true;
// BoundProcedure: input-present arms have a REQUIRED first param of the encoded
// schema type; input-absent arms have `input?: undefined`, so the param widens to
// `undefined`. `[undefined] extends [void]` is true, so reuse the same predicate
// shape but keyed on `undefined` (the absent-input marker BoundProcedure uses).
// biome-ignore lint/suspicious/noExplicitAny: type-level predicate over any callable arm.
type BoundHasInput<F extends (...args: any) => any> = [
  Parameters<F>[0],
] extends [undefined]
  ? false
  : true;

// The declared-error union each derivation resolves. On the bound side it is the
// `ProcedureResult` phantom; on the wire side it is `Rpc.Error`.
// biome-ignore lint/suspicious/noExplicitAny: type-level extraction over any callable arm.
type BoundErrorOf<F extends (...args: any) => any> =
  ReturnType<F> extends ProcedureResult<unknown, infer E> ? E : never;

// ── Per-arm assertions: BoundProcedure agrees with the Rpc walk ──────────

expectTypeOf<Awaited<ReturnType<BoundProcedure<Procs["both"]>>>>().toEqualTypeOf<
  Rpc.Success<WireRpc<"both">>
>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["both"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"both">>
>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["inputOnly"]>>>
>().toEqualTypeOf<Rpc.Success<WireRpc<"inputOnly">>>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["inputOnly"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"inputOnly">>
>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["outputOnly"]>>>
>().toEqualTypeOf<Rpc.Success<WireRpc<"outputOnly">>>();
expectTypeOf<
  BoundHasInput<BoundProcedure<Procs["outputOnly"]>>
>().toEqualTypeOf<WireHasInput<WireRpc<"outputOnly">>>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["neither"]>>>
>().toEqualTypeOf<Rpc.Success<WireRpc<"neither">>>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["neither"]>>>().toEqualTypeOf<
  WireHasInput<WireRpc<"neither">>
>();

// ── Input arm = ENCODED side, result arm = DECODED side (D2 / #13) ───────
//
// A decoding default makes a key OPTIONAL on the wire but REQUIRED after decode; a
// transforming codec changes the type across the parse. The bound INPUT must be
// the accepted-on-the-wire shape (`Encoded`), and the bound RESULT the decoded
// shape (`Type`). Inferring the schema's decoded type for the input — which is
// what Effect RPC's own generated client does — would wrongly REQUIRE a defaulted
// key and demand the transformed type as input. These specs have DIVERGENT
// Encoded/Type sides, so they fail unless `BoundProcedure` splits the two
// directions.

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

type DefaultedInput = Parameters<BoundProcedure<Divergent["defaulted"]>>[0];
// The wire ACCEPTS `{ pid }` (signal filled by the default) — so it must be
// assignable to the bound input.
expectTypeOf<{ pid: 1 }>().toMatchTypeOf<DefaultedInput>();
// …and the NEGATIVE half, which is the actual #13 regression: Effect RPC's own
// generated client types its payload on the make-in side, where the defaulted key
// is REQUIRED. If `BoundProcedure` ever drifted to that side, the assertion above
// would fail — and this one records what it would have drifted TO, so the
// difference is stated, not merely relied upon.
type DefaultedMakeIn = Rpc.PayloadConstructor<
  Rpc.ExtractTag<
    SurfaceRpcsFor<typeof divergent.spec>,
    "surface/ns/defaulted"
  >
>;
expectTypeOf<{ pid: 1 }>().not.toMatchTypeOf<DefaultedMakeIn>();

type TransformedInput = Parameters<BoundProcedure<Divergent["transformed"]>>[0];
// The RAW input is `string`; the parsed `number` is the OUTPUT, which must NOT be
// what the callable accepts.
expectTypeOf<TransformedInput>().toEqualTypeOf<string>();
expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Divergent["transformed"]>>>
>().toEqualTypeOf<number>();

// ── The DECLARED-ERRORS axis (SK6 / D4) threads through BOTH ladders ─────
//
// `ProcedureSpec.error` must reach the wire `Rpc`'s error channel AND the
// hand-rolled `BoundProcedure` face (so a `client.procedures.*` rejection carries
// the same union a `safe(...)` call narrows) — for EVERY input/output arm, not
// just the shape one caller happens to use. The declared error's DATA survives to
// the narrowed tagged class.

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

// The declared error is present on BOTH derivations, for each arm, as the SAME
// tagged class — so a `_tag` narrowing at a call site reads the declared data.
expectTypeOf<BoundErrorOf<BoundProcedure<EProcs["both"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"both">>
>();
expectTypeOf<BoundErrorOf<BoundProcedure<EProcs["inputOnly"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"inputOnly">>
>();
expectTypeOf<BoundErrorOf<BoundProcedure<EProcs["outputOnly"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"outputOnly">>
>();
expectTypeOf<BoundErrorOf<BoundProcedure<EProcs["neither"]>>>().toEqualTypeOf<
  Rpc.Error<EWireRpc<"neither">>
>();

// The declared class's DATA is reachable off the narrowed union (the old
// `{ code, data }` read, restated on the tagged-error discriminant).
expectTypeOf<
  Extract<BoundErrorOf<BoundProcedure<EProcs["both"]>>, { _tag: "Skew" }>
>().toMatchTypeOf<{ daemonVersion: string; requiredVersion: string }>();

// An errors-LESS spec resolves `never` on BOTH derivations — the cross-derivation
// equality the rest of this file pins, applied to the new axis's absent case. A
// caller therefore reads the plain `Promise` face, unchanged.
expectTypeOf<BoundErrorOf<BoundProcedure<Procs["both"]>>>().toEqualTypeOf<
  Rpc.Error<WireRpc<"both">>
>();
expectTypeOf<BoundErrorOf<BoundProcedure<Procs["both"]>>>().toEqualTypeOf<never>();
