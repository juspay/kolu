/**
 * agent-distro on THIS host — padi's POLICY for the Agents setting: what it
 * accepts, what it reports, and what a delivery means here. Its volatility is
 * kolu's own product decisions; the facts it acts on live in their own modules:
 *
 *   - `./bake.ts` — what this build was baked with (profiles, floor, plugins);
 *   - `./onHost.ts` — where agent-distro's bundles are on this host;
 *   - `./layer.ts` — the layer a bundle on disk gives, and its record stamp;
 *   - `./deliveries.ts` — what kolu-server has told this host about delivering
 *     it bundles, and landing one (`current` flipped, upstream's files written);
 *   - `./receipt.ts` — what upstream's files on the host say about deliveries.
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference), and DELIVERS the setting's bundle — it fetches,
 * copies and roots it on its own schedule and reports each step through
 * `agentDistro.report` ({@link onAgentDistroReport}). padi never fetches,
 * builds or retries anything: a host needs neither flakes, GitHub, nor `nix` on
 * padi's PATH for its agents. This module keeps the read-only cells true:
 * `agentDistroStatus` (what a new terminal gets here), `agentDistroReceipt`
 * (what landed, and the last delivery that did not) and `agentDistroResolved`.
 *
 * A bundle that serves keeps serving while a newer one is delivered and after
 * a delivery that fails: only a host with nothing to serve reports the failure
 * as its status.
 */

import { log } from "../log.ts";
import {
  type AgentDistroDeliveryReport,
  type AgentDistroSetting,
  type AgentDistroStatus,
  bundleProfileOf,
  DEFAULT_AGENT_DISTRO_SETTING,
  EMPTY_AGENT_DISTRO_RECEIPT,
} from "@kolu/agent-distro/schema";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { agentDistroBake } from "./bake.ts";
import {
  deliveringProfiles,
  deliveryFailed,
  deliveryOf,
  deliveryStarted,
  landDelivery,
  unlandedRunOf,
} from "./deliveries.ts";
import { resolveProfileOnHost } from "./inEffect.ts";
import { type AgentLayer, layerOnHost } from "./layer.ts";
import { bundleOnHost } from "./onHost.ts";
import { readReceipt } from "./receipt.ts";

/** The backing store of the `agentDistro` cell, shared by the cell declaration
 *  and the spawn path — so a spawn resolves against exactly what the binder
 *  wrote (the `newTerminalPolicyStore` arrangement). */
export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

/** The bundle `profile` rides on this host ({@link bundleProfileOf} against
 *  the bake's bundles; every name rides the vanilla one on an unbaked padi,
 *  which has none to look up). */
function bundleName(profile: string): string {
  return bundleProfileOf(profile, agentDistroBake()?.profiles ?? new Set());
}

/** Publish what this host keeps of `setting`'s profile's deliveries —
 *  readable with agents off too (the profile the setting still names) — and
 *  which profiles have a delivery in flight. Nothing else to say on an unbaked
 *  padi or before the first push (no profile). */
function publishReceipt(setting: AgentDistroSetting): void {
  const bake = agentDistroBake();
  const profile = bake?.profiles.get(bundleName(setting.profile));
  if (bake === null || profile === undefined) {
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      profile: setting.profile,
      running: [...deliveringProfiles()],
    });
    return;
  }
  // Named for the setting's profile — a reference's receipt is its bundle's —
  // so a reader pairs it with the setting it is about.
  padiSurfaceCtx.cells.agentDistroReceipt.set({
    ...readReceipt(
      profile,
      bundleOnHost(bake, profile),
      unlandedRunOf(profile.name),
      deliveringProfiles(),
    ),
    profile: setting.profile,
  });
}

/** {@link publishReceipt}, never thrown into a caller that cannot act on it:
 *  a file that will not read (a history line upstream changed the shape of,
 *  say) is logged loudly AND published as the receipt's `error`, so the host's
 *  line in Settings says so instead of keeping the last good receipt. */
function publishReceiptLoud(setting: AgentDistroSetting): void {
  try {
    publishReceipt(setting);
  } catch (err) {
    log.error({ err }, "agent-distro receipt could not be read");
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      profile: setting.profile,
      running: [...deliveringProfiles()],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Where `setting` stands on this host, as of now, without side effects — the
 *  ONE answer to "what does a new terminal get here": the published status is
 *  this with the layer reduced to its profile and bundle, and the spawn path
 *  stamps this layer ({@link newTerminalLayer}). So a host never reads one
 *  thing while its new terminals get another. */
export function assessAgentDistro(setting: AgentDistroSetting):
  | Exclude<AgentDistroStatus, { kind: "ready" }>
  | {
      readonly kind: "ready";
      readonly layer: AgentLayer;
      /** A newer bundle is being delivered; `layer` keeps serving until it
       *  lands. */
      readonly update?: Extract<AgentDistroStatus, { kind: "ready" }>["update"];
    } {
  if (!setting.enabled) return { kind: "off" };
  if (agentDistroBake() === null) return { kind: "unavailable" };
  const delivery = deliveryOf(bundleName(setting.profile));
  const layer = layerOnHost(setting);
  if (layer !== undefined)
    return {
      kind: "ready",
      layer,
      ...(delivery?.kind === "delivering" ? { update: {} } : {}),
    };
  if (delivery?.kind === "failed")
    return {
      kind: "error",
      profile: setting.profile,
      reason: delivery.failure.reason,
      message: delivery.failure.message,
    };
  // Nothing serves and nothing failed: kolu-server delivers this host's
  // bundle as it binds it (and as the setting reaches it), so the host is
  // waiting on a delivery that is coming or under way.
  return { kind: "downloading", profile: setting.profile };
}

/** What a terminal spawned NOW gets on this host — the same answer the host's
 *  status gives ({@link assessAgentDistro}): a layer only when it reads ready. */
export function newTerminalLayer(): AgentLayer | undefined {
  const assessed = assessAgentDistro(agentDistroSettingStore.get());
  return assessed.kind === "ready" ? assessed.layer : undefined;
}

/** Publish `setting`'s status on this host, and keep its resolved cell about
 *  it. */
function settle(setting: AgentDistroSetting): void {
  const assessed = assessAgentDistro(setting);
  resolveSettingOnHost(
    setting,
    assessed.kind === "ready" ? assessed.layer.bundle : undefined,
  );
  padiSurfaceCtx.cells.agentDistroStatus.set(
    assessed.kind === "ready"
      ? {
          kind: "ready",
          profile: assessed.layer.profile,
          bundle: assessed.layer.bundle,
          ...(assessed.update === undefined ? {} : { update: assessed.update }),
        }
      : assessed,
  );
}

/** The current ask of the `agentDistroResolved` cell — an answer publishes
 *  only while its ask (by identity) is still the current one. */
let resolveAsk: { readonly profile: string } | undefined;

/** Keep the `agentDistroResolved` cell about `setting`: `none` while there is
 *  nothing to ask (agents off, or no bundle serving yet — `bundle` undefined);
 *  once a bundle serves, ask agent-distro ONCE per setting whether its profile
 *  resolves (`pending` until it answers). Turning agents off and on asks
 *  again — the retry for a profile that did not resolve. */
function resolveSettingOnHost(
  setting: AgentDistroSetting,
  bundle: string | undefined,
): void {
  const cell = padiSurfaceCtx.cells.agentDistroResolved;
  if (!setting.enabled || bundle === undefined) {
    resolveAsk = undefined;
    cell.set({ kind: "none" });
    return;
  }
  if (resolveAsk?.profile === setting.profile) return;
  const ask = { profile: setting.profile };
  resolveAsk = ask;
  cell.set({ kind: "pending", profile: ask.profile });
  void resolveProfileOnHost({ bundle, profile: ask.profile }).then((answer) => {
    if (resolveAsk === ask) cell.set(answer);
  });
}

/** The `agentDistro` cell's `onWrite`: a CHANGED setting (the cell's `equals`
 *  drops a re-push of the same value, so a reconnect does not land here). Fires
 *  BEFORE the store write, so it reads `next`, never the store. */
export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  settle(next);
  publishReceiptLoud(next);
}

/** `agentDistro.report`: kolu-server's word on a delivery to this host. A
 *  landing points the profile's `current` at the bundle; if that cannot be
 *  done here (the bundle is not on this host, the state dir will not write) it
 *  is this host's failure, recorded in padi's words AND thrown back, so
 *  kolu-server's log has it too. Re-publishes the receipt first, then the
 *  status — so a client that sees the new bundle can already read what
 *  changed. Throws on a profile this padi does not know: a binder and a padi
 *  that disagree on the listing is a broken pair, not a state to degrade to. */
export function onAgentDistroReport(report: AgentDistroDeliveryReport): void {
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "kolu-server reported an agent-distro delivery, but this padi has no agent-distro bake",
    );
  const profile = bake.profiles.get(report.profile);
  if (profile === undefined)
    throw new Error(
      `kolu-server reported a delivery of '${report.profile}', which this padi's profiles listing does not name`,
    );
  try {
    switch (report.kind) {
      case "delivering":
        deliveryStarted(profile.name);
        return;
      case "failed":
        deliveryFailed(profile.name, {
          reason: report.reason,
          message: report.message,
        });
        return;
      case "landed":
        try {
          landDelivery(profile, report.bundle);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          deliveryFailed(profile.name, { reason: "delivery", message }, "padi");
          throw err;
        }
        return;
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
  const setting = agentDistroSettingStore.get();
  publishReceiptLoud(setting);
  settle(setting);
}
