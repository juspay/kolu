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
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { expectTypeOf } from "vitest";
import { activePadiRpc, activePadiStreams, padiMap } from "./wire";

// A no-input / no-output declared procedure (`lifecycle.killAll: {}`) is a typed
// `() => Promise<void>` — NOT `unknown`. Assigning it to the concrete function type
// only compiles if `procedures` is declaration-typed.
const _killAll: () => Promise<void> = activePadiRpc.lifecycle.killAll;
void _killAll;

// A declared OUTPUT flows through: `screen.text` declares `output: z.string()`, so
// its bound return resolves EXACTLY `string`. Since SK6 the bound face returns
// oRPC's `ClientPromiseResult<out, err>` (a `Promise` plus a phantom error slot
// that types the DECLARED error union for `safe`/`isDefinedError`), so the pin
// asserts the awaited output invariantly rather than bare-`Promise` identity —
// `Promise<unknown>` would still fail it.
expectTypeOf<
  Awaited<ReturnType<typeof activePadiRpc.screen.text>>
>().toEqualTypeOf<string>();

// `padiMap.entry(host).procedures` (the fixed-host face `createViewState` reaches)
// is the SAME declaration-typed procedures.
const _perHostKillAll: () => Promise<void> =
  padiMap.entry(LOCAL_HOST).procedures.lifecycle.killAll;
void _perHostKillAll;

// NEGATIVE: `activePadiRpc` is the BOUND PROCEDURES face — it is NOT the raw oRPC
// client, so it carries no `.surface` escape a consumer could cast a procedure
// through. (Reserved procs + the link-root escape hatch live on `.rpc`, elsewhere.)
// @ts-expect-error — the procedures face has no `.surface`.
void activePadiRpc.surface;

// The deliberately UN-ENROLLED stream ref is a typed `StreamingProcedure`, not
// `unknown`: `unknown` is not assignable to a function type, so this only compiles
// because `.unenrolled` carries the declaration's stream shape.
const _attach: StreamingProcedure<{ id: string }, unknown> =
  activePadiStreams.terminalAttach.unenrolled;
void _attach;
