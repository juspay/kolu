import type { SurfaceHandlers } from "@kolu/surface/server";
import { Context, Effect } from "effect";
import { koluRootGroup } from "kolu-common/contract";
import type {
  HostRef,
  ServerBackupsList,
  ServerBackupsRestore,
  ServerBackupsRestoreResult,
  ViewerHost,
} from "kolu-common/contract";
import type { HostKey } from "kolu-common/hostKey";
import { serverHostname } from "./hostname.ts";
import { log } from "./log.ts";
import type { ViewerConnection } from "./portForward/resolveViewerHost.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import type { ServedFragment } from "./surface.ts";

export class CurrentViewer extends Context.Service<
  CurrentViewer,
  {
    /** The direct TCP peer of this connection, or `undefined` when the adapter
     *  cannot tell. Never a guess — an absent address answers `null`. */
    readonly viewerAddress: string | undefined;
    /** This connection's `x-forwarded-for` header, or `undefined` when unproxied.
     *  `undefined` and `""` are different facts downstream, so the mount must not
     *  flatten them. */
    readonly forwardedFor: string | undefined;
  }
>()("kolu-server/CurrentViewer") {}

export interface BuildAppRouterDeps {
  drainBoundPadi: () => Effect.Effect<void, unknown>;
  /** Add a padi host to the warm pool at runtime (the strip's "+ add host"). Re-adding
   *  an existing member rejects loudly (`host already exists`), never a silent no-op
   *  (surfaced to the strip as a rejected call — see the `hosts/add` handler below). */
  addHost: (host: HostKey) => Promise<void>;
  /** Remove a guest host from the pool (its map subs end typed, its session is
   *  destroyed). Throws `UnremovableHostError` for the unremovable default. */
  removeHost: (host: HostKey) => Promise<void>;
  reconnectHost: (host: HostKey) => void;
  renewHostDaemon: (host: HostKey) => Effect.Effect<void, unknown>;
  viewerHost: (connection: ViewerConnection) => Promise<HostKey | null>;
  listStateBackups: () => ServerBackupsList;
  /** Restore one ring snapshot in-process (validate → cell writes → pool
   *  convergence) — `stateBackups.ts`'s restore with the boot's seams bound.
   *  Answers the hosts that would not converge; every anomaly that happens
   *  before anything is applied still throws. */
  restoreStateBackup: (
    input: ServerBackupsRestore,
  ) => Promise<ServerBackupsRestoreResult>;
}

export function buildAppRouter(deps: BuildAppRouterDeps): ServedFragment {
  const handlers = {
    "server/info": () =>
      Effect.sync(() => ({ identity: pwaIdentityForHostname(serverHostname) })),
    "server/backups/list": () => Effect.sync(() => deps.listStateBackups()),
    "server/backups/restore": (input: ServerBackupsRestore) =>
      Effect.promise(async () => {
        log.info({ file: input.file }, "server state restore requested");
        return await deps.restoreStateBackup(input);
      }),
    "daemon/restart": () =>
      Effect.gen(function* () {
        log.info({}, "padi restart requested — draining the bound padi");
        yield* deps.drainBoundPadi();
      }),
    "hosts/viewer": () =>
      CurrentViewer.use((viewer) =>
        Effect.promise(
          async (): Promise<ViewerHost> => ({
            host: await deps.viewerHost({
              peerAddress: viewer.viewerAddress,
              forwardedFor: viewer.forwardedFor,
            }),
          }),
        ),
      ),
    "hosts/add": (input: HostRef) =>
      Effect.promise(async () => {
        log.info({ host: input.host }, "host add requested");
        await deps.addHost(input.host);
      }),
    "hosts/remove": (input: HostRef) =>
      Effect.promise(async () => {
        log.info({ host: input.host }, "host remove requested");
        await deps.removeHost(input.host);
      }),
    "hosts/reconnect": (input: HostRef) =>
      Effect.sync(() => {
        log.info({ host: input.host }, "host reconnect requested");
        deps.reconnectHost(input.host);
      }),
    "hosts/renewDaemon": (input: HostRef) =>
      Effect.gen(function* () {
        log.info(
          { host: input.host },
          "host daemon renew requested — draining that host's padi to re-realise the current closure",
        );
        yield* deps.renewHostDaemon(input.host);
      }),
  };

  return {
    group: koluRootGroup,
    handlers: handlers as unknown as SurfaceHandlers,
  };
}
