/**
 * The frozen identity fragment shared by every surface daemon.
 *
 * **This channel never versions — within a protocol epoch.** A supervisor must
 * be able to ask a resident daemon who it is, and drain it, *before* the
 * versioned application surface is known to be compatible. So the fragment's
 * payload stays deliberately small and immutable, and every reader may assume
 * the six fields below are exactly what a same-epoch daemon answers with.
 *
 * ## Why the doctrine is now epoch-scoped (PLAN D6, review finding #2)
 *
 * The original wording was unqualified — "this channel never versions" — and the
 * Effect-4 migration falsified it at the one layer the wording never mentioned:
 * the **framing**. This fragment used to ride oRPC's base64+newline peer
 * protocol; it now rides Effect RPC ndjson. That is a **declared flag day**, not
 * a negotiation: version negotiation happens *inside* the protocol being
 * replaced, so a daemon from the previous epoch cannot be asked anything at all
 * — its first frame is undecodable, which is the whole content of finding #2.
 * PLAN D6 therefore re-scopes the doctrine rather than pretending it held:
 *
 *   - **Across epochs** there is no handshake. A peer that cannot be decoded is
 *     observed as `unspeakable-protocol` at the transport's first frame (D6/#3,
 *     supervisor side), never as an incompatible *version*.
 *   - **Within this epoch** — from the Effect-4 flag day forward — the frozen
 *     contract holds again, exactly as it did before: same six fields, no
 *     additions, no removals, no renames.
 *
 * The epoch, not {@link CONTROL_CORE_VERSION}, is what moved; see that
 * constant's own note for why bumping it would have been inert.
 */

import { defineSurface } from "@kolu/surface/define";
import type { ImplementSurfaceDeps } from "@kolu/surface/server";
import { Effect, Schema } from "effect";

/** The frozen fragment's own wire version — the shape of the hello **payload**,
 *  within one protocol epoch.
 *
 *  It did NOT move across the Effect-4 flag day, deliberately. The value is read
 *  *off* this wire (`readControlCoreHello` compares it), so a peer from the
 *  previous epoch can never present it — bumping it would be inert across the
 *  only boundary a bump could possibly describe, which is finding #2's own
 *  diagnosis of why D6's version lever is the wrong tool here. And the payload
 *  itself is unchanged: the six fields encode byte-for-byte as they did under
 *  zod, pinned by the fixture in `controlCore.test.ts`. Bump this only when a
 *  FIELD changes, and then only within an epoch. */
export const CONTROL_CORE_VERSION = "1.0";

/** The version-agnostic daemon identity read before any versioned handshake. */
export const ControlCoreHelloSchema = Schema.Struct({
  stateRoot: Schema.String,
  surfaceVersion: Schema.String,
  controlCoreVersion: Schema.String,
  startedAt: Schema.Number,
  // Optional on the frozen wire so a supervisor can still identify a survivor
  // predating the identity pair. Readers enforce the joint fact: both absent,
  // both empty (off-nix), or both non-empty (baked).
  //
  // `optionalKey`, never `optional` (PLAN #17): the key is either PRESENT with a
  // string or ABSENT — an explicit `undefined` must not round-trip to `null`,
  // which is what `Schema.optional` would encode it as and what zod's
  // `.optional()` never did.
  commit: Schema.optionalKey(Schema.String),
  buildId: Schema.optionalKey(Schema.String),
});
/** Parsed identity payload returned by the frozen hello procedure. */
export type ControlCoreHello = typeof ControlCoreHelloSchema.Type;

/** The frozen procedure spec, exported so a daemon may add legacy siblings
 * beside it without re-declaring `hello` or `drain`. */
export const controlCoreProcedureSpec = {
  hello: { output: ControlCoreHelloSchema },
  drain: {},
} as const;

/** The standalone fragment contract used by new daemons and generic probes. */
export const controlCoreSurface = defineSurface({
  procedures: { core: controlCoreProcedureSpec },
});

/** Server dependencies that implement the complete frozen control fragment. */
export type ControlCoreFragment = ImplementSurfaceDeps<
  typeof controlCoreSurface.spec
>;

/**
 * Build the server implementation for the frozen `hello` + `drain` fragment.
 * The caller owns persistence and process shutdown; `drain` awaits that hook so
 * observing the daemon disappear can never race a final state write.
 */
export function controlCoreFragment(deps: {
  stateRoot: string;
  surfaceVersion: string;
  startedAt: number;
  commit: string;
  buildId: string;
  onDrain: () => void | Promise<void>;
}) {
  return {
    procedures: {
      core: {
        hello: () =>
          Effect.succeed({
            stateRoot: deps.stateRoot,
            surfaceVersion: deps.surfaceVersion,
            controlCoreVersion: CONTROL_CORE_VERSION,
            startedAt: deps.startedAt,
            commit: deps.commit,
            buildId: deps.buildId,
          }),
        // `Effect.promise`, not `Effect.tryPromise`: the procedure declares NO
        // error schema, so a rejecting drain hook is an UNDECLARED failure and
        // must stay a defect (PLAN D4) rather than masquerade as a member error
        // the supervisor could narrow on. A daemon whose drain hook throws is
        // broken, not busy.
        drain: () =>
          Effect.promise(async () => {
            await deps.onDrain();
          }),
      },
    },
  } satisfies ControlCoreFragment;
}
