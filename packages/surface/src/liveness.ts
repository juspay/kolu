/**
 * Framework-reserved liveness probe.
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface.system.live`, that `implementSurface` auto-answers with a trivial
 * `{}` — no app declares it, no app implements it. Its sole purpose is to be a
 * CONTRACT-AGNOSTIC round-trip a client-side liveness watchdog can call to tell
 * a live link from a silently half-open one, WITHOUT each app nominating its own
 * probe procedure.
 *
 * That per-app probe is exactly the wiring an app forgets: a half-open socket
 * (laptop sleep, Wi-Fi roam, a NAT/proxy evicting an idle connection) fires
 * neither `close` nor `error`, so without a probe the link sits `OPEN` forever
 * and every stream hangs. `@kolu/surface-app`'s `createHeartbeat` (browser leg)
 * and `@kolu/surface-nix-host`'s HostSession watchdog (ssh leg) both default
 * their probe to `probeSurfaceLive` below, so the watchdog is on by construction
 * and there is no probe for an app to leave unwired.
 *
 * `system.live` is the framework twin of an app's own liveness verb (e.g.
 * kaval's `system.heartbeat`): they coexist in the `system` namespace because
 * `defineSurface`'s `claim` merges namespaces and rejects only a duplicate VERB,
 * so reserving `live` can never silently clobber an app's `system.*` — and an
 * app that *did* declare `system.live` gets a loud boot-time collision, which is
 * the correct behaviour for a reserved verb.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

/** The namespace + verb of the reserved liveness procedure, single-sourced so
 *  the contract injection (`defineSurface`), the server auto-answer
 *  (`implementSurface`), and the client probe never drift. */
export const LIVENESS_NAMESPACE = "system";
export const LIVENESS_VERB = "live";

/** The reserved procedure's contract descriptor — empty in, empty out (the
 *  resolution itself is the liveness signal; the value is ignored, and even a
 *  rejection counts as alive because the round-trip completed). Built from the
 *  SAME `oc.input().output()` the runtime injects, so the `.contract` type and
 *  the served handler stay in lockstep. */
export const livenessContractEntry = () =>
  oc.input(z.object({})).output(z.object({}));

/** The reserved liveness procedure as it appears under a surface contract's
 *  `surface` namespace: `{ system: { live } }`. Intersected into every
 *  `SurfaceContractFor<S>` so `client.rpc.surface.system.live({})` is typed. */
export type ReservedLivenessContract = Record<
  typeof LIVENESS_NAMESPACE,
  Record<typeof LIVENESS_VERB, ReturnType<typeof livenessContractEntry>>
>;

/** A client (or its `.rpc`) that can be probed for liveness — anything exposing
 *  the reserved `surface.system.live` round-trip. Every surface client has it
 *  (the proc is on every contract), but a watchdog generic over an arbitrary
 *  contract can't always prove that statically, so `probeSurfaceLive` accepts
 *  this structural shape and call sites cast to it where the static type is
 *  opaque. */
export type SurfaceLiveProbeable = {
  surface: Record<
    typeof LIVENESS_NAMESPACE,
    Record<
      typeof LIVENESS_VERB,
      (input: Record<string, never>) => Promise<unknown>
    >
  >;
};

/** The framework-reserved liveness round-trip. Resolution proves the link is
 *  alive; the value is discarded. This is the default probe for both liveness
 *  watchdogs (browser ws + ssh stdio), so neither needs an app-supplied probe.
 *  Pass the thing that carries `.surface` — a raw `ContractRouterClient` (an ssh
 *  agent client) or a `surfaceClient`'s `.rpc`.
 *
 *  Accepts `unknown` and concentrates the single structural cast to
 *  {@link SurfaceLiveProbeable} HERE — the same receptacle pattern `surfaceAppProbe`
 *  uses for the `identity.info` probe. Every real surface client DOES carry
 *  `surface.system.live` statically (the reserved proc is intersected into every
 *  `SurfaceContractFor<S>`), but a watchdog generic over an arbitrary contract,
 *  or a `.rpc` typed `unknown` (the dynamic combined link), can't always prove it
 *  to the compiler. Taking `unknown` and casting once internally means callers
 *  pass `client.rpc` / `client` with NO cast at the boundary, instead of each
 *  hand-pinning `as unknown as SurfaceLiveProbeable`. */
export function probeSurfaceLive(client: unknown): Promise<unknown> {
  return (client as SurfaceLiveProbeable).surface[LIVENESS_NAMESPACE][
    LIVENESS_VERB
  ]({});
}
