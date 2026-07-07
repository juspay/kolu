/**
 * Framework-reserved server-identity preamble — the identity twin of the reserved
 * liveness probe (`./liveness`).
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface.system.identity`, that `implementSurface` auto-answers with the
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

import { oc } from "@orpc/contract";
import { z } from "zod";

/** The namespace + verb of the reserved identity procedure, single-sourced so the
 *  contract injection (`defineSurface`), the server auto-answer (`implementSurface`),
 *  and the client probe never drift. Shares the `system` namespace with `live`. */
export const IDENTITY_NAMESPACE = "system";
export const IDENTITY_VERB = "identity";

/** A build's source commit — a SUM, never `string | null`. `dev-vs-real` is
 *  explicit: a navigable commit to link to, or a dev tree with none. */
export const BuildCommitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit"), sha: z.string().min(1) }),
  z.object({ kind: z.literal("dev") }),
]);
export type BuildCommit = z.infer<typeof BuildCommitSchema>;

/** The server-DECLARED build triple — always whole (a server either declares its
 *  build or is `anonymous`; there is no half-declared state). `buildId` is the
 *  content hash (convergence CURRENCY / staleKey); `commit` is the DISTINCT
 *  navigable-vs-dev axis, never merged with `buildId`. */
export const BakedIdentitySchema = z.object({
  contractVersion: z.string(),
  buildId: z.string(),
  commit: BuildCommitSchema,
});
export type BakedIdentity = z.infer<typeof BakedIdentitySchema>;

/** What the server actually SERVES over `system.identity` — it is always live when
 *  it answers, so the `disconnected` arm never crosses the wire. Either it declared
 *  a build (`identified`) or it didn't (`anonymous`); both carry `startedAt`. */
export const ServedIdentitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous"), startedAt: z.number() }),
  z.object({
    kind: z.literal("identified"),
    startedAt: z.number(),
    baked: BakedIdentitySchema,
  }),
]);
export type ServedIdentity = z.infer<typeof ServedIdentitySchema>;

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

/** The reserved identity procedure's contract descriptor — empty in,
 *  {@link ServedIdentity} out. */
export const identityContractEntry = () =>
  oc.input(z.object({})).output(ServedIdentitySchema);

/** The reserved identity procedure as it appears under a surface contract's
 *  `surface` namespace: `{ system: { identity } }`. Intersected into every
 *  `SurfaceContractFor<S>` (beside `ReservedLivenessContract`). */
export type ReservedIdentityContract = Record<
  typeof IDENTITY_NAMESPACE,
  Record<typeof IDENTITY_VERB, ReturnType<typeof identityContractEntry>>
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
 *  {@link probeSurfaceLive}. Resolves with the server's served identity
 *  ({@link ServedIdentity}). Pass the thing that carries `.surface`. */
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
 *  `system.identity` serves: `identified` when it declared a build, else
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
