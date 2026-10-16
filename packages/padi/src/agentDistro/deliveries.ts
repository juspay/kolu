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
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { historyLine } from "@juspay/agent-distro/update/history";
import { currentLink, lastSuccessFile } from "@kolu/agent-distro/bundle";
import { staleGcRoots } from "@kolu/agent-distro/gcRoots";
import {
  type DeliveredSet,
  deliveryChanges,
  parseDeliveredSet,
  referencesOf,
} from "@kolu/agent-distro/landing";
import type { AgentUpdateRun } from "@kolu/agent-distro/receipt";
import { log } from "../log.ts";
import type { AgentDistroBake } from "./bake.ts";
import { assertSetOnHost, readOrUndefined } from "./onHost.ts";
import { versionsOf } from "./receipt.ts";

/** A stack, as the delivery record keys it. */
function key(stack: readonly string[]): string {
  return JSON.stringify(stack);
}

/** Stacks kolu-server is delivering to this host right now. */
const delivering = new Set<string>();
/** Each stack's last delivery that landed nothing — when, why (in
 *  kolu-server's or padi's words), and who said so: the one thing the host's
 *  files do not show (a failure writes no history line). Kept while a newer
 *  attempt runs, so it stays the last run until that one ends; cleared when
 *  a set lands. */
const failed = new Map<string, AgentUpdateRun>();

/** Where the deliveries of `stack` stand: one in flight, a failed last one, or
 *  nothing to say (`undefined`). */
export function deliveryOf(
  stack: readonly string[],
):
  | { readonly kind: "delivering" }
  | { readonly kind: "failed"; readonly failure: AgentUpdateRun }
  | undefined {
  if (delivering.has(key(stack))) return { kind: "delivering" };
  const failure = failed.get(key(stack));
  return failure === undefined ? undefined : { kind: "failed", failure };
}

/** `stack`'s last delivery that landed nothing, if any — a newer attempt may
 *  be running. */
export function lastFailureOf(
  stack: readonly string[],
): AgentUpdateRun | undefined {
  return failed.get(key(stack));
}

/** A delivery of `stack` started. */
export function deliveryStarted(stack: readonly string[]): void {
  delivering.add(key(stack));
}

/** A delivery of `stack` failed: whatever serves keeps serving. */
export function deliveryFailed(
  stack: readonly string[],
  message: string,
  by: AgentUpdateRun["by"] = "delivery",
): void {
  delivering.delete(key(stack));
  failed.set(key(stack), {
    at: Date.now(),
    outcome: "failed",
    words: message,
    by,
  });
  log.warn(
    { agentDistroProfiles: stack, message, by },
    "agent-distro delivery did not land",
  );
}

/** A delivery of `stack` ended, and nothing about it is this host's to report
 *  (a stack the setting has since left). */
export function deliveryDropped(stack: readonly string[]): void {
  delivering.delete(key(stack));
  failed.delete(key(stack));
  log.info(
    { agentDistroProfiles: stack },
    "agent-distro report for a stack the setting has left was dropped",
  );
}

/** Write `text` to `path` atomically (a temp file renamed over it). */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.kolu-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** `set` landed (for its own stack): record it — one atomic rename, so a spawn never
 *  reads a half-written record — point upstream's `current` at its package,
 *  stamp `last-success`, remove every GC root but the package's and those of
 *  the landed stack (the setting's own — a landing of any other is refused
 *  before it gets here), and, when anything changed, append upstream's
 *  `updated:` history line naming what. Throws on a set this host does not
 *  hold: kolu-server rooted it here, so its absence is a broken delivery,
 *  never a state to paper over. */
export function landDelivery(
  bake: AgentDistroBake,
  set: DeliveredSet,
  now: Date = new Date(),
): void {
  assertSetOnHost(set);
  const stack = referencesOf(set.profiles);
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
  pruneGcRoots(bake.gcRootsDir, stack);
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

/** Remove every root in `dir` but the package's and those of the profiles
 *  `keep` names (`@kolu/agent-distro/gcRoots`'s `staleGcRoots` — a bare
 *  legacy bundle name included), so only what serves stays protected from
 *  Nix's garbage collection. A root that will not go is logged at error, never
 *  thrown: the set has landed, and a leftover root costs disk, not
 *  correctness. */
export function pruneGcRoots(dir: string, keep: readonly string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    log.error({ err, dir }, "agent-distro GC roots could not be listed");
    return;
  }
  for (const name of staleGcRoots(names, keep)) {
    try {
      rmSync(join(dir, name), { force: true });
    } catch (err) {
      log.error(
        { err, root: name },
        "agent-distro GC root could not be removed",
      );
    }
  }
}

/** Test seam: forget every delivery in flight and every failure. */
export function __resetAgentDistroDeliveriesForTest(): void {
  delivering.clear();
  failed.clear();
}
