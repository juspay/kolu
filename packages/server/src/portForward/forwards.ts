import {
  ASSUMED_LOOPBACK,
  createForwardManager,
  type Forward,
  type ForwardLoss,
  type ForwardManager,
  type ForwardTarget,
  type LoopbackFamily,
  targetKey,
} from "@kolu/port-forward";
import { match } from "ts-pattern";
import type { HostPorts, HostPortsReader } from "./hostPorts.ts";
import type { Logger } from "@kolu/log";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type {
  ForwardCreateInput,
  ForwardOrigin,
  Forwards,
  KoluForward,
  PortFamily,
} from "kolu-common/surface";

export const FORWARD_REAP_INTERVAL_MS = 5_000;

function containedNotify(
  listeners: Iterable<() => void>,
  log: Logger,
): () => void {
  return (): void => {
    for (const tick of listeners) {
      try {
        tick();
      } catch (err) {
        log.error({ err }, "port forward subscriber threw on notify");
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  };
}

export interface KoluForwards {
  subscribe(tick: () => void): () => void;
  /** Open a forward, or return the live one for the same target. A `manual`
   *  request over a live `auto` forward PROMOTES it (see `create`). */
  create(input: ForwardCreateInput): Promise<KoluForward>;
  /** Take one down by key. Rejects on an unknown key. */
  cancel(key: string): Promise<void>;
  /** Every live forward, oldest first — a plain read, no reconciliation. */
  list(): Forwards;
  reconcile(): Promise<Forwards>;
  heldHosts(): readonly HostKey[];
  /** A host left the pool — take ITS forwards down, both origins, including one
   *  still opening. A door to a machine kolu no longer has is a door to
   *  nowhere. */
  hostDeparted(host: HostKey): Promise<void>;
  /** Close everything. */
  dispose(): Promise<void>;
}

export function targetFor(
  host: HostKey,
  port: number,
  loopback: LoopbackFamily,
): ForwardTarget {
  return host.kind === "local"
    ? { kind: "local", port, loopback }
    : { kind: "remote", host: host.target, port, loopback };
}

function hostOf(target: ForwardTarget): HostKey {
  return target.kind === "local"
    ? { kind: "local" }
    : { kind: "remote", target: target.host };
}

function loopbackOf(family: PortFamily): LoopbackFamily {
  return match(family)
    .with("v4", () => "v4" as const)
    .with("v6", () => "v6" as const)
    .exhaustive();
}

export function createKoluForwards(deps: {
  readHostPorts: HostPortsReader;
  hostIsMember: (host: HostKey) => boolean;
  log: Logger;
  /** The forward map. Defaults to the real one; injected by tests. */
  makeManager?: (opts: {
    onLost: (loss: ForwardLoss<ForwardOrigin>) => void;
  }) => ForwardManager<ForwardOrigin>;
}): KoluForwards {
  const manager = (deps.makeManager ?? createForwardManager<ForwardOrigin>)({
    onLost: ({ forward, reason, kind }) => {
      const line = { key: forward.key, reason, kind };
      const msg = "port forward reported by its mechanism";
      match(kind)
        .with("degraded", () => deps.log.error(line, msg))
        .with("gone", () => deps.log.warn(line, msg))
        .exhaustive();
      notify();
    },
  });

  const listeners = new Set<() => void>();

  const rowOf = (forward: Forward<ForwardOrigin>): KoluForward => ({
    key: forward.key,
    host: hostOf(forward.target),
    remotePort: forward.target.port,
    localPort: forward.localPort,
    origin: forward.meta,
    createdAt: forward.createdAt,
  });

  const list = (): Forwards => manager.list().map(rowOf);

  const notify = containedNotify(listeners, deps.log);

  const alreadyOpen = (input: ForwardCreateInput): boolean => {
    const key = targetKey(targetFor(input.host, input.port, ASSUMED_LOOPBACK));
    return manager.list().some((f) => f.key === key);
  };

  const familyFor = async (
    input: ForwardCreateInput,
  ): Promise<LoopbackFamily> => {
    const seen = await deps.readHostPorts
      .forOpeningClick(input.host)
      .catch((err: unknown) => {
        deps.log.error(
          { err, host: encodeHostKey(input.host) },
          "could not read a host's ports while opening a forward — dialling the assumed loopback",
        );
        return { status: "unobserved" } as const;
      });
    if (seen.status !== "observed") return ASSUMED_LOOPBACK;
    const family = seen.ports.get(input.port);
    return family === undefined ? ASSUMED_LOOPBACK : loopbackOf(family);
  };

  return {
    subscribe(tick) {
      listeners.add(tick);
      return () => listeners.delete(tick);
    },

    async create(input) {
      const target = alreadyOpen(input)
        ? targetFor(input.host, input.port, ASSUMED_LOOPBACK)
        : targetFor(input.host, input.port, await familyFor(input));
      if (!deps.hostIsMember(input.host)) {
        throw new Error(
          `kolu no longer has the host "${encodeHostKey(input.host)}" — not opening a forward to it.`,
        );
      }
      const forward = await manager.create(target, input.origin);
      const row = rowOf(
        input.origin === "manual" && forward.meta !== "manual"
          ? manager.promote(forward.key, "manual")
          : forward,
      );
      notify();
      return row;
    },

    async cancel(key) {
      await manager.cancel(key);
      notify();
    },

    list,

    async reconcile() {
      const auto = manager.list().filter((f) => f.meta === "auto");
      if (auto.length === 0) return list();

      const hosts = new Map<string, HostKey>();
      for (const f of auto)
        hosts.set(encodeHostKey(hostOf(f.target)), hostOf(f.target));

      const ports = new Map<string, HostPorts>();
      await Promise.all(
        [...hosts].map(async ([enc, host]) => {
          try {
            ports.set(enc, await deps.readHostPorts.forReap(host));
          } catch (err) {
            deps.log.error(
              { err, host: enc },
              "could not read a host's ports for forward auto-cancel — its forwards are left standing",
            );
            ports.set(enc, { status: "unobserved" });
          }
        }),
      );

      for (const forward of auto) {
        if (
          manager.list().find((f) => f.key === forward.key)?.meta !== "auto"
        ) {
          continue;
        }
        const host = hostOf(forward.target);
        const seen = ports.get(encodeHostKey(host));
        if (seen?.status !== "observed") continue;
        if (seen.ports.has(forward.target.port)) continue;
        deps.log.info(
          { key: forward.key, port: forward.target.port },
          "auto forward's listener is gone — cancelling it",
        );
        try {
          await manager.cancel(forward.key);
        } catch (err) {
          deps.log.error(
            { err, key: forward.key },
            "could not cancel a dead auto forward — it is still listed",
          );
        }
      }
      return list();
    },

    heldHosts() {
      const byKey = new Map<string, HostKey>();
      for (const target of manager.targets()) {
        const host = hostOf(target);
        byKey.set(encodeHostKey(host), host);
      }
      return [...byKey.values()];
    },

    async hostDeparted(host) {
      const enc = encodeHostKey(host);
      const doomed = manager
        .targets()
        .filter((t) => encodeHostKey(hostOf(t)) === enc)
        .map(targetKey);
      await Promise.all(
        doomed.map(async (key) => {
          try {
            await manager.cancel(key);
          } catch (err) {
            deps.log.error(
              { err, key, host: enc },
              "could not cancel a departed host's forward — it is still listed",
            );
          }
        }),
      );
      if (doomed.length > 0) notify();
    },

    async dispose() {
      try {
        await manager.dispose();
      } finally {
        notify();
      }
    },
  };
}
