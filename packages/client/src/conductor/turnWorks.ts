/** WHICH PIECES OF WORK EACH CHAT TURN IS ABOUT — read off rows already in
 *  the transcript and the works' own records, never stored in a row.
 *
 *  A TURN is one prompt row (what you typed, or kolu's wake-up) and every row
 *  that answers it ({@link chatTurns}). Rows before the first prompt are a
 *  turn of their own. A turn's works are the ones its rows NAME:
 *
 *   - a wake-up names the terminals that rang (`events`);
 *   - a tool call names the terminal it acted on (its `kolu` reading);
 *   - a question about a piece of work names that work (`work-ask`);
 *   - a message of yours names the works and the terminals you mentioned.
 *
 *  A terminal is turned into its work through the works' timelines: every
 *  `joined` event says which work a terminal joined and when. So a finished
 *  work is still found, and a terminal that moved from one work to another
 *  is read as the work it had joined by the end of that turn — or, named
 *  before it joined anything, the first work it joined. A turn that names no
 *  work has none: nothing is carried over from the turn before. */

import type { ConductorRow } from "kolu-common/conductor";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import type { Work, WorkId } from "kolu-work";

/** One work a terminal joined, and when. */
interface Joining {
  readonly work: WorkId;
  readonly at: number;
}

/** EVERY TERMINAL THAT EVER JOINED A WORK, with its joins oldest first — the
 *  index a turn's terminals are turned into works through. Built once per
 *  change of the works, never per streamed chunk of the chat. */
export type Joins = ReadonlyMap<string, ReadonlyArray<Joining>>;

export function joinsOf(works: ReadonlyMap<WorkId, Work>): Joins {
  const joins = new Map<string, Joining[]>();
  for (const [work, one] of works)
    for (const event of one.events) {
      if (event.kind !== "joined" || event.about.kind !== "member") continue;
      const list = joins.get(event.about.terminal) ?? [];
      list.push({ work, at: Date.parse(event.at) });
      joins.set(event.about.terminal, list);
    }
  for (const list of joins.values()) list.sort((a, b) => a.at - b.at);
  return joins;
}

/** ONE TURN: the row that starts it — where its works are drawn — and the
 *  works it names, in the order it first named them. */
export interface Turn {
  readonly head: string;
  readonly works: ReadonlyArray<WorkId>;
}

/** ONE TURN'S ROWS AND ITS WINDOW — the one turn boundary every reading of
 *  the chat shares (the works a turn is about, the fold, the status line and
 *  the order the chat is drawn in). A row is in a turn because it SAYS it
 *  answers that turn's message (`turn`, written once where the agent's output
 *  is read), not because of where it sits in the list — so a message sent
 *  while a reply is still being written cannot take the rest of that reply,
 *  and a line showing one turn's chips over another turn's sentence cannot
 *  happen for a row that says which message it answers. */
export interface ChatTurn {
  /** The message row that starts it — or, for rows before the first message
   *  and rows whose message is no longer in the list, the first of them. */
  readonly head: ConductorRow;
  /** Every row of the turn, by `seq`, the head first. */
  readonly rows: readonly ConductorRow[];
  /** Its window, epoch milliseconds: from the head's stamp up to the moment
   *  the next turn STARTED, or with no end when no later turn has. */
  readonly from: number;
  readonly until: number;
}

/** A row that can open a turn: what a person typed, or kolu's wake-up. */
const isMessage = (
  row: ConductorRow,
): row is Extract<ConductorRow, { kind: "user" | "wake" }> =>
  row.kind === "user" || row.kind === "wake";

/** The group of the rows before the first message of all. */
const BEFORE = Symbol("before the first message");

/** When a turn STARTED, or `null` for one still waiting behind another (its
 *  message is `queued`). A started turn began at its first reply row — a
 *  message sent while another turn runs is typed long before the agent takes
 *  it up — or at its message's stamp when it has no reply yet. */
const startOf = (group: {
  readonly head: ConductorRow;
  readonly rows: readonly ConductorRow[];
}): number | null => {
  const { head } = group;
  if (isMessage(head) && head.queued === true) return null;
  return Date.parse(((isMessage(head) ? group.rows[1] : head) ?? head).since);
};

/**
 * THE TURNS OF THE CHAT, in the order of the rows that start them.
 *
 * A message (`user` or `wake`) that answers no turn starts one. Every row that
 * says which message it answers (`turn`) is in that message's turn — a reply
 * written after the next message was sent, and a message steered into the
 * running turn alike. A row that says nothing (written while no turn ran, or
 * saved before rows said so) is in the turn of the nearest message above it
 * by `seq`, which is how every row was placed before. A row whose message is
 * not in the list (the saved chat keeps its newest rows) is a turn of its own
 * where it stands; the message next to it does not adopt it. Rows before the
 * first message are a turn of their own.
 *
 * It reads `seq` and never the order it is handed, so the turns are the same
 * whichever list a reader holds — the one the server sent, or the one drawn.
 */
export function chatTurns(rows: readonly ConductorRow[]): ChatTurn[] {
  const ordered = [...rows].sort((one, other) => one.seq - other.seq);
  const groups = new Map<
    string | typeof BEFORE,
    { head: ConductorRow; rows: ConductorRow[] }
  >();
  /** The turn of the nearest message above, for a row that says nothing. */
  let above: string | typeof BEFORE = BEFORE;
  for (const row of ordered) {
    const key: string | typeof BEFORE =
      row.turn !== undefined ? row.turn : isMessage(row) ? row.id : above;
    if (isMessage(row)) above = key;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { head: row, rows: [row] });
    else group.rows.push(row);
  }
  const list = [...groups.values()];
  const until: number[] = [];
  let next = Infinity;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    until[index] = next;
    const group = list[index];
    const started = group === undefined ? null : startOf(group);
    if (started !== null) next = started;
  }
  return list.map((group, index) => ({
    ...group,
    from: Date.parse(group.head.since),
    until: until[index] ?? Infinity,
  }));
}

/** The terminals and works one row names, in the order it names them. */
function namedBy(
  row: ConductorRow,
): ReadonlyArray<
  | { readonly kind: "terminal"; readonly ref: string }
  | { readonly kind: "work"; readonly work: WorkId }
> {
  switch (row.kind) {
    case "wake":
      return row.events.map((event) => ({
        kind: "terminal",
        ref: event.ref,
      }));
    // A MESSAGE NAMES WHAT IT MENTIONED, either way round: a work mention
    // names that work outright, a terminal mention through the work it had
    // joined.
    case "user":
      return (row.mentions ?? []).map((mention) =>
        mention.kind === "work"
          ? { kind: "work", work: mention.work as WorkId }
          : {
              kind: "terminal",
              ref: fleetTerminalRef(mention.host, mention.terminalId),
            },
      );
    case "tool": {
      const call = row.kolu;
      return call === undefined ||
        call.host === null ||
        call.terminalId === null
        ? []
        : [
            {
              kind: "terminal",
              ref: fleetTerminalRef(call.host, call.terminalId),
            },
          ];
    }
    case "work-ask":
      return [{ kind: "work", work: row.work }];
    default:
      return [];
  }
}

/** THE TURN OF EVERY ROW, by row id: each row of a turn maps to the same
 *  {@link Turn}. A turn that names no work has an empty list. */
export function turnWorks(
  rows: readonly ConductorRow[],
  works: ReadonlyMap<WorkId, Work>,
  joins: Joins,
): ReadonlyMap<string, Turn> {
  const out = new Map<string, Turn>();
  for (const turn of chatTurns(rows)) {
    const found: WorkId[] = [];
    const add = (work: WorkId): void => {
      if (works.has(work) && !found.includes(work)) found.push(work);
    };
    for (const row of turn.rows)
      for (const named of namedBy(row)) {
        if (named.kind === "work") {
          add(named.work);
          continue;
        }
        const list = joins.get(named.ref) ?? [];
        const joined =
          list.filter((one) => one.at <= turn.until).at(-1) ?? list[0];
        if (joined !== undefined) add(joined.work);
      }
    const reading: Turn = { head: turn.head.id, works: found };
    for (const row of turn.rows) out.set(row.id, reading);
  }
  return out;
}
