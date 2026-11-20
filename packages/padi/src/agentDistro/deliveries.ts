import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { historyLine } from "@juspay/agent-distro/update/history";
import { appendHistory } from "@juspay/agent-distro/update/history-log";
import {
  currentLink,
  lastSuccessFile,
} from "@juspay/agent-distro/update/state";
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

function key(stack: readonly string[]): string {
  return JSON.stringify(stack);
}

const delivering = new Set<string>();
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

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.kolu-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

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
  appendHistory(bake.historyFile, historyLine(`updated: ${words}`, now));
  log.info(
    { bundle: set.bundle, profiles: set.profiles, previous: old },
    "agent-distro set landed",
  );
}

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
