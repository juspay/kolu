/**
 * What this host keeps of agent-distro's updates for a profile — the
 * `agentDistroReceipt` cell's value, read off the updater's OWN files: its
 * history log (`@kolu/agent-distro/history`), its `last-success` stamp
 * (`@kolu/agent-distro/schedule`) and the serving bundle's versions file
 * (`@kolu/agent-distro/versions`). The one thing those files may not hold — a
 * run that landed nothing and wrote no line (a crash, a repeated skip) — comes
 * from the run state (`./download.ts`). Its volatility is reading those files.
 */

import { readFileSync } from "node:fs";
import {
  type AgentUpdateRun,
  lastRunOf,
  recentEvents,
} from "@kolu/agent-distro/history";
import { lastSuccessFile, parseLastSuccess } from "@kolu/agent-distro/schedule";
import type { AgentDistroReceipt } from "@kolu/agent-distro/schema";
import { parseVersions, versionsFile } from "@kolu/agent-distro/versions";
import type { AgentDistroProfileBake } from "./bake.ts";

/** `path`'s text, or `undefined` when it does not exist. Only `ENOENT` is
 *  "absent"; anything else is thrown. */
function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** `profile`'s `last-success` stamp (epoch seconds), or `null` before any
 *  successful run. */
export function lastSuccessOf(profile: AgentDistroProfileBake): number | null {
  return parseLastSuccess(readOrUndefined(lastSuccessFile(profile.stateDir)));
}

/** How far apart the run state's and the files' last runs may be and still be
 *  the same run. */
const SAME_RUN_MS = 5_000;

/** The receipt for `profile` on this host: the versions of `serving` (the
 *  bundle new terminals get there now, if any), the last run, and the last few
 *  history events. `unlanded` is the profile's last run that landed nothing, as
 *  the run state remembers it — shown when it is newer than what the files
 *  say; `running` is every profile with a run in flight. Throws on a history
 *  or versions file that is not upstream's format. */
export function readReceipt(
  profile: AgentDistroProfileBake,
  serving: string | undefined,
  unlanded: AgentUpdateRun | undefined,
  running: readonly string[],
): AgentDistroReceipt {
  const events = recentEvents(
    readOrUndefined(profile.historyFile) ?? "",
    profile.name,
  );
  const fromFiles = lastRunOf(events, lastSuccessOf(profile));
  const lastRun =
    unlanded !== undefined &&
    (fromFiles === undefined || unlanded.at > fromFiles.at + SAME_RUN_MS)
      ? unlanded
      : fromFiles;
  const versionsText =
    serving === undefined ? undefined : readOrUndefined(versionsFile(serving));
  return {
    profile: profile.name,
    ...(serving === undefined ? {} : { bundle: serving }),
    versions:
      versionsText === undefined ? [] : [...parseVersions(versionsText)],
    ...(lastRun === undefined ? {} : { lastRun }),
    events: [...events],
    running: [...running],
  };
}
