/**
 * Type-level regression: a SPECIFIC-contract session must remain assignable to
 * the general `RemoteMirrorSession` / `pumpRemoteSurface` `session` receptacle.
 *
 * The consuming shape drishti compiles against: it holds a
 * `HostSession<its-own-contract>` (a specific contract whose reserved
 * `system.live` procedure takes `Record<string, never>`), and hands it to
 * `pumpRemoteSurface({ source, session, makeSink })` WITHOUT an explicit type
 * argument — so the pump's `C` is inferred. `C` appears in `RemoteMirrorSession`
 * only inside the mapped `AgentClient<C>` (a non-inferable position), so it
 * collapses to the constraint `AnyContractRouter`, and the compiler must then
 * assign `HostSession<Specific>` to `RemoteMirrorSession<AnyContractRouter>`.
 *
 * If `RemoteMirrorSession` narrows its yielded client to the specific per-contract
 * `AgentClient<C>`, that assignment fails on input contravariance (`unknown` not
 * assignable to `Record<string, never>`) — drishti's `router.ts` stops compiling
 * (kolu gauntlet `5725e8d01` did exactly this). Keeping the receptacle's client
 * at the loose `unknown` view keeps the role covariant in `C`, so a specific
 * session stays assignable. This file pins that so the regression cannot silently
 * recur inside kolu's own suite. No runtime; `tsc --noEmit` (part of `just check`)
 * is the check.
 */

import { defineSurface } from "@kolu/surface/define";
import type { AnyContractRouter } from "@orpc/contract";
import { z } from "zod";
import { pumpRemoteSurface } from "./hostFanout";
import type {
  AgentClient,
  HostSession,
  RemoteMirrorSession,
} from "./hostSession";

// A concrete, app-shaped surface: one cell, whose contract also carries the
// framework-reserved `system.live` proc (input `Record<string, never>`) — the
// exact member drishti's failure pointed at.
const specificSurface = defineSurface({
  cells: { status: { schema: z.string(), default: "" } },
});
type SpecificContract = typeof specificSurface.contract;

declare const specificSession: HostSession<SpecificContract>;

// (1) The precise regression, reduced: a specific-contract session assigned to
//     the general receptacle role the way inference resolves it at drishti's
//     un-annotated `pumpRemoteSurface` call (`C` → `AnyContractRouter`).
const generalRole: RemoteMirrorSession<AnyContractRouter> = specificSession;
void generalRole;

// (2) The same collapse via a bare generic consumer — a specific session must
//     satisfy `RemoteMirrorSession` when its `C` is left to the constraint (the
//     pump/cursor resolve `C` this way when it can't be inferred).
function consumesSession<C extends AnyContractRouter>(
  _session: RemoteMirrorSession<C>,
): void {}
consumesSession(specificSession);

// (3) drishti's ACTUAL call shape, verbatim: `pumpRemoteSurface` with an
//     un-annotated options object, `source` a specific surface and `session` its
//     `HostSession<Specific>`. `makeSink` is trivial (every `SurfaceSink` member
//     is optional). This is the end-to-end mirror of the failing consumer.
void pumpRemoteSurface({
  source: specificSurface,
  session: specificSession,
  makeSink: () => ({}),
});

// (4) A specifically-typed session/client stays usable at kolu's OWN sites, where
//     `C` is pinned to the real contract: the concrete `HostSession` still exposes
//     the precise `AgentClient<C>`, so the loosening is confined to the ROLE's
//     view and never dulls kolu's own typed usage.
const typedRole: RemoteMirrorSession<SpecificContract> = specificSession;
void typedRole;
const client: Promise<AgentClient<SpecificContract>> = specificSession.pin();
void client;
