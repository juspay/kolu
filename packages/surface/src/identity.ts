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
 * uptime, contract version, build, and (the RESTART axis) the per-process id a
 * stale-tab handshake compares. This subsumes what `@kolu/surface-app`'s
 * `identity.info` / `buildInfo` did per-app into one framework member: an app that
 * needs to know "is this the same process that served my page?" reads it here,
 * rather than declaring a probe of its own. The gap that forced apps to declare
 * one — this member reporting a start TIME but not an id — is closed by
 * {@link surfaceProcessId}.
 *
 * NO NULLS. Every "who is the far end" state is a named arm of ONE sum
 * ({@link SurfaceIdentity}); the reader is forced to branch, and impossible states
 * (identified-but-no-`startedAt` · `baked`-while-disconnected · a commit that might
 * be dev-might-be-real) can't be written.
 */

import type { Effect } from "effect";
import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

/** The namespace + verb of the reserved identity procedure, single-sourced so the
 *  tag minting (`defineSurface`), the server auto-answer (`implementSurface`),
 *  and the client probe never drift. Shares the `system` namespace with `live`. */
export const IDENTITY_NAMESPACE = "system";
export const IDENTITY_VERB = "identity";

// The id minted for THIS process, on first read. Module-private and lazy: this
// module is isomorphic (a browser imports it for `probeSurfaceIdentity`), and
// `crypto.randomUUID` is unavailable in a browser off a secure context — a
// module-level mint would throw at IMPORT there, on a value only a server needs.
let processId: string | undefined;

/** This serving process's identity — the value `system/identity` reports and the
 *  ONE thing a stale-tab gate may compare a reconnecting client's claim against.
 *
 *  A nonce minted once per process, so "a different id" means "a different
 *  process" and nothing else. It is deliberately NOT `startedAt`: two processes
 *  can start in the same millisecond, and a timestamp read as an identity invites
 *  exactly the kind of near-miss a gate must never make.
 *
 *  There is no way to inject one. A consumer that could supply its own id could
 *  supply a DIFFERENT id to the gate than the one the wire reports — which is the
 *  stale-tab handshake comparing two unrelated strings and rejecting every
 *  reconnect (or none). A process has one identity; this is it, and anything that
 *  wants to stamp a log line with it reads it from here. */
export function surfaceProcessId(): string {
  processId ??= crypto.randomUUID();
  return processId;
}

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
 *  a build (`identified`) or it didn't (`anonymous`); both carry `startedAt` and
 *  `processId`.
 *
 *  `processId` is the RESTART axis and `startedAt` is the UPTIME axis — related but
 *  not interchangeable. A reader asking "am I still talking to the process that
 *  served this page?" compares `processId`; a reader rendering "up for 3h" reads
 *  `startedAt`. Serving both is what lets a stale-tab gate and an uptime readout
 *  share one member instead of an app growing a second `identity.info` beside it. */
export const ServedIdentitySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("anonymous"),
    startedAt: Schema.Number,
    processId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("identified"),
    startedAt: Schema.Number,
    processId: Schema.String,
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
      (input: Record<string, never>) => Effect.Effect<ServedIdentity, unknown>
    >
  >;
};

/** The framework-reserved identity round-trip — the identity twin of
 *  `probeSurfaceLive`. Resolves with the server's served identity
 *  ({@link ServedIdentity}). Pass the thing that carries `.surface`.
 *
 *  As with `probeSurfaceLive`, the value is the member call off the face — a lazy
 *  `Effect` the caller composes and bounds. */
export function probeSurfaceIdentity(
  client: unknown,
): Effect.Effect<ServedIdentity, unknown> {
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
 *  `anonymous` — both stamped with the server's `startedAt` and this process's
 *  {@link surfaceProcessId}. The one place the serve path turns a
 *  {@link BakedIdentity} into a {@link ServedIdentity}.
 *
 *  The process id is stamped HERE rather than taken as an argument, so the id a
 *  server ANSWERS with is the id `surfaceProcessId()` reports — the two cannot be
 *  made to disagree, which is what a stale-tab gate comparing against the latter
 *  depends on. */
export function serveIdentity(
  startedAt: number,
  baked: BakedIdentity | undefined,
): ServedIdentity {
  const processId = surfaceProcessId();
  return baked === undefined
    ? { kind: "anonymous", startedAt, processId }
    : { kind: "identified", startedAt, processId, baked };
}
