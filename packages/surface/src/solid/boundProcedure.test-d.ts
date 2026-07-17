/**
 * TYPE-LEVEL drift-catch (lens debate, lowy-2) — `BoundProcedure<S>` (this
 * package's hand-rolled ProcedureSpec→callable arm-ladder) is pinned against the
 * OTHER derivation of the same axis: `ProcedureContract<S>` in `define.ts`, walked
 * through the REAL contract → oRPC `ContractRouterClient` the wire actually uses.
 *
 * Both derivations discriminate ONE axis — how a `ProcedureSpec`'s optional
 * `input`/`output` combine into the four callable arms ({input,output} / {input} /
 * {output} / neither). `ProcedureContract` maps each arm to an oRPC contract
 * builder; `BoundProcedure` maps each arm to a hand-written client callable. They
 * are structurally unrelated types, so TS catches no drift on its own. Adding a
 * fifth arm, or changing input-optionality semantics, must move BOTH ladders in
 * lockstep — this file fails to compile if only one moves.
 *
 * WHY the two axes and not full mutual assignability: oRPC's own client callable
 * types its INPUT loosely (`input?: unknown` when a spec has input, `input?: void`
 * when it doesn't) and does NOT re-narrow it to the schema type — that looseness is
 * exactly why `BoundProcedure` is hand-rolled (to recover a typed `(input: I) =>`
 * face). So the two callables are deliberately NOT assignable in either direction;
 * pinning that would pin an accident, not the contract. What the wire callable DOES
 * carry, straight from `ProcedureContract`, are the two discrimination bits: whether
 * an input is present (`unknown` vs `void`) and the resolved output type
 * (`Promise<O>` vs `Promise<void>`). This file asserts `BoundProcedure`'s own
 * input-presence and output resolution agree with those, per arm.
 *
 * The catch lives HERE, in the package that owns both derivations, for a FIXED
 * concrete spec exercising all four arms (a single-procedure non-generic spec has
 * no generic explicit-supertype, so the TS2590 "union too complex" that forces the
 * hand-rolling in the first place does not fire). `tsc --noEmit` green over this
 * file IS the assertion; there is no runtime.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";
import type { BoundProcedure } from "./surfaceClient";

// Exact (invariant) equality is vitest's `expectTypeOf().toEqualTypeOf()` and
// assignability its `toMatchTypeOf()` — both tsc-native (they error under
// `tsc --noEmit`, so this file needs no vitest run), replacing a hand-rolled
// `Equals`/`Assert` pair.

// A FIXED concrete spec touching all four arms. `defineSurface` runs its
// `ProcedureContract` derivation over these to produce `fixture.contract`.
const fixture = defineSurface({
  procedures: {
    ns: {
      both: { input: z.object({ a: z.string() }), output: z.number() },
      inputOnly: { input: z.object({ b: z.string() }) },
      outputOnly: { output: z.boolean() },
      neither: {},
    },
  },
});

type Procs = NonNullable<(typeof fixture.spec)["procedures"]>["ns"];

// The client the WIRE actually hands back — `ProcedureContract<arm>` per arm,
// threaded through oRPC's `ContractRouterClient` exactly as `surfaceClient` types
// `.rpc`. `WireProcs[verb]` is the callable that derivation produces.
type WireProcs = ContractRouterClient<
  typeof fixture.contract,
  ClientRetryPluginContext
>["surface"]["ns"];

// ── The two discrimination bits, read off each derivation ────────────────

// oRPC's wire callable: input-present ⇒ first param `unknown`, input-absent ⇒
// `void`. `[void] extends [void]` distinguishes them (`unknown` is not `void`).
// biome-ignore lint/suspicious/noExplicitAny: type-level predicate over any callable arm.
type WireHasInput<F extends (...args: any) => any> =
  // biome-ignore lint/suspicious/noConfusingVoidType: matching oRPC's absent-input `input?: void` marker structurally requires `void` here.
  [Parameters<F>[0]] extends [void] ? false : true;
// BoundProcedure: input-present arms have a REQUIRED first param of the schema
// type; input-absent arms have `input?: undefined`, so the param widens to
// `undefined`. `[undefined] extends [void]` is true, so reuse the same predicate
// shape but keyed on `undefined` (the absent-input marker BoundProcedure uses).
// biome-ignore lint/suspicious/noExplicitAny: type-level predicate over any callable arm.
type BoundHasInput<F extends (...args: any) => any> = [
  Parameters<F>[0],
] extends [undefined]
  ? false
  : true;

// ── Per-arm assertions: BoundProcedure agrees with ProcedureContract ─────
// Each arm: the resolved OUTPUT (Awaited return) and the INPUT-presence bit agree
// between the two derivations.

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["both"]>>>
>().toEqualTypeOf<Awaited<ReturnType<WireProcs["both"]>>>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["both"]>>>().toEqualTypeOf<
  WireHasInput<WireProcs["both"]>
>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["inputOnly"]>>>
>().toEqualTypeOf<Awaited<ReturnType<WireProcs["inputOnly"]>>>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["inputOnly"]>>>().toEqualTypeOf<
  WireHasInput<WireProcs["inputOnly"]>
>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["outputOnly"]>>>
>().toEqualTypeOf<Awaited<ReturnType<WireProcs["outputOnly"]>>>();
expectTypeOf<
  BoundHasInput<BoundProcedure<Procs["outputOnly"]>>
>().toEqualTypeOf<WireHasInput<WireProcs["outputOnly"]>>();

expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Procs["neither"]>>>
>().toEqualTypeOf<Awaited<ReturnType<WireProcs["neither"]>>>();
expectTypeOf<BoundHasInput<BoundProcedure<Procs["neither"]>>>().toEqualTypeOf<
  WireHasInput<WireProcs["neither"]>
>();

// ── Input arm uses z.INPUT, result arm uses z.OUTPUT (not the parsed input) ─
//
// A `.default()` makes a key OPTIONAL on the wire but REQUIRED after parse; a
// `.transform()` changes the type across the parse. The bound INPUT must be the
// accepted-on-the-wire shape (`z.input`), and the bound RESULT the parsed shape
// (`z.output`). Inferring the ZodType's first generic param (its OUTPUT) for the
// input — the pre-fix bug — would wrongly REQUIRE a defaulted key / demand the
// transformed type as input. These specs have DIVERGENT input/output, so they fail
// unless `BoundProcedure` splits the two directions.
const divergent = defineSurface({
  procedures: {
    ns: {
      // input `{ pid; signal? }` (signal defaulted) → output `{ pid; signal }`.
      defaulted: {
        input: z.object({
          pid: z.number(),
          signal: z.enum(["TERM", "KILL"]).default("TERM"),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      // input `string` (raw) → output `number` (transformed length).
      transformed: {
        input: z.string().transform((s) => s.length),
        output: z.number(),
      },
    },
  },
});
type Divergent = NonNullable<(typeof divergent.spec)["procedures"]>["ns"];

type DefaultedInput = Parameters<BoundProcedure<Divergent["defaulted"]>>[0];
// The wire ACCEPTS `{ pid }` (signal filled by the default) — so it must be
// assignable to the bound input. With the output type it would be REQUIRED and
// this assignability would fail.
expectTypeOf<{ pid: 1 }>().toMatchTypeOf<DefaultedInput>();

type TransformedInput = Parameters<BoundProcedure<Divergent["transformed"]>>[0];
// The RAW input is `string`; the transformed `number` is the OUTPUT, which must
// NOT be what the callable accepts.
expectTypeOf<TransformedInput>().toEqualTypeOf<string>();
expectTypeOf<
  Awaited<ReturnType<BoundProcedure<Divergent["transformed"]>>>
>().toEqualTypeOf<number>();

// ── The DECLARED-ERRORS axis (SK6) threads through BOTH ladders, all four arms ─
//
// `ProcedureSpec.errors` must reach the wire callable's error phantom via
// `ProcedureContract` (so `safe()` narrows a raw `.rpc` call) AND the
// hand-rolled `BoundProcedure` face (so `client.procedures.*` rejections carry
// the same union) — for EVERY input/output arm, not just the shape one caller
// happens to use (the define.ts drift-watch: all four `buildProcedure*`
// oracles moved, this pins that none regresses). The declared code's DATA
// shape survives to the narrowed `ORPCError`.

const skewData = z.object({
  daemonVersion: z.string(),
  requiredVersion: z.string(),
});

const withErrors = defineSurface({
  procedures: {
    ns: {
      both: {
        input: z.object({ a: z.string() }),
        output: z.number(),
        errors: { E_BOTH: { data: skewData } },
      },
      inputOnly: {
        input: z.object({ b: z.string() }),
        errors: { E_IN: { data: skewData } },
      },
      outputOnly: {
        output: z.boolean(),
        errors: { E_OUT: { data: skewData } },
      },
      neither: { errors: { E_NONE: { data: skewData } } },
    },
  },
});

type EProcs = NonNullable<(typeof withErrors.spec)["procedures"]>["ns"];
type EWire = ContractRouterClient<
  typeof withErrors.contract,
  ClientRetryPluginContext
>["surface"]["ns"];

// Extract the error phantom off a callable's `ClientPromiseResult` return.
// biome-ignore lint/suspicious/noExplicitAny: type-level extraction over any callable arm.
type ErrOf<F extends (...args: any) => any> = NonNullable<
  ReturnType<F>["__error"]
>["type"];

// The declared code is present in the union with its declared data type, on
// BOTH derivations, for each arm.
type DataOf<E, Code extends string> =
  Extract<E, { code: Code }> extends {
    data: infer D;
  }
    ? D
    : never;

expectTypeOf<DataOf<ErrOf<EWire["both"]>, "E_BOTH">>().toEqualTypeOf<
  z.output<typeof skewData>
>();
expectTypeOf<
  DataOf<ErrOf<BoundProcedure<EProcs["both"]>>, "E_BOTH">
>().toEqualTypeOf<z.output<typeof skewData>>();

expectTypeOf<DataOf<ErrOf<EWire["inputOnly"]>, "E_IN">>().toEqualTypeOf<
  z.output<typeof skewData>
>();
expectTypeOf<
  DataOf<ErrOf<BoundProcedure<EProcs["inputOnly"]>>, "E_IN">
>().toEqualTypeOf<z.output<typeof skewData>>();

expectTypeOf<DataOf<ErrOf<EWire["outputOnly"]>, "E_OUT">>().toEqualTypeOf<
  z.output<typeof skewData>
>();
expectTypeOf<
  DataOf<ErrOf<BoundProcedure<EProcs["outputOnly"]>>, "E_OUT">
>().toEqualTypeOf<z.output<typeof skewData>>();

expectTypeOf<DataOf<ErrOf<EWire["neither"]>, "E_NONE">>().toEqualTypeOf<
  z.output<typeof skewData>
>();
expectTypeOf<
  DataOf<ErrOf<BoundProcedure<EProcs["neither"]>>, "E_NONE">
>().toEqualTypeOf<z.output<typeof skewData>>();

// An errors-LESS spec keeps the plain face — the SAME error phantom the wire
// derivation resolves for it (oRPC's default `ThrowableError`, no declared
// union): the cross-derivation equality the rest of this file pins, applied
// to the new axis's absent case.
expectTypeOf<ErrOf<BoundProcedure<Procs["both"]>>>().toEqualTypeOf<
  ErrOf<WireProcs["both"]>
>();
