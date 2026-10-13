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
 * On a kolu-server without the delivery bake (built from source) nothing
 * delivers, and that is SAID: every REMOTE host that takes the setting (a
 * `padi-agent`, baked with the profiles and no floor) is told the delivery
 * failed and why, rather than left waiting. The local padi shares this
 * process's environment, so it is unbaked too (or carries the e2e fixture's
 * floor) and has nothing to be told.
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
}

/** What a kolu-server built without the delivery bake tells a host. */
export const NO_DELIVERY_MESSAGE =
  "this kolu was built from source without agent delivery (KOLU_AGENT_DISTRO_DELIVERY is not baked), so it delivers no coding agents — run kolu from its Nix wrapper";

export function installAgentDelivery(deps: {
  /** The delivery bake, or `null` on a kolu-server built from source. */
  readonly bake: AgentDistroDelivery | null;
  readonly pool: DeliveryPool;
  readonly setting: () => AgentDistroSetting;
  /** The bundles this build ships, by name (the floor's listing). */
  readonly bundles: ReadonlySet<string>;
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
  const bundle = (): string | undefined => {
    const setting = deps.setting();
    return setting.enabled
      ? bundleProfileOf(setting.profile, deps.bundles)
      : undefined;
  };
  if (bake === null) {
    const tell = (key: string): void => {
      const profile = bundle();
      const host = hostOf(key);
      if (profile === undefined || host === undefined) return;
      if (decodeHostKey(key).kind !== "remote") return;
      host
        .report({
          kind: "failed",
          profile,
          reason: "delivery",
          message: NO_DELIVERY_MESSAGE,
        })
        .catch((err: unknown) =>
          log.error({ err, host: host.label }, "agent-distro report failed"),
        );
    };
    return {
      deliverTo: tell,
      deliverNow: (host) =>
        (host === null ? pool.hosts() : [encodeHostKey(host)]).forEach(tell),
      onSettingChanged: () => {},
    };
  }
  const delivery: AgentDelivery = createAgentDelivery({
    bake,
    ops: nixDeliveryOps(bake),
    log,
    bundle,
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
    onSettingChanged: () => schedule.poke(),
  };
}
