/**
 * TYPE-LEVEL pin (SRT-PR2) — the map entry's bound `procedures` face is
 * DECLARATION-TYPED, not `unknown`. This is the compile-time dual of the runtime
 * `procedureCastGuard.test.ts`: the guard proves kolu no longer CASTS a declared
 * procedure client; this proves it no longer NEEDS to, because `padiMap`'s entry
 * `procedures` (reached via `activePadiRpc` / `padiMap.entry`) carries the padi
 * declaration's types straight through.
 *
 * `tsc` GREEN over this file ⇒ every access below resolves against `padiSurface`'s
 * declared procedures. Were `entry.procedures` still `unknown` (the pre-PR2 raw
 * `.rpc`), `activePadiRpc.lifecycle` would be `unknown` and every line here would be
 * a compile error — so the file compiling IS the assertion.
 *
 * House style mirrors `kaval/canvasModeResolver.test-d.ts`: bare typed
 * declarations plus inline `// @ts-expect-error`; exact (invariant) output
 * equality uses vitest's `expectTypeOf().toEqualTypeOf()` (tsc-native — it errors
 * under `tsc --noEmit`, so it needs no vitest run).
 */

import type { StreamingProcedure } from "@kolu/surface/client";
import type { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { expectTypeOf } from "vitest";
import { activePadiRpc, activePadiStreams, padiMap } from "./wire";

/** The SUCCESS arm of a member call's effect. Named because every assertion
 *  below is about that arm alone: the error arm carries the member's declared
 *  union PLUS the framework's `SurfaceCallFailure`, which is the framework's
 *  business and is pinned in `@kolu/surface`'s own `effectProcedure.test-d.ts`. */
type SuccessOf<T> =
  T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;

// A no-input / no-output declared procedure (`lifecycle.killAll: {}`) is a typed
// nullary function returning an `Effect` — NOT `unknown`. Assigning it to a
// concrete function type only compiles if `procedures` is declaration-typed.
const _killAll: () => Effect.Effect<void, unknown> =
  activePadiRpc.lifecycle.killAll;
void _killAll;

// A declared OUTPUT flows through: `screen.text` declares `output: z.string()`, so
// the effect's SUCCESS arm resolves EXACTLY `string`. Asserted invariantly on that
// arm rather than on the whole `Effect`, because the error arm is a union the
// framework widens (the declared errors plus `SurfaceCallFailure`) and restating
// it here would just duplicate the framework's own pin — while
// `Effect<unknown, …>` would still fail this.
expectTypeOf<
  SuccessOf<ReturnType<typeof activePadiRpc.screen.text>>
>().toEqualTypeOf<string>();

// `padiMap.entry(host).procedures` (the fixed-host face `createViewState` reaches
// through `padiRpcOf`) is the SAME declaration-typed procedures.
const _perHostKillAll: () => Effect.Effect<void, unknown> =
  padiMap.entry(LOCAL_HOST).procedures.lifecycle.killAll;
void _perHostKillAll;

// NEGATIVE: a member call is a DESCRIPTION, not a settled value — an `Effect` is
// not a `Promise`, so a call site cannot `await` one into a result by accident.
// This is the pin that would have caught the whole Promise face surviving the
// rename.
// @ts-expect-error — an Effect is not assignable to a Promise.
const _notAPromise: () => Promise<void> = activePadiRpc.lifecycle.killAll;
void _notAPromise;

// NEGATIVE: `activePadiRpc` is the BOUND PROCEDURES face — it is NOT the raw
// member face, so it carries no `.surface` escape a consumer could cast a
// procedure through. (Reserved procs + the link-root escape hatch live on `.rpc`,
// elsewhere.)
// @ts-expect-error — the procedures face has no `.surface`.
void activePadiRpc.surface;

// The deliberately UN-ENROLLED stream ref is a typed `StreamingProcedure`, not
// `unknown`: `unknown` is not assignable to a function type, so this only compiles
// because `.unenrolled` carries the declaration's stream shape. A streaming row is
// unchanged by the Effect rename — it was already a lazy `Stream`.
const _attach: StreamingProcedure<{ id: string }, unknown> =
  activePadiStreams.terminalAttach.unenrolled;
void _attach;
