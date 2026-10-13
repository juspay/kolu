/**
 * kolu-server's agent delivery, wired to the warm padi pool — the composition
 * of `./delivery.ts` (deliver to hosts), `./schedule.ts` (upstream's clock)
 * and `./nix.ts` (the real Nix steps), with the triggers that live here:
 *
 *   - a host's padi taking the Agents setting (`deliverTo`, from the setting
 *     pusher's per-host push: every bind and reconnect, and every real change
 *     of the setting) — a lock from the current schedule period is reused;
 *   - the user's "check for newer agents" (`deliverNow`, one host or all) — a
 *     fresh lock, at once, counted toward no scheduled attempt;
 *   - upstream's schedule (`startDeliverySchedule`).
 *
 * Absent entirely on a kolu-server without the delivery bake (from source):
 * nothing delivers, and the hosts' padis — unbaked too, locally — say so.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import {
  type AgentDistroSetting,
  bundleProfileOf,
} from "@kolu/agent-distro/schema";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { Logger } from "@kolu/log";
import { Effect } from "effect";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import {
  type AgentDelivery,
  createAgentDelivery,
  type DeliveryHost,
  type DeliveryOps,
} from "./delivery.ts";
import { nixDeliveryOps } from "./nix.ts";
import { startDeliverySchedule } from "./schedule.ts";

/** The pool slice delivery reads: membership and the session behind a key. */
export interface DeliveryPool {
  hosts(): string[];
  getSession(key: string):
    | {
        currentState(): { phase: string };
        currentClient(): Promise<PadiSurfaceClient> | null;
      }
    | undefined;
}

export interface AgentDeliveryHandle {
  /** Deliver to the host behind pool key `key` — it just took the setting. */
  deliverTo(key: string): void;
  /** The user's check: `host`, or every connected host for `null`. */
  deliverNow(host: HostKey | null): void;
  /** The setting changed: wake the schedule (it idles while agents are off). */
  onSettingChanged(): void;
  stop(): void;
}

export function installAgentDelivery(deps: {
  readonly bake: AgentDistroDelivery;
  readonly pool: DeliveryPool;
  readonly setting: () => AgentDistroSetting;
  /** The bundles this build ships, by name (the floor's listing). */
  readonly bundles: ReadonlySet<string>;
  /** How messages name a host (the local machine by its hostname). */
  readonly label: (host: HostKey) => string;
  readonly log: Logger;
  /** The Nix steps — `nixDeliveryOps(bake)` unless a test stands in. */
  readonly ops?: DeliveryOps;
}): AgentDeliveryHandle {
  const { pool, log } = deps;
  const hostOf = (key: string): DeliveryHost | undefined => {
    const session = pool.getSession(key);
    if (session === undefined || session.currentState().phase !== "connected")
      return undefined;
    const host = decodeHostKey(key);
    return {
      key,
      ssh: host.kind === "local" ? "localhost" : host.target,
      label: deps.label(host),
      report: async (r) => {
        const client = session.currentClient();
        if (client === null)
          throw new Error(`padi on ${deps.label(host)} is not connected`);
        await Effect.runPromise((await client).surface.agentDistro.report(r));
      },
    };
  };
  const delivery: AgentDelivery = createAgentDelivery({
    bake: deps.bake,
    ops: deps.ops ?? nixDeliveryOps(deps.bake),
    log,
    bundle: () => {
      const setting = deps.setting();
      return setting.enabled
        ? bundleProfileOf(setting.profile, deps.bundles)
        : undefined;
    },
    hosts: () =>
      pool
        .hosts()
        .map(hostOf)
        .filter((h): h is DeliveryHost => h !== undefined),
  });
  const schedule = startDeliverySchedule({
    delivery,
    schedule: deps.bake.schedule,
    enabled: () => deps.setting().enabled,
    log,
  });
  return {
    deliverTo: (key) => void delivery.run({ keys: [key], freshLock: false }),
    deliverNow: (host) =>
      void delivery.run({
        ...(host === null ? {} : { keys: [encodeHostKey(host)] }),
        freshLock: true,
      }),
    onSettingChanged: () => schedule.poke(),
    stop: schedule.stop,
  };
}
