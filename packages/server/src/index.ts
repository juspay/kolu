import {
  artifactSdkBundleLayer,
  type SdkScriptPath,
  withArtifactSdk,
} from "@kolu/artifact-sdk/server";
import { startHeapDiagnostics } from "@kolu/heap-diag";
import {
  discoverPadiDaemons,
  probeKavalStatus,
  publisherSize,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  DEFAULT_PADI_PROCESS_MEMORY,
  PADI_FORWARDING_POLICY,
  type PadiProcessMemory,
  padiSurface,
} from "@kolu/padi-client/surface";
import { agentDistroSettingEqual } from "@kolu/agent-distro/schema";
import { siblingTagPrefix } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import { surfaceClientRef } from "@kolu/surface/project";
import { parseAllowedOrigins } from "@kolu/surface/ws-origin";
import { type SurfaceAppEvent, serveSurfaceApp } from "@kolu/surface-app/serve";
import type { ManifestOptions } from "@kolu/surface-app/server";
import {
  buildRemotePool,
  type RemotePool,
  type ReServedSurface,
  reServeSurface,
  serveHostMap,
} from "@kolu/surface-remote";
import {
  projectConnection,
  sessionConnection,
} from "@kolu/surface-remote/connection";
import { Cause, Effect, Layer, Option, Scope, Stream } from "effect";
import { HttpRouter } from "effect/http";
import { discoverKavalDaemons, legacyKavalSocketPath } from "kaval";
import { agentDiagnostics } from "kolu-agents";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { PwaIdentity } from "kolu-common/contract";
import {
  type HostKey,
  LOCAL_HOST,
  type PadiEntryFailure,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import { type FleetWorks, serveKoluFleetMcp } from "kolu-mcp";
import {
  driverOf,
  hostOf,
  modeOf,
  onGreenOf,
  policyOf,
  standing,
} from "kolu-work";
import { dirname } from "node:path";
import type { KoluBootFlags } from "./bootFlags.ts";
import { koluOfferOver } from "./conductor/koluOffer.ts";
import { fleetHostsOver } from "./fleet/fleetHosts.ts";
import { startFleetMcpEndpoint } from "./fleet/mcpEndpoint.ts";
import {
  disposeServerConductor,
  liveServerConductor,
  setConductorFleetHosts,
  setConductorOffer,
  setFleetMcpEndpoint,
  setWatchScopeListener,
  setWorksListener,
} from "./conductor/live.ts";
import {
  type ConductorWatcher,
  startConductorWatcher,
} from "./conductor/watcher.ts";
import { healthRouteLayer } from "./healthRoute.ts";
import { serverHostname, serverProcessId, serverVersion } from "./hostname.ts";
import { getPersistedHosts, savePoolMembership } from "./hostPersistence.ts";
import { koluHttpMiddleware } from "./httpMiddleware.ts";
import {
  PREVIEW_ROUTE_PATTERN,
  previewRouteHandler,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { enumerateDaemonInventoryOnce } from "./padi/daemonInventory.ts";
import { readAgentDistroListing } from "./agentDistroListing.ts";
import { readAgentDistroDeliveryBake } from "./agentDelivery/bake.ts";
import {
  type AgentDeliveryHandle,
  installAgentDelivery,
} from "./agentDelivery/install.ts";
import { withAttachTelemetry } from "./padi/attachTelemetry.ts";
import { entryDispatch } from "./padi/entryDispatch.ts";
import { installNewTerminalPolicyPusher } from "./padi/newTerminalPolicy.ts";
import { installPadiCellPusher } from "./padi/padiCellPusher.ts";
import {
  ensurePadiBinding,
  handlePadiBootFailure,
} from "./padi/padiBinding.ts";
import { mapConnectionToPadiLink } from "./padi/padiLink.ts";
import { type PadiSession, padiFailureOf } from "./padi/padiSession.ts";
import {
  assertRemovableHost,
  ensureRemotePadiBinding,
  parseKoluPadiHostSeed,
} from "./padi/remotePadiBinding.ts";
import { pruneToMembers } from "./padi/reServeEviction.ts";
import {
  claimLocalSupervisor,
  supervisorConflictError,
} from "./padi/supervisorClaim.ts";
import { padiMemoryReadable } from "./padiMemoryGate.ts";
import { createKoluForwards } from "./portForward/forwards.ts";
import { makeHostPortsReader } from "./portForward/hostPorts.ts";
import { makeViewerHostResolver } from "./portForward/resolveViewerHost.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { buildAppRouter, CurrentViewer } from "./router.ts";
import { stateBackupRing, store } from "./state.ts";
import {
  listServerStateBackups,
  restoreServerStateBackup,
} from "./stateBackups.ts";
import {
  assembleServedHandlers,
  currentAgentDistroSetting,
  currentNewTerminalPolicy,
  implementKoluSurface,
  servedGroup,
} from "./surface.ts";
import { resolveTlsOptions } from "./tls.ts";
import {
  WORK_FILE_ROUTE_PATTERN,
  workFileRouteHandler,
} from "./workFilesRoute.ts";

let booted = false;

type PollRead<A> = () => Promise<A>;

function installProcessLifecycleHandlers(deps: {
  shutdown: () => Promise<void>;
}): void {
  let shuttingDown = false;
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info({ signal: sig }, "shutting down");
      void (async () => {
        await deps.shutdown();
        process.exit(0);
      })();
    });
  }
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.fatal(
      { reason },
      "unhandled rejection — a background task is missing its error boundary",
    );
    process.exit(1);
  });
}

function fleetWorksOver(worksReaders: Set<() => void>): FleetWorks {
  return {
    rows: () => {
      const stored = liveServerConductor().works();
      const detail = liveServerConductor().membersDetail();
      return {
        works: stored
          .filter(([, work]) => work.state.kind === "open")
          .map(([id, work]) => ({
            id,
            title: work.title,
            key: work.key,
            host: hostOf(work),
            mode: modeOf(work),
            onGreen: onGreenOf(work),
            standing: standing(work, policyOf(work)),
            members: detail
              .filter((one) => one.work === id)
              .map((one) => ({
                ref: one.ref,
                role: one.role,
                name: one.name === "" ? null : one.name,
                agent: one.agent,
                joined: one.joined,
                driver: driverOf(work, one.ref, Option.some(one)),
              })),
            openQuestions: work.decisions
              .filter((one) => one.kind === "asked")
              .map((one) => one.question),
          })),
        finished: stored.flatMap(([id, work]) =>
          work.state.kind === "ended"
            ? [
                {
                  id,
                  title: work.title,
                  outcome: work.state.outcome,
                  endedAt: work.state.at,
                },
              ]
            : [],
        ),
      };
    },
    subscribe: (cb) => {
      worksReaders.add(cb);
      return () => {
        worksReaders.delete(cb);
      };
    },
    open: async (intent) => {
      const { work, setup, ask, asked, created, reopened } =
        await liveServerConductor().openWork(intent);
      return { work, setup, ask, asked, created, reopened };
    },
    startOf: (work, role) => liveServerConductor().startOf(work, role),
    stop: (work) => {
      liveServerConductor().stopWork(work, "conductor");
    },
    ask: (work, questions) =>
      liveServerConductor().askAboutWork(work, questions),
    join: (ref, work, role, joined) => {
      liveServerConductor().joinWork(work, ref, role, joined);
    },
    leave: (ref) => liveServerConductor().leaveWork(ref),
    note: (work, text) => {
      liveServerConductor().note(work, text);
    },
    said: (ref) => {
      liveServerConductor().saidTo(ref);
    },
    closed: (ref) => {
      liveServerConductor().closedTerminal(ref);
    },
    check: (work) => {
      const found = liveServerConductor()
        .works()
        .find(([id]) => id === work)?.[1];
      if (found === undefined) return Option.some("unknown-work");
      return found.state.kind === "ended"
        ? Option.some("work-ended")
        : Option.none();
    },
  };
}

const PWA_BACKGROUND_COLOR = "#0c0c0e";

function koluManifest(pwaIdentity: PwaIdentity): ManifestOptions {
  return {
    name: pwaIdentity.name,
    description:
      "Real terminals on an infinite canvas — run any coding agent, pin it as an app, reach it from anywhere.",
    launch_handler: { client_mode: "focus-existing" },
    themeColor: pwaIdentity.themeColor,
    backgroundColor: PWA_BACKGROUND_COLOR,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

function appRoutesLayer(deps: {
  pool: RemotePool<PadiSession, undefined>;
  sdkScriptPath: SdkScriptPath;
  workFileStateRoot: string;
}) {
  return Layer.mergeAll(
    healthRouteLayer,

    artifactSdkBundleLayer({ sdkScriptPath: deps.sdkScriptPath }),

    HttpRouter.add(
      "GET",
      PREVIEW_ROUTE_PATTERN,
      withArtifactSdk(deps.sdkScriptPath)(
        previewRouteHandler({ pool: deps.pool, log }),
      ),
    ),

    HttpRouter.add(
      "GET",
      WORK_FILE_ROUTE_PATTERN,
      withArtifactSdk(deps.sdkScriptPath)(
        workFileRouteHandler({ stateRoot: deps.workFileStateRoot }),
      ),
    ),
  );
}

function serveEventLogger(
  pool: RemotePool<PadiSession, undefined>,
): (event: SurfaceAppEvent) => void {
  let liveConnections = 0;
  return (event) => {
    switch (event._tag) {
      case "Connected":
        log.info(
          { ws: event.connection.id, total: ++liveConnections },
          "connected",
        );
        for (const h of pool.hosts()) pool.getSession(h)?.nudge();
        return;
      case "Disconnected":
        log.info(
          {
            ws: event.connection.id,
            code: event.code,
            ...(event.reason && { reason: event.reason }),
            remaining: --liveConnections,
          },
          "disconnected",
        );
        return;
      case "SocketError":
        log.error({ err: event.error }, "ws error");
        return;
      case "GenerationRefused":
        log.error({ err: event.error }, "ws live generation refused");
        return;
      case "StaleTab":
        log.info(
          { claimedPid: event.claimedPid, serverProcessId },
          "rejecting stale client — server restarted since it last connected",
        );
        return;
      case "DisallowedOrigin":
        log.warn(
          { origin: event.origin },
          "rejecting ws upgrade: disallowed Origin",
        );
        return;
      case "ServingFailed":
        log.error(
          { err: event.cause, ws: event.connection.id },
          "ws rpc serving stack faulted",
        );
        return;
    }
  };
}

/** Boot the kolu web server: the `kolu` binary's `web` arm (`packages/kolu-cli`)
 *  calls this, at most once per process — a second call throws. The returned
 *  promise resolves once the boot sequence has run and the HTTP listener is
 *  accepting; the server's live handles keep the process up from there. */
export async function bootKoluWeb(flags: KoluBootFlags): Promise<void> {
  if (booted) throw new Error("bootKoluWeb called twice in one process");
  booted = true;

  const allowedOrigins = parseAllowedOrigins(process.env.KOLU_ALLOWED_ORIGINS);

  if (flags.verbose) {
    log.level = "debug";
  }

  stateBackupRing.startTicker();

  let releaseLocalSupervisor: (() => void) | null = null;
  let conductorWatcher: ConductorWatcher | undefined;

  installProcessLifecycleHandlers({
    shutdown: async () => {
      await conductorWatcher?.dispose();
      await disposeServerConductor();
      releaseLocalSupervisor?.();
    },
  });

  const seed = parseKoluPadiHostSeed();
  const defaultHost = seed[0] ?? LOCAL_HOST;

  const persistedAtBoot = getPersistedHosts();
  const envSeedKeys = seed.map(encodeHostKey);
  const initialHostKeys = [...new Set([...envSeedKeys, ...persistedAtBoot])];
  const persistedAtBootSet = new Set(persistedAtBoot);
  const declarativeSeedKeys = new Set(
    envSeedKeys.filter((k) => !persistedAtBootSet.has(k)),
  );

  const localSupervisorStateRoot = resolvePadiStateRoot();
  const supervisorClaim = claimLocalSupervisor(localSupervisorStateRoot);
  if (supervisorClaim.kind !== "self") {
    const err = supervisorConflictError(
      supervisorClaim,
      localSupervisorStateRoot,
    );
    log.fatal({ err }, err.message);
    process.exit(1);
  }
  releaseLocalSupervisor = supervisorClaim.release;

  const pool = buildRemotePool<PadiSession, undefined>({
    initialHosts: initialHostKeys,
    persist: (hosts) => savePoolMembership(hosts, declarativeSeedKeys),
    buildEntry: (h) => {
      const key = decodeHostKey(h);
      return {
        session:
          key.kind === "local"
            ? ensurePadiBinding({
                nixShellWhitelist: flags.allowNixShellWithEnvWhitelist,
                legacyKavalSocket: legacyKavalSocketPath(flags.port),
                spawnVersion: serverVersion,
                verbose: flags.verbose,
                onFatalBindingError: (err) =>
                  handlePadiBootFailure(err, { log, exit: process.exit }),
              })
            : ensureRemotePadiBinding({
                host: key.target,
                spawnVersion: serverVersion,
              }),
        handler: undefined,
      };
    },
  });

  pool
    .getSession(encodeHostKey(LOCAL_HOST))
    ?.pin()
    .catch((err: unknown) =>
      handlePadiBootFailure(err, { log, exit: process.exit }),
    );

  const padiSession = ((): PadiSession => {
    const s = pool.getSession(encodeHostKey(defaultHost));
    if (s === undefined)
      throw new Error(
        `boot invariant violated: default host "${encodeHostKey(defaultHost)}" was seeded but has no pool session`,
      );
    return s;
  })();

  const reServes = new Map<string, ReServedSurface<typeof padiSurface.spec>>();
  const reServeFor = (
    h: HostKey,
    s: PadiSession,
  ): ReServedSurface<typeof padiSurface.spec> => {
    const enc = encodeHostKey(h);
    let r = reServes.get(enc);
    if (r === undefined) {
      r = reServeSurface<typeof padiSurface.spec>({
        source: padiSurface,
        policy: PADI_FORWARDING_POLICY,
        session: s,
        log: (line) => log.debug({ line, host: enc }, "padi re-serve"),
        onFault: (fault) =>
          log.error(
            {
              err: fault.err,
              host: enc,
              member: fault.label,
              scope: fault.scope,
            },
            fault.scope === "key"
              ? "padi projection: a collection key stopped being mirrored (key-local; the host mirror is still live)"
              : "padi projection: a mirrored member's upstream stream died — the mirror is dead",
          ),
      });
      reServes.set(enc, r);
      s.pin().catch((err: unknown) =>
        log.debug(
          { err, host: enc },
          "padi session pin failed while warming a mirror — the host map carries the failure",
        ),
      );
      r.done
        .then(() =>
          log.info(
            { host: enc },
            "padi re-serve ended cleanly (link closed or supervision stopped)",
          ),
        )
        .catch((err) => {
          if (enc === encodeHostKey(defaultHost)) {
            log.fatal(
              { err, host: enc },
              "default padi re-serve pump died — binding is unrecoverable",
            );
            process.exit(1);
          }
          log.error(
            { err, host: enc },
            "guest padi re-serve pump died — retiring the host",
          );
          void pool.retire(enc);
        });
    }
    return r;
  };

  pool.subscribe(() =>
    pruneToMembers(
      reServes,
      (h) => pool.has(h),
      (r) => void r.close(),
    ),
  );

  const siblingTagPrefixes = Object.keys(padiHostMap.siblings).map(
    siblingTagPrefix,
  );

  const localReServe = reServeFor(LOCAL_HOST, padiSession);
  const reServedPadiClient = surfaceClientRef(
    localReServe.surface,
    localReServe,
  );

  const padiMap = serveHostMap(padiHostMap, pool, {
    dispatchFor: (h, s) =>
      entryDispatch({
        siblingTagPrefixes,
        mirror: withAttachTelemetry(
          directDispatch({ handlers: reServeFor(h, s).handlers }),
          { host: encodeHostKey(h), log },
        ),
        link: () => s.currentDispatch?.(),
        host: encodeHostKey(h),
      }),
    failureOf: (_host, session, state): PadiEntryFailure | null =>
      padiFailureOf(session.provisions, session.entryFailedDetail(), state),
    connection: {
      project: sessionConnection,
      isConnected: (c) => c.phase === "connected",
    },
  });

  const fleetHosts = fleetHostsOver({
    pool,
    padiMap,
    localName: serverHostname,
  });
  setConductorFleetHosts(() => fleetHosts);
  const worksReaders = new Set<() => void>();
  const works = fleetWorksOver(worksReaders);
  const fleetMcp = await startFleetMcpEndpoint({
    log,
    serve: (transport) =>
      serveKoluFleetMcp({
        hosts: fleetHosts,
        transport,
        serverInfo: { name: "kolu-fleet", version: serverVersion },
        works,
      }),
  });
  setFleetMcpEndpoint(() => ({ url: fleetMcp.url, token: fleetMcp.token }));

  const PADI_MEMORY_READ_FAILED: PadiProcessMemory = {
    padi: { status: "error" },
    kaval: { status: "error" },
  };

  function readPadiMemoryOnce(): Effect.Effect<PadiProcessMemory> {
    if (!padiMemoryReadable(padiSession))
      return Effect.succeed(DEFAULT_PADI_PROCESS_MEMORY);
    return Effect.gen(function* () {
      const frame = yield* Stream.runHead(
        reServedPadiClient.surface.processMemory.get(undefined),
      );
      if (Option.isNone(frame)) {
        log.error({}, "padi memory read yielded no frame through the mirror");
        return PADI_MEMORY_READ_FAILED;
      }
      return frame.value;
    }).pipe(
      Effect.catchCause((cause) => {
        log.error(
          { err: Cause.squash(cause) },
          "padi memory read failed through the mirror",
        );
        return Effect.succeed(PADI_MEMORY_READ_FAILED);
      }),
    );
  }

  const padiStartedAt = (): number | null => {
    const id = padiSession.identity();
    return id.kind === "disconnected" ? null : id.startedAt;
  };
  const padiSurfaceVersion = (): string | null => {
    const id = padiSession.identity();
    return id.kind === "identified" ? id.baked.contractVersion : null;
  };
  const padiBuildCommit = (): string | null => {
    const id = padiSession.identity();
    return id.kind === "identified" && id.baked.commit.kind === "commit"
      ? id.baked.commit.sha
      : null;
  };

  const readDaemonInventoryEffect = () =>
    enumerateDaemonInventoryOnce({
      discoverKavals: discoverKavalDaemons,
      discoverPadis: discoverPadiDaemons,
      probe: probeKavalStatus,
      activePadiSurfaceVersion: () => padiSurfaceVersion(),
      activePadiBuildCommit: () => padiBuildCommit(),
      activePadiConvergence: () => padiSession.convergence(),
      binding: { kind: "local" },
    });

  const pollRead =
    <A>(program: () => Effect.Effect<A, unknown>): PollRead<A> =>
    () =>
      Effect.runPromise(program());

  const readHostPorts = makeHostPortsReader({
    log,
    listenersOf: (host) => {
      const session = pool.getSession(encodeHostKey(host));
      if (session === undefined) return null;
      const served = reServeFor(host, session);
      return surfaceClientRef(served.surface, served).surface.hostListeners.get(
        undefined,
      );
    },
  });

  const forwards = createKoluForwards({
    readHostPorts,
    hostIsMember: (host) => pool.has(encodeHostKey(host)),
    log,
  });

  pool.subscribe(() => {
    for (const host of forwards.heldHosts()) {
      if (!pool.has(encodeHostKey(host))) void forwards.hostDeparted(host);
    }
  });

  const viewerHost = makeViewerHostResolver({ hosts: () => pool.hosts() });

  const newTerminalPolicyPusher = installNewTerminalPolicyPusher({
    pool,
    resolvePolicyNow: currentNewTerminalPolicy,
    log,
  });
  const agentDistroListing = readAgentDistroListing();
  setConductorOffer(
    koluOfferOver({ listing: agentDistroListing, hosts: fleetHosts }),
  );
  const deliveryBake = readAgentDistroDeliveryBake();
  let installedAgentDelivery: AgentDeliveryHandle | undefined;
  const agentDistroPusher = installPadiCellPusher({
    cell: "agentDistro",
    pool,
    getValue: currentAgentDistroSetting,
    equals: agentDistroSettingEqual,
    onPushed: (host) => installedAgentDelivery?.deliverTo(host),
    log,
  });

  if (padiStartedAt() !== null) {
    throw new Error(
      "kolu boot invariant violated: padi must still be warming (padiStartedAt null) when " +
        "implementKoluSurface runs — a pin() was awaited before the surface build, so " +
        "processStartedAt would seed stale. Seed the push cells from a live snapshot instead.",
    );
  }
  const koluServed = implementKoluSurface({
    readPadiMemory: pollRead(readPadiMemoryOnce),
    readDaemonInventory: pollRead(readDaemonInventoryEffect),
    onState: (cb) =>
      padiSession.onState((s) =>
        cb({
          link: mapConnectionToPadiLink(projectConnection(s).phase),
          padiStartedAt: padiStartedAt(),
        }),
      ),
    forwards: {
      read: forwards.reconcile,
      onChange: forwards.subscribe,
      create: forwards.create,
      cancel: forwards.cancel,
    },
    onPolicyInputsChanged: () => newTerminalPolicyPusher.republish(),
    onAgentDistroChanged: () => {
      agentDistroPusher.republish();
      installedAgentDelivery?.onSettingChanged();
    },
    deliverAgents: (host) => installedAgentDelivery?.deliverNow(host),
    agentDistroListing,
  });
  installedAgentDelivery =
    deliveryBake === null
      ? undefined
      : installAgentDelivery({
          bake: deliveryBake,
          pool,
          setting: currentAgentDistroSetting,
          publishProfiles: koluServed.setAgentProfiles,
          label: (host) =>
            host.kind === "local" ? serverHostname : host.target,
          log,
        });

  conductorWatcher = startConductorWatcher({
    hosts: fleetHosts,
    conductor: liveServerConductor,
    log,
  });
  setWorksListener(() => {
    for (const tell of worksReaders) tell();
  });
  setWatchScopeListener(() => conductorWatcher?.scopeMoved());

  const rootServed = buildAppRouter({
    drainBoundPadi: () => padiSession.renew(),
    addHost: (host) => pool.add(encodeHostKey(host)),
    removeHost: async (host) => {
      assertRemovableHost(host, defaultHost);
      await pool.remove(encodeHostKey(host));
    },
    reconnectHost: (host) => {
      const s = pool.getSession(encodeHostKey(host));
      if (s === undefined)
        throw new Error(
          `cannot reconnect unknown host "${encodeHostKey(host)}"`,
        );
      s.recheck();
    },
    viewerHost,
    renewHostDaemon: (host) =>
      Effect.suspend(() => {
        const s = pool.getSession(encodeHostKey(host));
        if (s === undefined)
          throw new Error(
            `cannot renew daemon on unknown host "${encodeHostKey(host)}"`,
          );
        return s.renew();
      }),
    listStateBackups: listServerStateBackups,
    restoreStateBackup: (input) =>
      restoreServerStateBackup(input, {
        ...koluServed.storeCellWriters,
        currentHostKeys: getPersistedHosts,
        hasLiveHost: (key) => pool.getHandler(key) !== undefined,
        addHostKey: (key) => pool.add(key),
        removeHostKey: (key) => pool.remove(key),
        restoreWorks: (works, members) => {
          liveServerConductor().restoreWorks(works, members);
        },
      }),
  });

  const servedHandlers = assembleServedHandlers({
    kolu: koluServed,
    padiMap,
    root: rootServed,
  });

  const SDK_SCRIPT_PATH: SdkScriptPath = "/api/artifact-sdk.js";

  const clientDist = process.env.KOLU_CLIENT_DIST;

  const manifest = koluManifest(pwaIdentityForHostname(serverHostname));

  const appLayer = appRoutesLayer({
    pool,
    sdkScriptPath: SDK_SCRIPT_PATH,
    workFileStateRoot: dirname(store.path),
  });

  const tlsOptions = await resolveTlsOptions(flags);

  const { bind: host, port } = flags;

  const listenerScope = Scope.makeUnsafe();

  const onServeEvent = serveEventLogger(pool);

  const address = await Effect.runPromise(
    serveSurfaceApp({
      group: servedGroup,
      handlers: servedHandlers,
      routes: appLayer,
      manifest,
      clientDist,
      serviceWorker: "notify",
      host,
      port,
      tls: tlsOptions,
      middleware: koluHttpMiddleware(log),
      allowedOrigins,
      upgradeHeaders: ["x-forwarded-for"],
      services: (connection) =>
        Layer.succeed(CurrentViewer)({
          viewerAddress: connection.remoteAddress,
          forwardedFor: connection.headers["x-forwarded-for"],
        }),
      onEvent: onServeEvent,
    }).pipe(Scope.provide(listenerScope)),
  );

  log.info(
    {
      version: serverVersion,
      pid: process.pid,
      node: process.version,
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      address,
    },
    "kolu listening",
  );

  startHeapDiagnostics({
    log,
    snapshotPrefix: "baseline",
    logPrefix: "diag",
    extraColumns: () => ({
      publisherSize: publisherSize(),
      ...agentDiagnostics(),
    }),
  });
}
