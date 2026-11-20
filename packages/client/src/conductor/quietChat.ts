import type { ConductorRow } from "kolu-common/conductor";
import type { Work, WorkId } from "kolu-work";
import { chatTurns } from "./turnWorks";

const GUARDED = /`[^`]*`|<?https?:\/\/[^\s)>]+>?/g;

const CLOSERS = "\"”’')]»*_`";

const OPENERS = "\"“‘'([«—–*_`#";

const ABBREVIATION =
  /(?:^|[\s("'])(?:e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|Prof|Fig|No|approx|[A-Z])$/;

const SentenceScanner = {
  mask: (text: string): string =>
    text.replace(GUARDED, (run) => "x".repeat(run.length)),

  closes(text: string, i: number): boolean {
    let j = i + 1;
    while (j < text.length && CLOSERS.includes(text[j] as string)) j += 1;
    if (j >= text.length) return true;
    if (!/\s/.test(text[j] as string)) return false;
    while (j < text.length && /\s/.test(text[j] as string)) j += 1;
    if (j >= text.length) return true;
    const next = text[j] as string;
    const capital = next === next.toUpperCase() && next !== next.toLowerCase();
    if (!capital && !OPENERS.includes(next)) return false;
    return !ABBREVIATION.test(text.slice(0, i));
  },

  firstEnd(text: string): number | null {
    const scan = SentenceScanner.mask(text);
    for (let i = 0; i < scan.length; i += 1) {
      const char = scan[i] as string;
      if (char !== "." && char !== "!" && char !== "?") continue;
      let end = i;
      while (end + 1 < scan.length && ".!?".includes(scan[end + 1] as string))
        end += 1;
      if (!SentenceScanner.closes(scan, end)) {
        i = end;
        continue;
      }
      let stop = end;
      while (
        stop + 1 < scan.length &&
        CLOSERS.includes(scan[stop + 1] as string)
      )
        stop += 1;
      return stop;
    }
    return null;
  },
};

function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKER =
  /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?|\|\s*|```+\s*\w*\s*$|:::\s*\w*)/;

const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;

export function firstSentence(markdown: string): string {
  const lines = markdown.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at] as string).trim() === "") at += 1;
  while (at < lines.length && RULE.test((lines[at] as string).trim())) {
    at += 1;
    while (at < lines.length && (lines[at] as string).trim() === "") at += 1;
  }
  const first = (lines[at] ?? "").trim();
  if (first === "") return "";
  const mark = MARKER.exec(first);
  if (mark !== null) {
    if (first.startsWith("```"))
      return plain((lines[at + 1] ?? "").trim()).slice(0, 200);
    return plain(first.slice((mark[0] as string).length));
  }
  const paragraph: string[] = [];
  for (let i = at; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === "") break;
    if (i > at && (MARKER.test(line.trim()) || RULE.test(line.trim()))) break;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(" ");
  const end = SentenceScanner.firstEnd(text);
  return plain(end === null ? text : text.slice(0, end + 1));
}

export interface WorkNote {
  readonly at: number;
  readonly text: string;
}

export function agentNotes(works: ReadonlyMap<WorkId, Work>): WorkNote[] {
  const out: WorkNote[] = [];
  for (const work of works.values())
    for (const event of work.events)
      if (event.kind === "note" && event.by === "agent")
        out.push({ at: Date.parse(event.at), text: event.text });
  return out.sort((one, other) => one.at - other.at);
}

export type QuietSays =
  | { readonly kind: "prose"; readonly headline: string }
  | { readonly kind: "noted"; readonly text: string }
  | { readonly kind: "quiet" };

export interface QuietTurn {
  readonly head: string;
  readonly since: string;
  readonly folds: boolean;
  readonly says: QuietSays;
  readonly open: boolean;
  readonly asks: ReadonlySet<string>;
}

export interface SinceRun {
  readonly from: string;
  readonly count: number;
}

export interface QuietChat {
  readonly turns: ReadonlyArray<QuietTurn>;
  readonly of: ReadonlyMap<string, QuietTurn>;
  readonly since: SinceRun | null;
}

const prose = (
  row: ConductorRow,
): row is Extract<ConductorRow, { kind: "agent" }> =>
  row.kind === "agent" && row.text.trim() !== "";

export function quietChat(
  rows: readonly ConductorRow[],
  notes: readonly WorkNote[],
): QuietChat {
  const groups = chatTurns(rows);

  const newest = groups.findLastIndex((group) => group.rows.some(prose));

  const turns: QuietTurn[] = [];
  const of = new Map<string, QuietTurn>();
  groups.forEach((group, index) => {
    const { head, from, until } = group;
    const said = group.rows.filter(prose).at(-1);
    const note = notes.filter((one) => one.at >= from && one.at < until).at(-1);
    const says: QuietSays =
      said !== undefined
        ? { kind: "prose", headline: firstSentence(said.text) }
        : note !== undefined
          ? { kind: "noted", text: note.text }
          : { kind: "quiet" };
    const asks = new Set(
      group.rows
        .filter((row) => row.kind === "ask" || row.kind === "work-ask")
        .map((row) => row.id),
    );
    const turn: QuietTurn = {
      head: head.id,
      since: head.since,
      folds: head.kind === "wake",
      says,
      open: index === newest,
      asks,
    };
    turns.push(turn);
    for (const row of group.rows) of.set(row.id, turn);
  });

  const spoke = groups.findLastIndex((group) => group.head.kind === "user");
  const run =
    spoke === -1 ? [] : turns.slice(spoke + 1).filter((one) => one.folds);
  const first = run[0];
  const since: SinceRun | null =
    first === undefined ? null : { from: first.head, count: run.length };

  return { turns, of, since };
}
