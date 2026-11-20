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

export function memberDetail(at: Membership): MentionDetail {
  return {
    kind: "work",
    text: `${ROLE_WORD[at.role].toLowerCase()} of «${at.title}»`,
  };
}

const distinctPart = (id: WorkId): string =>
  Option.match(workKeyOf(id), {
    onNone: () => "work",
    onSome: (key) =>
      workSlug(key.kind === "branch" ? key.branch : key.terminal.slice(-8)),
  });

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
