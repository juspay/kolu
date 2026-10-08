/**
 * A host's runs of agent-distro's updater for a profile — the STATE MACHINE
 * padi's policy (`./agentDistro.ts`) drives: which profiles have a run going
 * (with their byte counts), which failed and why, and the one run that moves a
 * profile between them. Its volatility is the run itself; what the setting
 * means, when a run is due, and what is published stay in the policy module.
 *
 * Two kinds of run, decided when it starts:
 *
 *   - a FIRST download — the host has no bundle for the profile, so new
 *     terminals get nothing until it lands, and a run that does not land is
 *     the host's failure (`failed`, with a typed reason);
 *   - an UPDATE — a bundle already serves (`serving`). It keeps serving for
 *     the whole run (the updater flips `current` before it reports, so `current`
 *     is never read mid-run), and a run that skips, fails, or lands something
 *     other than what it reported leaves it serving: a background update that
 *     does not land is NOT the host's failure. If `current` moved anyway, that
 *     path is disowned and the old bundle is KEPT serving
 *     ({@link keptBundleOf}). The run is kept as the profile's last unlanded run
 *     ({@link unlandedRunOf}) for the receipt, and logged.
 *
 * A failure is recorded as a TYPED reason with its cause — never a remedy or a
 * retry instruction: those are worded once, in `@kolu/agent-distro/status`.
 * Nothing retries on its own; the policy forgets a failure when the setting
 * turns that profile on again.
 */

import type { AgentDistroFailureReason } from "@kolu/agent-distro/schema";
import type { AgentUpdateRun } from "@kolu/agent-distro/history";
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

/** A run in flight: its latest byte counts, and — for an update — the bundle
 *  that keeps serving until it lands. */
interface Run {
  readonly progress?: UpdaterProgress;
  readonly serving?: string;
}

/** Profiles with a run going. */
const running = new Map<string, Run>();
/** Profiles whose last FIRST download failed. */
const failed = new Map<string, DownloadFailure>();
/** The bundle a profile's `current` points at that a run DISOWNED: the
 *  updater said it landed another. Outlives {@link forgetFailure} — the retry
 *  must download again, not adopt it — and is cleared only when a run lands
 *  and the host resolves exactly what the updater reported. */
const disowned = new Map<string, string>();
/** Each profile's last run that landed nothing (skipped or failed) — the one
 *  thing the updater's own files may not show: a crash writes no history line,
 *  and a repeated skip is written once. */
const unlanded = new Map<string, AgentUpdateRun>();
/** The bundle that keeps serving after an update that did not land cleanly
 *  while `current` moved to a path it disowned. Cleared when a run lands. */
const kept = new Map<string, string>();

/** Where `profile`'s runs stand: one running (with bytes, and the bundle that
 *  serves meanwhile when it is an update), a failed first download, or nothing
 *  (`undefined`). */
export function downloadOf(profile: string):
  | {
      readonly kind: "running";
      readonly progress?: UpdaterProgress;
      readonly serving?: string;
    }
  | { readonly kind: "failed"; readonly failure: DownloadFailure }
  | undefined {
  const run = running.get(profile);
  if (run !== undefined) return { kind: "running", ...run };
  const failure = failed.get(profile);
  return failure === undefined ? undefined : { kind: "failed", failure };
}

/** Forget `profile`'s last failure — the policy's retry. A bundle that failure
 *  disowned stays disowned ({@link disownedBundleOf}). */
export function forgetFailure(profile: string): void {
  failed.delete(profile);
}

/** The bundle on this host that a run of `profile` disowned, if any: what
 *  `current` points at is not the bundle the updater reported, so no terminal
 *  may get it. */
export function disownedBundleOf(profile: string): string | undefined {
  return disowned.get(profile);
}

/** The bundle `profile` keeps serving after an update that did not land
 *  cleanly, while `current` points at a disowned path. */
export function keptBundleOf(profile: string): string | undefined {
  return kept.get(profile);
}

/** `profile`'s last run that landed nothing, if any. */
export function unlandedRunOf(profile: string): AgentUpdateRun | undefined {
  return unlanded.get(profile);
}

/** Start `profile`'s one run: a first download, or — given the bundle that
 *  serves now — an update. Every way it can fail — no `nix`, a config that will
 *  not write, the updater's own failure or skip, a protocol violation, a landed
 *  bundle this host does not resolve, a throw while reading the result — ends
 *  as a recorded outcome and a loud log line; none is swallowed. `onProgress`
 *  runs at each byte count, `onSettled` once the run has ended however it
 *  ended, so the policy can re-publish. Refuses (throws) while a run of
 *  `profile` is going — one at a time. */
export function startRun(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
  serving: string | undefined,
  on: { readonly onProgress: () => void; readonly onSettled: () => void },
): void {
  if (running.has(profile.name))
    throw new Error(
      `agent-distro: a run for '${profile.name}' is already going; one at a time`,
    );
  const update = serving !== undefined;
  const plog = log.child({ agentDistroProfile: profile.name, update });
  /** A run that landed nothing. A first download's is the host's failure; an
   *  update's leaves the serving bundle serving, and is only kept and logged. */
  const unlandedEnd = (
    outcome: "skipped" | "failed",
    reason: AgentDistroFailureReason,
    message: string,
    err?: unknown,
  ) => {
    running.delete(profile.name);
    unlanded.set(profile.name, { at: Date.now(), outcome, words: message });
    if (serving !== undefined) {
      keepServing(serving);
      plog.warn(
        { err, outcome, message },
        "agent-distro update did not land; the current agents keep serving",
      );
      return;
    }
    failed.set(profile.name, { reason, message });
    plog.error({ err, reason, message }, "agent-distro download failed");
  };
  /** An update that did not land cleanly: if `current` moved anyway (a crash
   *  after the flip, a landing other than the one reported), disown that path
   *  and keep the bundle that served. */
  const keepServing = (old: string) => {
    let here: string | undefined;
    try {
      here = bundleOnHost(bake, profile);
    } catch (err) {
      plog.error({ err }, "could not resolve this host's current bundle");
    }
    if (here === undefined || here === old) return;
    disowned.set(profile.name, here);
    kept.set(profile.name, old);
  };
  /** A host that resolves something other than what the updater reported:
   *  never a bundle any terminal gets. For a first download that is the
   *  host's failure; for an update the old bundle keeps serving. */
  const mismatch = (message: string) => {
    if (update) {
      plog.error(
        { message },
        "agent-distro update landed an unreported bundle",
      );
      unlandedEnd("failed", "updater", message);
      return;
    }
    running.delete(profile.name);
    failed.set(profile.name, { reason: "updater", message });
    plog.error({ message }, "agent-distro run landed an unreported bundle");
  };
  if (nixOnPath() === undefined) {
    unlandedEnd(
      "failed",
      "nixMissing",
      "nix is not on padi's PATH on this host, so the agents cannot be downloaded",
    );
    return;
  }
  let config: ReturnType<typeof writeUpdaterConfig>;
  try {
    config = writeUpdaterConfig(profile.configText);
  } catch (err) {
    unlandedEnd(
      "failed",
      "updater",
      `could not prepare the updater: ${String(err)}`,
      err,
    );
    return;
  }
  running.set(profile.name, update ? { serving } : {});
  plog.info(
    { serving },
    update
      ? "checking for an agent-distro update"
      : "downloading agent-distro bundle",
  );
  void runUpdater({
    command: profile.command,
    configPath: config.configPath,
    onProgress: (progress) => {
      running.set(profile.name, update ? { progress, serving } : { progress });
      on.onProgress();
    },
  })
    .then((outcome) => {
      if (!outcome.ok) {
        // A skip (cache unusable, bundle not fully cached) exits 0 but is a
        // `skipped` result: nothing landed, and its reason says why.
        unlandedEnd(outcome.result, "updater", outcome.message);
        return;
      }
      // The updater names the bundle it settled on; this host must now resolve
      // exactly that one, or new terminals would get something else.
      const here = bundleOnHost(bake, profile);
      if (here !== outcome.bundle) {
        if (here !== undefined && !update) disowned.set(profile.name, here);
        mismatch(
          here === undefined
            ? `the updater landed ${outcome.bundle}, but this host has no current bundle for ${profile.name}`
            : `the updater landed ${outcome.bundle}, but this host resolves ${here} for ${profile.name}`,
        );
        return;
      }
      running.delete(profile.name);
      disowned.delete(profile.name);
      kept.delete(profile.name);
      unlanded.delete(profile.name);
      plog.info(
        { bundle: here, result: outcome.result },
        "agent-distro bundle ready",
      );
    })
    .catch((err: unknown) =>
      unlandedEnd(
        "failed",
        "updater",
        `reading the run's result failed: ${String(err)}`,
        err,
      ),
    )
    .finally(() => {
      // Status first: nothing below may keep the host's tab from moving on.
      on.onSettled();
      try {
        config.remove();
      } catch (err) {
        // A leftover temp config is litter, not a failed run.
        plog.error({ err }, "could not remove the updater's temp config");
      }
    });
}

/** Test seam: forget every run, failure, disowned bundle and unlanded run. */
export function __resetAgentDistroDownloadsForTest(): void {
  running.clear();
  failed.clear();
  disowned.clear();
  unlanded.clear();
  kept.clear();
}

/** Test seam: put `profile`'s run in a state without running one. */
export function __setDownloadForTest(
  profile: string,
  state: { kind: "running" } | { kind: "failed"; failure: DownloadFailure },
): void {
  if (state.kind === "running") running.set(profile, {});
  else failed.set(profile, state.failure);
}
