/**
 * The frozen identity fragment shared by every surface daemon.
 *
 * This channel never versions: a supervisor must be able to ask a resident
 * daemon who it is, and drain it, before the versioned application surface is
 * known to be compatible. Keep this wire deliberately small and immutable.
 */

import { defineSurface } from "@kolu/surface/define";
import type { ImplementSurfaceDeps } from "@kolu/surface/server";
import { z } from "zod";

/** The frozen fragment's own wire version. Never bump this value. */
export const CONTROL_CORE_VERSION = "1.0";

/** The version-agnostic daemon identity read before any versioned handshake. */
export const ControlCoreHelloSchema = z.object({
  stateRoot: z.string(),
  surfaceVersion: z.string(),
  controlCoreVersion: z.string(),
  startedAt: z.number(),
  // Optional on the frozen wire so a supervisor can still identify a survivor
  // predating the identity pair. Readers enforce the joint fact: both absent,
  // both empty (off-nix), or both non-empty (baked).
  commit: z.string().optional(),
  buildId: z.string().optional(),
});
/** Parsed identity payload returned by the frozen hello procedure. */
export type ControlCoreHello = z.infer<typeof ControlCoreHelloSchema>;

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
        hello: () => ({
          stateRoot: deps.stateRoot,
          surfaceVersion: deps.surfaceVersion,
          controlCoreVersion: CONTROL_CORE_VERSION,
          startedAt: deps.startedAt,
          commit: deps.commit,
          buildId: deps.buildId,
        }),
        drain: async () => {
          await deps.onDrain();
        },
      },
    },
  } satisfies ControlCoreFragment;
}
