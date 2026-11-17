/** What the `@` menu offers: every piece of work kolu is running, and every
 *  terminal on every host with the host on it.
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
 *  host itself is the disambiguator, and it is what the menu row shows.
 *
 *  THE WORKS COME FIRST and in one order — what needs the human, then what is
 *  in progress, then what has finished — which is `useNeedsYou` followed by
 *  `useWorks`, the two readings every other surface is drawn from. No third
 *  ordering of the works is invented here. */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import {
  computeTerminalKeys,
  type TerminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import { Option } from "effect";
import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  type Membership,
  type NeedsYou,
  type Work,
  type WorkId,
  type WorkRow,
  workKeyOf,
} from "kolu-work";
import {
  type FleetTerminalRow,
  groupFleetByHost,
} from "../palette/fleetTerminals";
import { agentName, stateLabels } from "../ui/agentDisplay";
import type {
  MentionDetail,
  TerminalCandidate,
  WorkCandidate,
} from "./mentions";
import { workSlug } from "./mentions";
import { ROLE_WORD, standingLine } from "./workReadings";

/** What tells a terminal apart from the others the menu offers under the same
 *  name — and same-named terminals are ordinary (one repo, several branches
 *  cut from it, or several shells in one directory). In order: the intent a
 *  person gave it, else the agent running in it and its state, else the
 *  directory it is in. `null` only for a record with none of the three.
 *
 *  A MEMBER OF A PIECE OF WORK says so instead ({@link memberDetail}) — the
 *  intent is what the terminal was CREATED with and can still name a work
 *  that ended hours ago, while its membership is where it stands now.
 *
 *  The KIND rides along because the row draws a directory differently: what
 *  differs between two worktrees of one repo is the END of the path, so a
 *  directory is cut from the left. */
export function mentionDetail(meta: TerminalMetadata): MentionDetail | null {
  const intent = meta.intent?.split("\n")[0]?.trim();
  if (intent) return { kind: "intent", text: intent };
  const agent = activeArm(meta)?.agent;
  if (agent) {
    return {
      kind: "agent",
      text: `${agentName(agent.kind)} · ${stateLabels[agent.state] ?? agent.state}`,
    };
  }
  return meta.cwd ? { kind: "directory", text: meta.cwd } : null;
}

/** WHAT A TERMINAL IS DOING IN A PIECE OF WORK, as its menu detail: the role
 *  it holds and the work it holds it in. Membership is only ever written for
 *  an OPEN work, so a row that says this is a row about something live. */
export function memberDetail(at: Membership): MentionDetail {
  return {
    kind: "work",
    text: `${ROLE_WORD[at.role].toLowerCase()} of «${at.title}»`,
  };
}

/** WHAT TELLS A WORK FROM ANOTHER OF THE SAME TITLE — its branch (unique in
 *  its repo), or for a watch the terminal it watches. */
const distinctPart = (id: WorkId): string =>
  Option.match(workKeyOf(id), {
    onNone: () => "work",
    onSome: (key) =>
      workSlug(key.kind === "branch" ? key.branch : key.terminal.slice(-8)),
  });

/** EVERY WORK'S OWN WORD after `@`, in the order given. A work is its title's
 *  slug ({@link workSlug}) while that slug is its alone; one that another
 *  work also slugs to, or that a terminal is already called (`taken`), adds
 *  what tells it apart — its branch — and a number if even that is shared.
 *  So every work row the menu offers resolves to that work, and two works
 *  with one title (a work stopped and opened again on a new branch) can both
 *  be picked. */
function workWords(
  works: ReadonlyArray<readonly [WorkId, Work]>,
  taken: ReadonlySet<string>,
): ReadonlyArray<string> {
  const bases = works.map(([, work]) => workSlug(work.title));
  const count = new Map<string, number>();
  for (const base of bases) count.set(base, (count.get(base) ?? 0) + 1);
  const used = new Set<string>(taken);
  return works.map(([id], at) => {
    const base = bases[at] ?? "work";
    let word =
      (count.get(base) ?? 0) > 1 || taken.has(base)
        ? `${base}-${distinctPart(id)}`
        : base;
    for (let n = 2; used.has(word); n += 1) word = `${base}-${n}`;
    used.add(word);
    return word;
  });
}

/** EVERY PIECE OF WORK the menu offers, in the one order: what needs the
 *  human first (`needsYou`'s own), then the rest as the works collection
 *  lists them — in progress oldest first, then the finished ones. `taken` is
 *  the terminals' names, which no work's word may be. */
export function workMentionCandidates(
  works: ReadonlyArray<WorkRow>,
  needs: ReadonlyArray<NeedsYou>,
  taken: ReadonlySet<string>,
): WorkCandidate[] {
  const byId = new Map<WorkId, Work>(works);
  const order = [...needs.map((one) => one.work), ...works.map(([id]) => id)];
  const seen = new Set<WorkId>();
  const rows: Array<readonly [WorkId, Work]> = [];
  for (const id of order) {
    const record = byId.get(id);
    if (record === undefined || seen.has(id)) continue;
    seen.add(id);
    rows.push([id, record]);
  }
  const words = workWords(rows, taken);
  return rows.map(([id, record], at) => ({
    kind: "work",
    work: id,
    title: record.title,
    name: words[at] ?? workSlug(record.title),
    record,
    // The card's own lead, not a second vocabulary for where a work
    // stands: "Needs you", "Agents at work", "CI running", "Merged".
    standing: standingLine(record, Option.none()).lead,
  }));
}

export function fleetMentionCandidates(
  rows: readonly FleetTerminalRow[],
  membership: ReadonlyMap<string, Membership>,
): TerminalCandidate[] {
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
  // resolves to the warmer one (`armedMentions` takes the first match).
  return rows.map((row): TerminalCandidate => {
    const host = encodeHostKey(row.host);
    const key = keysByHost.get(host)?.get(row.id);
    if (key === undefined) {
      throw new Error(
        `computeTerminalKeys missing id ${row.id} on host ${host} — the per-host map must cover every row of that host`,
      );
    }
    const at = membership.get(fleetTerminalRef(host, row.id));
    return {
      kind: "terminal",
      terminalId: row.id,
      host,
      name: key.label,
      intent: row.meta.intent?.split("\n")[0] ?? null,
      cwd: row.meta.cwd,
      repo: key.group,
      detail: at === undefined ? mentionDetail(row.meta) : memberDetail(at),
    };
  });
}
