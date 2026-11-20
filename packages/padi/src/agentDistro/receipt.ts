import { parseStamp } from "@juspay/agent-distro/update/due";
import {
  parseVersions,
  type Version,
} from "@juspay/agent-distro/update/versions";
import { lastSuccessFile } from "@juspay/agent-distro/update/state";
import { versionsFile } from "@kolu/agent-distro/bundle";
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
