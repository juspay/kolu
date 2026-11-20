import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import { padiSurfaceSibling } from "@kolu/padi-client/surface";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  type DirectlyDispatchable,
  directDispatch,
} from "@kolu/surface/links/direct";
import { fold as mapEnvelope } from "@kolu/surface-map";
import type { RemotePool } from "@kolu/surface-remote";
import { decodeHostKey } from "kolu-common/hostKey";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import type { FleetHostState, FleetHosts } from "kolu-mcp";
import type { PadiSession } from "../padi/padiSession.ts";

if (padiSurfaceSibling.tagPrefix !== padiHostMap.tagPrefix) {
  throw new Error(
    `fleet: padi's client face dials "${padiSurfaceSibling.tagPrefix}" while the served host map binds "${padiHostMap.tagPrefix}" — ` +
      "the fleet face would reach no handler at all. The map's mount name (`PADI_SURFACE_NAME`) and padi's own sibling key must be the same word.",
  );
}

function fleetStateOf(session: PadiSession): FleetHostState {
  if (session.isDestroyed()) return "failed";
  const phase = session.currentState().phase;
  if (phase === "connected") return "connected";
  if (phase === "failed" || phase === "absent") return "failed";
  return "warming";
}

export interface FleetHostsOptions {
  pool: RemotePool<PadiSession, undefined>;
  padiMap: DirectlyDispatchable;
  localName: string;
}

function hostCalls(
  map: DirectlyDispatchable,
  hostKey: string,
): SurfaceDispatch {
  const served = directDispatch(map);
  return {
    unary: (tag, input) => served.unary(tag, mapEnvelope(hostKey, input)),
    stream: (tag, input) => served.stream(tag, mapEnvelope(hostKey, input)),
  };
}

export function fleetHostsOver(opts: FleetHostsOptions): FleetHosts {
  const { pool, padiMap, localName } = opts;

  const clients = new WeakMap<PadiSession, PadiSurfaceClient>();

  return {
    keys: () => pool.hosts(),

    display: (key) => {
      const host = decodeHostKey(key);
      return host.kind === "local" ? localName : host.target;
    },

    padi: (key) => {
      const session = pool.getSession(key);
      if (session === undefined) return null;
      if (fleetStateOf(session) !== "connected") return null;
      const cached = clients.get(session);
      if (cached !== undefined) return cached;
      const client = padiClientOver(hostCalls(padiMap, key)).padi;
      clients.set(session, client);
      return client;
    },

    state: (key) => {
      const session = pool.getSession(key);
      return session === undefined ? "failed" : fleetStateOf(session);
    },

    subscribe: (cb) => {
      const lastWord = new Map<string, FleetHostState>();
      const perHost = new Map<string, () => void>();

      const sweep = (): boolean => {
        let moved = false;
        const live = new Set(pool.hosts());
        for (const [key, off] of perHost) {
          if (live.has(key)) continue;
          off();
          perHost.delete(key);
          lastWord.delete(key);
          moved = true;
        }
        for (const key of live) {
          const session = pool.getSession(key);
          if (session === undefined) continue;
          const word = fleetStateOf(session);
          if (lastWord.get(key) === word) continue;
          lastWord.set(key, word);
          moved = true;
        }
        return moved;
      };

      const attach = (): void => {
        for (const key of pool.hosts()) {
          if (perHost.has(key)) continue;
          const session = pool.getSession(key);
          if (session === undefined) continue;
          perHost.set(
            key,
            session.onState(() => {
              if (sweep()) cb();
            }),
          );
        }
      };

      function resync(): boolean {
        const moved = sweep();
        attach();
        return moved;
      }

      resync();
      const offPool = pool.subscribe(() => {
        resync();
        cb();
      });

      return () => {
        offPool();
        for (const off of perHost.values()) off();
        perHost.clear();
        lastWord.clear();
      };
    },
  };
}
