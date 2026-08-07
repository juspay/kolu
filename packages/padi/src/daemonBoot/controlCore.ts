/**
 * Serving the frozen control core (`padiControlSurface`) — hello · version ·
 * drain · clock.now. Defined as pure schema shapes in W1.C; this is where W2.2
 * serves them for real, beside `padiSurface` on padi's socket.
 *
 * The control core is the version-agnostic side channel: a binder dials the
 * socket, reads `control.hello` FIRST (always compatible — the schemas never
 * move), learns which `padiSurface` version this padi serves, and decides
 * upgrade-me (binder older → refuse) vs drain-you (binder newer → `control.drain`
 * persists + exits so the binder can spawn the newer closure). Because it never
 * versions, the one call you need at a version mismatch is always reachable.
 */

import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import { controlCoreFragment } from "@kolu/surface-daemon";
import { Effect } from "effect";
import {
  CONTROL_CORE_VERSION,
  PADI_SURFACE_VERSION,
  type padiControlSurface,
} from "../surface.ts";

type ControlCoreDeps = ImplementSurfaceDeps<typeof padiControlSurface.spec>;

/** Assemble the control-core server deps. `stateRoot` is padi's identity (echoed
 *  by `hello`); `startedAt` is padi's boot time (ms epoch), stamped once at daemon
 *  init and echoed by `hello` so the binder reports honest uptime; `commit` is padi's
 *  navigable git commit (`PADI_COMMIT_HASH`), echoed by `hello` so the binder surfaces
 *  the RUNNING padi's build (the Padi dialog's "build commit"); `buildId` is padi's
 *  staleKey (`PADI_BUILD_ID`), echoed by `hello` so a binder can converge on a
 *  same-contract build change (#1670 — drain-on-build-mismatch); `onDrain` persists
 *  padi's state and triggers a graceful exit — the PTYs survive in kaval, and the
 *  caller observes the socket close. */
export function buildControlCoreDeps(deps: {
  stateRoot: string;
  startedAt: number;
  commit: string;
  buildId: string;
  onDrain: () => void | Promise<void>;
}): ControlCoreDeps {
  const fragment = controlCoreFragment({
    ...deps,
    surfaceVersion: PADI_SURFACE_VERSION,
  });
  return {
    cells: {
      // The frozen control-core version — a read-only build constant.
      version: {
        store: inMemoryStore({ controlCoreVersion: CONTROL_CORE_VERSION }),
      },
    },
    procedures: {
      core: {
        ...fragment.procedures.core,
        // Effect-returning (S2): a procedure handler's ONE arm is
        // `({input, ctx}) => Effect`. Both of these are pure reads of a build
        // constant / the clock, so `Effect.succeed` / `Effect.sync` is the whole
        // body — the clock one must be `sync` so each call reads `Date.now()`
        // afresh rather than freezing the value at deps-build time.
        controlVersion: () =>
          Effect.succeed({ controlCoreVersion: CONTROL_CORE_VERSION }),
        clockNow: () => Effect.sync(() => ({ epochMs: Date.now() })),
      },
    },
  };
}
