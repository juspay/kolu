import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import {
  composeSurfaceContracts,
  mergeDisjointGroups,
  type Surface,
} from "@kolu/surface/define";
import {
  implementSurface,
  superviseTerminalSource,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import type { Rpc, RpcGroup } from "effect/rpc";
import type { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

/** The frozen control fragment as kaval serves it: a SIBLING under the `control`
 *  key, so its members are tagged `surface/control/core/{hello,drain}`. Exported
 *  because a client of the daemon builds its control face from this exact
 *  surface value — the same one the handlers were bound against — rather than
 *  re-deriving the prefix from a string. */
export const kavalControlSurface: Surface<typeof controlCoreSurface.spec> =
  composeSurfaceContracts({ control: controlCoreSurface }).siblings.control;

/** Kaval's complete daemon wire, as ONE flat group. Byte-for-byte the pty-host
 *  tags plus the control sibling's — nothing renamed, nothing re-prefixed. */
export const kavalDaemonGroup: RpcGroup.RpcGroup<Rpc.Any> = mergeDisjointGroups(
  { ptyHost: ptyHostSurface.group, control: kavalControlSurface.group },
);

type PtyHostRuntime = ReturnType<typeof createInProcessPtyHost>;

/** The assembled daemon: one group, one handler record, one supervision pair. */
export interface KavalDaemonSurface {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
  readonly done: Promise<void>;
  close(): Promise<void>;
}

function mergeHandlersDisjoint(
  ...records: readonly SurfaceHandlers[]
): SurfaceHandlers {
  const merged: SurfaceHandlers = Object.create(null);
  for (const record of records) {
    for (const [tag, handler] of Object.entries(record)) {
      if (tag in merged) {
        throw new Error(
          `serveKavalDaemonSurface: two handlers bound at wire tag "${tag}" — ` +
            "the pty-host surface and the control sibling must stay disjoint.",
        );
      }
      merged[tag] = handler;
    }
  }
  return merged;
}

/** Assemble the final kaval daemon wire without re-implementing either half. */
export function serveKavalDaemonSurface(opts: {
  ptyHost: PtyHostRuntime;
  stateRoot: string;
}): KavalDaemonSurface {
  const control = implementSurface(
    kavalControlSurface,
    controlCoreFragment({
      stateRoot: opts.stateRoot,
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      startedAt: opts.ptyHost.boot.startedAt,
      commit: opts.ptyHost.boot.identity.navigableCommit,
      buildId: opts.ptyHost.boot.identity.staleKey,
      onDrain: () => {
        throw new Error("kaval is not drainable; restart it explicitly");
      },
    }),
  );

  const supervised = superviseTerminalSource(control, opts.ptyHost);
  return {
    group: kavalDaemonGroup,
    handlers: mergeHandlersDisjoint(
      opts.ptyHost.served.handlers,
      control.handlers,
    ),
    ...supervised,
  };
}
