/**
 * agent-distro on THIS host — padi's POLICY for the Agents setting: what it
 * accepts, what it reports, and when it downloads. Its volatility is kolu's own
 * product decisions; the facts it acts on live in their own modules:
 *
 *   - `./bake.ts` — what this build was baked with (profiles, floor, plugins);
 *   - `./onHost.ts` — where agent-distro's bundles are on this host;
 *   - `./layer.ts` — what a terminal spawned now gets, and its record stamp;
 *   - `./download.ts` — the download state machine (running · failed, with a
 *     typed reason) and its one run of agent-distro's updater (`./updater.ts`;
 *     the line format is `@kolu/agent-distro/progress`).
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference). This module refuses a profile the build does not know,
 * keeps the read-only `agentDistroStatus` cell true, and — on a host with no
 * bundle for the selected profile (a remote host has no floor) — runs the
 * updater once. Nothing retries on its own: a failure is published with its typed
 * reason and cause, and the next time the setting turns that profile on, it tries
 * again (the remedy and retry are worded in `@kolu/agent-distro/status`).
 */

import {
  type AgentDistroSetting,
  type AgentDistroStatus,
  DEFAULT_AGENT_DISTRO_SETTING,
} from "@kolu/agent-distro/schema";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { agentDistroBake } from "./bake.ts";
import { downloadOf, forgetFailure, startDownload } from "./download.ts";
import { resolveAgentLayer } from "./layer.ts";

/** The backing store of the `agentDistro` cell, shared by the cell declaration
 *  and the spawn path — so a spawn resolves against exactly what the binder
 *  wrote (the `newTerminalPolicyStore` arrangement). */
export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

/** The `agentDistro` cell's write gate (`onMutate`): refuse to turn on a profile
 *  this build does not know. The user's choice is never mapped to another
 *  profile — the push fails loudly and kolu-server logs it. An unbaked padi
 *  takes any value (it gives nothing either way, and says so in its status). */
export function checkAgentDistroSetting(next: AgentDistroSetting): void {
  if (!next.enabled) return;
  const bake = agentDistroBake();
  if (bake === null) return;
  if (!bake.profiles.has(next.profile)) {
    throw new Error(
      `unknown agent-distro profile '${next.profile}'; this host knows ${[...bake.profiles.keys()].join(", ")}`,
    );
  }
}

function publishStatus(status: AgentDistroStatus): void {
  padiSurfaceCtx.cells.agentDistroStatus.set(status);
}

/** Where `setting` stands on this host, as of now, without side effects.
 *  `needsDownload` is NOT a status anyone sees: it is the one state a caller
 *  must act on (start the download) before there is something true to publish,
 *  so it is kept out of {@link AgentDistroStatus} rather than spelled as a
 *  `downloading` that nothing is doing. */
export function assessAgentDistro(
  setting: AgentDistroSetting,
):
  | AgentDistroStatus
  | { readonly kind: "needsDownload"; readonly profile: string } {
  if (!setting.enabled) return { kind: "off" };
  const bake = agentDistroBake();
  if (bake === null) return { kind: "unavailable" };
  // A download's own state comes FIRST: a download starts only when there is
  // no bundle, and the updater flips `current` before it reports — so while it
  // runs, or after it failed (say, it landed a bundle other than the one it
  // reported), an existing `current` is not yet a fact to call ready.
  const download = downloadOf(setting.profile);
  if (download?.kind === "running")
    return {
      kind: "downloading",
      profile: setting.profile,
      ...(download.progress !== undefined
        ? { progress: download.progress }
        : {}),
    };
  if (download?.kind === "failed")
    return {
      kind: "error",
      profile: setting.profile,
      reason: download.failure.reason,
      message: download.failure.message,
    };
  const layer = resolveAgentLayer(setting);
  if (layer !== undefined)
    return { kind: "ready", profile: layer.profile, bundle: layer.bundle };
  return { kind: "needsDownload", profile: setting.profile };
}

/** Bring this host's status in line with `setting` and publish it: a profile
 *  with no bundle, no running download and no recorded failure gets its one
 *  download started first, so what is published is always something true. */
function settle(setting: AgentDistroSetting): void {
  let assessed = assessAgentDistro(setting);
  if (assessed.kind === "needsDownload") {
    const bake = agentDistroBake();
    const profile = bake?.profiles.get(setting.profile);
    // `assessAgentDistro` only answers `needsDownload` for a baked, known
    // profile (`resolveAgentLayer` throws on an unknown one).
    if (bake === null || profile === undefined)
      throw new Error(`agent-distro: no bake for profile '${setting.profile}'`);
    startDownload(bake, profile, republish);
    assessed = assessAgentDistro(setting);
    if (assessed.kind === "needsDownload")
      throw new Error(
        `agent-distro: starting the '${setting.profile}' download recorded neither a run nor a failure`,
      );
  }
  publishStatus(assessed);
}

/** The `agentDistro` cell's `onWrite`: a CHANGED setting (the cell's `equals`
 *  drops a re-push of the same value, so a reconnect does not land here). Fires
 *  BEFORE the store write, so it reads `next`, never the store. Turning a
 *  profile on forgets its last failure — that is the retry. */
export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  if (next.enabled) forgetFailure(next.profile);
  settle(next);
}

/** Re-publish for whatever setting is current — after a download settles or
 *  reports bytes. A download for a profile no longer selected changes nothing
 *  visible, but its result is kept for when it is. */
function republish(): void {
  try {
    settle(agentDistroSettingStore.get());
  } catch (err) {
    // Runs from a download's own callbacks, where a throw has nowhere to go but
    // an unhandled rejection; logged loudly instead.
    log.error({ err }, "agent-distro status could not be re-published");
  }
}
