/**
 * Framework-reserved server-identity preamble — the identity twin of the reserved
 * liveness probe (`./liveness`).
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface/system/identity`, that `implementSurface` auto-answers with the
 * server's own identity — stamped from a baked-build triple the server optionally
 * declares (`implementSurface(surface, deps, { identity })`). No app IMPLEMENTS it;
 * a server with a reader (padi) DECLARES its build, everyone else omits it and the
 * framework answers `anonymous`. It sits in the SAME reserved `system` namespace as
 * `live`, so reserving `identity` beside `live` can never clobber an app's `system.*`.
 *
 * Its purpose is to make "who are you" a UNIVERSAL question every serving process
 * answers — the identity axis a mirror/session reads to report a bound server's
 * uptime, contract version, and build. This generalizes what `@kolu/surface-app`'s
 * `identity.info` / `buildInfo` did per-app into one framework member.
 *
 * NO NULLS. Every "who is the far end" state is a named arm of ONE sum
 * ({@link SurfaceIdentity}); the reader is forced to branch, and impossible states
 * (identified-but-no-`startedAt` · `baked`-while-disconnected · a commit that might
 * be dev-might-be-real) can't be written.
 */

import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

/** The namespace + verb of the reserved identity procedure, single-sourced so the
 *  tag minting (`defineSurface`), the server auto-answer (`implementSurface`),
 *  and the client probe never drift. Shares the `system` namespace with `live`. */
export const IDENTITY_NAMESPACE = "system";
export const IDENTITY_VERB = "identity";

/** A build's source commit — a SUM, never `string | null`. `dev-vs-real` is
 *  explicit: a navigable commit to link to, or a dev tree with none. */
export const BuildCommitSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("commit"),
    sha: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({ kind: Schema.Literal("dev") }),
]);
export type BuildCommit = typeof BuildCommitSchema.Type;

/** The server-DECLARED build triple — always whole (a server either declares its
 *  build or is `anonymous`; there is no half-declared state). `buildId` is the
 *  content hash (convergence CURRENCY / staleKey); `commit` is the DISTINCT
 *  navigable-vs-dev axis, never merged with `buildId`. */
export const BakedIdentitySchema = Schema.Struct({
  contractVersion: Schema.String,
  buildId: Schema.String,
  commit: BuildCommitSchema,
});
export type BakedIdentity = typeof BakedIdentitySchema.Type;

/** What the server actually SERVES over `system/identity` — it is always live when
 *  it answers, so the `disconnected` arm never crosses the wire. Either it declared
 *  a build (`identified`) or it didn't (`anonymous`); both carry `startedAt`. */
export const ServedIdentitySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("anonymous"),
    startedAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("identified"),
    startedAt: Schema.Number,
    baked: BakedIdentitySchema,
  }),
]);
export type ServedIdentity = typeof ServedIdentitySchema.Type;

/**
 * The identity a surface carries, as seen by a consumer's `Session.identity()` —
 * ONE sum, NO null. Adds the client-only `disconnected` arm (there is no live link,
 * so nothing to identify) to what the server serves ({@link ServedIdentity}).
 *
 *   - `disconnected` — no live link (a session between dials). Not a wire value.
 *   - `anonymous`    — connected; the server declared no build (drishti/odu).
 *   - `identified`   — connected; the server declared its build (padi).
 */
export type SurfaceIdentity =
  | { readonly kind: "disconnected" }
  | ServedIdentity;

/** The reserved identity procedure's payload schema — empty in, encoded as `{}`
 *  exactly as the `oc.input(z.object({}))` shape it replaces. */
export const IdentityPayloadSchema = Schema.Struct({});

/** The reserved identity `Rpc`, minted at `tag` — empty in, {@link ServedIdentity}
 *  out. Both the runtime emitter and the type oracle {@link ReservedIdentityRpc}
 *  reads (see `./liveness` for why reserved members need no separate oracle). */
export function buildIdentityRpc<Tag extends string>(tag: Tag) {
  return Rpc.make(tag, {
    payload: IdentityPayloadSchema,
    success: ServedIdentitySchema,
  });
}

/** The reserved identity procedure's `Rpc` type under a surface's tag prefix.
 *  Unioned into every `SurfaceRpcsFor<S>` (beside {@link ReservedLivenessRpc}). */
export type ReservedIdentityRpc<Prefix extends string> = ReturnType<
  typeof buildIdentityRpc<`${Prefix}${typeof IDENTITY_NAMESPACE}/${typeof IDENTITY_VERB}`>
>;

/** A client (or its `.rpc`) that can be probed for identity — anything exposing the
 *  reserved `surface.system.identity` round-trip. `probeSurfaceIdentity` casts once
 *  internally so a session/mirror passes `client` with no boundary cast. */
export type SurfaceIdentityProbeable = {
  surface: Record<
    typeof IDENTITY_NAMESPACE,
    Record<
      typeof IDENTITY_VERB,
      (input: Record<string, never>) => Promise<ServedIdentity>
    >
  >;
};

/** The framework-reserved identity round-trip — the identity twin of
 *  `probeSurfaceLive`. Resolves with the server's served identity
 *  ({@link ServedIdentity}). Pass the thing that carries `.surface`.
 *
 *  STAGE 3 (client face): as with `probeSurfaceLive`, the nested Promise face this
 *  walks is what `surfaceClient` hand-builds from the spec (D2); the walk itself is
 *  transport-agnostic and unchanged by the Effect port. */
export function probeSurfaceIdentity(client: unknown): Promise<ServedIdentity> {
  return (client as SurfaceIdentityProbeable).surface[IDENTITY_NAMESPACE][
    IDENTITY_VERB
  ]({});
}

/** Map a baked commit string (a daemon's `<PREFIX>_COMMIT_HASH`, `""` off-nix / on a
 *  dirty tree) to the {@link BuildCommit} sum: a non-empty hash is a navigable
 *  `commit`, `""` is `dev`. The one place a baked `""` commit becomes the `dev` arm —
 *  so a server declaring its identity never has to spell the null-free mapping. */
export function buildCommit(commitHash: string): BuildCommit {
  return commitHash === ""
    ? { kind: "dev" }
    : { kind: "commit", sha: commitHash };
}

/** Wrap a server's optional declared build into the value the reserved
 *  `system/identity` serves: `identified` when it declared a build, else
 *  `anonymous` — both stamped with the server's `startedAt`. The one place the
 *  serve path turns a {@link BakedIdentity} into a {@link ServedIdentity}. */
export function serveIdentity(
  startedAt: number,
  baked: BakedIdentity | undefined,
): ServedIdentity {
  return baked === undefined
    ? { kind: "anonymous", startedAt }
    : { kind: "identified", startedAt, baked };
}
