import type {
  PadiHostInventory,
  RunningKaval,
  RunningPadi,
} from "@kolu/padi-client/surface";
import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { buildSurfaceFace } from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import {
  type ControlCoreProbeClient,
  isNoListenerError,
  readControlCoreHello,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import {
  discoverKavalDaemons,
  type KavalDaemon,
  kavalControlSurface,
  kavalDaemonGroup,
  ptyHostClientOver,
} from "kaval";
import {
  getPadiServeSocketPath,
  readDaemonStatus,
} from "./ptyHost/daemonStatus.ts";
import {
  discoverPadiDaemons,
  type PadiDaemon,
  padiKavalSocketPath,
} from "./stateRoot.ts";

/** The read-only status a kaval socket answered — a field is null only where the
 *  daemon/listener is honestly absent, never because a failure was swallowed. */
export interface KavalProbe {
  terminalCount: number | null;
  buildCommit: string | null;
  contractVersion: string | null;
}

const EMPTY_PROBE: KavalProbe = {
  terminalCount: null,
  buildCommit: null,
  contractVersion: null,
};

export function assembleKavalInventory(
  daemons: readonly KavalDaemon[],
  probes: ReadonlyMap<string, KavalProbe>,
  activeSocket: string | null,
  activeAtLegacy: boolean,
): RunningKaval[] {
  return daemons.map((d) => {
    const probe = probes.get(d.socket) ?? EMPTY_PROBE;
    const active = activeSocket !== null && d.socket === activeSocket;
    return {
      socket: d.socket,
      label: d.label,
      kind: d.kind,
      gatePid: d.gatePid,
      terminalCount: probe.terminalCount,
      buildCommit: probe.buildCommit,
      contractVersion: probe.contractVersion,
      held: active
        ? { active: true as const, atLegacyAddress: activeAtLegacy }
        : { active: false as const },
    };
  });
}

export function assemblePadiInventory(
  daemons: readonly PadiDaemon[],
  activeSocket: string | null,
): RunningPadi[] {
  return daemons.map((d) => ({
    socket: d.socket,
    stateRoot: d.stateRoot,
    gatePid: d.gatePid,
    active: activeSocket !== null && d.socket === activeSocket,
  }));
}

export const HOST_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;

export const PROBE_TIMEOUT_MS = HOST_INVENTORY_SAMPLE_INTERVAL_MS / 2;

export function probeKavalStatus(
  socket: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Effect.Effect<KavalProbe, unknown> {
  const bounded = <A, E>(
    read: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> =>
    Effect.timeoutOrElse(read, {
      duration: timeoutMs,
      orElse: () => Effect.fail(new Error(`timed out after ${timeoutMs}ms`)),
    });
  return Effect.catch(
    Effect.scoped(
      Effect.flatMap(
        Effect.acquireRelease(
          bounded(
            Effect.tryPromise({
              try: () =>
                unixSocketLink({ group: kavalDaemonGroup, socketPath: socket }),
              catch: (err) => err,
            }),
          ),
          (link) => Effect.promise(() => link.dispose()),
        ),
        (link) => {
          const pty = ptyHostClientOver(link.dispatch);
          const control = buildSurfaceFace(kavalControlSurface, link.dispatch)
            .surface
            .core as unknown as ControlCoreProbeClient["surface"]["control"]["core"];
          return Effect.map(
            Effect.all(
              [
                Effect.map(
                  bounded(
                    readControlCoreHello({
                      surface: { control: { core: control } },
                    }),
                  ),
                  (hello) => hello.commit || null,
                ),
                bounded(pty.surface.system.version({})),
                bounded(pty.surface.terminal.list({})),
              ],
              { concurrency: "unbounded" },
            ),
            ([commit, version, list]) => ({
              terminalCount: list.entries.length,
              buildCommit: commit,
              contractVersion: version.contractVersion,
            }),
          );
        },
      ),
    ),
    (err) =>
      isNoListenerError(err) ? Effect.succeed(EMPTY_PROBE) : Effect.fail(err),
  );
}
/** The seams the scanner reads through. The `active*` values mark which daemons
 *  the scanning host's kolu owns — all `null`/`false` for a local-machine scan
 *  under a remote binding, where no local daemon is kolu's. */
export interface HostDaemonScanDeps {
  discoverKavals: () => KavalDaemon[];
  discoverPadis: () => PadiDaemon[];
  probe: (socket: string) => Effect.Effect<KavalProbe, unknown>;
  activeKavalSocket: string | null;
  activeKavalAtLegacy: boolean;
  activePadiSocket: string | null;
}

/** Take one read-only reading of the host-daemon inventory. An honestly absent
 *  listener reads as an empty probe; every other probe failure rejects the
 *  reading, so a broken status observation cannot silently become nulls. */
export function enumerateHostDaemons(
  deps: HostDaemonScanDeps,
): Effect.Effect<PadiHostInventory, unknown> {
  return Effect.gen(function* () {
    const kavalDaemons = deps.discoverKavals();
    const padiDaemons = deps.discoverPadis();
    const probeEntries = yield* Effect.all(
      kavalDaemons.map((d) =>
        Effect.map(deps.probe(d.socket), (probe) => [d.socket, probe] as const),
      ),
      { concurrency: "unbounded" },
    );
    const probes = new Map(probeEntries);
    return {
      kavals: assembleKavalInventory(
        kavalDaemons,
        probes,
        deps.activeKavalSocket,
        deps.activeKavalAtLegacy,
      ),
      padis: assemblePadiInventory(padiDaemons, deps.activePadiSocket),
    };
  });
}

export function heldKaval(stateRoot: string): {
  socket: string;
  atLegacy: boolean;
} {
  const digest = padiKavalSocketPath(stateRoot);
  const held =
    readDaemonStatus(encodeHostLocation(LOCAL_LOCATION))?.socketPath ?? null;
  return {
    socket: held ?? digest,
    atLegacy: held !== null && held !== digest,
  };
}

export function withSelfPadi(
  discovered: readonly PadiDaemon[],
  self: { padiSocket: string; stateRoot: string; pid: number },
): PadiDaemon[] {
  if (discovered.some((p) => p.socket === self.padiSocket)) {
    return [...discovered];
  }
  return [
    ...discovered,
    {
      socket: self.padiSocket,
      stateRoot: self.stateRoot,
      gatePid: self.pid,
    },
  ];
}

export function samplePadiHostInventory(
  stateRoot: string,
): Effect.Effect<PadiHostInventory, unknown> {
  return Effect.suspend(() => {
    const padiSocket = getPadiServeSocketPath();
    if (!padiSocket) {
      throw new Error(
        "host-inventory read before padi's serve socket was set (boot-order defect)",
      );
    }
    const self = { padiSocket, stateRoot, pid: process.pid };
    const held = heldKaval(stateRoot);
    return enumerateHostDaemons({
      discoverKavals: discoverKavalDaemons,
      discoverPadis: () => withSelfPadi(discoverPadiDaemons(), self),
      probe: probeKavalStatus,
      activeKavalSocket: held.socket,
      activeKavalAtLegacy: held.atLegacy,
      activePadiSocket: padiSocket,
    });
  });
}
