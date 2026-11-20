import type { Saying } from "@kolu/acp/wire";
import { isTerminalId } from "@kolu/terminal-vocab/terminalId";
import {
  appendedText,
  type ConductorFrame,
  type ConductorRow,
  type ConductorToolRow,
} from "kolu-common/conductor";
import { isEncodedHostKey } from "kolu-common/hostKey";
import { askLead, askRecord } from "./askRecord";
import {
  agentLineSubject,
  callSubject,
  failureReason,
  toolLabel,
} from "./toolCard";

export interface TranscriptState {
  readonly seq: number;
  readonly rows: readonly ConductorRow[];
}

export const EMPTY_TRANSCRIPT: TranscriptState = { seq: 0, rows: [] };

function appendSaying(
  rows: readonly ConductorRow[],
  saying: Saying,
): readonly ConductorRow[] {
  const index = rows.findIndex((row) => row.id === saying.of);
  if (index === -1) {
    console.warn("conductor transcript: append for an unknown row", saying.of);
    return rows;
  }
  const row = rows[index];
  if (row === undefined) return rows;
  if (row.kind === "plan") {
    console.warn(
      "conductor transcript: append addressed to a plan row",
      saying.of,
    );
    return rows;
  }
  const current = row.text;
  if (saying.at > current.length) {
    console.warn(
      "conductor transcript: append starts past the end of its row — a frame was lost",
      { row: saying.of, at: saying.at, have: current.length },
    );
  }
  const next = rows.slice();
  next[index] = {
    ...row,
    text: appendedText(current, saying.at, saying.text),
  };
  return next;
}

function upsert(
  rows: readonly ConductorRow[],
  row: ConductorRow,
): readonly ConductorRow[] {
  const at = rows.findIndex((existing) => existing.id === row.id);
  if (at !== -1) {
    const next = rows.slice();
    next[at] = row;
    return next;
  }
  const before = rows.findIndex((existing) => existing.seq > row.seq);
  const next = rows.slice();
  next.splice(before === -1 ? next.length : before, 0, row);
  return next;
}

type ConductorDelta = Extract<ConductorFrame, { kind: "delta" }>;

type DeltaStage = (
  rows: readonly ConductorRow[],
  delta: ConductorDelta,
) => readonly ConductorRow[];

const retire: DeltaStage = (rows, delta) => {
  if (delta.removes.length === 0) return rows;
  const gone = new Set(delta.removes);
  return rows.filter((row) => !gone.has(row.id));
};

const upsertAll: DeltaStage = (rows, delta) =>
  delta.upserts.reduce<readonly ConductorRow[]>(upsert, rows);

const appendAll: DeltaStage = (rows, delta) =>
  delta.appends.reduce<readonly ConductorRow[]>(appendSaying, rows);

const DELTA_PIPELINE: readonly DeltaStage[] = [retire, upsertAll, appendAll];

export function applyFrame(
  prev: TranscriptState,
  frame: ConductorFrame,
): TranscriptState {
  if (frame.kind === "snapshot") {
    return {
      seq: frame.seq,
      rows: [...frame.rows].sort((a, b) => a.seq - b.seq),
    };
  }
  return {
    seq: frame.seq,
    rows: DELTA_PIPELINE.reduce((rows, stage) => stage(rows, frame), prev.rows),
  };
}

export interface TranscriptEntry {
  readonly row: ConductorRow;
  readonly repeat: number;
}

export function foldNoticeRuns(
  rows: readonly ConductorRow[],
): readonly TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const row of rows) {
    if (row.kind === "tool" && row.asksThroughForm === true) continue;
    const last = entries[entries.length - 1];
    if (
      last !== undefined &&
      row.kind === "notice" &&
      last.row.kind === "notice" &&
      last.row.text === row.text
    ) {
      entries[entries.length - 1] = { row: last.row, repeat: last.repeat + 1 };
      continue;
    }
    entries.push({ row, repeat: 1 });
  }
  return entries;
}

export type TranscriptItem =
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly entry: TranscriptEntry;
    }
  | {
      readonly kind: "fold";
      readonly key: string;
      readonly rows: readonly ConductorToolRow[];
    }
  | {
      readonly kind: "failures";
      readonly key: string;
      readonly tool: string;
      readonly reason: string;
      readonly rows: readonly ConductorToolRow[];
    };

function staysInFlow(row: ConductorToolRow): boolean {
  if (row.status === "pending" || row.status === "in_progress") return true;
  if (row.status === "failed" || row.stranded === true) return true;
  if (row.armed !== undefined && row.armed.ended === null) return true;
  return agentLineSubject(row) !== null;
}

const FOLD_AT_TOP = "fold:top";

export function foldToolRuns(
  entries: readonly TranscriptEntry[],
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const asItem = (entry: TranscriptEntry): TranscriptItem => ({
    kind: "entry",
    key: entry.row.id,
    entry,
  });
  const foldable = (row: ConductorRow): row is ConductorToolRow =>
    row.kind === "tool" && !staysInFlow(row);
  let run: TranscriptEntry[] = [];
  let key = FOLD_AT_TOP;

  const flush = () => {
    const folded = run.map((one) => one.row).filter(foldable);
    let placed = folded.length === 0;
    for (const one of run) {
      if (!foldable(one.row)) items.push(asItem(one));
      else if (!placed) {
        items.push({ kind: "fold", key, rows: folded });
        placed = true;
      }
    }
    run = [];
  };

  for (const entry of entries) {
    const kind = entry.row.kind;
    if (
      kind !== "agent" &&
      kind !== "user" &&
      kind !== "divider" &&
      kind !== "wake"
    ) {
      run.push(entry);
      continue;
    }
    flush();
    items.push(asItem(entry));
    key = `fold:${entry.row.id}`;
  }
  flush();
  return items;
}

const REASON = Symbol("comparable failure reason");

interface ComparableReason {
  readonly [REASON]: string;
}

interface Failure {
  readonly tool: string;
  readonly key: ComparableReason;
  readonly said: string;
  readonly row: ConductorToolRow;
}

const ADDRESS_RUNS = /[^\s"'`]+/g;

const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function withoutTerminalRef(run: string): string {
  const addressed = run.replace(TRAILING_PUNCTUATION, "");
  const punctuation = run.slice(addressed.length);
  const idAt = addressed.lastIndexOf("/");
  if (!isTerminalId(addressed.slice(idAt + 1))) return run;
  const head = addressed.slice(0, idAt + 1);
  const hostAt = head.slice(0, -1).lastIndexOf("/");
  const host = head.slice(hostAt + 1, -1);
  return (
    (isEncodedHostKey(host) ? head.slice(0, hostAt + 1) : head) + punctuation
  );
}

function failureKey(row: ConductorToolRow, said: string): ComparableReason {
  const subject = callSubject(row.kolu);
  const withoutSubject =
    subject === null
      ? said
      : said
          .replaceAll(`${subject.host}/${subject.id}`, "")
          .replaceAll(subject.id, "");
  return {
    [REASON]: withoutSubject
      .replace(ADDRESS_RUNS, withoutTerminalRef)
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function failureOf(item: TranscriptItem): Failure | null {
  if (item.kind !== "entry" || item.entry.row.kind !== "tool") return null;
  const row = item.entry.row;
  const said = failureReason(row);
  if (said === null) return null;
  return { tool: toolLabel(row), key: failureKey(row, said), said, row };
}

function failureSentence(run: readonly Failure[]): string {
  const [first, ...rest] = run;
  if (first === undefined) return "";
  const others = new Set(
    rest.map((one) => one.said).filter((said) => said !== first.said),
  ).size;
  return others === 0 ? first.said : `${first.said} +${others} more`;
}

export function foldFailureRuns(
  items: readonly TranscriptItem[],
): readonly TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let run: { item: TranscriptItem; failure: Failure }[] = [];

  const flush = () => {
    const [first] = run;
    if (first !== undefined && run.length === 1) out.push(first.item);
    if (first !== undefined && run.length > 1) {
      out.push({
        kind: "failures",
        key: `failures:${first.failure.row.id}`,
        tool: first.failure.tool,
        reason: failureSentence(run.map((one) => one.failure)),
        rows: run.map((one) => one.failure.row),
      });
    }
    run = [];
  };

  for (const item of items) {
    const failure = failureOf(item);
    const last = run.at(-1)?.failure;
    if (
      failure === null ||
      last === undefined ||
      failure.tool !== last.tool ||
      failure.key[REASON] !== last.key[REASON]
    ) {
      flush();
    }
    if (failure === null) out.push(item);
    else run.push({ item, failure });
  }
  flush();
  return out;
}

function rowText(row: ConductorRow): string {
  switch (row.kind) {
    case "user":
      return `you: ${row.text}`;
    case "agent":
      return `agent: ${row.text}`;
    case "plan":
      return [
        "plan:",
        ...row.steps.map((step) => `  [${step.status}] ${step.content}`),
      ].join("\n");
    case "tool":
      return `tool: ${row.text} [${row.status}]`;
    case "ask": {
      const lead = askLead(row);
      return [
        `ask:${lead === null ? "" : ` ${lead}`}`,
        ...askRecord(row).map(
          (line) =>
            `  ${line.question}${line.answer === null ? "" : ` — ${line.answer}`}`,
        ),
        ...(row.ask.outcome === null ? [] : [`  [${row.ask.outcome.how}]`]),
      ].join("\n");
    }
    case "work-ask":
      return `ask about ${row.work}`;
    case "notice":
      return `note: ${row.text}`;
    case "divider":
      return `— ${row.text} —`;
    case "wake":
      return `${row.from}: ${row.text}`;
  }
}

export function transcriptText(rows: readonly ConductorRow[]): string {
  return rows.map(rowText).join("\n\n");
}
