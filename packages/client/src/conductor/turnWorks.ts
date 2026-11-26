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

/** One work a terminal joined, and when — with the terminal that joined it,
 *  so a work's own joins can be read before they are filed by terminal. */
export interface Joining {
  readonly terminal: string;
  readonly work: WorkId;
  readonly at: number;
}

/** EVERY TERMINAL THAT EVER JOINED A WORK, with its joins oldest first — the
 *  index a turn's terminals are turned into works through. Built once per
 *  change of the works, never per streamed chunk of the chat. */
export type Joins = ReadonlyMap<string, ReadonlyArray<Joining>>;

/** ONE WORK'S OWN JOINS, oldest first — read off that work's timeline alone,
 *  so a mirror of many works is read work by work and a timeline that moves
 *  re-reads only the work it moved in. */
export function joinsOfWork(
  work: WorkId,
  record: Work,
): ReadonlyArray<Joining> {
  const joins: Joining[] = [];
  for (const event of record.events) {
    if (event.kind !== "joined" || event.about.kind !== "member") continue;
    joins.push({
      terminal: event.about.terminal,
      work,
      at: Date.parse(event.at),
    });
  }
  return joins;
}

/** THE INDEX, from readings already taken: every work's joins by the terminal
 *  that made them, each terminal's oldest first. */
export function mergeJoins(works: Iterable<ReadonlyArray<Joining>>): Joins {
  const joins = new Map<string, Joining[]>();
  for (const one of works)
    for (const joining of one) {
      const list = joins.get(joining.terminal) ?? [];
      list.push(joining);
      joins.set(joining.terminal, list);
    }
  for (const list of joins.values()) list.sort((a, b) => a.at - b.at);
  return joins;
}

export function joinsOf(works: ReadonlyMap<WorkId, Work>): Joins {
  return mergeJoins(
    [...works].map(([work, record]) => joinsOfWork(work, record)),
  );
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
  /** The head when it is a message (what a person typed, or kolu's wake-up);
   *  `null` for a group of rows no message heads. */
  readonly message: Message | null;
  /** Every row of the turn, by `seq`, the head first. */
  readonly rows: readonly ConductorRow[];
  /** WHEN IT STARTED, epoch milliseconds, or `null` for a turn that never
   *  ran — its message still waits behind another (`queued`), or the agent
   *  refused it or left it unanswered (`delivery`). A started turn began at
   *  its first reply row: a message sent while another turn runs is typed
   *  long before the agent takes it up. A turn with no reply yet began at its
   *  head's stamp. A turn that never waited is taken the same way: once
   *  `queued` comes off, a row cannot say it ever waited. */
  readonly started: number | null;
  /** Its window, epoch milliseconds: from the head's stamp up to the moment
   *  the next turn STARTED, or with no end when no later turn has. */
  readonly from: number;
  readonly until: number;
}

/** A row that can open a turn: what a person typed, or kolu's wake-up. */
type Message = Extract<ConductorRow, { kind: "user" | "wake" }>;
const isMessage = (row: ConductorRow): row is Message =>
  row.kind === "user" || row.kind === "wake";

/** The group of the rows before the first message of all. */
const BEFORE = Symbol("before the first message");

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
  const list = [...groups.values()].map((group) => {
    const message = isMessage(group.head) ? group.head : null;
    const ran =
      message === null ||
      (message.queued !== true && message.delivery === undefined);
    const first = message === null ? group.head : (group.rows[1] ?? message);
    return {
      ...group,
      message,
      started: ran ? Date.parse(first.since) : null,
      from: Date.parse(group.head.since),
    };
  });
  // A turn runs until the next turn that STARTED did — read from the newest.
  const out: ChatTurn[] = [];
  let next = Infinity;
  for (const turn of list.toReversed()) {
    out.push({ ...turn, until: next });
    if (turn.started !== null) next = turn.started;
  }
  return out.reverse();
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
