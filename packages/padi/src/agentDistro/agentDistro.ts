/**
 * agent-distro on THIS host — padi's POLICY for the Agents setting: what it
 * accepts, what it reports, and when it downloads. Its volatility is kolu's own
 * product decisions; the facts it acts on live in their own modules:
 *
 *   - `./bake.ts` — what this build was baked with (profiles, floor, plugins);
 *   - `./onHost.ts` — where agent-distro's bundles are on this host;
 *   - `./layer.ts` — what a terminal spawned now gets, and its record stamp;
 *   - `./updater.ts` + `./updaterProtocol.ts` — running agent-distro's updater.
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference). This module refuses a profile the build does not know,
 * keeps the read-only `agentDistroStatus` cell true, and — on a host with no
 * bundle for the selected profile (a remote host has no floor) — runs the
 * updater once. Nothing retries on its own: a failure is shown in the updater's
 * own words, and the next time the setting turns that profile on, it tries again.
 */

import {
  type AgentDistroSetting,
  type AgentDistroStatus,
  DEFAULT_AGENT_DISTRO_SETTING,
} from "@kolu/padi-client/surface";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  type AgentDistroBake,
  type AgentDistroProfileBake,
  agentDistroBake,
  hostUpdaterConfig,
} from "./bake.ts";
import { resolveAgentLayer } from "./layer.ts";
import { bundleOnHost, hostStateHome, nixOnPath } from "./onHost.ts";
import { runUpdater, writeUpdaterConfig } from "./updater.ts";
import type { UpdaterProgress } from "./updaterProtocol.ts";

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

// ── Download (a host with no bundle for the selected profile) ────────────

/** Profiles whose download is running, with the latest byte counts. */
const downloading = new Map<string, { progress?: UpdaterProgress }>();
/** Profiles whose last download failed, with the updater's message. Cleared
 *  when the setting next turns that profile on — the only retry there is. */
const failed = new Map<string, string>();

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
  const layer = resolveAgentLayer(setting);
  if (layer !== undefined)
    return { kind: "ready", profile: layer.profile, bundle: layer.bundle };
  const running = downloading.get(setting.profile);
  if (running !== undefined)
    return {
      kind: "downloading",
      profile: setting.profile,
      ...(running.progress !== undefined ? { progress: running.progress } : {}),
    };
  const message = failed.get(setting.profile);
  if (message !== undefined)
    return { kind: "error", profile: setting.profile, message };
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
    startDownload(bake, profile);
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
  if (next.enabled) failed.delete(next.profile);
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

/** Start `profile`'s one download. Every way it can fail — no `nix`, a config
 *  that will not write, the updater's own failure or skip, a protocol
 *  violation, a throw while reading the result — ends as a recorded failure (the
 *  host's `error` status) and a loud log line; none is swallowed and none
 *  retries on its own. */
function startDownload(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
): void {
  const plog = log.child({ agentDistroProfile: profile.name });
  const fail = (message: string, err?: unknown) => {
    downloading.delete(profile.name);
    failed.set(profile.name, message);
    plog.error({ err, message }, "agent-distro download failed");
  };
  if (nixOnPath() === undefined) {
    fail(
      "nix is not on padi's PATH on this host, so the agents cannot be downloaded — make `nix` reachable for non-login ssh sessions — add /nix/var/nix/profiles/default/bin to PATH in /etc/environment (or at the very top of ~/.bashrc, before any early return for non-interactive shells) — then turn Agents off and on",
    );
    return;
  }
  let config: ReturnType<typeof writeUpdaterConfig>;
  try {
    config = writeUpdaterConfig(
      hostUpdaterConfig(bake, profile, hostStateHome()).text,
    );
  } catch (err) {
    fail(`could not prepare the updater: ${String(err)}`, err);
    return;
  }
  downloading.set(profile.name, {});
  plog.info({}, "downloading agent-distro bundle");
  void runUpdater({
    command: profile.command,
    configPath: config.configPath,
    onProgress: (progress) => {
      downloading.set(profile.name, { progress });
      republish();
    },
  })
    .then((outcome) => {
      if (!outcome.ok) {
        // A skip (cache unusable, bundle not fully cached) exits 0 but is a
        // `skipped` result: nothing landed, and its reason says why.
        fail(outcome.message);
      } else if (bundleOnHost(bake, profile) === undefined) {
        fail(
          `the updater reported "${outcome.message}" but this host has no current bundle for ${profile.name}`,
        );
      } else {
        downloading.delete(profile.name);
        plog.info({}, "agent-distro bundle ready");
      }
    })
    .catch((err: unknown) =>
      fail(`reading the download's result failed: ${String(err)}`, err),
    )
    .finally(() => {
      // Status first: nothing below may keep the host's tab from moving on.
      republish();
      try {
        config.remove();
      } catch (err) {
        // A leftover temp config is litter, not a failed download.
        plog.error({ err }, "could not remove the updater's temp config");
      }
    });
}

/** Test seam: forget every download and failure. */
export function __resetAgentDistroDownloadsForTest(): void {
  downloading.clear();
  failed.clear();
}
