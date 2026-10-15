/**
 * kolu-server's agent delivery, wired to the warm padi pool — the composition
 * of `./delivery.ts` (deliver to hosts), `./schedule.ts` (upstream's clock)
 * and `./ops.ts` (the real index read, profile builds and host transfers),
 * with the triggers that live here:
 *
 *   - a host's padi taking the Agents setting (`deliverTo`, from the setting
 *     pusher's per-host push: every bind and reconnect, and every real change
 *     of the setting) — an index answer from the current schedule period is
 *     reused;
 *   - the user's "check for newer agents" (`deliverNow`, one host or all) — a
 *     fresh index read, at once, counted toward no scheduled attempt;
 *   - upstream's schedule (`startDeliverySchedule`).
 *
 * A kolu-server without the delivery bake (built from source) installs none of
 * this: it delivers nothing and reports nothing, and a host it serves reads
 * `undelivered` — padi says `downloading` only once a delivery has said it
 * started.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import type {
  AgentDistroSetting,
  AgentProfiles,
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
} from "./delivery.ts";
import { realDeliveryOps } from "./ops.ts";
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
  /** The setting changed: say whether its profiles build, and wake the
   *  schedule (it idles while agents are off). */
  onSettingChanged(): void;
}

export function installAgentDelivery(deps: {
  readonly bake: AgentDistroDelivery;
  readonly pool: DeliveryPool;
  readonly setting: () => AgentDistroSetting;
  /** Publish whether each profile of the setting builds (kolu's
   *  `agentProfiles` cell). */
  readonly publishProfiles: (profiles: AgentProfiles) => void;
  /** How messages name a host (the local machine by its hostname). */
  readonly label: (host: HostKey) => string;
  readonly log: Logger;
}): AgentDeliveryHandle {
  const { pool, log, bake } = deps;
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
  const stack = (): readonly string[] | undefined => {
    const setting = deps.setting();
    return setting.enabled ? setting.profiles : undefined;
  };
  const delivery: AgentDelivery = createAgentDelivery({
    schedule: bake.schedule,
    ops: realDeliveryOps(bake),
    log,
    stack,
    onResolution: deps.publishProfiles,
    hosts: () =>
      pool
        .hosts()
        .map(hostOf)
        .filter((h): h is DeliveryHost => h !== undefined),
  });
  const schedule = startDeliverySchedule({
    delivery,
    schedule: bake.schedule,
    enabled: () => deps.setting().enabled,
    log,
  });
  return {
    deliverTo: (key) => void delivery.run({ keys: [key], trigger: "connect" }),
    deliverNow: (host) =>
      void delivery.run({
        ...(host === null ? {} : { keys: [encodeHostKey(host)] }),
        trigger: "user",
      }),
    onSettingChanged: () => {
      void delivery.resolve();
      schedule.poke();
    },
  };
}
