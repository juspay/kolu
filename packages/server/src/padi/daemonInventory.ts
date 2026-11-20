import type { KavalProbe, PadiDaemon } from "@kolu/padi/assembly";
import { enumerateHostDaemons } from "@kolu/padi/assembly";
import { Effect } from "effect";
import type { KavalDaemon } from "kaval";
import type {
  DaemonBinding,
  DaemonInventory,
  PadiConvergence,
} from "kolu-common/surface";

export type DaemonInventoryBinding =
  | { kind: "local" }
  | Omit<Extract<DaemonBinding, { kind: "remote" }>, "localScan">;

export interface DaemonInventoryDeps {
  discoverKavals: () => KavalDaemon[];
  discoverPadis: () => PadiDaemon[];
  probe: (socket: string) => Effect.Effect<KavalProbe, unknown>;
  binding: DaemonInventoryBinding;
  activePadiSurfaceVersion: () => string | null;
  activePadiBuildCommit: () => string | null;
  activePadiConvergence: () => PadiConvergence | null;
}

export function enumerateDaemonInventoryOnce(
  deps: DaemonInventoryDeps,
): Effect.Effect<DaemonInventory, unknown> {
  return Effect.gen(function* () {
    const binding: DaemonBinding =
      deps.binding.kind === "local"
        ? { kind: "local" }
        : {
            ...deps.binding,
            localScan: yield* enumerateHostDaemons({
              discoverKavals: deps.discoverKavals,
              discoverPadis: deps.discoverPadis,
              probe: deps.probe,
              activeKavalSocket: null,
              activeKavalAtLegacy: false,
              activePadiSocket: null,
            }),
          };
    const padiSurfaceVersion = deps.activePadiSurfaceVersion();
    const padiBuildCommit = deps.activePadiBuildCommit();
    const padiConvergence = deps.activePadiConvergence();
    return {
      binding,
      boundPadi:
        padiSurfaceVersion === null &&
        padiBuildCommit === null &&
        padiConvergence === null
          ? null
          : {
              surfaceVersion: padiSurfaceVersion,
              buildCommit: padiBuildCommit,
              convergence: padiConvergence,
            },
    };
  });
}

export const DAEMON_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;
