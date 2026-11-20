import {
  CONTROL_CORE_VERSION,
  PADI_SURFACE_VERSION,
  type padiControlSurface,
} from "@kolu/padi-client/surface";
import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import { controlCoreFragment } from "@kolu/surface-daemon";
import { Effect } from "effect";

type ControlCoreDeps = ImplementSurfaceDeps<typeof padiControlSurface.spec>;

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
      version: {
        store: inMemoryStore({ controlCoreVersion: CONTROL_CORE_VERSION }),
      },
    },
    procedures: {
      core: {
        ...fragment.procedures.core,
        controlVersion: () =>
          Effect.succeed({ controlCoreVersion: CONTROL_CORE_VERSION }),
        clockNow: () => Effect.sync(() => ({ epochMs: Date.now() })),
      },
    },
  };
}
