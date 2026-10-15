/**
 * What kolu-server has told this host about delivering it the setting's set —
 * the per-stack record padi's policy (`./agentDistro.ts`) reads, and the one
 * act a delivery asks of this host: recording the set that landed (`land`).
 * Its volatility is the host-side half of a delivery; what the setting means
 * and what is published stay in the policy module.
 *
 * kolu-server decides what lands — it builds the profiles and has this host's
 * Nix pull or receive every path over ssh, rooted — and padi itself never runs
 * Nix for agents. A `landed` set is already valid in this host's store and
 * rooted there, so landing it is a record and a symlink flip plus upstream's
 * two files: the `last-success` stamp and a history line in upstream's format
 * (`@juspay/agent-distro/update/history`), so a host that also runs
 * agent-distro's Home Manager module keeps one log.
 *
 * A failure is recorded with its cause, in kolu-server's words. padi never
 * retries: kolu-server delivers again at its next run (its schedule, a check
 * the user asks for, a reconnect).
 */

import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { historyLine } from "@juspay/agent-distro/update/history";
import { currentLink, lastSuccessFile } from "@kolu/agent-distro/bundle";
import {
  type DeliveredSet,
  deliveryChanges,
  parseDeliveredSet,
} from "@kolu/agent-distro/landing";
import type { AgentUpdateRun } from "@kolu/agent-distro/receipt";
import { log } from "../log.ts";
import type { AgentDistroBake } from "./bake.ts";
import { assertSetOnHost, readOrUndefined } from "./onHost.ts";
import { versionsOf } from "./receipt.ts";

/** Why the last delivery failed, in kolu-server's (or padi's) words. */
export interface DeliveryFailure {
  readonly message: string;
}

/** A stack, as the delivery record keys it. */
function key(stack: readonly string[]): string {
  return JSON.stringify(stack);
}

/** Stacks kolu-server is delivering to this host right now. */
const delivering = new Set<string>();
/** Stacks whose last delivery failed, and why — cleared when the next one
 *  starts or lands. */
const failed = new Map<string, DeliveryFailure>();
/** The last delivery that landed nothing — the one thing the host's files do
 *  not show (a failure writes no history line). */
let unlanded: AgentUpdateRun | undefined;

/** Where the deliveries of `stack` stand: one in flight, a failed last one, or
 *  nothing to say (`undefined`). */
export function deliveryOf(
  stack: readonly string[],
):
  | { readonly kind: "delivering" }
  | { readonly kind: "failed"; readonly failure: DeliveryFailure }
  | undefined {
  if (delivering.has(key(stack))) return { kind: "delivering" };
  const failure = failed.get(key(stack));
  return failure === undefined ? undefined : { kind: "failed", failure };
}

/** The last delivery that landed nothing, if any. */
export function unlandedRun(): AgentUpdateRun | undefined {
  return unlanded;
}

/** A delivery of `stack` started. */
export function deliveryStarted(stack: readonly string[]): void {
  delivering.add(key(stack));
  failed.delete(key(stack));
}

/** A delivery of `stack` failed: whatever serves keeps serving. */
export function deliveryFailed(
  stack: readonly string[],
  failure: DeliveryFailure,
  by: AgentUpdateRun["by"] = "delivery",
): void {
  delivering.delete(key(stack));
  failed.set(key(stack), failure);
  unlanded = {
    at: Date.now(),
    outcome: "failed",
    words: failure.message,
    by,
  };
  log.warn(
    { agentDistroProfiles: stack, ...failure },
    "agent-distro delivery did not land",
  );
}

/** Write `text` to `path` atomically (a temp file renamed over it). */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.kolu-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** `set` landed for `stack`: record it — one atomic rename, so a spawn never
 *  reads a half-written record — point upstream's `current` at its package,
 *  stamp `last-success`, and, when anything changed, append upstream's
 *  `updated:` history line naming what. Throws on a set this host does not
 *  hold: kolu-server rooted it here, so its absence is a broken delivery,
 *  never a state to paper over. */
export function landDelivery(
  bake: AgentDistroBake,
  stack: readonly string[],
  set: DeliveredSet,
  now: Date = new Date(),
): void {
  assertSetOnHost(set);
  const oldText = readOrUndefined(bake.landedFile);
  const old = oldText === undefined ? undefined : parseDeliveredSet(oldText);
  mkdirSync(dirname(bake.landedFile), { recursive: true });
  writeAtomic(bake.landedFile, `${JSON.stringify(set)}\n`);
  mkdirSync(bake.stateDir, { recursive: true });
  const link = currentLink(bake.stateDir);
  const tmp = `${link}.kolu-tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(set.bundle, tmp);
  renameSync(tmp, link);
  writeAtomic(
    lastSuccessFile(bake.stateDir),
    `${Math.floor(now.getTime() / 1000)}\n`,
  );
  delivering.delete(key(stack));
  failed.delete(key(stack));
  unlanded = undefined;
  const words = deliveryChanges(
    old === undefined
      ? undefined
      : { set: old, versions: versionsOf(old.bundle) },
    { set, versions: versionsOf(set.bundle) },
  );
  if (words === "") return;
  mkdirSync(dirname(bake.historyFile), { recursive: true });
  appendFileSync(bake.historyFile, historyLine(`updated: ${words}`, now));
  log.info(
    { bundle: set.bundle, profiles: set.profiles, previous: old },
    "agent-distro set landed",
  );
}

/** Test seam: forget every delivery in flight, failure and unlanded run. */
export function __resetAgentDistroDeliveriesForTest(): void {
  delivering.clear();
  failed.clear();
  unlanded = undefined;
}
