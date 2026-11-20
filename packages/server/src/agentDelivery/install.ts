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
  deliverTo(key: string): void;
  deliverNow(host: HostKey | null): void;
  onSettingChanged(): void;
}

export function installAgentDelivery(deps: {
  readonly bake: AgentDistroDelivery;
  readonly pool: DeliveryPool;
  readonly setting: () => AgentDistroSetting;
  readonly publishProfiles: (profiles: AgentProfiles) => void;
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
  const delivery: AgentDelivery = createAgentDelivery({
    schedule: bake.schedule,
    ops: realDeliveryOps(bake),
    log,
    setting: deps.setting,
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
