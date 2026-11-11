/** What the `@` menu offers: every terminal on every host, with the host on it.
 *
 *  One conversation reaches the whole fleet, so the menu does too — a person
 *  naming a terminal the agent has never touched is exactly how it gets told
 *  about one, and that terminal is as likely to be on the box they are not
 *  looking at. The rows come from `useFleetTerminalIndex`, the SAME union the
 *  command palette's terminal switcher reads; a second cross-host walk here
 *  would be a second answer to "which terminals exist".
 *
 *  NAMES ARE COMPUTED PER HOST, like the palette's: `computeTerminalKeys`
 *  disambiguates two `main`s in one host's census by adding a suffix, and
 *  running it over the whole fleet at once would suffix terminals that are
 *  only "the same" because they live on different machines. Across hosts the
 *  host itself is the disambiguator, and it is what the menu row shows. */

import { activeArm } from "@kolu/padi-client/surface";
import {
  computeTerminalKeys,
  type TerminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type FleetTerminalRow,
  groupFleetByHost,
} from "../palette/fleetTerminals";
import type { MentionCandidate } from "./mentions";

export function fleetMentionCandidates(
  rows: readonly FleetTerminalRow[],
): MentionCandidate[] {
  const keysByHost = new Map<string, Map<TerminalId, TerminalKey>>();
  for (const bucket of groupFleetByHost(rows)) {
    keysByHost.set(
      encodeHostKey(bucket.host),
      computeTerminalKeys(
        bucket.rows.map((row) => ({
          id: row.id,
          git: row.meta.git,
          cwd: row.meta.cwd,
        })),
      ),
    );
  }
  // The INPUT order is kept — most recently active first, across hosts — so
  // the menu ranks the way the switcher does, and a name two hosts both carry
  // resolves to the warmer one (`resolveMentions` takes the first match).
  return rows.map((row): MentionCandidate => {
    const host = encodeHostKey(row.host);
    const key = keysByHost.get(host)?.get(row.id);
    if (key === undefined) {
      throw new Error(
        `computeTerminalKeys missing id ${row.id} on host ${host} — the per-host map must cover every row of that host`,
      );
    }
    return {
      terminalId: row.id,
      host,
      name: key.label,
      intent: row.meta.intent?.split("\n")[0] ?? null,
      cwd: row.meta.cwd,
      repo: key.group,
      state: activeArm(row.meta)?.agent?.state ?? null,
    };
  });
}
