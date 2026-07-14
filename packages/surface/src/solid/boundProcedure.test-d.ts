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
import { z } from "zod";
import { defineSurface } from "../define";
import type { BoundProcedure } from "./surfaceClient";

// Exact (invariant) type equality — a widen OR narrow on either side flips it.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<_T extends true> = never;

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

type _both = [
  // output axis
  Assert<
    Equals<
      Awaited<ReturnType<BoundProcedure<Procs["both"]>>>,
      Awaited<ReturnType<WireProcs["both"]>>
    >
  >,
  // input axis
  Assert<
    Equals<
      BoundHasInput<BoundProcedure<Procs["both"]>>,
      WireHasInput<WireProcs["both"]>
    >
  >,
];

type _inputOnly = [
  Assert<
    Equals<
      Awaited<ReturnType<BoundProcedure<Procs["inputOnly"]>>>,
      Awaited<ReturnType<WireProcs["inputOnly"]>>
    >
  >,
  Assert<
    Equals<
      BoundHasInput<BoundProcedure<Procs["inputOnly"]>>,
      WireHasInput<WireProcs["inputOnly"]>
    >
  >,
];

type _outputOnly = [
  Assert<
    Equals<
      Awaited<ReturnType<BoundProcedure<Procs["outputOnly"]>>>,
      Awaited<ReturnType<WireProcs["outputOnly"]>>
    >
  >,
  Assert<
    Equals<
      BoundHasInput<BoundProcedure<Procs["outputOnly"]>>,
      WireHasInput<WireProcs["outputOnly"]>
    >
  >,
];

type _neither = [
  Assert<
    Equals<
      Awaited<ReturnType<BoundProcedure<Procs["neither"]>>>,
      Awaited<ReturnType<WireProcs["neither"]>>
    >
  >,
  Assert<
    Equals<
      BoundHasInput<BoundProcedure<Procs["neither"]>>,
      WireHasInput<WireProcs["neither"]>
    >
  >,
];

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
// this would be `false`.
type _defaultedAcceptsPidOnly = Assert<
  { pid: 1 } extends DefaultedInput ? true : false
>;

type TransformedInput = Parameters<BoundProcedure<Divergent["transformed"]>>[0];
// The RAW input is `string`; the transformed `number` is the OUTPUT, which must
// NOT be what the callable accepts.
type _transformedInputIsRaw = Assert<Equals<TransformedInput, string>>;
type _transformedResult = Assert<
  Equals<Awaited<ReturnType<BoundProcedure<Divergent["transformed"]>>>, number>
>;

// Reference the assertion tuples so they are not unused.
export type _BoundProcedureContractDriftCatch = [
  _both,
  _inputOnly,
  _outputOnly,
  _neither,
  _defaultedAcceptsPidOnly,
  _transformedInputIsRaw,
  _transformedResult,
];
