/** THE CHAT, QUIET — which turns are one line and what that line says.
 *
 *  Most of this conversation is not an answer to anybody. kolu wakes the
 *  Conductor when a watched terminal stops, asks or dies, and the reply to
 *  that wake-up is news nobody asked for: on a night of work it is seven
 *  replies in ten. Drawn whole they bury the two lines a person actually
 *  typed, so a turn kolu started is drawn as ONE LINE — its time, the works
 *  it is about, and the reply's first sentence — which opens where it is.
 *
 *  WHAT NEVER FOLDS, and why each one is in the list: a turn that began with
 *  a message of yours (you asked, so the answer is yours to read); the turn
 *  holding the newest reply in the chat (it is the news, and a conversation
 *  that opens folded looks like it stopped talking); and a QUESTION — an
 *  `ask` or a `work-ask` row is the one thing in here that waits on a person,
 *  so it is drawn whether its turn is open or not.
 *
 *  Folding is DRAWING, and this file is the whole rule: nothing it decides is
 *  sent anywhere or saved, and the transcript it reads is the one the panel
 *  already holds. The turns are `./turnWorks.ts`'s `chatTurns` — the same
 *  boundary the chips are drawn by. */

import type { ConductorRow } from "kolu-common/conductor";
import type { Work } from "kolu-work";
import { chatTurns } from "./turnWorks";

/** A RUN OF CHARACTERS A FULL STOP INSIDE CANNOT END A SENTENCE: a code span
 *  (`69b08e9`, `.waterfall/mockup/`) and a URL. Masked to the same length
 *  before the scan, so the index it finds is an index into the real text. */
const GUARDED = /`[^`]*`|<?https?:\/\/[^\s)>]+>?/g;

/** What a sentence may put between its full stop and the space after it. */
const CLOSERS = "\"”’')]»*_`";

/** What may OPEN the sentence after this one. A capital, a quote, an opening
 *  bracket, or a dash — anything else (a lower-case word, a digit) means the
 *  full stop was part of what came before it. */
const OPENERS = "\"“‘'([«—–*_`#";

/** THE ABBREVIATIONS a full stop belongs to rather than ends — written out,
 *  because "e.g. Something" and "i.e. A thing" both put a capital after a dot
 *  and a space, which is exactly the shape of a sentence boundary. */
const ABBREVIATION =
  /(?:^|[\s("'])(?:e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|Prof|Fig|No|approx|[A-Z])$/;

/** Is the full stop at `i` the end of a sentence? */
function ends(text: string, i: number): boolean {
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
}

/** The text with every guarded run replaced by `x`s of the same length — the
 *  string the scan reads, so a dot inside a commit hash or a path is a dot
 *  the rule never sees. Its length is kept, so an index into it is an index
 *  into the real text. */
const masked = (text: string): string =>
  text.replace(GUARDED, (run) => "x".repeat(run.length));

/** Markdown's inline marks taken off: a link is its words, a code span is its
 *  code, emphasis is the text it emphasised. The line is drawn as PLAIN TEXT
 *  — one line of a folded turn is not a place to render markdown — so the
 *  marks would otherwise be read as punctuation. */
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

/** Lines a block cannot start with and still be prose: a heading, a list
 *  item, a quote, a table row, a fence. */
const MARKER =
  /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?|\|\s*|```+\s*\w*\s*$|:::\s*\w*)/;

/** A line that is only a rule — `---`, `***`, `___` — which separates blocks
 *  and says nothing. */
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;

/** THE REPLY'S HEADLINE — its first sentence, or, when the reply does not
 *  open with prose, the first line of whatever it does open with.
 *
 *  A reply that opens with a heading or a list ("**What it found:**",
 *  "- **The cache rule is its to choose**") has no first sentence to cut: the
 *  line is that block's first line with its marker taken off, which is what a
 *  person skimming would read aloud. Everything else is cut at the first full
 *  stop that ENDS something — never one inside a commit hash, a path, a URL,
 *  a version or `e.g.` ({@link ends}). */
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
    // A FENCE opens a block whose first line is the fence itself ("```bash"),
    // which says nothing; the code's own first line is the news.
    if (first.startsWith("```"))
      return plain((lines[at + 1] ?? "").trim()).slice(0, 200);
    return plain(first.slice((mark[0] as string).length));
  }
  // The paragraph: every line up to the first blank one or the first line
  // that starts a block of its own.
  const paragraph: string[] = [];
  for (let i = at; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === "") break;
    if (i > at && (MARKER.test(line.trim()) || RULE.test(line.trim()))) break;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(" ");
  const scan = masked(text);
  for (let i = 0; i < scan.length; i += 1) {
    const char = scan[i] as string;
    if (char !== "." && char !== "!" && char !== "?") continue;
    // A run of terminators (`?!`, `...`) ends at its last one.
    let end = i;
    while (end + 1 < scan.length && ".!?".includes(scan[end + 1] as string))
      end += 1;
    if (!ends(scan, end)) {
      i = end;
      continue;
    }
    let stop = end;
    while (stop + 1 < scan.length && CLOSERS.includes(scan[stop + 1] as string))
      stop += 1;
    return plain(text.slice(0, stop + 1));
  }
  return plain(text);
}

/** A NOTE the Conductor put on a work's timeline — what a turn it wrote no
 *  reply in says instead. `at` is the epoch milliseconds of the event, to be
 *  placed in a turn's window. */
export interface WorkNote {
  readonly at: number;
  readonly text: string;
}

/** ONE WORK'S OWN NOTES, in the order its timeline carries them — the
 *  per-work half of the shared reading (`useAgentNotes`), so a mirror of many
 *  works is read work by work rather than walked again whenever any timeline
 *  moves. The human's own notes are not news from a turn, so only the
 *  agent's are read. */
export function notesOfWork(work: Work): ReadonlyArray<WorkNote> {
  const out: WorkNote[] = [];
  for (const event of work.events)
    if (event.kind === "note" && event.by === "agent")
      out.push({ at: Date.parse(event.at), text: event.text });
  return out;
}

/** EVERY NOTE OF EVERY WORK, oldest first — from readings already taken. */
export function mergeNotes(
  works: Iterable<ReadonlyArray<WorkNote>>,
): WorkNote[] {
  const out: WorkNote[] = [];
  for (const one of works) out.push(...one);
  return out.sort((one, other) => one.at - other.at);
}

/** WHAT A WAKE TURN'S ONE LINE SAYS: the reply's first sentence, the note it
 *  wrote instead of replying, or nothing at all. */
export type QuietSays =
  | { readonly kind: "prose"; readonly headline: string }
  | { readonly kind: "noted"; readonly text: string }
  | { readonly kind: "quiet" };

/** ONE TURN as the transcript draws it. */
export interface QuietTurn {
  /** The id of the row that starts it — `./turnWorks.ts`'s `head`. */
  readonly head: string;
  /** When it started, as the head row stamped it. */
  readonly since: string;
  /** Is it drawn as one line? True for a turn kolu woke, false for a turn
   *  that began with a message of yours and for the rows before the first
   *  prompt of all. */
  readonly folds: boolean;
  readonly says: QuietSays;
  /** Open with nothing pressed — the turn holding the newest reply. */
  readonly open: boolean;
  /** The rows that are drawn even while it is folded: its questions. */
  readonly asks: ReadonlySet<string>;
}

/** THE RUN OF UNASKED REPLIES that follows the human's last message — where
 *  the heading goes, and how many it counts. */
export interface SinceRun {
  /** The head row of the first turn in the run. */
  readonly from: string;
  readonly count: number;
}

/** The whole reading, in one value: the turns in order, the turn of every
 *  row, and the run of replies since the last thing a person said. */
export interface QuietChat {
  readonly turns: ReadonlyArray<QuietTurn>;
  readonly of: ReadonlyMap<string, QuietTurn>;
  readonly since: SinceRun | null;
}

/** Does this row carry prose a headline can be cut out of? */
const prose = (
  row: ConductorRow,
): row is Extract<ConductorRow, { kind: "agent" }> =>
  row.kind === "agent" && row.text.trim() !== "";

/** THE FOLD, READ OFF THE CHAT: which turns are one line, what the line says,
 *  and which of them is open before anybody presses anything.
 *
 *  `notes` is every note the Conductor wrote on any work (`useAgentNotes`),
 *  because a turn is a window of time and a note is an event in one. A turn
 *  with no prose shows the LAST note written inside its window: the Conductor
 *  writing twice in one turn has said the newer thing. */
export function quietChat(
  rows: readonly ConductorRow[],
  notes: readonly WorkNote[],
): QuietChat {
  const groups = chatTurns(rows);

  /** The newest turn with a reply in it — the one that stays open. */
  const newest = groups.findLastIndex((group) => group.rows.some(prose));

  const turns: QuietTurn[] = [];
  const of = new Map<string, QuietTurn>();
  groups.forEach((group, index) => {
    const { head, from, until } = group;
    // THE TURN'S LAST REPLY is its news: a turn that writes "Green, clean"
    // and then, after more calls, "PR #2400 is merged" ended on the merge.
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

  /** The last thing the person typed, and everything kolu has said since. */
  const spoke = groups.findLastIndex((group) => group.head.kind === "user");
  const run =
    spoke === -1 ? [] : turns.slice(spoke + 1).filter((one) => one.folds);
  const first = run[0];
  const since: SinceRun | null =
    first === undefined ? null : { from: first.head, count: run.length };

  return { turns, of, since };
}
