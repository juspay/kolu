/**
 * A host's download of a profile's bundle — the STATE MACHINE padi's policy
 * (`./agentDistro.ts`) drives: which profiles are downloading (with their byte
 * counts), which failed and why, and the one run that moves a profile between
 * them. Its volatility is the download itself; what the setting means, and
 * what is published, stay in the policy module.
 *
 * A failure is recorded as a TYPED reason with its cause — never a remedy or a
 * retry instruction: those are worded once, in `@kolu/agent-distro/status`.
 * Nothing retries on its own; the policy forgets a failure when the setting
 * turns that profile on again.
 */

import type { AgentDistroFailureReason } from "@kolu/agent-distro/schema";
import type { UpdaterProgress } from "@kolu/agent-distro/progress";
import { log } from "../log.ts";
import type { AgentDistroBake, AgentDistroProfileBake } from "./bake.ts";
import { bundleOnHost, nixOnPath } from "./onHost.ts";
import { runUpdater, writeUpdaterConfig } from "./updater.ts";

/** Why a profile's last download failed: the kind, and the cause in words. */
export interface DownloadFailure {
  readonly reason: AgentDistroFailureReason;
  readonly message: string;
}

/** Profiles whose download is running, with the latest byte counts. */
const running = new Map<string, { progress?: UpdaterProgress }>();
/** Profiles whose last download failed. */
const failed = new Map<string, DownloadFailure>();

/** Where `profile`'s download stands: running (with bytes), failed, or never
 *  started / forgotten (`undefined`). */
export function downloadOf(
  profile: string,
):
  | { readonly kind: "running"; readonly progress?: UpdaterProgress }
  | { readonly kind: "failed"; readonly failure: DownloadFailure }
  | undefined {
  const run = running.get(profile);
  if (run !== undefined) return { kind: "running", ...run };
  const failure = failed.get(profile);
  return failure === undefined ? undefined : { kind: "failed", failure };
}

/** Forget `profile`'s last failure — the policy's retry. */
export function forgetFailure(profile: string): void {
  failed.delete(profile);
}

/** Start `profile`'s one download. Every way it can fail — no `nix`, a config
 *  that will not write, the updater's own failure or skip, a protocol
 *  violation, a landed bundle this host does not resolve, a throw while reading
 *  the result — ends as a recorded failure and a loud log line; none is
 *  swallowed. `onChange` runs after every change (bytes, landing, failure) so
 *  the policy can re-publish. */
export function startDownload(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
  onChange: () => void,
): void {
  const plog = log.child({ agentDistroProfile: profile.name });
  const fail = (
    reason: AgentDistroFailureReason,
    message: string,
    err?: unknown,
  ) => {
    running.delete(profile.name);
    failed.set(profile.name, { reason, message });
    plog.error({ err, reason, message }, "agent-distro download failed");
  };
  if (nixOnPath() === undefined) {
    fail(
      "nixMissing",
      "nix is not on padi's PATH on this host, so the agents cannot be downloaded",
    );
    return;
  }
  let config: ReturnType<typeof writeUpdaterConfig>;
  try {
    config = writeUpdaterConfig(profile.configText);
  } catch (err) {
    fail("updater", `could not prepare the updater: ${String(err)}`, err);
    return;
  }
  running.set(profile.name, {});
  plog.info({}, "downloading agent-distro bundle");
  void runUpdater({
    command: profile.command,
    configPath: config.configPath,
    onProgress: (progress) => {
      running.set(profile.name, { progress });
      onChange();
    },
  })
    .then((outcome) => {
      if (!outcome.ok) {
        // A skip (cache unusable, bundle not fully cached) exits 0 but is a
        // `skipped` result: nothing landed, and its reason says why.
        fail("updater", outcome.message);
        return;
      }
      // The updater names the bundle it landed; this host must now resolve
      // exactly that one, or new terminals would get something else.
      const here = bundleOnHost(bake, profile);
      if (here !== outcome.bundle) {
        fail(
          "updater",
          here === undefined
            ? `the updater landed ${outcome.bundle}, but this host has no current bundle for ${profile.name}`
            : `the updater landed ${outcome.bundle}, but this host resolves ${here} for ${profile.name}`,
        );
        return;
      }
      running.delete(profile.name);
      plog.info({ bundle: here }, "agent-distro bundle ready");
    })
    .catch((err: unknown) =>
      fail(
        "updater",
        `reading the download's result failed: ${String(err)}`,
        err,
      ),
    )
    .finally(() => {
      // Status first: nothing below may keep the host's tab from moving on.
      onChange();
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
  running.clear();
  failed.clear();
}
