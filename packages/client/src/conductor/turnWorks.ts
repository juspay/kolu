/** WHICH PIECES OF WORK EACH CHAT TURN IS ABOUT — read off rows already in
 *  the transcript and the works' own records, never stored in a row.
 *
 *  A TURN is one prompt row (what you typed, or kolu's wake-up) and every row
 *  up to the next prompt. Rows before the first prompt are a turn of their
 *  own. A turn's works are the ones its rows NAME:
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
 *  the chat shares (the works a turn is about, and the fold), so a line
 *  showing one turn's chips over another turn's sentence cannot happen. */
export interface ChatTurn {
  /** The prompt row that starts it (or the first row of all). */
  readonly head: ConductorRow;
  /** Every row of the turn, the head first. */
  readonly rows: readonly ConductorRow[];
  /** Its window, epoch milliseconds: from the head's stamp up to the next
   *  turn's, or with no end for the newest. */
  readonly from: number;
  readonly until: number;
}

/** THE TURNS OF THE CHAT, in order: a prompt row (`user` or `wake`) and every
 *  row up to the next one. Rows before the first prompt are a turn of their
 *  own. */
export function chatTurns(rows: readonly ConductorRow[]): ChatTurn[] {
  const groups: { head: ConductorRow; rows: ConductorRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last === undefined || row.kind === "user" || row.kind === "wake")
      groups.push({ head: row, rows: [row] });
    else last.rows.push(row);
  }
  return groups.map((group, index) => {
    const next = groups[index + 1]?.head;
    return {
      ...group,
      from: Date.parse(group.head.since),
      until: next === undefined ? Infinity : Date.parse(next.since),
    };
  });
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
