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
  return {
    cells: {
      // The frozen control-core version — a read-only build constant.
      version: {
        store: inMemoryStore({ controlCoreVersion: CONTROL_CORE_VERSION }),
      },
    },
    procedures: {
      core: {
        hello: () => ({
          stateRoot: deps.stateRoot,
          surfaceVersion: PADI_SURFACE_VERSION,
          controlCoreVersion: CONTROL_CORE_VERSION,
          startedAt: deps.startedAt,
          commit: deps.commit,
          buildId: deps.buildId,
        }),
        controlVersion: () => ({ controlCoreVersion: CONTROL_CORE_VERSION }),
        // Persist + exit. Await the caller's drain (a final session flush) BEFORE
        // returning, so the socket close the binder observes truly follows the
        // save — not a race where the process dies mid-write.
        drain: async () => {
          await deps.onDrain();
        },
        clockNow: () => ({ epochMs: Date.now() }),
      },
    },
  };
}
