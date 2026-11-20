import { frameByClass, frameClassOf } from "@kolu/padi-client/attention";
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import type {
  WatchGit,
  WatchMerge,
  WatchObservation,
  WatchPr,
} from "./observation.ts";

type PadiTerminalId = PadiUrgency["awaitingIds"][number];

export type HostView = HostUnreachable | HostSettling | HostReady;

interface HostLeg {
  readonly host: string;
  readonly hostName: string;
  readonly watched: readonly string[];
}

export interface HostUnreachable extends HostLeg {
  readonly kind: "unreachable";
}

export interface HostSettling extends HostLeg {
  readonly kind: "settling";
}

export interface HostReady extends HostLeg {
  readonly kind: "ready";
  readonly roster: ReadonlySet<string>;
  readonly urgency: PadiUrgency;
  readonly records: ReadonlyMap<string, PadiTerminal>;
}

export const recordName = (record: PadiTerminal | undefined): string => {
  const live = record?.state === "active" ? record : undefined;
  const branch = live?.git.kind === "repo" ? live.git.info.branch : "";
  return live?.intent ?? branch;
};

const gitOf = (record: PadiTerminal | undefined): WatchGit | null => {
  const live = record?.state === "active" ? record : undefined;
  if (live?.git.kind !== "repo") return null;
  const info = live.git.info;
  return {
    worktree: info.worktreePath,
    branch: info.branch,
    repo: info.repoRoot,
  };
};

type PrValue = Extract<PrResult, { readonly kind: "ok" }>["value"];

/** WHETHER THE FORGE WOULD MERGE IT — GitHub's merge state, in the record's
 *  words. This is the fact that decides "green"; the checks' rollup only says
 *  what the checks that have REPORTED say, and a required check that has not
 *  started is not among them.
 *
 *  - `CLEAN`, `HAS_HOOKS` and `UNSTABLE` can merge;
 *  - `BLOCKED` cannot: on a review when one is required or changes were
 *    requested, otherwise on whatever else the branch's protection still
 *    wants (a required check that has not passed, a conversation);
 *  - `BEHIND` and `DIRTY` cannot, for those reasons, and neither can `DRAFT`
 *    (GitHub's retired word, not said since 2021: whether a PR is a draft is
 *    `isDraft` now, and {@link prReading} calls this only for one that is not);
 *  - `UNKNOWN` is the forge not having worked it out yet (`unsettled`):
 *    recorded once for a commit it has said nothing about, so a push never
 *    inherits the last commit's answer;
 *  - a reading with no merge state at all (`unreported`) is a padi older than
 *    the field, which never says: nothing is recorded, and the card says
 *    GitHub has not answered. */
export const mergeOf = (value: PrValue): WatchMerge => {
  switch (value.mergeStateStatus) {
    case "CLEAN":
    case "HAS_HOOKS":
    case "UNSTABLE":
      return { kind: "can" };
    case "BLOCKED":
      return {
        kind: "cannot",
        why:
          value.reviewDecision === "REVIEW_REQUIRED" ||
          value.reviewDecision === "CHANGES_REQUESTED"
            ? "review"
            : "blocked",
      };
    case "BEHIND":
      return { kind: "cannot", why: "behind" };
    case "DIRTY":
      return { kind: "cannot", why: "conflicts" };
    case "DRAFT":
      return { kind: "cannot", why: "draft" };
    case "UNKNOWN":
      return { kind: "unsettled" };
    case null:
      return { kind: "unreported" };
    default:
      return value.mergeStateStatus satisfies never;
  }
};

export type PrRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "pr"; readonly pr: WatchPr }
  | { readonly kind: "broken"; readonly why: string };

export const prReading = (pr: PrResult): PrRead => {
  if (pr.kind !== "ok") return { kind: "unknown" };
  const value = pr.value;
  if (value.url === "")
    return {
      kind: "broken",
      why: `the forge's reading of PR #${value.number} carries no address`,
    };
  return {
    kind: "pr",
    pr: {
      number: value.number,
      title: value.title,
      url: value.url,
      state: value.state,
      checks:
        value.checks === null
          ? { kind: "unreported" }
          : { kind: "rollup", rollup: value.checks },
      // A DRAFT HAS NO MERGE ANSWER: GitHub works its merge state out as if
      // it were ready, so a draft with green checks says `CLEAN`.
      readiness: value.isDraft
        ? { kind: "draft" }
        : { kind: "ready", merge: mergeOf(value) },
      failing: value.checkRuns
        .filter((one) => one.outcome === "fail")
        .map((one) => one.name),
      head:
        value.headSha === null
          ? { kind: "unreported" }
          : { kind: "commit", sha: value.headSha },
    },
  };
};

export const readingsOf = (view: HostView): ReadonlyArray<WatchObservation> => {
  if (view.kind !== "ready") return [];
  const { host, hostName, urgency, roster, records } = view;
  const frame = { byClass: frameByClass(urgency), liveIds: [] };
  const seen: Array<WatchObservation> = [];
  for (const id of view.watched) {
    const record = records.get(id);
    const live = record?.state === "active" ? record : undefined;
    const base = {
      ref: fleetTerminalRef(host, id),
      host,
      terminalId: id,
      hostName,
      name: recordName(record),
      agent: live?.agent?.kind ?? null,
      git: gitOf(record),
      foregroundShell: live?.foreground?.shell ?? null,
    };
    if (!roster.has(id)) {
      seen.push({ ...base, level: "gone" });
      continue;
    }
    if (record !== undefined && record.state !== "active") {
      seen.push({ ...base, level: "asleep" });
      continue;
    }
    const klass = frameClassOf(frame, id as PadiTerminalId);
    switch (klass) {
      case "asking":
        seen.push({ ...base, level: "asking" });
        continue;
      case "finished":
        seen.push({ ...base, level: "stopped" });
        continue;
      case "linger":
      case "working":
        seen.push({ ...base, level: "working" });
        continue;
      case "idle":
        break;
      default: {
        const unknownClass: never = klass;
        throw new Error(`unhandled attention class: ${String(unknownClass)}`);
      }
    }
    if (record === undefined) continue;
    const agent = live?.agent ?? null;
    if (agent === null) {
      seen.push({ ...base, level: "shell" });
      continue;
    }
    const bucket = agentBucket(agent.state);
    if (bucket === "starting" || bucket === "fresh") {
      seen.push({ ...base, level: bucket });
    }
  }
  return seen;
};
