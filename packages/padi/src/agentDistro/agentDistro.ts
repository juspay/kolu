import { referencesOf, sameStack } from "@kolu/agent-distro/landing";
import {
  type AgentDistroDeliveryReport,
  type AgentDistroSetting,
  type AgentDistroStatus,
  DEFAULT_AGENT_DISTRO_SETTING,
  EMPTY_AGENT_DISTRO_RECEIPT,
} from "@kolu/agent-distro/schema";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { agentDistroBake } from "./bake.ts";
import {
  deliveryDropped,
  deliveryFailed,
  deliveryOf,
  deliveryStarted,
  landDelivery,
  lastFailureOf,
  pruneGcRoots,
} from "./deliveries.ts";
import type { AgentLayer } from "./layer.ts";
import {
  AgentPackageUnreadable,
  type PackageAnswers,
  packageAnswers,
  servedSetOnHost,
} from "./onHost.ts";
import { readReceipt } from "./receipt.ts";

export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

function publishReceipt(setting: AgentDistroSetting): void {
  const bake = agentDistroBake();
  padiSurfaceCtx.cells.agentDistroReceipt.set(
    bake === null
      ? EMPTY_AGENT_DISTRO_RECEIPT
      : readReceipt(
          bake,
          servedSetOnHost(bake),
          lastFailureOf(setting.profiles),
        ),
  );
}

function publishReceiptLoud(setting: AgentDistroSetting): void {
  try {
    publishReceipt(setting);
  } catch (err) {
    log.error({ err }, "agent-distro receipt could not be read");
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function assessAgentDistro(setting: AgentDistroSetting):
  | Exclude<AgentDistroStatus, { kind: "ready" }>
  | {
      readonly kind: "ready";
      readonly layer: AgentLayer;
      /** A newer set for the same stack is being delivered; `layer` keeps
       *  serving until it lands. */
      readonly delivering: boolean;
    } {
  if (!setting.enabled) return { kind: "off" };
  const bake = agentDistroBake();
  if (bake === null) return { kind: "unavailable" };
  const { profiles } = setting;
  let served: ReturnType<typeof servedSetOnHost>;
  try {
    served = servedSetOnHost(bake);
  } catch (err) {
    log.error({ err }, "agent-distro set on this host could not be read");
    return {
      kind: "error",
      profiles,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const delivery = deliveryOf(profiles);
  if (
    served !== undefined &&
    sameStack(referencesOf(served.profiles), profiles)
  )
    return {
      kind: "ready",
      layer: { ...served, plugins: bake.plugins },
      delivering: delivery?.kind === "delivering",
    };
  if (delivery?.kind === "failed")
    return { kind: "error", profiles, message: delivery.failure.words };
  return {
    kind: delivery?.kind === "delivering" ? "downloading" : "undelivered",
    profiles,
  };
}

/** What a terminal spawned NOW gets on this host — the same answer the host's
 *  status gives ({@link assessAgentDistro}): a layer only when it reads ready. */
export function newTerminalLayer(): AgentLayer | undefined {
  const assessed = assessAgentDistro(agentDistroSettingStore.get());
  return assessed.kind === "ready" ? assessed.layer : undefined;
}

function settle(setting: AgentDistroSetting): void {
  const assessed = assessAgentDistro(setting);
  if (assessed.kind !== "ready") {
    padiSurfaceCtx.cells.agentDistroStatus.set(assessed);
    return;
  }
  let answers: PackageAnswers;
  try {
    answers = packageAnswers(assessed.layer.bundle);
  } catch (err) {
    if (!(err instanceof AgentPackageUnreadable)) throw err;
    log.error({ err }, "agent-distro package on this host could not be read");
    padiSurfaceCtx.cells.agentDistroStatus.set({
      kind: "error",
      profiles: setting.profiles,
      message: err.message,
    });
    return;
  }
  padiSurfaceCtx.cells.agentDistroStatus.set({
    kind: "ready",
    set: {
      bundle: assessed.layer.bundle,
      profiles: assessed.layer.profiles,
    },
    delivering: assessed.delivering,
    answers: answers.kind === "answers" ? [...answers.flags] : [],
  });
}

export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  settle(next);
  publishReceiptLoud(next);
}

export function onAgentDistroReport(report: AgentDistroDeliveryReport): void {
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "kolu-server reported an agent-distro delivery, but this padi has no agent-distro bake",
    );
  const stack =
    report.kind === "landed"
      ? referencesOf(report.set.profiles)
      : report.profiles;
  try {
    switch (report.kind) {
      case "delivering":
        deliveryStarted(stack);
        return;
      case "failed":
        if (!sameStack(stack, agentDistroSettingStore.get().profiles))
          deliveryDropped(stack);
        else deliveryFailed(stack, report.message);
        return;
      case "landed": {
        const current = agentDistroSettingStore.get().profiles;
        if (!sameStack(stack, current)) {
          deliveryDropped(stack);
          throw new Error(
            `kolu-server reported a landing for ${JSON.stringify(stack)}, but the Agents setting is now ${JSON.stringify(current)}; the set this host serves is kept`,
          );
        }
        try {
          landDelivery(bake, report.set);
        } catch (err) {
          deliveryFailed(
            stack,
            err instanceof Error ? err.message : String(err),
            "padi",
          );
          throw err;
        }
        return;
      }
      default:
        report satisfies never;
    }
  } finally {
    const setting = agentDistroSettingStore.get();
    publishReceiptLoud(setting);
    settle(setting);
  }
}

/** Publish the receipt and status for the setting padi boots with. Called
 *  once, at boot. */
export function publishAgentDistroAtBoot(): void {
  sweepGcRootsAtBoot();
  const setting = agentDistroSettingStore.get();
  publishReceiptLoud(setting);
  settle(setting);
}

function sweepGcRootsAtBoot(): void {
  const bake = agentDistroBake();
  if (bake === null) return;
  let served: ReturnType<typeof servedSetOnHost>;
  try {
    served = servedSetOnHost(bake);
  } catch (err) {
    log.error(
      { err },
      "agent-distro GC roots not swept: the served set does not read",
    );
    return;
  }
  pruneGcRoots(bake.gcRootsDir, served?.profiles.map((p) => p.reference) ?? []);
}
