import type { DaemonStatus } from "@kolu/padi-client/surface";
import type { EndpointStatus } from "@kolu/surface-daemon-supervisor";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { type KavalConnectionMetadata, optionalLifetime } from "./connect.ts";

const store = new Map<string, DaemonStatus>();

let localSocketPath: string | undefined;

/** Every host's current daemon status (for the collection's `readAll`). */
export function readDaemonStatuses(): Map<string, DaemonStatus> {
  return store;
}

/** One host's current daemon status (for the collection's `readOne`). */
export function readDaemonStatus(hostId: string): DaemonStatus | undefined {
  return store.get(hostId);
}

export function setLocalSocketPath(path: string): void {
  localSocketPath = path;
}

export function getLocalSocketPath(): string | undefined {
  return localSocketPath;
}

let padiServeSocketPath: string | undefined;

export function setPadiServeSocketPath(path: string): void {
  padiServeSocketPath = path;
}

export function getPadiServeSocketPath(): string | undefined {
  return padiServeSocketPath;
}

const statusChangeListeners = new Set<() => void>();

export function onDaemonStatusChange(listener: () => void): () => void {
  statusChangeListeners.add(listener);
  return () => {
    statusChangeListeners.delete(listener);
  };
}

function publishFullDaemonStatus(hostId: string, status: DaemonStatus): void {
  store.set(hostId, status);
  padiSurfaceCtx.collections.daemonStatus.upsert(hostId, status);
  for (const listener of [...statusChangeListeners]) listener();
}

/** Record + publish a host's daemon status. The endpoint's `onStatus` sink. Folds
 *  the local socket path on (a constant server fact) so the client need not — and
 *  can't — derive it. */
export function publishDaemonStatus(
  hostId: string,
  status: EndpointStatus<DaemonStatus["identity"], KavalConnectionMetadata>,
): void {
  const socket = localSocketPath ? { socketPath: localSocketPath } : {};
  const full: DaemonStatus =
    status.state === "connected"
      ? {
          state: "connected",
          identity: status.identity,
          startedAt: status.startedAt,
          contractVersion: status.metadata.contractVersion,
          ...optionalLifetime(status.metadata.lifetime),
          ...socket,
        }
      : status.state === "incompatible"
        ? {
            state: "incompatible",
            daemonVersion: status.daemonVersion,
            requiredVersion: status.requiredVersion,
            ...socket,
          }
        : {
            state: status.state,
            ...socket,
          };
  publishFullDaemonStatus(hostId, full);
}

export function setAdoptedCount(hostId: string, adopted: number): void {
  stampOnConnected(hostId, (at) => ({ adopted, adoptedAt: at }));
}

function stampOnConnected(
  hostId: string,
  patch: (
    at: number,
  ) => Omit<Partial<Extract<DaemonStatus, { state: "connected" }>>, "state">,
): void {
  const current = store.get(hostId);
  if (!current || current.state !== "connected") return;
  publishFullDaemonStatus(hostId, { ...current, ...patch(Date.now()) });
}

export function setAutoRecovered(hostId: string): void {
  stampOnConnected(hostId, (at) => ({ autoRecoveredAt: at }));
}

export function setLinkRestored(hostId: string): void {
  stampOnConnected(hostId, (at) => ({ linkRestoredAt: at }));
}
