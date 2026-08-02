/**
 * Framework-reserved liveness probe.
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface/system/live`, that `implementSurface` auto-answers with a trivial
 * `{}` — no app declares it, no app implements it. Its sole purpose is to be a
 * CONTRACT-AGNOSTIC round-trip a client-side liveness watchdog can call to tell
 * a live link from a silently half-open one, WITHOUT each app nominating its own
 * probe procedure.
 *
 * That per-app probe is exactly the wiring an app forgets: a half-open socket
 * (laptop sleep, Wi-Fi roam, a NAT/proxy evicting an idle connection) fires
 * neither `close` nor `error`, so without a probe the link sits `OPEN` forever
 * and every stream hangs. `@kolu/surface-app`'s `createHeartbeat` (browser leg)
 * and `@kolu/surface-remote`'s HostSession watchdog (ssh leg) both default
 * their probe to `probeSurfaceLive` below, so the watchdog is on by construction
 * and there is no probe for an app to leave unwired.
 *
 * `system/live` is the framework twin of an app's own liveness verb (e.g.
 * kaval's `system.heartbeat`): they coexist in the `system` namespace because
 * `defineSurface`'s `claim` merges namespaces and rejects only a duplicate VERB,
 * so reserving `live` can never silently clobber an app's `system.*` — and an
 * app that *did* declare `system.live` gets a loud boot-time collision, which is
 * the correct behaviour for a reserved verb.
 */

import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

/** The namespace + verb of the reserved liveness procedure, single-sourced so
 *  the tag minting (`defineSurface`), the server auto-answer
 *  (`implementSurface`), and the client probe never drift. */
export const LIVENESS_NAMESPACE = "system";
export const LIVENESS_VERB = "live";

/** The reserved procedure's payload / success schemas — empty in, empty out (the
 *  resolution itself is the liveness signal; the value is ignored, and even a
 *  rejection counts as alive because the round-trip completed). Encoded as `{}`
 *  in both directions, byte-identical to the `oc.input(z.object({}))` shape this
 *  replaces. */
export const LivenessPayloadSchema = Schema.Struct({});
export const LivenessSuccessSchema = Schema.Struct({});

/** The reserved liveness `Rpc`, minted at `tag`. This function is BOTH the
 *  runtime emitter `defineSurface` calls and the type oracle
 *  {@link ReservedLivenessRpc} reads — reserved members have a statically known
 *  verb, so unlike the per-verb cell/collection oracles there is nothing to keep
 *  in step by hand. */
export function buildLivenessRpc<Tag extends string>(tag: Tag) {
  return Rpc.make(tag, {
    payload: LivenessPayloadSchema,
    success: LivenessSuccessSchema,
  });
}

/** The reserved liveness procedure's `Rpc` type under a surface's tag prefix
 *  (`"surface/"`, or `"surface/<sibling>/"` for a composed sibling). Unioned into
 *  every `SurfaceRpcsFor<S>` so `SurfaceTags<S>` carries `surface/system/live`. */
export type ReservedLivenessRpc<Prefix extends string> = ReturnType<
  typeof buildLivenessRpc<`${Prefix}${typeof LIVENESS_NAMESPACE}/${typeof LIVENESS_VERB}`>
>;

/** A client (or its `.rpc`) that can be probed for liveness — anything exposing
 *  the reserved `surface.system.live` round-trip on the typed nested face. Every
 *  surface client has it (the member is on every surface), but a watchdog generic
 *  over an arbitrary surface can't always prove that statically, so
 *  `probeSurfaceLive` accepts this structural shape and casts once internally. */
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
 *  Pass the thing that carries `.surface` — a raw agent client or a
 *  `surfaceClient`'s `.rpc`.
 *
 *  Accepts `unknown` and concentrates the single structural cast to
 *  {@link SurfaceLiveProbeable} HERE, so callers pass `client.rpc` / `client` with
 *  NO cast at the boundary instead of each hand-pinning the assertion.
 *
 *  STAGE 3 (client face): the Promise-returning nested face this walks is the
 *  face `surfaceClient` hand-builds from the spec (D2). The walk itself is
 *  transport-agnostic and unchanged by the Effect port — what Stage 3 supplies is
 *  the face, not a different probe. */
export function probeSurfaceLive(client: unknown): Promise<unknown> {
  return (client as SurfaceLiveProbeable).surface[LIVENESS_NAMESPACE][
    LIVENESS_VERB
  ]({});
}
