/**
 * What this host keeps of its agent deliveries — the `agentDistroReceipt`
 * cell's value, read off the files on the host (which padi writes as each
 * delivery lands, `./deliveries.ts`): upstream's history log and
 * `last-success` stamp (read with upstream's own parsers, through
 * `@kolu/agent-distro/receipt`), the serving package's versions file, and the
 * profiles that landed with it. The one thing those files do not hold — a
 * delivery that landed nothing — comes from the delivery record. Its
 * volatility is reading those files.
 */

import { parseStamp } from "@juspay/agent-distro/update/due";
import {
  parseVersions,
  type Version,
} from "@juspay/agent-distro/update/versions";
import { lastSuccessFile, versionsFile } from "@kolu/agent-distro/bundle";
import type { DeliveredSet } from "@kolu/agent-distro/landing";
import {
  type AgentUpdateRun,
  lastRunOf,
  recentEvents,
  SAME_RUN_MS,
} from "@kolu/agent-distro/receipt";
import type { AgentDistroReceipt } from "@kolu/agent-distro/schema";
import type { AgentDistroBake } from "./bake.ts";
import { readOrUndefined } from "./onHost.ts";

/** A package's harnesses, or `undefined` when it records none. */
export function versionsOf(bundle: string): Version[] | undefined {
  const text = readOrUndefined(versionsFile(bundle));
  return text === undefined ? undefined : parseVersions(text);
}

/** The receipt on this host: the set new terminals get there now (if any)
 *  with its package's harnesses, the last run, and the last few history
 *  events. `failure` is the setting's stack's last delivery that landed
 *  nothing, as the delivery record keeps it — shown when it is newer than
 *  what the files say. Throws on a history or versions file upstream's
 *  readers refuse. */
export function readReceipt(
  bake: AgentDistroBake,
  serving: DeliveredSet | undefined,
  failure: AgentUpdateRun | undefined,
): AgentDistroReceipt {
  const events = recentEvents(readOrUndefined(bake.historyFile) ?? "");
  const stampText = readOrUndefined(lastSuccessFile(bake.stateDir));
  const fromFiles = lastRunOf(
    events,
    stampText === undefined ? null : parseStamp(stampText),
  );
  const lastRun =
    failure !== undefined &&
    (fromFiles === undefined || failure.at > fromFiles.at + SAME_RUN_MS)
      ? failure
      : fromFiles;
  return {
    ...(serving === undefined
      ? {}
      : {
          serving: {
            set: serving,
            versions: [...(versionsOf(serving.bundle) ?? [])],
          },
        }),
    ...(lastRun === undefined ? {} : { lastRun }),
    events: [...events],
  };
}
