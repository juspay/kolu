/**
 * Kaval's complete daemon wire: the versioned pty-host surface at its historic
 * flat paths, plus the frozen control core under the sibling `control` key.
 *
 * The pty-host half MUST stay flat (`surface.system.version`,
 * `surface.terminal.*`, ...): existing padi and kaval-tui clients consume those
 * paths. The additive control sibling lands at `surface.control.core.*`, which
 * is the stable path `probeDaemonIdentity` dials at any pty-host version skew.
 */

import { oc } from "@orpc/contract";
import { implement, ORPCError, type Router } from "@orpc/server";
import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import {
  implementSurface,
  superviseTerminalSource,
} from "@kolu/surface/server";
import type { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

/** The additive daemon contract. Its pty-host subtree is byte-for-byte the
 * existing contract; only the `control` sibling is new. */
export const kavalDaemonContract = oc.router({
  ...ptyHostSurface.contract,
  surface: {
    ...ptyHostSurface.contract.surface,
    control: controlCoreSurface.contract.surface,
  },
});

type PtyHostRuntime = ReturnType<typeof createInProcessPtyHost>;
export type KavalDaemonRouter = Router<
  typeof kavalDaemonContract,
  Record<never, never>
>;

/** Assemble the final kaval router without re-finalizing either child surface. */
export function serveKavalDaemonSurface(opts: {
  ptyHost: PtyHostRuntime;
  stateRoot: string;
  commit: string;
  buildId: string;
}): {
  router: KavalDaemonRouter;
  done: Promise<void>;
  close(): Promise<void>;
} {
  const control = implementSurface(
    controlCoreSurface,
    controlCoreFragment({
      stateRoot: opts.stateRoot,
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      startedAt: opts.ptyHost.startedAt,
      commit: opts.commit,
      buildId: opts.buildId,
      // The frozen schema requires a drain verb, but kaval cannot drain: ending
      // the process destroys its live PTYs. Refuse as a typed application error;
      // the not-drainable convergence policy makes this unreachable in normal
      // supervision, while a direct caller receives an honest loud answer.
      onDrain: () => {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "kaval is not drainable; restart it explicitly",
        });
      },
    }),
  );

  // Re-adapt the two already-finalized routers against the additive contract's
  // matcher. Spreading the old pty namespaces preserves every historic path;
  // nesting only the control router gives the generic probe its sibling path.
  // biome-ignore lint/suspicious/noExplicitAny: oRPC's implement chain is dynamic; the contract pins the served matcher shape.
  const t = implement(kavalDaemonContract as any) as any;
  const ptyNamespaces = (opts.ptyHost.router as { surface: object }).surface;
  const controlNamespaces = (control.router as { surface: object }).surface;
  const router = t.router({
    surface: { ...ptyNamespaces, control: controlNamespaces },
  }) as KavalDaemonRouter;

  // The pty-host runtime owns the terminal resources and is therefore the
  // terminal source: close it first, then release the passive control runtime.
  const supervised = superviseTerminalSource(control, opts.ptyHost);
  return { router, ...supervised };
}
