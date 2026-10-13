/**
 * What kolu-server has told this host about delivering it bundles — the
 * per-bundle record padi's policy (`./agentDistro.ts`) reads, and the one act
 * a delivery asks of this host: pointing a profile's `current` at the bundle
 * that landed (`land`). Its volatility is the host-side half of a delivery;
 * what the setting means and what is published stay in the policy module.
 *
 * kolu-server does every fetch, copy and root (`@kolu/surface-remote`'s
 * `deliverClosure`); padi never runs Nix for agents. A `landed` bundle is
 * already valid in this host's store and rooted there, so landing it is a
 * symlink flip plus upstream's two files — the `last-success` stamp and a
 * history line in upstream's format (`@kolu/agent-distro/history`), so a host
 * that also runs agent-distro's Home Manager module keeps one log.
 *
 * A failure is recorded as a TYPED reason with its cause — never a remedy:
 * that is worded once, in `@kolu/agent-distro/status`. padi never retries:
 * kolu-server delivers again at its next run (its schedule, a check the user
 * asks for, a reconnect).
 */

import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { agentBinDir, currentLink } from "@kolu/agent-distro/bundle";
import { type AgentUpdateRun, historyLine } from "@kolu/agent-distro/history";
import { lastSuccessFile } from "@kolu/agent-distro/schedule";
import type { AgentDistroFailureReason } from "@kolu/agent-distro/schema";
import { bundleChanges } from "@kolu/agent-distro/versions";
import { log } from "../log.ts";
import type { AgentDistroProfileBake } from "./bake.ts";
import { realpathOrUndefined } from "./onHost.ts";
import { versionsOf } from "./receipt.ts";

/** Why a profile's last delivery failed: the kind, and the cause in words. */
export interface DeliveryFailure {
  readonly reason: AgentDistroFailureReason;
  readonly message: string;
}

/** Bundle profiles kolu-server is delivering to this host right now. */
const delivering = new Set<string>();
/** Bundle profiles whose last delivery failed, and why — cleared when the next
 *  one starts or lands. */
const failed = new Map<string, DeliveryFailure>();
/** Each profile's last delivery that landed nothing — the one thing the host's
 *  files do not show (a failure writes no history line). */
const unlanded = new Map<string, AgentUpdateRun>();

/** Where `profile`'s deliveries stand: one in flight, a failed last one, or
 *  nothing to say (`undefined`). */
export function deliveryOf(
  profile: string,
):
  | { readonly kind: "delivering" }
  | { readonly kind: "failed"; readonly failure: DeliveryFailure }
  | undefined {
  if (delivering.has(profile)) return { kind: "delivering" };
  const failure = failed.get(profile);
  return failure === undefined ? undefined : { kind: "failed", failure };
}

/** `profile`'s last delivery that landed nothing, if any. */
export function unlandedRunOf(profile: string): AgentUpdateRun | undefined {
  return unlanded.get(profile);
}

/** A delivery of `profile` started. */
export function deliveryStarted(profile: string): void {
  delivering.add(profile);
  failed.delete(profile);
}

/** A delivery of `profile` failed: whatever serves keeps serving. */
export function deliveryFailed(
  profile: string,
  failure: DeliveryFailure,
  by: AgentUpdateRun["by"] = "delivery",
): void {
  delivering.delete(profile);
  failed.set(profile, failure);
  unlanded.set(profile, {
    at: Date.now(),
    outcome: "failed",
    words: failure.message,
    by,
  });
  log.warn(
    { agentDistroProfile: profile, ...failure },
    "agent-distro delivery did not land",
  );
}

/** Write `text` to `path` atomically (a temp file renamed over it). */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.kolu-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** `bundle` landed for `profile`: point its `current` at it — one atomic
 *  rename over the old link, so a spawn never sees a half-flipped one — stamp
 *  `last-success`, and, when the bundle changed, append upstream's `updated:`
 *  history line naming what changed. Throws on a
 *  bundle this host does not hold (no `bin/`): kolu-server rooted it here, so
 *  its absence is a broken delivery, never a state to paper over. */
export function landDelivery(
  profile: AgentDistroProfileBake,
  bundle: string,
  now: Date = new Date(),
): void {
  if (!existsSync(agentBinDir(bundle)))
    throw new Error(
      `kolu-server reported ${bundle} landed for '${profile.name}', but this host has no ${agentBinDir(bundle)}`,
    );
  mkdirSync(profile.stateDir, { recursive: true });
  const link = currentLink(profile.stateDir);
  const old = realpathOrUndefined(link);
  const previous = old === undefined ? undefined : versionsOf(old);
  if (old !== bundle) {
    const tmp = `${link}.kolu-tmp`;
    rmSync(tmp, { force: true });
    symlinkSync(bundle, tmp);
    renameSync(tmp, link);
  }
  writeAtomic(
    lastSuccessFile(profile.stateDir),
    `${Math.floor(now.getTime() / 1000)}\n`,
  );
  delivering.delete(profile.name);
  failed.delete(profile.name);
  unlanded.delete(profile.name);
  if (old === bundle) return;
  mkdirSync(dirname(profile.historyFile), { recursive: true });
  appendFileSync(
    profile.historyFile,
    historyLine(
      now,
      profile.name,
      "updated",
      bundleChanges(previous, versionsOf(bundle)),
    ),
  );
  log.info(
    { agentDistroProfile: profile.name, bundle, previous: old },
    "agent-distro bundle landed",
  );
}

/** Test seam: forget every delivery in flight, failure and unlanded run. */
export function __resetAgentDistroDeliveriesForTest(): void {
  delivering.clear();
  failed.clear();
  unlanded.clear();
}
