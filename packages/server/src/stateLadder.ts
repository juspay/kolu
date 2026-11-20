import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type Conf from "conf";
import type { ConductorRow } from "kolu-common/conductor";
import { DEFAULT_PREFERENCES, type Preferences } from "kolu-common/surface";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  repointConductorAttachments,
} from "kolu-conductor";
import {
  transcriptFilePath,
  writeTranscriptFile,
} from "./conductor/transcriptFile.ts";
import { log } from "./log.ts";
import { type PersistedState, TRANSCRIPT_FILE_VERSION } from "./stateShape.ts";

export function migratePreferences_1_30_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if (!("shuffleTheme" in current)) return current;
  const { shuffleTheme, ...rest } = current as { shuffleTheme?: unknown };
  const newTerminalTheme = shuffleTheme === false ? "inherit" : "shuffle";
  return {
    ...rest,
    newTerminalTheme,
    shuffleBehavior: DEFAULT_PREFERENCES.shuffleBehavior,
  };
}

export function migratePreferences_1_37_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("agentDistro" in current) return current;
  return {
    ...current,
    agentDistro: { enabled: false, profile: "vanilla" },
  };
}

export function migratePreferences_1_38_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as { enabled?: unknown } | null;
  if (stored === null || stored === undefined || stored.enabled === true)
    return current;
  return { ...current, agentDistro: null };
}

export function migratePreferences_1_39_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("tipBarCollapsed" in current) return current;
  return { ...current, tipBarCollapsed: false };
}

export function migratePreferences_1_40_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as
    | { enabled: boolean; profile: string }
    | null
    | undefined;
  return {
    ...current,
    ...(stored?.profile === "juspay"
      ? { agentDistro: { ...stored, profile: "github:juspay/skills" } }
      : {}),
    agentProfilesRecent: current.agentProfilesRecent ?? [],
  };
}

export function migratePreferences_1_41_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as
    | { enabled: boolean; profile: string }
    | { enabled: boolean; profiles: string[] }
    | null
    | undefined;
  if (stored === null || stored === undefined || !("profile" in stored))
    return current;
  return {
    ...current,
    agentDistro: {
      enabled: stored.enabled,
      profiles: stored.profile === "vanilla" ? [] : [stored.profile],
    },
  };
}

export function migratePreferences_1_42_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const juspay = "github:juspay/skills";
  const stored = current.agentDistro as
    | { enabled: boolean; profiles: string[] }
    | null
    | undefined;
  const recent = current.agentProfilesRecent as string[] | undefined;
  return {
    ...current,
    ...(stored === null || stored === undefined
      ? {}
      : {
          agentDistro: {
            ...stored,
            profiles: stored.profiles.filter((p) => p !== juspay),
          },
        }),
    ...(recent === undefined
      ? {}
      : { agentProfilesRecent: recent.filter((p) => p !== juspay) }),
  };
}

export function migratePreferences_1_43_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("hostOrder" in current) return current;
  return { ...current, hostOrder: [] };
}

export function migratePreferences_1_32_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const rp =
    typeof current.rightPanel === "object" && current.rightPanel !== null
      ? (current.rightPanel as Record<string, unknown>)
      : undefined;
  const { collapsed: prevCollapsed, ...restRp } = rp ?? {};
  return {
    ...DEFAULT_PREFERENCES,
    ...current,
    newTerminalCollapsed:
      typeof prevCollapsed === "boolean"
        ? prevCollapsed
        : DEFAULT_PREFERENCES.newTerminalCollapsed,
    ...(rp !== undefined && { rightPanel: restRp }),
  };
}

export function migratePreferences_1_34_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const { activityAlerts, ...rest } = current;
  if (typeof activityAlerts === "boolean")
    return { ...rest, attentionAlerts: activityAlerts };
  if (typeof rest.attentionAlerts === "boolean") return rest;
  return { ...rest, attentionAlerts: DEFAULT_PREFERENCES.attentionAlerts };
}

interface RawStore {
  has: (key: string) => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
}

const rawStore = (store: Conf<PersistedState>): RawStore =>
  store as unknown as RawStore;

function deleteLegacyKey(store: Conf<PersistedState>, key: string): void {
  rawStore(store).delete(key);
}

/** `conf` merges `defaults` into the file before the ladder runs, so the
 *  destination key always LOOKS present: the legacy key's presence is the only
 *  test that can fire here. */
function renameLegacyKey(
  store: Conf<PersistedState>,
  from: string,
  to: keyof PersistedState & string,
): void {
  const raw = rawStore(store);
  const held = raw.get(from);
  if (held !== undefined) raw.set(to, held);
  deleteLegacyKey(store, from);
}

const LEGACY_KEYS_STRIPPED_1_31_0 = [
  "session",
  "activityFeed",
  "sleepingTerminals",
  "lastPairedDaemon",
] as const;

export function stripLegacyStateKeys_1_31_0(store: Conf<PersistedState>): void {
  const raw = store.store as unknown as Record<string, unknown>;
  const hasLegacy = LEGACY_KEYS_STRIPPED_1_31_0.some((key) => key in raw);
  const bakPath = `${store.path}.pre-1.31-strip.bak`;
  // `conf` records a rung as done only after its handler returns, so a crash
  // mid-strip reruns this one: the first copy is the complete pre-strip file.
  if (hasLegacy && !existsSync(bakPath)) {
    copyFileSync(store.path, bakPath);
  }
  for (const key of LEGACY_KEYS_STRIPPED_1_31_0) deleteLegacyKey(store, key);
}

interface WatchedEntry_1_49_0 {
  readonly ref: string;
  readonly name: string;
  readonly agent: string | null;
  readonly told: string | null;
  readonly joined: string;
  readonly spoken: boolean;
  readonly ran: boolean;
  readonly since: string;
  readonly root: { readonly ref: string; readonly name: string } | null;
}

export function worksFromWatched_1_50_0(
  watched: ReadonlyArray<WatchedEntry_1_49_0>,
  mintId: () => string,
): {
  readonly works: ReadonlyArray<Record<string, unknown>>;
  readonly members: Record<string, Record<string, unknown>>;
} {
  const groups = new Map<string, WatchedEntry_1_49_0[]>();
  for (const entry of watched) {
    const key = entry.root?.ref ?? entry.ref;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  const works: Record<string, unknown>[] = [];
  for (const [key, group] of groups) {
    const id = mintId();
    const first = group[0];
    if (first === undefined) continue;
    const startedAt = group.reduce(
      (earliest, one) => (one.since < earliest ? one.since : earliest),
      first.since,
    );
    const rootName = group.find((one) => one.root !== null)?.root?.name ?? "";
    const title =
      rootName !== ""
        ? rootName
        : first.name !== ""
          ? first.name
          : "Carried over";
    const host = key.slice(0, key.lastIndexOf("/"));
    const carried = (key: string, value: string) => ({
      id: `${id}:${key}`,
      ask: `${id}:carried-over`,
      at: startedAt,
      key,
      header: "",
      question: "Carried over from before kolu stored work",
      options: [value],
      multiple: false,
      file: "",
      answer: {
        at: startedAt,
        how: "answered",
        picked: [value],
        text: null,
        from: null,
      },
    });
    works.push({
      id,
      title,
      repo: "",
      branch: "",
      members: group.map((one) => ({
        terminal: one.ref,
        role: "other",
        joinedAt: one.since,
        leftAt: null,
        worktree: null,
      })),
      events: [
        {
          at: startedAt,
          by: "kolu",
          kind: "carried-over",
          terminal: null,
          detail: "watched before kolu stored work",
        },
        ...group.map((one) => ({
          at: one.since,
          by: "kolu",
          kind: "joined",
          terminal: one.ref,
          detail: "other",
        })),
      ],
      decisions: [carried("mode", "watch"), carried("host", host)],
      startedAt,
      endedAt: null,
      outcome: null,
      keptFiles: [],
    });
  }
  const members: Record<string, Record<string, unknown>> = {};
  for (const entry of watched) {
    members[entry.ref] = {
      name: entry.name,
      agent: entry.agent,
      told: entry.told,
      joined: entry.joined,
      spoken: entry.spoken,
      ran: entry.ran,
    };
  }
  return { works, members };
}

export function migrateConductorToWorks_1_50_0(
  store: Conf<PersistedState>,
): void {
  const record = store.get("conductor") as Record<string, unknown> | undefined;
  if (record === undefined) return;
  const { rows, watched, ...rest } = record;
  if (rows !== undefined && !Array.isArray(rows)) return;
  if (watched !== undefined && !Array.isArray(watched)) return;
  if (rows !== undefined) {
    writeTranscriptFile(
      transcriptFilePath(dirname(store.path)),
      TRANSCRIPT_FILE_VERSION,
      rows,
    );
  }
  store.set("conductor", rest as unknown as PersistedState["conductor"]);
  const carried = worksFromWatched_1_50_0(
    (watched ?? []) as ReadonlyArray<WatchedEntry_1_49_0>,
    randomUUID,
  );
  store.set("works", carried.works as unknown as PersistedState["works"]);
  store.set("members", carried.members as unknown as PersistedState["members"]);
}

const CHECK_KINDS_1_51_0: ReadonlySet<string> = new Set([
  "checks-running",
  "checks-passed",
  "checks-failed",
]);

const checkHead_1_51_0 = (detail: string): string | null =>
  /^([0-9a-f]{7,40})(?: |$)/.exec(detail)?.[1] ?? null;

export function collapseFlappingChecks_1_51_0(
  store: Conf<PersistedState>,
): void {
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  let swept = false;
  const next = works.map((work: unknown) => {
    if (typeof work !== "object" || work === null || !("events" in work))
      return work;
    const events = work.events;
    if (!Array.isArray(events)) return work;
    const seen = new Set<string>();
    const kept = events.filter((event: unknown) => {
      if (typeof event !== "object" || event === null) return true;
      if (!("kind" in event) || !("detail" in event)) return true;
      const { kind, detail } = event;
      if (typeof kind !== "string" || typeof detail !== "string") return true;
      if (!CHECK_KINDS_1_51_0.has(kind)) return true;
      const key = `${kind}@${checkHead_1_51_0(detail) ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (kept.length === events.length) return work;
    swept = true;
    return { ...work, events: kept };
  });
  if (swept) store.set("works", next as unknown as PersistedState["works"]);
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function memberWatchOutOfWorks_1_52_0(
  store: Conf<PersistedState>,
): void {
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  const members: Record<string, unknown> = {
    ...(recordOf(store.get("members")) ?? {}),
  };
  let moved = false;
  const next = works.map((value: unknown) => {
    const work = recordOf(value);
    if (work === null) return value;
    const workMembers = Array.isArray(work.members) ? work.members : null;
    const decisions = Array.isArray(work.decisions) ? work.decisions : null;
    let changed = false;
    const nextMembers = workMembers?.map((one: unknown) => {
      const member = recordOf(one);
      if (member === null) return one;
      const watch = recordOf(member.watch);
      if (watch === null && "worktree" in member) return one;
      changed = true;
      const { watch: _watch, ...rest } = member;
      const worktree =
        typeof watch?.worktree === "string" ? watch.worktree : null;
      const terminal = member.terminal;
      if (watch !== null && typeof terminal === "string") {
        const { worktree: _worktree, ...bookkeeping } = watch;
        if (!(terminal in members)) members[terminal] = bookkeeping;
      }
      return {
        ...rest,
        worktree: "worktree" in rest ? rest.worktree : worktree,
      };
    });
    const nextDecisions = decisions?.map((one: unknown) => {
      const decision = recordOf(one);
      if (decision === null) return one;
      if ("header" in decision && "file" in decision) return one;
      changed = true;
      return { header: "", file: "", ...decision };
    });
    if (!changed) return value;
    moved = true;
    return {
      ...work,
      ...(nextMembers === undefined ? {} : { members: nextMembers }),
      ...(nextDecisions === undefined ? {} : { decisions: nextDecisions }),
    };
  });
  if (!moved) return;
  store.set("works", next as unknown as PersistedState["works"]);
  store.set("members", members as unknown as PersistedState["members"]);
}

interface Work_1_52_0 {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly branch: string;
  readonly members: ReadonlyArray<Record<string, unknown>>;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly decisions: ReadonlyArray<Record<string, unknown>>;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: string | null;
  readonly keptFiles: ReadonlyArray<Record<string, unknown>>;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const answered_1_52_0 = (
  decisions: ReadonlyArray<Record<string, unknown>>,
  key: string,
): string | null => {
  let value: string | null = null;
  for (const one of decisions) {
    if (one.key !== key) continue;
    const answer = recordOf(one.answer);
    if (answer === null || answer.how !== "answered") continue;
    const picked = Array.isArray(answer.picked) ? answer.picked : [];
    const first = typeof picked[0] === "string" ? picked[0] : null;
    const typed = typeof answer.text === "string" ? answer.text : null;
    value = first ?? typed;
  }
  return value;
};

const hostOfRef_1_53_0 = (ref: string): string | null => {
  const cut = ref.indexOf("/");
  return cut <= 0 ? null : ref.slice(0, cut);
};

export type WorkKey_1_53_0 =
  | {
      readonly kind: "branch";
      readonly host: string;
      readonly repo: string;
      readonly branch: string;
    }
  | { readonly kind: "watch"; readonly terminal: string };

const part_1_53_0 = (value: string): string => encodeURIComponent(value);

export const workIdOf_1_53_0 = (key: WorkKey_1_53_0): string =>
  key.kind === "branch"
    ? `branch:${part_1_53_0(key.host)}/${part_1_53_0(key.repo)}/${part_1_53_0(key.branch)}`
    : `watch:${part_1_53_0(key.terminal)}`;

export const workDirOf_1_53_0 = (id: string): string => {
  const fnv = (seed: number): string => {
    let hash = seed;
    for (let at = 0; at < id.length; at += 1) {
      hash ^= id.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x7fffffff)}`;
};

const TRANSCRIPT_VERSION_1_53_0 = "1.53.0";

const keyOf_1_53_0 = (work: Work_1_52_0): WorkKey_1_53_0 | null => {
  const mode = answered_1_52_0(work.decisions, "mode");
  const terminals = work.members
    .map((one) => text(one.terminal))
    .filter((ref) => ref !== "");
  if (mode === "watch" || (work.repo === "" && work.branch === "")) {
    const terminal = terminals[0];
    return terminal === undefined ? null : { kind: "watch", terminal };
  }
  const host =
    answered_1_52_0(work.decisions, "host") ??
    (terminals[0] === undefined ? null : hostOfRef_1_53_0(terminals[0]));
  if (host === null || work.repo === "" || work.branch === "") return null;
  return { kind: "branch", host, repo: work.repo, branch: work.branch };
};

const prOf_1_53_0 = (detail: string): number | null => {
  const number = Number(/^#(\d+)/.exec(detail)?.[1]);
  return Number.isInteger(number) ? number : null;
};

const eventOf_1_53_0 = (
  event: Record<string, unknown>,
  pr: number | null,
): Record<string, unknown> | null => {
  const kind = text(event.kind);
  const detail = text(event.detail);
  const base = {
    at: text(event.at),
    by: text(event.by),
    terminal: typeof event.terminal === "string" ? event.terminal : null,
    kind,
  };
  switch (kind) {
    case "requested":
    case "note":
      return { ...base, text: detail };
    case "carried-over":
    case "taken-over":
    case "handed-back":
    case "reopened":
      return base;
    case "joined":
      return {
        ...base,
        role: ["planner", "implementor", "other"].includes(detail)
          ? detail
          : "other",
      };
    case "left":
      return {
        ...base,
        why: ["closed", "released", "gone"].includes(detail) ? detail : "gone",
      };
    case "ready":
    case "stopped":
    case "asking":
    case "exited":
    case "asleep":
    case "keep-failed":
      return { ...base, why: detail };
    case "file":
      return { ...base, path: detail };
    case "question":
    case "answered":
    case "question-dropped":
      return { ...base, ask: detail };
    case "pr-opened": {
      const number = prOf_1_53_0(detail);
      return number === null
        ? null
        : { ...base, pr: number, title: detail.replace(/^#\d+\s*/, "") };
    }
    case "merged":
    case "pr-closed": {
      const number = prOf_1_53_0(detail) ?? pr;
      return number === null ? null : { ...base, pr: number };
    }
    case "checks-running":
    case "checks-passed":
    case "checks-failed": {
      if (pr === null) return null;
      const head = checkHead_1_51_0(detail);
      const rest =
        head === null ? detail : detail.slice(head.length).trimStart();
      return {
        ...base,
        pr,
        head,
        failing:
          kind === "checks-failed" && rest !== "" ? rest.split(", ") : [],
      };
    }
    case "kept":
    case "folded": {
      const count = Number(detail);
      return { ...base, count: Number.isInteger(count) ? count : 0 };
    }
    default:
      return null;
  }
};

const records_1_53_0 = (value: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(value) ? value : [])
    .map(recordOf)
    .filter((one): one is Record<string, unknown> => one !== null);

const workOf_1_53_0 = (value: unknown): Work_1_52_0 | null => {
  const record = recordOf(value);
  if (record === null) return null;
  return {
    id: text(record.id),
    title: text(record.title),
    repo: text(record.repo),
    branch: text(record.branch),
    members: records_1_53_0(record.members),
    events: records_1_53_0(record.events),
    decisions: records_1_53_0(record.decisions),
    startedAt: text(record.startedAt),
    endedAt: typeof record.endedAt === "string" ? record.endedAt : null,
    outcome: typeof record.outcome === "string" ? record.outcome : null,
    keptFiles: records_1_53_0(record.keptFiles),
  };
};

const groupsByKey_1_53_0 = (
  works: ReadonlyArray<unknown>,
): Map<string, Array<Work_1_52_0>> => {
  const groups = new Map<string, Array<Work_1_52_0>>();
  for (const value of works) {
    const work = workOf_1_53_0(value);
    if (work === null) continue;
    const key = keyOf_1_53_0(work);
    if (key === null) continue;
    const id = workIdOf_1_53_0(key);
    const group = groups.get(id) ?? [];
    group.push(work);
    groups.set(id, group);
  }
  return groups;
};

const decisionsOf_1_53_0 = (
  inOrder: ReadonlyArray<Work_1_52_0>,
): Array<Record<string, unknown>> =>
  inOrder
    .flatMap((one) => one.decisions)
    .filter((one) => one.key !== "host")
    .map((one) => {
      const { answer, ...rest } = one;
      const given = recordOf(answer);
      return given === null
        ? { kind: "asked", ...rest }
        : { kind: "answered", ...rest, answer: given };
    });

const timelineOf_1_53_0 = (
  inOrder: ReadonlyArray<Work_1_52_0>,
): Array<Record<string, unknown>> => {
  const seen = new Set<string>();
  const timeline: Array<Record<string, unknown>> = [];
  for (const one of inOrder) {
    for (const event of one.events) {
      const signature = `${text(event.kind)}|${text(event.at)}|${text(event.terminal)}|${text(event.detail)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      timeline.push(event);
    }
  }
  timeline.sort((a, b) =>
    text(a.at) < text(b.at) ? -1 : text(a.at) > text(b.at) ? 1 : 0,
  );
  return timeline;
};

const typedEventsOf_1_53_0 = (
  timeline: ReadonlyArray<Record<string, unknown>>,
  ending: Work_1_52_0 | undefined,
): {
  readonly events: Array<Record<string, unknown>>;
  readonly pr: number | null;
} => {
  let pr: number | null = null;
  const events: Array<Record<string, unknown>> = [];
  const checks = new Set<string>();
  const paths = new Set<string>();
  for (const event of timeline) {
    if (text(event.kind) === "ended" && ending === undefined) continue;
    const typed = eventOf_1_53_0(event, pr);
    if (typed === null) continue;
    if (typed.kind === "kept" && ending === undefined) continue;
    if (typed.kind === "file") {
      const path = text(typed.path);
      if (paths.has(path)) continue;
      paths.add(path);
    }
    if (typed.kind === "pr-opened" && typeof typed.pr === "number") {
      if (typed.pr === pr) continue;
      pr = typed.pr;
    }
    if (typeof typed.kind === "string" && CHECK_KINDS_1_51_0.has(typed.kind)) {
      const key = `${typed.kind}#${String(typed.pr)}@${typed.head ?? ""}`;
      if (checks.has(key)) continue;
      checks.add(key);
    }
    if (typed.kind === "ended") {
      if (ending === undefined) continue;
      typed.outcome = {
        kind: ending.outcome === "merged" ? "merged" : "closed",
        pr: pr ?? 0,
      };
    }
    events.push(typed);
  }
  return { events, pr };
};

const membersOf_1_53_0 = (
  inOrder: ReadonlyArray<Work_1_52_0>,
  id: string,
  was: Record<string, unknown>,
): Record<string, unknown> => {
  const latest = new Map<string, Record<string, unknown>>();
  for (const one of inOrder)
    for (const member of one.members) {
      const ref = text(member.terminal);
      if (ref === "") continue;
      const held = latest.get(ref);
      if (held === undefined || text(held.joinedAt) <= text(member.joinedAt))
        latest.set(ref, member);
    }
  const members: Record<string, unknown> = {};
  const roles = new Set<string>();
  for (const [ref, member] of latest) {
    if (member.leftAt !== null && member.leftAt !== undefined) continue;
    const role = text(member.role) === "" ? "other" : text(member.role);
    if (role !== "other" && roles.has(role)) continue;
    roles.add(role);
    members[ref] = {
      work: id,
      role,
      joinedAt: text(member.joinedAt),
      worktree: typeof member.worktree === "string" ? member.worktree : null,
      watch: recordOf(was[ref]) ?? {
        name: "",
        agent: null,
        told: null,
        joined: "asked",
        spoken: false,
        ran: false,
      },
    };
  }
  return members;
};

export function foldWorksByKey_1_53_0(
  works: ReadonlyArray<unknown>,
  was: Record<string, unknown>,
): {
  readonly works: Record<string, unknown>;
  readonly members: Record<string, unknown>;
  readonly moves: ReadonlyArray<{ readonly from: string; readonly to: string }>;
} {
  const folded: Record<string, unknown> = {};
  const members: Record<string, unknown> = {};
  const moves: Array<{ from: string; to: string }> = [];
  for (const [id, group] of groupsByKey_1_53_0(works)) {
    const inOrder = [...group].sort((a, b) =>
      a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
    );
    const first = inOrder[0];
    if (first === undefined) continue;
    const key = keyOf_1_53_0(first);
    if (key === null) continue;
    const ending = inOrder.findLast(
      (one) => one.outcome === "merged" || one.outcome === "closed",
    );
    const { events, pr } = typedEventsOf_1_53_0(
      timelineOf_1_53_0(inOrder),
      ending,
    );
    const state =
      ending === undefined
        ? { kind: "open" }
        : {
            kind: "ended",
            at: ending.endedAt ?? first.startedAt,
            outcome: {
              kind: ending.outcome === "merged" ? "merged" : "closed",
              pr: pr ?? 0,
            },
            kept: ending.keptFiles,
          };
    folded[id] = {
      key,
      title: first.title,
      startedAt: first.startedAt,
      decisions: decisionsOf_1_53_0(inOrder),
      events,
      state,
    };
    for (const one of [...inOrder].sort((a, b) =>
      (a.endedAt ?? a.startedAt) < (b.endedAt ?? b.startedAt) ? -1 : 1,
    ))
      moves.push({ from: one.id, to: workDirOf_1_53_0(id) });
    if (state.kind !== "open") continue;
    Object.assign(members, membersOf_1_53_0(inOrder, id, was));
  }
  return { works: folded, members, moves };
}

export function moveKeptFiles_1_53_0(
  root: string,
  moves: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): void {
  for (const { from, to } of moves) {
    if (from === to) continue;
    const source = join(root, from);
    const target = join(root, to);
    if (!existsSync(source)) continue;
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true, mode: 0o700 });
    } else {
      for (const path of keptPathsUnder_1_53_0(source, ""))
        if (existsSync(join(target, path)))
          log.info(
            { work: from, path },
            "state: two folded works kept the same file — keeping the newer copy",
          );
    }
    cpSync(source, target, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
}

const keptPathsUnder_1_53_0 = (dir: string, prefix: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? keptPathsUnder_1_53_0(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );

export function foldWorks_1_53_0(store: Conf<PersistedState>): void {
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  const folded = foldWorksByKey_1_53_0(
    works,
    recordOf(store.get("members")) ?? {},
  );
  moveKeptFiles_1_53_0(join(dirname(store.path), "works"), folded.moves);
  store.set("works", folded.works as unknown as PersistedState["works"]);
  store.set("members", folded.members as unknown as PersistedState["members"]);
  splitWorkAskRows_1_53_0(dirname(store.path));
}

export function splitWorkAskRows_1_53_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  writeTranscriptFile(
    path,
    TRANSCRIPT_VERSION_1_53_0,
    rows.map((value: unknown) => {
      const row = recordOf(value);
      if (row === null || row.kind !== "ask") return value;
      return typeof row.work === "string" && row.work !== ""
        ? { ...row, kind: "work-ask" }
        : row;
    }),
  );
}

const KOLU_CHOICE_KEYS_1_54_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

export function dropKoluChoiceOptions_1_54_0(
  store: Conf<PersistedState>,
): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    if (work === null || !Array.isArray(work.decisions)) {
      next[id] = value;
      continue;
    }
    let touched = false;
    const decisions = work.decisions.map((one: unknown) => {
      const decision = recordOf(one);
      if (decision === null) return one;
      if (typeof decision.key !== "string") return one;
      if (!KOLU_CHOICE_KEYS_1_54_0.has(decision.key)) return one;
      const answer =
        decision.kind === "answered" ? recordOf(decision.answer) : null;
      const normalized = answer === null ? null : normalizeChoiceAnswer(answer);
      const strip = "options" in decision || "multiple" in decision;
      if (!strip && normalized === null) return one;
      touched = true;
      const { options: _options, multiple: _multiple, ...rest } = decision;
      return normalized === null ? rest : { ...rest, answer: normalized };
    });
    if (!touched) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, decisions };
  }
  if (!changed) return;
  store.set("works", next as unknown as PersistedState["works"]);
}

function normalizeChoiceAnswer(
  answer: Record<string, unknown>,
): Record<string, unknown> | null {
  const picked = Array.isArray(answer.picked) ? answer.picked : [];
  const value =
    answer.how === "answered"
      ? picked.length > 0
        ? picked[0]
        : (answer.text ?? null)
      : null;
  const nextPicked = value === null ? [] : [value];
  if (
    answer.text === null &&
    picked.length === nextPicked.length &&
    picked[0] === nextPicked[0]
  ) {
    return null;
  }
  return { ...answer, picked: nextPicked, text: null };
}

const WORK_MODES_1_55_0: ReadonlySet<string> = new Set([
  "full",
  "trivial",
  "watch",
]);
const ON_GREEN_1_55_0: ReadonlySet<string> = new Set(["merge", "hand-over"]);
const KOLU_CHOICE_KEYS_1_55_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

const AGENT_WHY_KINDS_1_55_0: ReadonlySet<string> = new Set([
  "ready",
  "stopped",
  "asking",
  "exited",
  "asleep",
]);

const CHECK_KINDS_1_55_0: ReadonlySet<string> = new Set([
  "checks-running",
  "checks-passed",
  "checks-failed",
]);

const stringsOf_1_55_0 = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];

type Settlement_1_55_0 =
  | { readonly how: "asked" }
  | { readonly how: "none"; readonly at: string }
  | { readonly how: "settled"; readonly answer: Record<string, unknown> };

const valueOf_1_55_0 = (
  key: string | null,
  answer: Record<string, unknown>,
): Record<string, unknown> | null => {
  const picked = stringsOf_1_55_0(answer.picked);
  const typed = typeof answer.text === "string" ? answer.text : "";
  if (key === null) {
    const text = typed.trim();
    if (picked.length > 0 && text !== "")
      return { said: { kind: "picked-and-typed", picked, text } };
    if (picked.length > 0) return { said: { kind: "picked", picked } };
    return text === "" ? null : { said: { kind: "typed", text } };
  }
  if (key === "mode" || key === "on-green") {
    const word = picked[0] ?? typed.trim();
    const words = key === "mode" ? WORK_MODES_1_55_0 : ON_GREEN_1_55_0;
    return words.has(word) ? { value: word } : null;
  }
  const value = picked[0] ?? typed;
  return value === "" ? null : { value };
};

const settlementOf_1_55_0 = (
  decision: Record<string, unknown>,
  key: string | null,
): Settlement_1_55_0 => {
  if (decision.kind !== "answered") return { how: "asked" };
  const answer = recordOf(decision.answer);
  if (answer === null) return { how: "asked" };
  const at = text(answer.at);
  const from = typeof answer.from === "string" ? answer.from : null;
  if (answer.how === "declined")
    return from === null
      ? { how: "settled", answer: { how: "dropped", at } }
      : { how: "settled", answer: { how: "declined", at, from } };
  if (answer.how === "dropped")
    return { how: "settled", answer: { how: "dropped", at } };
  const value = valueOf_1_55_0(key, answer);
  if (value === null) return { how: "none", at };
  return {
    how: "settled",
    answer: { how: "answered", at, from: from ?? "carried-over", ...value },
  };
};

const decisionOf_1_55_0 = (value: unknown, open: boolean): unknown => {
  const decision = recordOf(value);
  if (decision === null || "topic" in decision) return value;
  const {
    kind: _kind,
    key: storedKey,
    header,
    file,
    options,
    multiple,
    answer: _answer,
    ...rest
  } = decision;
  const key = typeof storedKey === "string" ? storedKey : null;
  const fields =
    key === null
      ? {
          ...rest,
          topic: "work",
          header:
            text(header) === ""
              ? { kind: "none" }
              : { kind: "header", text: header },
          options: stringsOf_1_55_0(options),
          multiple: multiple === true,
          file:
            text(file) === "" ? { kind: "none" } : { kind: "file", path: file },
        }
      : KOLU_CHOICE_KEYS_1_55_0.has(key)
        ? { ...rest, topic: "setup", key }
        : {
            ...rest,
            topic: "setup",
            key,
            options: stringsOf_1_55_0(options).filter((one) =>
              (key === "mode" ? WORK_MODES_1_55_0 : ON_GREEN_1_55_0).has(one),
            ),
          };
  const settlement = settlementOf_1_55_0(decision, key);
  switch (settlement.how) {
    case "asked":
      return { kind: "asked", ...fields };
    case "none":
      return open
        ? { kind: "asked", ...fields }
        : {
            kind: "settled",
            ...fields,
            answer: { how: "dropped", at: settlement.at },
          };
    case "settled":
      return { kind: "settled", ...fields, answer: settlement.answer };
  }
};

const eventOf_1_55_0 = (
  value: unknown,
  reasked: ReadonlySet<string>,
): unknown => {
  const event = recordOf(value);
  if (event === null || "about" in event) return value;
  const { terminal, ...rest } = event;
  const ref = text(terminal);
  const base: Record<string, unknown> = {
    ...rest,
    about: ref === "" ? { kind: "work" } : { kind: "member", terminal: ref },
  };
  const kind = text(event.kind);
  if (kind === "requested") {
    const { text: words, ...without } = base;
    return {
      ...without,
      request:
        text(words) === "" ? { kind: "none" } : { kind: "said", text: words },
    };
  }
  if (AGENT_WHY_KINDS_1_55_0.has(kind)) {
    const why = text(base.why);
    return {
      ...base,
      why: why === "" ? { kind: "none" } : { kind: "reason", text: why },
    };
  }
  if (CHECK_KINDS_1_55_0.has(kind)) {
    const sha = text(base.head);
    return {
      ...base,
      head: sha === "" ? { kind: "unreported" } : { kind: "commit", sha },
    };
  }
  if (kind === "answered" && reasked.has(text(event.ask)))
    return { ...base, kind: "answered-part" };
  return base;
};

export function workArmsNotNulls_1_55_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works !== null) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(works)) {
      const work = recordOf(value);
      if (work === null) {
        next[id] = value;
        continue;
      }
      const open = recordOf(work.state)?.kind !== "ended";
      const decisions = Array.isArray(work.decisions) ? work.decisions : [];
      const nextDecisions = decisions.map((one: unknown) =>
        decisionOf_1_55_0(one, open),
      );
      const reasked = new Set<string>();
      if (open)
        for (const one of nextDecisions) {
          const decision = recordOf(one);
          if (decision?.kind === "asked") reasked.add(text(decision.ask));
        }
      const events = Array.isArray(work.events) ? work.events : [];
      const nextEvents = events.map((one: unknown) =>
        eventOf_1_55_0(one, reasked),
      );
      const touched =
        nextDecisions.some((one, at) => one !== decisions[at]) ||
        nextEvents.some((one, at) => one !== events[at]);
      if (!touched) {
        next[id] = value;
        continue;
      }
      changed = true;
      next[id] = { ...work, decisions: nextDecisions, events: nextEvents };
    }
    if (changed) store.set("works", next as unknown as PersistedState["works"]);
  }
  workAskStanding_1_55_0(dirname(store.path));
  const members = recordOf(store.get("members"));
  if (members === null) return;
  let moved = false;
  const nextMembers: Record<string, unknown> = {};
  for (const [ref, value] of Object.entries(members)) {
    const member = recordOf(value);
    if (member === null || recordOf(member.worktree) !== null) {
      nextMembers[ref] = value;
      continue;
    }
    moved = true;
    const path = text(member.worktree);
    nextMembers[ref] = {
      ...member,
      worktree: path === "" ? { kind: "unread" } : { kind: "read", path },
    };
  }
  if (moved)
    store.set("members", nextMembers as unknown as PersistedState["members"]);
}

const TRANSCRIPT_VERSION_1_55_0 = "1.55.0";

export function workAskStanding_1_55_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  let changed = record?.version !== TRANSCRIPT_VERSION_1_55_0;
  const next = rows.map((value: unknown) => {
    const row = recordOf(value);
    if (row !== null && row.kind === "user" && "auth" in row) {
      changed = true;
      const { auth, ...rest } = row;
      return auth === true ? { ...rest, signIn: "signed-out" } : rest;
    }
    if (row === null || row.kind !== "work-ask") return value;
    const ask = recordOf(row.ask);
    if (ask === null || "standing" in ask) return value;
    changed = true;
    const { link: _link, outcome, ...rest } = ask;
    const settled = recordOf(outcome);
    if (settled === null)
      return { ...row, ask: { ...rest, standing: { kind: "open" } } };
    const answers = (Array.isArray(settled.answers) ? settled.answers : [])
      .map(recordOf)
      .filter(
        (one): one is Record<string, unknown> =>
          one !== null && stringsOf_1_55_0(one.values).length > 0,
      );
    const standing =
      settled.how === "answered" && answers.length > 0
        ? { kind: "answered", answers }
        : { kind: settled.how === "withdrawn" ? "withdrawn" : "declined" };
    return { ...row, ask: { ...rest, standing } };
  });
  if (!changed) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_55_0, next);
}

const KOLU_CHOICE_KEYS_1_56_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

const decisionOf_1_56_0 = (value: unknown): unknown => {
  const decision = recordOf(value);
  if (
    decision === null ||
    decision.kind !== "settled" ||
    typeof decision.key !== "string" ||
    !KOLU_CHOICE_KEYS_1_56_0.has(decision.key)
  )
    return value;
  const answer = recordOf(decision.answer);
  if (answer === null || answer.how !== "answered" || "chosen" in answer)
    return value;
  return { ...decision, answer: { ...answer, chosen: "picked" } };
};

export function koluChoicesSayHowChosen_1_56_0(
  store: Conf<PersistedState>,
): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const decisions = Array.isArray(work?.decisions) ? work.decisions : null;
    if (work === null || decisions === null) {
      next[id] = value;
      continue;
    }
    const nextDecisions = decisions.map(decisionOf_1_56_0);
    if (nextDecisions.every((one, at) => one === decisions[at])) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, decisions: nextDecisions };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

const sameHead_1_57_0 = (a: unknown, b: unknown): boolean => {
  const one = recordOf(a);
  const two = recordOf(b);
  if (one === null || two === null || one.kind !== two.kind) return false;
  return one.kind !== "commit" || one.sha === two.sha;
};

const eventsOf_1_57_0 = (
  events: ReadonlyArray<unknown>,
  finished: boolean,
): ReadonlyArray<unknown> => {
  const closed = new Set(
    events.flatMap((value) => {
      const event = recordOf(value);
      return event?.kind === "pr-closed" ? [event.pr] : [];
    }),
  );
  let changed = false;
  const next: unknown[] = [];
  events.forEach((value, at) => {
    const event = recordOf(value);
    if (event?.kind === "pr-opened" && !("url" in event)) {
      changed = true;
      next.push({ ...event, url: { kind: "unrecorded" } });
      return;
    }
    next.push(value);
    if (!finished || event?.kind !== "checks-passed") return;
    if (closed.has(event.pr)) return;
    const following = recordOf(events[at + 1]);
    if (
      following?.kind === "merge-state" &&
      following.pr === event.pr &&
      sameHead_1_57_0(following.head, event.head)
    )
      return;
    changed = true;
    next.push({
      at: event.at,
      by: "kolu",
      about: { kind: "work" },
      kind: "merge-state",
      pr: event.pr,
      head: event.head,
      merge: { kind: "can" },
    });
  });
  return changed ? next : events;
};

export function prFactsOnTheTimeline_1_57_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const events = Array.isArray(work?.events) ? work.events : null;
    if (work === null || events === null) {
      next[id] = value;
      continue;
    }
    const nextEvents = eventsOf_1_57_0(
      events,
      recordOf(work.state)?.kind === "ended",
    );
    if (nextEvents === events) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, events: nextEvents };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

const TRANSCRIPT_VERSION_1_58_0 = "1.58.0";
const TRANSCRIPT_VERSION_1_59_0 = "1.59.0";

export function toolOutings_1_59_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  if (record === null || !Array.isArray(record.rows)) return;
  if (record.version === TRANSCRIPT_VERSION_1_59_0) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_59_0, record.rows);
}

export function mentionsSayTheirKind_1_58_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  let changed = record?.version !== TRANSCRIPT_VERSION_1_58_0;
  const next = rows.map((value: unknown) => {
    const row = recordOf(value);
    if (row === null || row.kind !== "user" || !Array.isArray(row.mentions))
      return value;
    const mentions = row.mentions.map((one: unknown) => {
      const mention = recordOf(one);
      if (mention === null || "kind" in mention) return one;
      changed = true;
      return { kind: "terminal", ...mention };
    });
    return { ...row, mentions };
  });
  if (!changed) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_58_0, next);
}

const DRAFT_UNRECORDED_1_61_0 = "unrecorded";

export function prOpenedSaysDraft_1_61_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const events = Array.isArray(work?.events) ? work.events : null;
    if (work === null || events === null) {
      next[id] = value;
      continue;
    }
    let moved = false;
    const nextEvents = events.map((one: unknown) => {
      const event = recordOf(one);
      if (event?.kind !== "pr-opened" || "draft" in event) return one;
      moved = true;
      return { ...event, draft: DRAFT_UNRECORDED_1_61_0 };
    });
    if (!moved) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, events: nextEvents };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

export const CONF_MIGRATIONS = {
  "1.1.0": () => {},
  "1.2.0": (store: Conf<PersistedState>) => {
    if (!store.has("preferences")) {
      store.set("preferences", DEFAULT_PREFERENCES);
    }
  },
  "1.3.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Partial<Preferences>
      | undefined;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...current,
    });
  },
  "1.4.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as unknown as
      | Record<string, unknown>
      | undefined;
    const old = current?.sidebarAgentPreviews;
    const migrated =
      old === true
        ? "agents"
        : old === false
          ? "none"
          : typeof old === "string"
            ? old
            : "attention";
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...(current as Partial<Preferences>),
      sidebarAgentPreviews: migrated,
    } as unknown as Preferences);
  },
  "1.5.0": (store: Conf<PersistedState>) => {
    const untyped = rawStore(store);
    if (!untyped.has("recentAgents")) {
      untyped.set("recentAgents", []);
    }
  },
  "1.6.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Partial<Preferences>
      | undefined;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...current,
    });
  },
  "1.7.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Record<string, unknown>
      | undefined;
    const { rightPanelCollapsed, rightPanelSize, ...rest } = current ?? {};
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...rest,
      rightPanel: DEFAULT_PREFERENCES.rightPanel,
    });
  },
  "1.8.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const staleTab = rp.tab !== "inspector" && rp.tab !== "review";
    if (staleTab) {
      store.set("preferences", {
        ...current,
        rightPanel: { ...rp, tab: "inspector" },
      } as unknown as Preferences);
    }
  },
  "1.9.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const next = rp.tab === "review" ? "diff" : rp.tab;
    const valid = next === "inspector" || next === "diff";
    store.set("preferences", {
      ...current,
      rightPanel: { ...rp, tab: valid ? next : "inspector" },
    } as unknown as Preferences);
  },
  "1.10.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as unknown as
      | (Record<string, unknown> & { randomTheme?: unknown })
      | undefined;
    const { randomTheme, ...rest } = current ?? {};
    const shuffleTheme = typeof randomTheme === "boolean" ? randomTheme : true;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...(rest as Partial<Preferences>),
      shuffleTheme,
    });
  },
  "1.11.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    if ((current.rightPanel as Record<string, unknown>).pinned === undefined) {
      store.set("preferences", {
        ...current,
        rightPanel: { ...current.rightPanel, pinned: true },
      });
    }
  },
  "1.12.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    if (current.canvasMode === undefined) {
      store.set("preferences", {
        ...current,
        canvasMode: false,
      } as unknown as Preferences);
    }
  },
  "1.13.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const tab =
      rp.tab === "diff"
        ? { kind: "code" as const, mode: "local" as const }
        : { kind: "inspector" as const };
    const { codeMode: _codeMode, tab: _tab, ...rest } = rp;
    store.set("preferences", {
      ...current,
      rightPanel: { ...rest, tab },
    } as unknown as Preferences);
  },
  "1.14.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    if ((current as Record<string, unknown>).terminalRenderer === undefined) {
      store.set("preferences", { ...current, terminalRenderer: "auto" });
    }
  },
  "1.15.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const { canvasMode: _cm, sidebarAgentPreviews: _sap, ...rest } = current;
    store.set("preferences", rest as Preferences);
  },
  "1.16.0": () => {},
  "1.17.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    const rp = current.rightPanel as Record<string, unknown>;
    if (rp.pinned !== undefined) {
      const { pinned: _pinned, ...rest } = rp;
      store.set("preferences", {
        ...current,
        rightPanel: rest as typeof current.rightPanel,
      });
    }
  },
  "1.18.0": () => {},
  "1.19.0": (store: Conf<PersistedState>) => {
    deleteLegacyKey(store, "recentRepos");
    deleteLegacyKey(store, "recentAgents");
  },
  "1.20.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    const tab = rp.tab as
      | { kind: "inspector" }
      | { kind: "code"; mode: "local" | "branch" | "browse" }
      | undefined;
    const activeTab = tab?.kind === "code" ? "code" : "inspector";
    const codeMode = tab?.kind === "code" ? tab.mode : "local";
    const { tab: _tab, ...rest } = rp;
    store.set("preferences", {
      ...current,
      rightPanel: { ...rest, activeTab, codeMode },
    } as unknown as Preferences);
  },
  "1.21.0": () => {},
  "1.22.0": () => {},
  "1.23.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown> | undefined;
    if (!rp) return;
    const { activeTab: _activeTab, codeMode: _codeMode, ...rest } = rp;
    store.set("preferences", {
      ...current,
      rightPanel: rest as typeof current.rightPanel,
    } as Preferences);
  },
  "1.24.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown> | undefined;
    if (!rp || rp.codeTabTreeSize !== undefined) return;
    store.set("preferences", {
      ...current,
      rightPanel: {
        ...rp,
        codeTabTreeSize: DEFAULT_PREFERENCES.rightPanel.codeTabTreeSize,
      },
    } as Preferences);
  },
  "1.25.0": () => {},
  "1.26.0": () => {},
  "1.27.0": () => {},
  "1.28.0": () => {},
  "1.29.0": () => {},
  "1.30.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    store.set(
      "preferences",
      migratePreferences_1_30_0(current) as unknown as Preferences,
    );
  },
  "1.31.0": (store: Conf<PersistedState>) => stripLegacyStateKeys_1_31_0(store),
  "1.32.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_32_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.33.0": (store: Conf<PersistedState>) => {
    if (!store.has("hosts")) store.set("hosts", []);
  },
  "1.34.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_34_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.35.0": () => {},
  "1.36.0": (store: Conf<PersistedState>) => {
    if (!store.has("viewerMode")) store.set("viewerMode", "dark");
  },
  "1.37.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_37_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.38.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_38_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.39.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_39_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.40.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_40_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.41.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_41_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.42.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_42_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.43.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_43_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  "1.44.0": (store: Conf<PersistedState>) => {
    if (!store.has("conductor")) {
      store.set("conductor", EMPTY_PERSISTED_CONDUCTOR);
    }
  },
  "1.45.0": (store: Conf<PersistedState>) => {
    renameLegacyKey(store, "orchestrator", "conductor");
    const root = dirname(store.path);
    const from = join(root, "orchestrator");
    const to = join(root, "conductor");
    if (!existsSync(from) || existsSync(to)) return;
    try {
      renameSync(from, to);
    } catch (err) {
      log.warn(
        { err, from, to },
        "kolu-server: the conductor's attachments could not be moved to their new corner",
      );
      return;
    }
    const record = store.get("conductor") as unknown as Record<
      string,
      unknown
    > & { rows?: ReadonlyArray<ConductorRow> };
    if (record.rows === undefined) return;
    store.set("conductor", {
      ...record,
      ...repointConductorAttachments({ rows: record.rows }, from, to),
    } as unknown as PersistedState["conductor"]);
  },
  "1.49.0": (store: Conf<PersistedState>) => {
    const record = store.get("conductor") as
      | Record<string, unknown>
      | undefined;
    if (record === undefined) return;
    const watched = record.watched;
    if (watched !== undefined && !Array.isArray(watched)) return;
    const now = new Date().toISOString();
    store.set("conductor", {
      ...record,
      watched: (watched ?? []).map((entry: Record<string, unknown>) => ({
        joined: "asked",
        spoken: false,
        ran: false,
        root: null,
        since: now,
        ...entry,
      })),
    } as unknown as PersistedState["conductor"]);
  },
  "1.50.0": migrateConductorToWorks_1_50_0,
  "1.51.0": collapseFlappingChecks_1_51_0,
  "1.52.0": memberWatchOutOfWorks_1_52_0,
  "1.53.0": foldWorks_1_53_0,
  "1.54.0": dropKoluChoiceOptions_1_54_0,
  "1.55.0": workArmsNotNulls_1_55_0,
  "1.56.0": koluChoicesSayHowChosen_1_56_0,
  "1.57.0": prFactsOnTheTimeline_1_57_0,
  "1.58.0": (store: Conf<PersistedState>) =>
    mentionsSayTheirKind_1_58_0(dirname(store.path)),
  "1.59.0": (store: Conf<PersistedState>) =>
    toolOutings_1_59_0(dirname(store.path)),
  "1.60.0": (store: Conf<PersistedState>) => {
    const record = store.get("conductor") as
      | Record<string, unknown>
      | undefined;
    if (record === undefined) return;
    store.set("conductor", {
      taught: false,
      ...record,
    } as unknown as PersistedState["conductor"]);
  },
  "1.61.0": prOpenedSaysDraft_1_61_0,
};
