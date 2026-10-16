/**
 * agent-distro on THIS host — padi's POLICY for the Agents setting: what it
 * accepts, what it reports, and what a delivery means here. Its volatility is
 * kolu's own product decisions; the facts it acts on live in their own modules:
 *
 *   - `./bake.ts` — what this build was baked with (state, floor, plugins);
 *   - `./onHost.ts` — the set this host serves;
 *   - `./layer.ts` — the layer a set gives, and its record stamp;
 *   - `./deliveries.ts` — what kolu-server has told this host about delivering
 *     it the setting's set, and landing one (`current` flipped, the set
 *     recorded, upstream's files written);
 *   - `./receipt.ts` — what the files on the host say about deliveries.
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference), and DELIVERS the setting's set — agent-distro's
 * package and the profiles it builds — on its own schedule, reporting each
 * step through `agentDistro.report` ({@link onAgentDistroReport}). padi never
 * fetches, builds or retries anything: a host needs neither flakes, GitHub,
 * nor `nix` on padi's PATH for its agents. This module keeps the read-only
 * cells true: `agentDistroStatus` (what a new terminal gets here) and
 * `agentDistroReceipt` (what landed, and the last delivery that did not).
 *
 * A set serves new terminals only while it is the setting's stack: a changed
 * list waits for its own set (no terminal starts without a profile the setting
 * names). A set that serves keeps serving while a newer one for the same stack
 * is delivered and after a delivery that fails: only a host with nothing to
 * serve reports the failure as its status.
 */

import { sameStack } from "@kolu/agent-distro/landing";
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
  pruneGcRoots,
  unlandedRun,
} from "./deliveries.ts";
import type { AgentLayer } from "./layer.ts";
import { servedSetOnHost } from "./onHost.ts";
import { readReceipt } from "./receipt.ts";

/** The backing store of the `agentDistro` cell, shared by the cell declaration
 *  and the spawn path — so a spawn resolves against exactly what the binder
 *  wrote (the `newTerminalPolicyStore` arrangement). */
export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

/** Publish what this host keeps of its deliveries — readable with agents off
 *  too. Nothing to say on an unbaked padi. */
function publishReceipt(): void {
  const bake = agentDistroBake();
  padiSurfaceCtx.cells.agentDistroReceipt.set(
    bake === null
      ? EMPTY_AGENT_DISTRO_RECEIPT
      : readReceipt(bake, servedSetOnHost(bake), unlandedRun()),
  );
}

/** {@link publishReceipt}, never thrown into a caller that cannot act on it:
 *  a file that will not read (a history line upstream changed the shape of,
 *  say) is logged loudly AND published as the receipt's `error`, so the host's
 *  line in Settings says so instead of keeping the last good receipt. */
function publishReceiptLoud(): void {
  try {
    publishReceipt();
  } catch (err) {
    log.error({ err }, "agent-distro receipt could not be read");
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Where `setting` stands on this host, as of now, without side effects — the
 *  ONE answer to "what does a new terminal get here": the published status is
 *  this with the layer reduced to its package and profiles, and the spawn path
 *  stamps this layer ({@link newTerminalLayer}). So a host never reads one
 *  thing while its new terminals get another. A set on record that this host
 *  cannot hold is an `error`, in padi's words — never a half set served. */
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
    sameStack(
      served.profiles.map((p) => p.reference),
      profiles,
    )
  )
    return {
      kind: "ready",
      layer: { ...served, plugins: bake.plugins },
      delivering: delivery?.kind === "delivering",
    };
  if (delivery?.kind === "failed")
    return { kind: "error", profiles, message: delivery.failure.message };
  // Nothing serves this stack and nothing failed: `downloading` only once
  // kolu-server has SAID it is delivering — never inferred from silence, which
  // is also what a kolu-server that cannot deliver at all sends.
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

/** Publish `setting`'s status on this host. */
function settle(setting: AgentDistroSetting): void {
  const assessed = assessAgentDistro(setting);
  padiSurfaceCtx.cells.agentDistroStatus.set(
    assessed.kind === "ready"
      ? {
          kind: "ready",
          profiles: setting.profiles,
          bundle: assessed.layer.bundle,
          delivered: assessed.layer.profiles,
          delivering: assessed.delivering,
        }
      : assessed,
  );
}

/** The `agentDistro` cell's `onWrite`: a CHANGED setting (the cell's `equals`
 *  drops a re-push of the same value, so a reconnect does not land here). Fires
 *  BEFORE the store write, so it reads `next`, never the store. */
export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  settle(next);
  publishReceiptLoud();
}

/** `agentDistro.report`: kolu-server's word on a delivery to this host. A
 *  landing records the set and points `current` at its package; if that cannot
 *  be done here (a path is not on this host, the state dir will not write) it
 *  is this host's failure, recorded in padi's words AND thrown back, so
 *  kolu-server's log has it too. A landing or a failure of a stack the
 *  setting has since left (a delivery that ran while the list changed) is
 *  refused or dropped: it never replaces, or marks, the set the current stack
 *  serves. Re-publishes the receipt first, then the
 *  status — so a client that sees the new set can already read what
 *  changed. */
export function onAgentDistroReport(report: AgentDistroDeliveryReport): void {
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "kolu-server reported an agent-distro delivery, but this padi has no agent-distro bake",
    );
  const stack = report.profiles;
  try {
    switch (report.kind) {
      case "delivering":
        deliveryStarted(stack);
        return;
      case "failed":
        // A stack the setting has left failing is no failure of what this
        // host serves: the receipt is about the current set.
        if (!sameStack(stack, agentDistroSettingStore.get().profiles))
          deliveryDropped(stack);
        else deliveryFailed(stack, { message: report.message });
        return;
      case "landed": {
        // A delivery of a stack the setting has since left (the list changed
        // while it ran) must not replace the set the current stack landed —
        // new terminals would get nothing until the next delivery. It is no
        // failure of this host's either, so the receipt keeps what it says.
        const current = agentDistroSettingStore.get().profiles;
        if (!sameStack(stack, current)) {
          deliveryDropped(stack);
          throw new Error(
            `kolu-server reported a landing for ${JSON.stringify(stack)}, but the Agents setting is now ${JSON.stringify(current)}; the set this host serves is kept`,
          );
        }
        try {
          if (
            !sameStack(
              report.delivered.map((p) => p.reference),
              stack,
            )
          )
            throw new Error(
              `kolu-server reported a landing for ${JSON.stringify(stack)} whose profiles name ${JSON.stringify(report.delivered.map((p) => p.reference))}`,
            );

          landDelivery(bake, stack, {
            bundle: report.bundle,
            profiles: report.delivered,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          deliveryFailed(stack, { message }, "padi");
          throw err;
        }
        return;
      }
      default:
        report satisfies never;
    }
  } finally {
    publishReceiptLoud();
    settle(agentDistroSettingStore.get());
  }
}

/** Publish the receipt and status for the setting padi boots with. Called
 *  once, at boot. */
export function publishAgentDistroAtBoot(): void {
  sweepGcRootsAtBoot();
  publishReceiptLoud();
  settle(agentDistroSettingStore.get());
}

/** At boot, before kolu-server has pushed or delivered anything, remove every
 *  GC root but those of the set this host serves — so a host whose agents are
 *  off (no delivery ever lands to prune) still drops what an older kolu rooted
 *  (a per-profile bundle's bare-name root). A set on record this host cannot
 *  read is the status's to report: nothing is swept then. */
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
