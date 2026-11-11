/**
 * The conversation, as rows.
 *
 * {@link ./harness.ts} says what the agent DID; this says what the panel shows.
 * Keeping the two apart is what lets the transcript have rules of its own —
 * chunks accumulate into one row, a tool call is updated in place by its id, a
 * new session replaces everything rather than appending to it — without any of
 * them leaking into the protocol layer.
 *
 * THREE of those rules are about an agent repeating itself, and they are here
 * rather than in the protocol layer because they are about what a READER can
 * follow rather than about what the wire may carry. A message's chunks
 * accumulate whoever said them. A call's NAME is picked at the first frame that
 * carries a title and no later one moves it, because a title is a display
 * string an agent may rewrite mid-call. And a frame that says nothing the row
 * does not already say changes nothing at all — no upsert, and no mark taken
 * back off.
 *
 * It is a keyed, ordered set rather than a list, because that is what the wire
 * member is ({@link @kolu/padi-client/orchestrator}'s `OrchestratorFrame`): a
 * collection served snapshot-then-deltas, so a row that changes is one upsert
 * on its own key and a late-joining tab gets the whole thing in one frame. The
 * `seq` on each row keeps the ORDER independent of the delivery.
 *
 * ONE thing is open at a time, and {@link Transcript.say}'s `#open` is the whole
 * of that fact: a row's `streaming` flag is DERIVED from it on every write
 * rather than set beside it. The two kept in step by hand is the bug this shape
 * makes unrepresentable — an agent that spoke, then called a tool, left a
 * paragraph marked as still growing until the end of the turn.
 *
 * WHAT A TURN LEAVES BEHIND is recorded the same way, for a sharper version of
 * the same reason: a call the wire still calls running when its turn ends will
 * never be reported on, and `stranded` is derived off a set this class keeps
 * rather than written onto the row — a claim that gets LOUDER the longer it is
 * wrong, because the face it feeds is a clock.
 *
 * Everything here is synchronous and in memory. The agent's own session is the
 * persistence; a second copy would be a second thing to be wrong.
 */

import type { AskField, AskLink, AskOutcome, FileDiff } from "@kolu/acp/wire";
import type {
  OrchestratorArmed,
  OrchestratorKoluCall,
  OrchestratorPlanStep,
  OrchestratorRow,
  OrchestratorSaying,
  OrchestratorSpawned,
  OrchestratorToolStatus,
  OrchestratorWatching,
} from "./rows.ts";

export interface Change {
  readonly upserts: ReadonlyArray<OrchestratorRow>;
  readonly removes: ReadonlyArray<string>;
  /**
   * TEXT ADDED TO A ROW THAT IS ALREADY THERE — what a chunk of a streaming
   * answer is, said as the thing it is rather than as the row it grew.
   *
   * The upserts above carry rows WHOLE, which is what a late joiner has to be
   * handed. A streaming answer is not a sequence of rows: it is one row and six
   * hundred pieces, and publishing the whole of it once per piece puts the sum
   * of its prefixes on the wire — quadratic in the length of the answer.
   */
  readonly appends: ReadonlyArray<OrchestratorSaying>;
}

const EMPTY: Change = { upserts: [], removes: [], appends: [] };

/** Whether a change says anything at all. HERE, beside the type, because the
 *  day it grew a third field is the day a caller asking about two of them
 *  stopped being right — which is how a guard that asked only about rows once
 *  dropped every chunk of every streaming answer. */
export const says = (change: Change): boolean =>
  change.upserts.length > 0 ||
  change.removes.length > 0 ||
  change.appends.length > 0;

/** Two changes as one. Closing the open row and writing the next one are two
 *  upserts a subscriber should see in the same frame. */
const both = (first: Change, second: Change): Change => ({
  upserts: [...first.upserts, ...second.upserts],
  removes: [...first.removes, ...second.removes],
  appends: [...first.appends, ...second.appends],
});

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** The fields {@link Transcript} DERIVES, named once — the list is spelled in
 *  two casts and a public type below, and three spellings of one list is one of
 *  them being missed the day a sixth is derived. */
type Derived = "id" | "seq" | "since" | "streaming" | "stranded";

/**
 * A row's CONTENT: everything about it that a caller decides.
 *
 * Naming the derived fields once, here, is what makes them unsettable: every
 * door into this class takes this rather than a `Partial<OrchestratorRow>`, so
 * a caller cannot hand in a `seq` or a `since` for the writer to have to
 * ignore, and a sixth derived field inherits the rule instead of needing each
 * door to be told about it.
 */
export type RowContent = DistributiveOmit<OrchestratorRow, Derived>;

type RowPatch<K extends OrchestratorRow["kind"]> = Partial<
  Extract<RowContent, { kind: K }>
>;

const contentOf = <R extends OrchestratorRow>(
  row: R,
): DistributiveOmit<R, Derived> => {
  switch (row.kind) {
    case "agent": {
      const {
        id: _id,
        seq: _seq,
        since: _since,
        streaming: _streaming,
        ...content
      } = row;
      return content as DistributiveOmit<R, Derived>;
    }
    case "tool": {
      const {
        id: _id,
        seq: _seq,
        since: _since,
        stranded: _stranded,
        ...content
      } = row;
      return content as DistributiveOmit<R, Derived>;
    }
    default: {
      const { id: _id, seq: _seq, since: _since, ...content } = row;
      return content as DistributiveOmit<R, Derived>;
    }
  }
};

/** The writer's derived fields, applied onto already-kind-correct content — a
 *  function rather than a spread in `#put`, so `streaming` cannot land on a
 *  tool row and `stranded` cannot land on a user row. */
const minted = (
  content: RowContent,
  derived: {
    readonly id: string;
    readonly seq: number;
    readonly since: string;
  },
  marks: { readonly streaming: boolean; readonly stranded: boolean },
): OrchestratorRow => {
  switch (content.kind) {
    case "agent":
      return marks.streaming
        ? { ...content, ...derived, streaming: true as const }
        : { ...content, ...derived };
    case "tool":
      return {
        ...content,
        ...derived,
        ...(marks.stranded ? { stranded: true as const } : {}),
      };
    default:
      return { ...content, ...derived };
  }
};

/** The two statuses that mean a call has not reported back. */
const isRunning = (status: OrchestratorToolStatus): boolean =>
  status === "pending" || status === "in_progress";

/** A background task that is STILL OUT — the one kind of call a turn's ending
 *  says nothing about, because outliving its turn is the whole point of it.
 *  Asked of the row rather than of a flag, so the strip above the scroll and
 *  the stranding rule cannot answer it differently. */
const isTaskOut = (row: Extract<OrchestratorRow, { kind: "tool" }>): boolean =>
  row.armed !== undefined && row.armed.ended === null;

/**
 * WHAT A DEATH SAYS when the agent sent no sentence with it.
 *
 * The harness's own summary is what a reader is owed — it names the task and
 * carries a background shell's exit code — and this is the honest thing to say
 * when the ending arrived without one. Never a word of ours where there is one
 * to use: `stopped` and `failed` are the harness's own, and a monitor somebody
 * stopped did not fail.
 */
const endedSaid = (what: string, name: string, ended: string): string =>
  `the ${what} “${name}” ended (${ended})`;

/** ... and KOLU'S OWN WORD for the one ending nothing reports: the turn that
 *  sent an agent out finished without it, so nobody is ever going to say what
 *  became of it. The agent has no word for this because the agent does not know
 *  it happened. */
export const STRANDED = "never reported back";

const toolKey = (id: string): string => `tool:${id}`;

/** What a spawned call was SENT TO DO, for the sentence about its death. The
 *  adapter titles a subagent call with the TOOL's name, so a fan-out that fell
 *  over reported four identical lines reading *the agent "Task" ended* — a
 *  bottom row that tells a reader something went wrong and refuses to say
 *  which of the four it was. */
const sentToDo = (spawned: OrchestratorSpawned, title: string): string =>
  spawned.said ?? spawned.kind ?? title;

/** Everything a frame can say about one tool call. Each field `undefined` means
 *  UNCHANGED — the protocol reports a call twice and the second report carries
 *  only what moved. */
export interface ToolMove {
  readonly title?: string | undefined;
  readonly status?: OrchestratorToolStatus | undefined;
  readonly server?: string | undefined;
  readonly tool?: string | undefined;
  readonly detail?: string | undefined;
  readonly progress?: string | undefined;
  readonly diffs?: ReadonlyArray<FileDiff> | undefined;
  readonly locations?: ReadonlyArray<string> | undefined;
  readonly kolu?: OrchestratorKoluCall | undefined;
  readonly parent?: string | undefined;
  readonly spawned?: OrchestratorSpawned | undefined;
  readonly armed?: Partial<OrchestratorArmed> | undefined;
  /** Whether `title` on THIS frame is the adapter's placeholder rather than the
   *  call's name. Scoped to the frame: absent is "not provisional", never
   *  "unchanged". */
  readonly provisional?: boolean | undefined;
}

export class Transcript {
  #rows = new Map<string, OrchestratorRow>();
  #seq = 0;
  #minted = 0;
  /** The agent row currently being streamed into — the ONE place "still
   *  growing" is recorded. Chunks accumulate into it rather than each becoming
   *  a row: what a reader wants is one paragraph growing, not forty. */
  #open: string | null = null;
  /** The calls a TURN left behind, by key — set beside the rows rather than
   *  written onto them, because half a dozen paths re-publish a row by
   *  spreading it as it stands and a hand-set field would ride straight past
   *  the decision that is supposed to make it. */
  #stranded = new Set<string>();
  /** The calls whose NAME has been picked, so a later frame's title cannot move
   *  it. What is kept here is only WHETHER the question has been answered; the
   *  answer itself stays in `text` where a reader of the row can see it. */
  #named = new Set<string>();
  /** Which rows have already had a death announced, so the sentence that
   *  arrives a beat after an ending refines rather than minting a second
   *  notice. BY THE ROW rather than by the task's own id: a call that armed a
   *  task and a call that sent an agent out are two ways of ending, and keyed
   *  by task id the two guards would be in two key spaces. */
  #ended = new Set<string>();
  /** What it would take to send a REFUSED row again, by that row's key. Here
   *  beside the rows rather than in the caller, because it is half of one fact
   *  and the other half is a field on the row: a row offering a retry with no
   *  prompt behind it draws a button that refuses. ONLY refused rows are in
   *  here — a row whose delivery went `unanswered` is one the agent may already
   *  have, so there is no honest retry to offer. */
  #undelivered = new Map<string, string>();
  readonly #now: () => number;

  /**
   * The clock and the WATERMARK, both handed in, for the reason every other
   * rule in this file is a value: the transcript is a data structure with no
   * agent, no socket and no browser under it.
   *
   * `from` is the highest `seq` of the rows somebody ELSE is already holding
   * for this conversation — a resumed one, restored from a store. Every id and
   * every `seq` this instance mints starts after it, so a row minted now can
   * neither collide with a restored row's id nor sort above it. Zero is an
   * empty transcript, which is what a fresh conversation has.
   */
  constructor(from = 0, now: () => number = Date.now) {
    this.#seq = from;
    this.#minted = from;
    this.#now = now;
  }

  rows(): ReadonlyArray<OrchestratorRow> {
    return [...this.#rows.values()];
  }

  /** Everything still out when the turn that started it has ended — the strip
   *  above the scroll, because the row itself may be an hour of scrollback
   *  away. Derived off the rows rather than kept beside them, so it cannot
   *  disagree with what is drawn. */
  watching(): ReadonlyArray<OrchestratorWatching> {
    const out: Array<OrchestratorWatching> = [];
    for (const row of this.#rows.values()) {
      if (row.kind !== "tool") continue;
      if (row.armed !== undefined && row.armed.ended === null) {
        out.push({
          row: row.id,
          kind: "task",
          name: row.armed.description ?? row.armed.task,
          since: row.startedAt ?? row.since,
        });
        continue;
      }
      if (
        row.spawned !== undefined &&
        isRunning(row.status) &&
        !this.#stranded.has(row.id)
      ) {
        out.push({
          row: row.id,
          kind: "agent",
          name: sentToDo(row.spawned, row.text),
          since: row.startedAt ?? row.since,
        });
      }
    }
    return out;
  }

  /** A row that stands on its own. */
  add<K extends OrchestratorRow["kind"]>(
    kind: K,
    text: string,
    extra: RowPatch<K> = {},
  ): Change {
    return this.#row(kind, text, extra).change;
  }

  /**
   * What went out down the person's lane — a row like any other, ANSWERING
   * WITH ITS KEY.
   *
   * The one caller that has to keep a key: a user message can turn out to be
   * undeliverable after it has been drawn, and a retry that lands has to find
   * the same row again.
   */
  user(
    text: string,
    extra: RowPatch<"user"> = {},
  ): { readonly key: string; readonly change: Change } {
    return this.#row("user", text, extra);
  }

  /** That message is WAITING ITS TURN at the agent — it went out while a turn
   *  was still running and nothing has started on it. Not a {@link
   *  OrchestratorDeliverySchema} value, because a queued message has not FAILED
   *  at anything and a person reading it in the column of things that went
   *  wrong would be told the opposite of the truth. */
  queued(key: string): Change {
    return this.#waiting(key, true);
  }

  /** ... and the agent has taken it up. Called on every turn that ends rather
   *  than only where a mark was made — a row that never said it was waiting is
   *  a no-op here, which is what makes the caller's rule "clear whoever is at
   *  the head now" rather than "remember which rows you marked". */
  taken(key: string): Change {
    return this.#waiting(key, false);
  }

  #waiting(key: string, waiting: boolean): Change {
    const current = this.#rows.get(key);
    if (current === undefined || current.kind !== "user") return EMPTY;
    // ALREADY SO IS NOT NEWS: {@link taken} lands mostly on rows that were
    // never waiting, and a frame per turn saying nothing is a conversation
    // republishing itself.
    if (waiting === (current.queued === true)) return EMPTY;
    const { queued: _queued, ...content } = contentOf(current);
    return this.#put(key, waiting ? { ...content, queued: true } : content);
  }

  /** That message CERTAINLY never reached the agent, and here is what it would
   *  take to send it again. The row does not move and nothing is minted: what a
   *  person typed stays exactly where they typed it, with a mark saying it is
   *  still theirs to send. */
  refused(key: string, prompt: string, auth = false): Change {
    if (!this.#rows.has(key)) return EMPTY;
    this.#undelivered.set(key, prompt);
    return this.#mark(key, "refused", auth);
  }

  /** NOTHING CAME BACK about that message, and that is all anybody can say. It
   *  takes no prompt, deliberately: an agent that went quiet may have the
   *  message already, so a retry would be a duplicate offered to somebody with
   *  no way to tell, and the way to make that unofferable is to keep nothing to
   *  offer. */
  unanswered(key: string): Change {
    if (!this.#rows.has(key)) return EMPTY;
    this.#undelivered.delete(key);
    return this.#mark(key, "unanswered");
  }

  /** ... and it went after all. A row must not go on advertising a failure that
   *  has stopped being true, and a prompt kept past its row's mark is a retry
   *  nothing can ask for. */
  sent(key: string): Change {
    this.#undelivered.delete(key);
    return this.#mark(key, null);
  }

  /** What it would take to send that row again, or `null` when there is no
   *  honest retry to offer. */
  undelivered(key: string): string | null {
    return this.#undelivered.get(key) ?? null;
  }

  #mark(
    key: string,
    delivery: "refused" | "unanswered" | null,
    auth = false,
  ): Change {
    const current = this.#rows.get(key);
    if (current === undefined || current.kind !== "user") return EMPTY;
    // `delivery` comes off along with the derived fields, for `contentOf`'s
    // reason: this line is what DECIDES it, and a spread of the old row would
    // carry the previous answer past the decision. The reason goes with it,
    // because a row that stopped being refused for want of a signature must
    // stop saying it was.
    const { delivery: _delivery, auth: _auth, ...content } = contentOf(current);
    if (delivery === null) return this.#put(key, content);
    return this.#put(key, {
      ...content,
      delivery,
      ...(auth ? { auth: true as const } : {}),
    });
  }

  /** One chunk of the agent's prose. Appends to the row already open, or opens
   *  one. */
  say(text: string): Change {
    return this.#grow("agent", text);
  }

  /** One chunk of prose into the row already open, or into a new one. The
   *  agent's, and only ever the agent's: what a PERSON said is a row kolu
   *  minted when they pressed send, and the chunk the wire echoes back for it
   *  would be that message drawn twice. */
  #grow(kind: "agent", text: string): Change {
    const open = this.#open;
    const current = open === null ? undefined : this.#rows.get(open);
    if (open !== null && current?.kind === kind) {
      // THE PIECE GOES OUT; THE WHOLE IS KEPT. The row here grows by the chunk
      // and what is REPORTED is the chunk and where it belongs.
      const at = current.text.length;
      this.#write(open, {
        ...contentOf(current),
        text: `${current.text}${text}`,
      });
      return { ...EMPTY, appends: [{ of: open, at, text }] };
    }
    // A row that is not there yet is WRITTEN, whole and with its first chunk in
    // it: there is nothing on the far end to append to.
    const closed = this.#close();
    this.#open = this.#next(kind);
    return both(closed, this.#put(this.#open, { kind, text } as RowContent));
  }

  /**
   * A turn is STARTING.
   *
   * It writes no row — what a person typed is already one — and does exactly
   * one thing: nothing a previous turn left running may still look like work in
   * progress under this one. {@link settle} has normally said that already, so
   * this is usually a no-op; it is here because the bug it forecloses is
   * specifically about the SECOND turn. A dead agent's rows are deliberately
   * not cleared, so sending again puts a live turn over a transcript full of
   * calls that will never report.
   */
  begins(): Change {
    return this.#strand(false);
  }

  /** The turn ended: whatever was streaming has stopped, and so has anything
   *  the agent announced and never reported back on — except a call that armed
   *  a background task, which is the one kind of call a turn ending says
   *  nothing about. */
  settle(): Change {
    return both(this.#close(), this.#strand(false));
  }

  /** The CONVERSATION is over — the agent died — and that is a different
   *  sentence from a turn ending. A dead agent reports nothing ever again, so
   *  the tasks it left out there are exactly as abandoned as the calls it never
   *  came back for, and a rail still pulsing under a process that no longer
   *  exists is the failure every live face is written against. */
  abandon(): Change {
    return both(this.#close(), this.#strand(true));
  }

  /** ... and the half of that which is true for a turn ending while ANOTHER is
   *  still running: its paragraph is finished, and nothing else is. Without it
   *  two turns in a row read as ONE ANSWER, the second turn's first words
   *  landing on the end of the first turn's last sentence. It may NOT strand:
   *  the calls still in flight belong to the turn that is still running. */
  stopSaying(): Change {
    return this.#close();
  }

  /**
   * Mark every call this turn is leaving behind.
   *
   * Its STATUS is left exactly as it came — `pending` is the agent's own word
   * and the row is the record of what it said — and what is added is kolu's own
   * observation about its own conversation, which is the only part of this
   * anybody here is entitled to.
   *
   * ... AND AN AGENT LEFT BEHIND IS A ROW AT THE BOTTOM, which a task left
   * behind is not: a subagent's own calls are filed under the agent that made
   * them, so a fan-out whose agents never report leaves a reader with nothing
   * on screen that changed. Only at a turn's end, never when the whole agent
   * has gone (`alsoArmed`) — a dead agent owes a reader ONE sentence about
   * itself, and six would bury it in its own consequences.
   */
  #strand(alsoArmed: boolean): Change {
    let change: Change = EMPTY;
    for (const [key, row] of this.#rows) {
      if (row.kind !== "tool" || this.#stranded.has(key)) continue;
      if (!isRunning(row.status)) continue;
      if (!alsoArmed && isTaskOut(row)) continue;
      this.#stranded.add(key);
      change = both(change, this.#put(key, contentOf(row)));
      if (!alsoArmed && row.spawned !== undefined) {
        change = both(
          change,
          this.#dies(key, "agent", sentToDo(row.spawned, row.text), STRANDED),
        );
      }
    }
    return change;
  }

  /**
   * A tool call, announced or moved. Keyed by the agent's own call id, so the
   * second report of a call is the same row with a new status rather than a
   * second row.
   *
   * THE TITLE IS THE ONE EXCEPTION to "the newest wins": a title is a display
   * string an agent may rewrite for its own reasons, so the row's NAME is
   * picked at the first frame that carries one — unless that frame says the
   * title is only a PLACEHOLDER, which one adapter sends while the model's
   * arguments are still streaming. Such a title is SHOWN, because a nameless
   * row is worse, but it does not ANSWER the question.
   *
   * A FRAME THAT SAYS NOTHING NEW CHANGES NOTHING. Agents repeat themselves,
   * and a repeat is not a second report: in particular the mark saying its turn
   * walked away from a call does not come off.
   */
  tool(id: string, move: ToolMove): Change {
    const key = toolKey(id);
    const current = this.#rows.get(key);
    const held = current?.kind === "tool" ? current : undefined;
    // A REPORT WITH NO ROW TO FILE IT UNDER: a background task's own report
    // names the call that armed it, and if that call was never announced here,
    // inventing a row for the report would be a call nobody made.
    if (
      held === undefined &&
      move.title === undefined &&
      move.status === undefined &&
      move.detail === undefined &&
      move.progress === undefined &&
      move.spawned === undefined &&
      move.armed?.report !== undefined &&
      move.armed.ended === undefined &&
      move.armed.description === undefined
    ) {
      return EMPTY;
    }
    const status = move.status ?? held?.status ?? "pending";
    const named = this.#named.has(key);
    const title =
      move.title !== undefined && !named
        ? move.title
        : (held?.text ?? move.title ?? "");
    if (move.title !== undefined && move.provisional !== true) {
      this.#named.add(key);
    }
    const armed = this.#armedOf(held?.armed, move.armed);
    const content: RowContent = {
      kind: "tool",
      text: title,
      status,
      ...pick("server", move.server, held?.server),
      ...pick("tool", move.tool, held?.tool),
      ...pick("detail", move.detail, held?.detail),
      ...pick("progress", move.progress, held?.progress),
      ...pick("diffs", move.diffs, held?.diffs),
      ...pick("locations", move.locations, held?.locations),
      ...pick("kolu", move.kolu, held?.kolu),
      ...pick("parent", move.parent, held?.parent),
      ...pick("spawned", move.spawned, held?.spawned),
      ...(armed === undefined ? {} : { armed }),
      ...(held?.startedAt === undefined
        ? isRunning(status)
          ? { startedAt: this.#stamp() }
          : {}
        : { startedAt: held.startedAt }),
    };
    // A REPEAT IS NOT A SECOND REPORT. Compared BEFORE the open paragraph is
    // closed, because the paragraph ended when the call was first reported and
    // a second report of it does not un-end it — so the close happens either
    // way and only the row is spared.
    const closed = this.#close();
    if (held !== undefined && same(contentOf(held), content)) return closed;
    // A call reported on again is a call its turn has NOT walked away from.
    this.#stranded.delete(key);
    const written = both(closed, this.#put(key, content));
    const ending = armed?.ended ?? null;
    if (ending === null) return written;
    return both(
      written,
      this.#dies(
        key,
        (move.spawned ?? held?.spawned) ? "agent" : "background task",
        armed?.description ?? armed?.task ?? title,
        ending,
        armed?.report ?? null,
      ),
    );
  }

  /** The agent's plan, which each update REPLACES whole — so it is upserted at
   *  one key for the life of the session, and an empty update removes it. */
  plan(steps: ReadonlyArray<OrchestratorPlanStep>): Change {
    const closed = this.#close();
    if (steps.length === 0) {
      if (!this.#rows.has(PLAN_KEY)) return closed;
      this.#rows.delete(PLAN_KEY);
      return both(closed, { ...EMPTY, removes: [PLAN_KEY] });
    }
    const current = this.#rows.get(PLAN_KEY);
    const content: RowContent = { kind: "plan", steps };
    if (current !== undefined && same(contentOf(current), content)) {
      return closed;
    }
    return both(closed, this.#put(PLAN_KEY, content));
  }

  /** A question the agent is waiting on, under the id the registry minted for
   *  it — so the row's key and the handle an answer arrives under are one
   *  string, and `openAsks` is a list of row ids rather than a second
   *  vocabulary that can disagree. */
  ask(
    id: string,
    message: string,
    fields: ReadonlyArray<AskField>,
    link: AskLink | null,
    parent: string | null,
  ): Change {
    const closed = this.#close();
    return both(
      closed,
      this.#put(id, {
        kind: "ask",
        text: message,
        ask: { fields, link, outcome: null },
        ...(parent === null ? {} : { parent }),
      }),
    );
  }

  /** ... and how it ended. A row that is not there any more — the session was
   *  replaced under it — changes nothing rather than minting one. */
  settleAsk(id: string, outcome: AskOutcome): Change {
    const current = this.#rows.get(id);
    if (current === undefined || current.kind !== "ask") return EMPTY;
    if (current.ask.outcome !== null) return EMPTY;
    const content = contentOf(current);
    return this.#put(id, { ...content, ask: { ...content.ask, outcome } });
  }

  /** A death, as a NOTICE at the bottom of the transcript — once per row,
   *  whichever of the two endings got there first. */
  #dies(
    key: string,
    what: string,
    name: string,
    ended: string,
    report: string | null = null,
  ): Change {
    if (this.#ended.has(key)) return EMPTY;
    this.#ended.add(key);
    const said = endedSaid(what, name, ended);
    return this.add(
      "notice",
      report === null || report === "" ? said : `${said}: ${report}`,
    );
  }

  /** What is known about a call's background task, ACCUMULATED across the
   *  frames that each know one piece: the frame that ARMS it names the
   *  description, the frame that SETTLES it names how it ended, and the report
   *  arrives later still. A leg answers about the frame in front of it and
   *  never accumulates, so holding the task together is this class's job. */
  #armedOf(
    held: OrchestratorArmed | undefined,
    move: Partial<OrchestratorArmed> | undefined,
  ): OrchestratorArmed | undefined {
    if (move === undefined) return held;
    const task = move.task ?? held?.task;
    if (task === undefined) return held;
    return {
      task,
      description: move.description ?? held?.description ?? null,
      ended: move.ended ?? held?.ended ?? null,
      report: move.report ?? held?.report ?? null,
    };
  }

  #stamp(): string {
    return new Date(this.#now()).toISOString();
  }

  #next(kind: string): string {
    return `${kind}:${++this.#minted}`;
  }

  #row<K extends OrchestratorRow["kind"]>(
    kind: K,
    text: string,
    extra: RowPatch<K>,
  ): { readonly key: string; readonly change: Change } {
    const closed = this.#close();
    const key = this.#next(kind);
    const content = { kind, text, ...extra } as RowContent;
    return { key, change: both(closed, this.#put(key, content)) };
  }

  /** Whatever was streaming has stopped. The row is re-published because
   *  `streaming` is derived on every write, so the flag comes off by the row
   *  being written again rather than by anybody clearing a field. */
  #close(): Change {
    const open = this.#open;
    if (open === null) return EMPTY;
    this.#open = null;
    const current = this.#rows.get(open);
    if (current === undefined) return EMPTY;
    return this.#put(open, contentOf(current));
  }

  /** Write a row and report it. */
  #put(key: string, content: RowContent): Change {
    return { ...EMPTY, upserts: [this.#write(key, content)] };
  }

  /** ... and write it WITHOUT reporting it, for the one caller that reports a
   *  piece instead of the whole ({@link #grow}). */
  #write(key: string, content: RowContent): OrchestratorRow {
    const current = this.#rows.get(key);
    const row = minted(
      content,
      {
        id: key,
        seq: current?.seq ?? ++this.#seq,
        since: current?.since ?? this.#stamp(),
      },
      { streaming: this.#open === key, stranded: this.#stranded.has(key) },
    );
    this.#rows.set(key, row);
    return row;
  }
}

const PLAN_KEY = "plan";

/** One optional field of a tool row: what this frame said, else what the row
 *  already said, else nothing — the "absent means unchanged" rule, spelled once
 *  because eight fields obey it and eight spellings is one of them drifting. */
const pick = <K extends string, V>(
  key: K,
  move: V | undefined,
  held: V | undefined,
): { [P in K]?: V } => {
  const value = move ?? held;
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
};

/** Whether a frame said anything the row does not already say. Structural, over
 *  the content alone — the derived fields are the writer's and comparing them
 *  would make every frame news. */
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
