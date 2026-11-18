/**
 * The conversation, as rows — ONE class for both products that draw one.
 *
 * A product says what its rows look like (kolu's conductor and olai's chat
 * plugin each spread `@kolu/acp/wire`'s row fields into their own schema and add
 * what is theirs) and hands the union to this class. What the class owns is the
 * part that is nobody's product: a keyed, ordered set; one open paragraph at a
 * time; the marks that say a message is waiting, refused or unanswered; and what
 * a turn leaves behind when it ends. Everything product-shaped rides in an
 * `extra` object the caller passes, which this class copies onto the row and
 * never reads.
 *
 * THREE of the rules here are about an agent repeating itself, and they are here
 * rather than in the protocol layer because they are about what a READER can
 * follow rather than about what the wire may carry. A message's chunks
 * accumulate whoever said them. A call's NAME is picked at the first frame that
 * carries a title and no later one moves it, because a title is a display string
 * an agent may rewrite mid-call. And a frame that says nothing the row does not
 * already say changes nothing at all — no upsert, and no mark taken back off.
 *
 * It is a keyed, ordered set rather than a list, because that is what the wire
 * member is: a collection served snapshot-then-deltas, so a row that changes is
 * one upsert on its own key and a late-joining tab gets the whole thing in one
 * frame. The `seq` on each row keeps the ORDER independent of the delivery.
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
 *
 * ## The two products' differences, as NAMED OPTIONS
 *
 * Both products' suites run against this one class, so where they genuinely
 * differ the difference is a value the caller passes rather than a branch on
 * whose row it is ({@link TranscriptOptions}):
 *
 *   - the first `seq` — a resumed conversation's rows are somebody else's, and
 *     nothing minted here may sort above them (`from`);
 *   - the caller's last restored row is already a break (`endsWithDivider`);
 *   - the wipe keeps the counters running (kolu writes `seq` into a store;
 *     olai clears a panel) — `countersSurviveClear`;
 *   - which kinds a turn can be the delivery of (kolu's own wake rows are one;
 *     olai has only `user` rows) — `deliverable`.
 */

import type {
  Armed,
  AskField,
  AskLink,
  AskOutcome,
  FileDiff,
  Saying,
  Spawned,
  ToolStatus,
  Watching,
} from "@kolu/acp/wire";

/** The three fields every row of this class carries, whatever a product adds. */
export interface RowHead {
  readonly id: string;
  readonly seq: number;
  readonly since: string;
}

/** The narrowest row this class can hold: a head and a discriminant. A
 *  product's row union is one of these with its own fields beside them. */
export interface AnyRow extends RowHead {
  readonly kind: string;
}

export interface Change<Row> {
  readonly upserts: ReadonlyArray<Row>;
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
  readonly appends: ReadonlyArray<Saying>;
}

/** Whether a change says anything at all. HERE, beside the type, because the
 *  day it grew a third field is the day a caller asking about two of them
 *  stopped being right — which is how a guard that asked only about rows once
 *  dropped every chunk of every streaming answer. */
export const says = <Row>(change: Change<Row>): boolean =>
  change.upserts.length > 0 ||
  change.removes.length > 0 ||
  change.appends.length > 0;

/** Whether a change speaks for any ROW — as against carrying only text added to
 *  one. The other half of {@link says}, and here for its reason: two of a
 *  `Change`'s three fields are the ones that name rows, and a caller spelling
 *  that partition itself is a caller the next field misroutes. */
export const movesRows = <Row>(change: Change<Row>): boolean =>
  change.upserts.length > 0 || change.removes.length > 0;

const EMPTY: Change<never> = { upserts: [], removes: [], appends: [] };

/** Two changes as one. Closing the open row and writing the next one are two
 *  upserts a subscriber should see in the same frame — and a caller that
 *  composes two of its own (a plan row removed beside the paragraph it closed)
 *  needs the same rule rather than a second three-field merge of its own. */
export const plus = <Row>(
  first: Change<Row>,
  second: Change<Row>,
): Change<Row> => ({
  upserts: [...first.upserts, ...second.upserts],
  removes: [...first.removes, ...second.removes],
  appends: [...first.appends, ...second.appends],
});

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** The fields {@link Transcript} DERIVES, named once — the list is spelled in
 *  several casts and a public type below, and several spellings of one list is
 *  one of them being missed the day a sixth is derived. */
type Derived = "id" | "seq" | "since" | "streaming" | "stranded" | "resumed";

/**
 * A row's CONTENT: everything about it that a caller decides.
 *
 * Naming the derived fields once, here, is what makes them unsettable: every
 * door into this class takes this rather than a `Partial<Row>`, so a caller
 * cannot hand in a `seq` or a `since` for the writer to have to ignore, and a
 * sixth derived field inherits the rule instead of needing each door to be told
 * about it. Exported because two of those doors are public and their argument
 * has to be nameable from outside.
 */
export type RowContent<Row extends AnyRow> = DistributiveOmit<Row, Derived>;

type RowPatch<Row extends AnyRow, K extends Row["kind"]> = Partial<
  Extract<RowContent<Row>, { kind: K }>
>;

/** A product's row without the fields this class derives — the argument every
 *  door below takes, so a caller's patch cannot set them. */
const contentOf = <Row extends AnyRow>(row: Row): RowContent<Row> => {
  const {
    id: _id,
    seq: _seq,
    since: _since,
    streaming: _streaming,
    stranded: _stranded,
    resumed: _resumed,
    ...content
  } = row as unknown as Row &
    RowHead & { streaming?: true; stranded?: true; resumed?: string };
  return content as unknown as RowContent<Row>;
};

/** The writer's derived fields, applied onto already-kind-correct content — a
 *  function rather than a spread in `#write`, so `streaming` cannot land on a
 *  tool row and `stranded` cannot land on a user row. */
const minted = <Row extends AnyRow>(
  content: RowContent<Row>,
  derived: {
    readonly id: string;
    readonly seq: number;
    readonly since: string;
  },
  marks: {
    readonly streaming: boolean;
    readonly stranded: boolean;
    readonly resumed: string | undefined;
  },
): Row => {
  const kind = (content as { kind: string }).kind;
  const marks_ =
    kind === "agent"
      ? marks.streaming
        ? { streaming: true as const }
        : {}
      : kind === "tool"
        ? {
            ...(marks.stranded ? { stranded: true as const } : {}),
            ...(marks.resumed === undefined ? {} : { resumed: marks.resumed }),
          }
        : {};
  return { ...content, ...derived, ...marks_ } as Row;
};

/** A row's text, read off the generic row.
 *
 *  The one field EVERY drawn row has and the type cannot say so: a product's
 *  union includes rows with no `text` of their own (kolu's `plan` carries steps,
 *  olai's width rows carry none), so this class reads it through one named
 *  accessor rather than casting at each site. */
const textOf = (row: unknown): string =>
  (row as { readonly text?: string }).text ?? "";

/** The two statuses that mean a call has not reported back. */
const isRunning = (status: ToolStatus): boolean =>
  status === "pending" || status === "in_progress";

/** A background task that is STILL OUT — the one kind of call a turn's ending
 *  says nothing about, because outliving its turn is the whole point of it.
 *  Asked of the row rather than of a flag, so the strip above the scroll and the
 *  stranding rule cannot answer it differently. */
const isTaskOut = (row: { readonly armed?: Armed | undefined }): boolean =>
  row.armed !== undefined && row.armed.ended === null;

/**
 * WHAT A DEATH SAYS when the harness sent no sentence with it.
 *
 * The harness's own summary is what a reader is owed — it names the task and
 * carries a background shell's exit code — and this is the honest thing to say
 * when the ending arrived without one. Never a word of ours where there is one
 * to use: `stopped` and `failed` are the harness's own, and a monitor somebody
 * stopped did not fail.
 */
const endedSaid = (what: string, name: string, ended: string): string =>
  `the ${what} “${name}” ended (${ended})`;

/** ... and the word for the one ending nothing reports: the turn that sent an
 *  agent out finished without it, so nobody is ever going to say what became of
 *  it. The agent has no word for this because the agent does not know it
 *  happened. */
export const STRANDED = "never reported back";

/** What a tool call is filed under. Spelled ONCE: the row a call writes and the
 *  row it names as the agent that made it are the same kind of key. */
export const toolKey = (id: string): string => `tool:${id}`;

/** What a spawned call was SENT TO DO, for the sentence about its death. The
 *  adapter titles a subagent call with the TOOL's name, so a fan-out that fell
 *  over reported four identical lines reading *the agent "Task" ended* — a
 *  bottom row that tells a reader something went wrong and refuses to say which
 *  of the four it was. */
const sentToDo = (spawned: Spawned, title: string): string =>
  spawned.said ?? title;

/** A task as a NEW outing finds it: everything said about it, except how the
 *  LAST outing ended and what it reported — because this outing has not ended,
 *  and has not reported, and those two fields are read as live facts. */
const withoutOuting = (armed: Armed): Armed => {
  const { ended: _ended, report: _report, ...before } = armed;
  // The two fields dropped ARE what a new outing has not done yet, so the value
  // this answers is an `Armed` whose ending and report are "not yet" — the shape
  // every reader of `armed` already understands.
  return { ...before, ended: null, report: null };
};

/** Everything a frame can say about one tool call. Each field `undefined` means
 *  UNCHANGED — the protocol reports a call twice and the second report carries
 *  only what moved.
 *
 *  `extra` is the PRODUCT's half: a field this class copies onto the row and
 *  never reads (kolu's `kolu` reading and `asksThroughForm`, olai's terminals,
 *  its engines' own names). It is part of the row for the repeat guard's sake,
 *  so a frame that moves one of those fields is news. */
export interface ToolMove<Row extends AnyRow> {
  readonly title?: string | undefined;
  readonly status?: ToolStatus | undefined;
  readonly detail?: string | undefined;
  readonly progress?: string | undefined;
  readonly diffs?: ReadonlyArray<FileDiff> | undefined;
  readonly locations?: ReadonlyArray<string> | undefined;
  /** The row of the subagent call this one was made inside, BY ITS ROW KEY —
   *  {@link toolKey} is the spelling, applied by the caller that has the id. */
  readonly parent?: string | undefined;
  readonly spawned?: Partial<Spawned> | undefined;
  readonly armed?: Partial<Armed> | undefined;
  /** The call's ARGUMENTS alone, as folded JSON — what a FAILED call's
   *  disclosure shows, so its error is said once, by its reason. */
  readonly asked?: string | undefined;
  readonly extra?:
    | Partial<Extract<RowContent<Row>, { kind: "tool" }>>
    | undefined;
  /** Product fields that are taken only UNTIL THE ROW IS NAMED — the ones a
   *  frame repeats with different words and means nothing by it (olai's engine
   *  spelling of a call, which the friendly title that arrives later must not
   *  overwrite). Taken on the frame that names the row, kept for good after it;
   *  everything in {@link extra} follows "the newest wins". */
  readonly untilNamed?:
    | Partial<Extract<RowContent<Row>, { kind: "tool" }>>
    | undefined;
  /** Whether `title` on THIS frame is the adapter's placeholder rather than the
   *  call's name. Scoped to the frame: absent is "not provisional", never
   *  "unchanged". */
  readonly provisional?: boolean | undefined;
}

/** What a caller may say about this transcript's two products. Every value has
 *  a default that is the STRICTER of the two, so a caller that names nothing
 *  gets a conversation that behaves like a fresh one. */
export interface TranscriptOptions<Row extends AnyRow> {
  /** The highest `seq` of the rows somebody ELSE is already holding for this
   *  conversation — a resumed one, restored from a store. Every id and every
   *  `seq` this instance mints starts after it, so a row minted now can neither
   *  collide with a restored row's id nor sort above it. */
  readonly from?: number;
  readonly now?: () => number;
  /** The LAST of the caller's restored rows is already a break — the only thing
   *  this instance can know about rows it never minted, and what
   *  {@link Transcript.write}'s divider guard needs while its own map is empty. */
  readonly endsWithDivider?: boolean;
  /** Which rows a turn can be the DELIVERY of — the ones that can wait behind
   *  another turn, be refused, or go unanswered. kolu's own wake rows are one;
   *  a product with only `user` rows leaves this alone. */
  readonly deliverable?: (row: Row) => boolean;
  /** Whether a wipe lets the counters run on. kolu writes its rows to a store
   *  and a resumed conversation's `seq` must stay above what it restored, so
   *  they do; olai clears a panel and starts again from one. */
  readonly countersSurviveClear?: boolean;
  /** What number the first row this instance mints carries.
   *
   *  `"zero"` — olai's conversation starts at nothing: its panel counts rows
   *  from zero, and a browser's "how many older rows are there" reads a row's
   *  `seq` as that count. `"afterFrom"` (the default) — kolu's starts just AFTER
   *  `from`, because `from` is the highest `seq` a caller already holds and a row
   *  minted now may not share its number. */
  readonly firstSeq?: "zero" | "afterFrom";
  /** The row KIND that means "a break between two conversations", for a product
   *  whose new session is a ROW rather than a wipe (kolu's `divider`). A
   *  product that clears instead names nothing. */
  readonly breakKind?: string;
  /** A product's own rule for when a row may be RENAMED after it has already
   *  been named, or `undefined` for "never".
   *
   *  kolu's answer is `undefined` and that is the rule a title needs: a title is
   *  a display string an agent may rewrite mid-call, so the first frame that
   *  carries one picks it and no later frame moves it. olai's engines have one
   *  shape more — a raw label arrives first, and the row's real name arrives
   *  with the OWNERSHIP that lands a frame later — so its caller answers
   *  `undefined` for every row but that one, where it answers the new title. */
  readonly retitle?: (row: Row, move: ToolMove<Row>) => string | undefined;
}

export class Transcript<Row extends AnyRow> {
  #rows = new Map<string, Row>();
  #seq = 0;
  #minted = 0;
  /** The row currently being streamed into — the ONE place "still growing" is
   *  recorded. Chunks accumulate into it rather than each becoming a row: what a
   *  reader wants is one paragraph growing, not forty. */
  #open: string | null = null;
  /** The calls a TURN left behind, by key — set beside the rows rather than
   *  written onto them, because half a dozen paths re-publish a row by spreading
   *  it as it stands and a hand-set field would ride straight past the decision
   *  that is supposed to make it. */
  #stranded = new Set<string>();
  /** The calls whose NAME has been picked, so a later frame's title cannot move
   *  it. What is kept here is only WHETHER the question has been answered; the
   *  answer itself stays in `text` where a reader of the row can see it. */
  #named = new Set<string>();
  /** Each call's arguments as last reported, by key — kept beside the rows
   *  rather than on them: the adapter sends the input on the arming frame and
   *  the answer on the settling one, and a failed call's disclosure needs the
   *  first after the second has replaced it. */
  #asked = new Map<string, string>();
  /** Which row said something DIED, by the key of the row it happened to — so
   *  the sentence that arrives a beat after an ending REFINES that notice rather
   *  than minting a second one. BY THE ROW rather than by the task's own id,
   *  because a call that armed a task and a call that sent an agent out are two
   *  ways of ending, and keyed by task id the two guards would be in two key
   *  spaces. */
  #ended = new Map<string, string>();
  /** What it would take to send a REFUSED row again, by that row's key. Here,
   *  beside the rows, because it is half of one fact and the other half is a
   *  field on the row: a row offering a retry with no prompt behind it draws a
   *  button that refuses, and a prompt with no row is a message nobody can see.
   *  ONLY refused rows are in here — a row whose delivery went `unanswered` is
   *  one the agent may already have, so there is no honest retry to offer. */
  #undelivered = new Map<string, string>();
  /** The product keys the LAST refusal wrote on each row — kolu's `signIn`,
   *  olai's `auth` — so the next mark can take them off again. Here rather than
   *  on the row for `stranded`'s reason: a key that is present is a claim, and
   *  the claim has to be withdrawn by the line that knows it stopped being
   *  true ({@link #mark}). */
  #refusalMarks = new Map<string, ReadonlyArray<string>>();
  /** The calls that have been round MORE THAN ONCE, and when the current outing
   *  began — the one place a resume is written down, with `resumed` derived from
   *  it on every write, exactly as `stranded` and `streaming` are. */
  #outings = new Map<string, string>();
  readonly #now: () => number;
  readonly #deliverable: (row: Row) => boolean;
  readonly #countersSurviveClear: boolean;
  readonly #breakKind: string | undefined;
  readonly #firstSeq: "zero" | "afterFrom";
  readonly #retitle:
    | ((row: Row, move: ToolMove<Row>) => string | undefined)
    | undefined;
  /** Whether the row the CALLER holds last for this conversation is a break. */
  #endsWithDivider: boolean;

  constructor(options: TranscriptOptions<Row> = {}) {
    this.#seq = options.from ?? 0;
    this.#minted = options.from ?? 0;
    this.#now = options.now ?? Date.now;
    this.#endsWithDivider = options.endsWithDivider ?? false;
    this.#deliverable =
      options.deliverable ??
      ((row) => (row as { kind: string }).kind === "user");
    this.#countersSurviveClear = options.countersSurviveClear ?? false;
    this.#breakKind = options.breakKind;
    this.#firstSeq = options.firstSeq ?? "afterFrom";
    this.#retitle = options.retitle;
    if (this.#firstSeq === "zero") this.#seq = (options.from ?? 0) - 1;
  }

  /** Whether the row a reader sees LAST for this conversation is already a
   *  BREAK — this instance's own last row, or, with none of its own, the
   *  caller's ({@link TranscriptOptions.endsWithDivider}).
   *
   *  A product whose new session is a ROW rather than a wipe asks this before
   *  minting another: two breaks with nothing between say exactly what one says,
   *  and the stack of them is what a caller retrying a refused open leaves
   *  behind. A product that clears instead never asks, which is why
   *  {@link TranscriptOptions.breakKind} is optional. */
  endsWithBreak(): boolean {
    const last = [...this.#rows.values()].at(-1);
    return last === undefined
      ? this.#endsWithDivider
      : last.kind === this.#breakKind;
  }

  rows(): ReadonlyArray<Row> {
    return [...this.#rows.values()];
  }

  /** The same rows as the keyed set they are — for a caller that asks about one
   *  row by key rather than in order. */
  entries(): ReadonlyMap<string, Row> {
    return this.#rows;
  }

  /**
   * EVERY ROW GOES, and everything this class knows ABOUT them with it.
   *
   * The wipe a person asks for by pressing `New session`: that conversation is
   * deleted rather than divided. It lives here, beside the rows, because the
   * rows are not the whole of this state — a call's picked name, the arguments
   * it was armed with, the deaths already announced, the calls a turn walked
   * away from, the paragraph still open — and a caller that emptied its own
   * MIRROR of the rows left all of that standing. An agent numbers its calls
   * from one in its next conversation, so the first call of the next turn
   * landed on a row this instance still held, said nothing new ("a repeat is not
   * a second report"), and was published to nobody.
   *
   * `held` is what the CALLER holds for this conversation and this instance
   * never minted — rows read back out of its store at boot, or minted by the
   * harness this one replaced. They are removed in the same change, so ONE wipe
   * empties both ends of one conversation.
   *
   * THE COUNTERS stay where the caller says (`countersSurviveClear`): kolu's
   * ids and `seq` stay monotonic for the life of the process, so nothing minted
   * after the wipe can collide with a row a reader is still holding.
   */
  clear(held: ReadonlyArray<string> = []): Change<Row> {
    const removes = [...this.#rows.keys()];
    for (const id of held) if (!this.#rows.has(id)) removes.push(id);
    this.#rows.clear();
    this.#named.clear();
    this.#asked.clear();
    this.#ended.clear();
    this.#stranded.clear();
    this.#undelivered.clear();
    this.#refusalMarks.clear();
    this.#outings.clear();
    this.#open = null;
    this.#endsWithDivider = true;
    if (!this.#countersSurviveClear) {
      // ... back to the origin the caller asked for: the first row of a fresh
      // conversation is 0 for a product that counts from nothing, and 1 for one
      // whose `from` is somebody else's highest number.
      this.#seq = this.#firstSeq === "zero" ? -1 : 0;
      this.#minted = 0;
    }
    return { ...EMPTY, removes };
  }

  /** Everything still out when the turn that started it has ended — the strip
   *  above the scroll, because the row itself may be an hour of scrollback
   *  away. Derived off the rows rather than kept beside them, so it cannot
   *  disagree with what is drawn. */
  watching(): ReadonlyArray<Watching> {
    const out: Array<Watching> = [];
    for (const row of this.#rows.values()) {
      if (row.kind !== "tool") continue;
      const tool = row as Row & {
        armed?: Armed;
        spawned?: Spawned;
        status?: ToolStatus;
        startedAt?: string;
      };
      if (tool.armed !== undefined && tool.armed.ended === null) {
        out.push({
          row: row.id,
          kind: "task",
          name: tool.armed.description ?? tool.armed.task,
          since: tool.startedAt ?? row.since,
        });
        continue;
      }
      if (
        tool.spawned !== undefined &&
        tool.status !== undefined &&
        isRunning(tool.status) &&
        !this.#stranded.has(row.id)
      ) {
        out.push({
          row: row.id,
          kind: "agent",
          name: sentToDo(tool.spawned, textOf(row)),
          since: tool.startedAt ?? row.since,
        });
      }
    }
    return out;
  }

  /**
   * A row that stands on its own, minted at a key this class makes.
   *
   * The door for a PRODUCT's own row kinds: kolu's `divider`, `plan` and `wake`
   * are written through it, and so is olai's `refusal` — the content is the
   * caller's whole, the key and the head are this class's.
   */
  write(
    content: RowContent<Row>,
    options: { readonly closing?: boolean } = {},
  ): { readonly key: string; readonly change: Change<Row> } {
    const key = this.#next((content as { kind: string }).kind);
    return {
      key,
      change: plus(
        options.closing === false ? (EMPTY as Change<Row>) : this.#close(),
        this.#put(key, content),
      ),
    };
  }

  /** A row that stands on its own, report the change and drop the key. */
  add<K extends Row["kind"]>(
    kind: K,
    text: string,
    extra: RowPatch<Row, K> = {},
  ): Change<Row> {
    return this.write({ kind, text, ...extra } as unknown as RowContent<Row>)
      .change;
  }

  /** Write a row at a key the CALLER chose — a row whose key is load-bearing
   *  outside this class: a question somebody answers by naming it, or a plan
   *  row that is upserted at one key for the life of a session. */
  upsert(key: string, content: RowContent<Row>): Change<Row> {
    return this.#put(key, content);
  }

  /** Take a row back out, for the ONE row that can turn out to have meant
   *  nothing: a break minted for a conversation that then would not open, or a
   *  plan the agent cleared. Nothing else is ever withdrawn — a row a reader has
   *  already seen is the record. */
  remove(key: string): Change<Row> {
    if (!this.#rows.delete(key)) return EMPTY as Change<Row>;
    return { ...(EMPTY as Change<Row>), removes: [key] };
  }

  /** Everything this class took back out of a row's own bookkeeping for that
   *  key, when a caller drops a row of its own (a plan the agent cleared). */
  forget(key: string): void {
    this.#named.delete(key);
    this.#asked.delete(key);
    this.#ended.delete(key);
    this.#stranded.delete(key);
    this.#undelivered.delete(key);
    this.#refusalMarks.delete(key);
    this.#outings.delete(key);
  }

  /**
   * What went out down the person's lane — a row like any other, ANSWERING WITH
   * ITS KEY.
   *
   * The one caller that has to keep a key: a user message can turn out to be
   * undeliverable after it has been drawn, and a retry that lands has to find
   * the same row again.
   */
  user(
    text: string,
    extra: RowPatch<Row, "user"> = {},
  ): { readonly key: string; readonly change: Change<Row> } {
    return this.#row("user", text, extra);
  }

  /** That message is WAITING ITS TURN at the agent — it went out while a turn
   *  was still running and nothing has started on it. Not a delivery value,
   *  because a queued message has not FAILED at anything. */
  queued(key: string): Change<Row> {
    return this.#waiting(key, true);
  }

  /** ... and the agent has taken it up. Called on every turn that ends rather
   *  than only where a mark was made — a row that never said it was waiting is a
   *  no-op here, which is what makes the caller's rule "clear whoever is at the
   *  head now" rather than "remember which rows you marked". */
  taken(key: string): Change<Row> {
    return this.#waiting(key, false);
  }

  #waiting(key: string, waiting: boolean): Change<Row> {
    const current = this.#rows.get(key);
    if (current === undefined || !this.#deliverable(current)) {
      return EMPTY as Change<Row>;
    }
    // ALREADY SO IS NOT NEWS: {@link taken} lands mostly on rows that were never
    // waiting, and a frame per turn saying nothing is a conversation
    // republishing itself.
    if (waiting === ((current as { queued?: true }).queued === true)) {
      return EMPTY as Change<Row>;
    }
    const { queued: _queued, ...content } = contentOf(current) as unknown as {
      queued?: true;
    } & Record<string, unknown>;
    return this.#put(
      key,
      (waiting
        ? { ...content, queued: true }
        : content) as unknown as RowContent<Row>,
    );
  }

  /**
   * That message CERTAINLY never reached the agent, and here is what it would
   * take to send it again.
   *
   * The row does not move and nothing is minted: what a person typed stays
   * exactly where they typed it, with a mark saying it is still theirs to send.
   *
   * `extra` carries what the PRODUCT says about the refusal — kolu's which
   * sign-in reason would fix it, olai's `auth` — because only the product knows
   * the words it puts beside *send again*. `retry` is the prompt itself, kept
   * for a caller that offers a button ({@link undelivered}).
   */
  refused(key: string, extra: Partial<Row> = {}, retry?: string): Change<Row> {
    const change = this.#mark(key, "refused", extra);
    // THE PROMPT IS KEPT ONLY IF THE MARK LANDED: a row a replaced session took
    // away has nothing to offer a retry for, and keeping its words would leave
    // a button on a row nobody can see.
    if (retry !== undefined && says(change)) this.#undelivered.set(key, retry);
    return change;
  }

  /** NOTHING CAME BACK about that message, and that is all anybody can say. No
   *  retry is offered at all: an agent that went quiet may have the message
   *  already, so sending it again is a duplicate offered to somebody with no way
   *  to tell. */
  unanswered(key: string): Change<Row> {
    // A prompt kept from an EARLIER failure of the same row goes with it: the
    // offer lives in that map.
    this.#undelivered.delete(key);
    return this.#mark(key, "unanswered");
  }

  /** ... and it went after all. A row must not go on advertising a failure that
   *  has stopped being true. */
  sent(key: string): Change<Row> {
    this.#undelivered.delete(key);
    return this.#mark(key, null);
  }

  /** What it would take to send that row again, or `null` when there is no
   *  honest retry to offer — it went, or nothing ever answered about it. */
  undelivered(key: string): string | null {
    return this.#undelivered.get(key) ?? null;
  }

  /**
   * THE ONE LINE THAT DECIDES A ROW'S DELIVERY MARK, and therefore the one line
   * that knows what the PREVIOUS decision wrote.
   *
   * `delivery` comes off along with the derived fields: a spread of the old row
   * would carry the previous answer past this decision. THE PRODUCT'S MARK GOES
   * WITH IT — kolu's `signIn`, olai's `auth` — and that is what
   * {@link #refusalMarks} is for: the keys the last refusal wrote are taken off
   * again on every later mark, so a message that was refused for want of a
   * signature and then WENT stops advertising the door it no longer needs. A
   * mark that outlives its failure is the row telling a person to sign in about
   * a message the agent already has.
   *
   * NOTHING IS MARKED ON A ROW THAT CANNOT CARRY A MARK: a refusal is about a
   * message a turn is the delivery of ({@link TranscriptOptions.deliverable}),
   * and writing `delivery` onto a notice — or kolu's `signIn` onto a wake, whose
   * schema has no such field — is a field a product's row type does not declare,
   * which its encoder then drops or refuses.
   */
  #mark(
    key: string,
    delivery: "refused" | "unanswered" | null,
    extra: Partial<Row> = {},
  ): Change<Row> {
    const current = this.#rows.get(key);
    if (current === undefined || !this.#deliverable(current)) {
      return EMPTY as Change<Row>;
    }
    const { delivery: _delivery, ...content } = contentOf(
      current,
    ) as unknown as {
      delivery?: string;
    } & Record<string, unknown>;
    // ... and every key the LAST refusal wrote, whichever way this mark goes.
    const product: Record<string, unknown> = { ...content };
    for (const name of this.#refusalMarks.get(key) ?? []) delete product[name];
    for (const name of Object.keys(extra)) delete product[name];
    if (delivery === null) {
      this.#refusalMarks.delete(key);
      return this.#put(key, product as unknown as RowContent<Row>);
    }
    this.#refusalMarks.set(key, Object.keys(extra));
    return this.#put(key, {
      ...product,
      delivery,
      ...present(extra),
    } as unknown as RowContent<Row>);
  }

  /** One chunk of the agent's prose. Appends to the row already open, or opens
   *  one. */
  say(text: string): Change<Row> {
    return this.#grow("agent", text);
  }

  /**
   * One chunk of what a PERSON said, out of a replay.
   *
   * The same accumulation the agent's own prose gets, and it is one row rather
   * than many because the protocol's unit is a CHUNK: a replayed message reaches
   * this end as however many pieces the agent kept it in, and a row per piece is
   * one sentence drawn as three bubbles down the side of the panel.
   *
   * ONLY a replay reaches this. A message typed here is written whole, by the
   * one caller that keeps its key ({@link user}), because the product has the
   * whole of it before anything is on the wire. A caller that never replays
   * simply never calls it, which is why kolu needs no option to switch it off.
   */
  userSaid(text: string): Change<Row> {
    return this.#grow("user", text);
  }

  /**
   * One chunk into the row already open, or into a new one.
   *
   * ONE function for the two kinds that arrive in pieces, and the KIND is what
   * decides whether the open row is the right one to grow: a tool frame closes
   * whatever was open, but nothing closes a paragraph between a person's words
   * and the agent's answer to them, so an agent chunk appended to an open user
   * row would put the answer inside the question.
   */
  #grow(kind: "agent" | "user", text: string): Change<Row> {
    const open = this.#open;
    const current = open === null ? undefined : this.#rows.get(open);
    if (open !== null && current !== undefined && current.kind === kind) {
      // THE PIECE GOES OUT; THE WHOLE IS KEPT. The row here grows by the chunk
      // and what is REPORTED is the chunk and where it belongs.
      const at = textOf(current).length;
      this.#write(open, {
        ...contentOf(current),
        text: `${textOf(current)}${text}`,
      } as unknown as RowContent<Row>);
      return { ...(EMPTY as Change<Row>), appends: [{ of: open, at, text }] };
    }
    // A row that is not there yet is WRITTEN, whole and with its first chunk in
    // it: there is nothing on the far end to append to.
    const closed = this.#close();
    this.#open = this.#next(kind);
    return plus(
      closed,
      this.#put(this.#open, { kind, text } as unknown as RowContent<Row>),
    );
  }

  /**
   * A turn is STARTING.
   *
   * It writes no row — what a person typed is already one — and does exactly one
   * thing: nothing a previous turn left running may still look like work in
   * progress under this one. {@link settle} has normally said that already, so
   * this is usually a no-op; it is here because the bug it forecloses is
   * specifically about the SECOND turn. A dead agent's rows are deliberately not
   * cleared, so sending again puts a live turn over a transcript full of calls
   * that will never report.
   */
  begins(): Change<Row> {
    return this.#strand(false);
  }

  /** The turn ended: whatever was streaming has stopped, and so has anything the
   *  agent announced and never reported back on — except a call that armed a
   *  background task, which is the one kind of call a turn ending says nothing
   *  about. */
  settle(): Change<Row> {
    return plus(this.#close(), this.#strand(false));
  }

  /** The CONVERSATION is over — the agent died — and that is a different
   *  sentence from a turn ending. A dead agent reports nothing ever again, so
   *  the tasks it left out there are exactly as abandoned as the calls it never
   *  came back for, and a rail still pulsing under a process that no longer
   *  exists is the failure every live face is written against. */
  abandon(): Change<Row> {
    return plus(this.#close(), this.#strand(true));
  }

  /** ... and the half of that which is true for a turn ending while ANOTHER is
   *  still running: its paragraph is finished, and nothing else is. Without it
   *  two turns in a row read as ONE ANSWER, the second turn's first words
   *  landing on the end of the first turn's last sentence. It may NOT strand:
   *  the calls still in flight belong to the turn that is still running. */
  stopSaying(): Change<Row> {
    return this.#close();
  }

  /**
   * Mark every call this turn is leaving behind.
   *
   * Its STATUS is left exactly as it came — `pending` is the agent's own word
   * and the row is the record of what it said — and what is added is this end's
   * own observation about its own conversation, which is the only part of this
   * anybody here is entitled to.
   *
   * ... AND AN AGENT LEFT BEHIND IS A ROW AT THE BOTTOM, which a task left
   * behind is not: a subagent's own calls are filed under the agent that made
   * them, so a fan-out whose agents never report leaves a reader with nothing on
   * screen that changed. Only at a turn's end, never when the whole agent has
   * gone (`alsoArmed`) — a dead agent owes a reader ONE sentence about itself,
   * and six would bury it in its own consequences.
   */
  #strand(alsoArmed: boolean): Change<Row> {
    let change: Change<Row> = EMPTY as Change<Row>;
    for (const [key, row] of this.#rows) {
      if (row.kind !== "tool" || this.#stranded.has(key)) continue;
      const tool = row as Row & {
        status?: ToolStatus;
        spawned?: Spawned;
        armed?: Armed;
        text: string;
      };
      if (tool.status === undefined || !isRunning(tool.status)) continue;
      if (!alsoArmed && isTaskOut(tool)) continue;
      this.#stranded.add(key);
      change = plus(change, this.#put(key, contentOf(row)));
      if (!alsoArmed && tool.spawned !== undefined) {
        change = plus(
          change,
          this.#dies(key, "agent", sentToDo(tool.spawned, tool.text), STRANDED),
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
   * string an agent may rewrite for its own reasons, so the row's NAME is picked
   * at the first frame that carries one — unless that frame says the title is
   * only a PLACEHOLDER, which one adapter sends while the model's arguments are
   * still streaming. Such a title is SHOWN, because a nameless row is worse, but
   * it does not ANSWER the question.
   *
   * A FRAME THAT SAYS NOTHING NEW CHANGES NOTHING. Agents repeat themselves, and
   * a repeat is not a second report: in particular the mark saying its turn
   * walked away from a call does not come off.
   */
  tool(id: string, move: ToolMove<Row>): Change<Row> {
    const key = toolKey(id);
    const current = this.#rows.get(key);
    const held =
      current?.kind === "tool"
        ? (current as Row & {
            text: string;
            status: ToolStatus;
            detail?: string;
            progress?: string;
            diffs?: ReadonlyArray<FileDiff>;
            locations?: ReadonlyArray<string>;
            parent?: string;
            spawned?: Spawned;
            armed?: Armed;
          })
        : undefined;
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
      move.extra === undefined &&
      move.armed?.report !== undefined &&
      move.armed.ended === undefined &&
      move.armed.description === undefined
    ) {
      return EMPTY as Change<Row>;
    }
    const status = move.status ?? held?.status ?? "pending";
    // A CALL THAT WAS OVER AND IS RUNNING AGAIN — a call going round a SECOND
    // time, which is the one transition here that is about the row's LIFE rather
    // than about its content, and the reason it is decided before any of the
    // merges below: the four facts below are scoped to an OUTING, and each is a
    // face that lies if it survives into the next one.
    const reopened =
      held !== undefined && !isRunning(held.status) && isRunning(status);
    if (reopened) {
      this.#outings.set(key, this.#stamp());
      this.#ended.delete(key);
    }
    if (move.asked !== undefined) this.#asked.set(key, move.asked);
    const progress = move.progress ?? held?.progress;
    // A FAILED CALL SAYS WHY ONCE. Its content (`progress`) is the reason the
    // card shows; the JSON under it is then what was ASKED, and never the answer
    // again. A failure that said nothing in its content keeps its answer here,
    // because that is the only place the error is.
    const detail =
      status === "failed" && progress !== undefined && this.#asked.has(key)
        ? this.#asked.get(key)
        : (move.detail ?? held?.detail);
    const named = this.#named.has(key);
    const renamed =
      held === undefined ? undefined : this.#retitle?.(held, move);
    const title =
      renamed ??
      (move.title !== undefined && !named
        ? move.title
        : (held?.text ?? move.title ?? id));
    if (move.title !== undefined && move.provisional !== true) {
      this.#named.add(key);
    }
    // What this call STARTED, spread one word deeper rather than replaced: the
    // fact arrives split across frames because the ARGUMENTS do, and a later
    // report that said only "this is a spawn" would take back a kind an earlier
    // frame already gave.
    // ... and what it STARTED, spread one word deeper rather than replaced: the
    // fact arrives split across frames because the ARGUMENTS do, and a later
    // report that said only "this is a spawn" would take back a kind an earlier
    // frame already gave. The fields a frame did not mention are `null` — the
    // shared encoding spells both of them — so a row can never carry half a
    // `Spawned` and fail to encode on its way to a browser.
    const spawned =
      move.spawned === undefined
        ? held?.spawned
        : {
            kind: move.spawned.kind ?? held?.spawned?.kind ?? null,
            said: move.spawned.said ?? held?.spawned?.said ?? null,
          };
    // ... and what it ARMED, ACCUMULATED across the frames that each know one
    // piece: the frame that ARMS it names the description, the frame that
    // SETTLES it names how it ended, and the report arrives later still. A
    // caller answers about the frame in front of it and never accumulates, so
    // holding the task together is this class's job — and the fields a frame
    // did not mention are `null` (not absent), because "still out" is a fact
    // this row states and every reader of it asks {@link isTaskOut}.
    const merged =
      move.armed === undefined
        ? held?.armed
        : held?.armed === undefined && move.armed.task === undefined
          ? undefined
          : {
              task: move.armed.task ?? held?.armed?.task ?? "",
              description:
                move.armed.description ?? held?.armed?.description ?? null,
              ended: move.armed.ended ?? held?.armed?.ended ?? null,
              report: move.armed.report ?? held?.armed?.report ?? null,
            };
    // ... and a REOPENED call's task has not ended and has not reported,
    // whatever the last outing said.
    const armed =
      reopened && merged !== undefined ? withoutOuting(merged) : merged;
    const startedAt = (held as { startedAt?: string } | undefined)?.startedAt;
    // FROM WHAT THE ROW ALREADY CARRIES, so a product's own fields survive a
    // frame that says nothing about them — the class copies them and never
    // reads them, and "absent means unchanged" has to be true of them too. The
    // shared fields this frame DOES decide are written after, so none of them
    // rides past the decision.
    const before = (held === undefined
      ? {}
      : contentOf(held)) as unknown as Record<string, unknown>;
    const content = {
      ...before,
      kind: "tool",
      text: title,
      status,
      ...(detail === undefined ? {} : { detail }),
      ...(move.progress === undefined ? {} : { progress: move.progress }),
      ...((move.diffs ?? held?.diffs) === undefined
        ? {}
        : { diffs: move.diffs ?? held?.diffs }),
      ...((move.locations ?? held?.locations) === undefined
        ? {}
        : { locations: move.locations ?? held?.locations }),
      ...(move.parent === undefined
        ? held?.parent === undefined
          ? {}
          : { parent: held.parent }
        : { parent: move.parent }),
      ...(spawned === undefined ? {} : { spawned }),
      ...(armed === undefined ? {} : { armed }),
      ...(startedAt === undefined
        ? isRunning(status)
          ? { startedAt: this.#stamp() }
          : {}
        : { startedAt }),
      ...present(move.extra),
      ...untilNamed(move.untilNamed, named),
    } as unknown as RowContent<Row>;
    // A TOOL FRAME ENDS THE OPEN PARAGRAPH — the agent said something, then it
    // did something, and the next thing it says is a new paragraph. The one
    // exception is a frame that is only the LIFE of a task we already knew
    // about: the call was made three hours ago, the frame is the harness
    // reporting its end, and nothing about the conversation has stopped.
    const lifecycle = held?.armed !== undefined && move.armed !== undefined;
    const closed = lifecycle ? (EMPTY as Change<Row>) : this.#close();
    // THE DEATH OF A TASK IS ALSO A ROW AT THE BOTTOM, computed before the
    // repeat guard so a frame that brings the harness's sentence — which says
    // nothing new about the CALL and everything about the line at the bottom —
    // still lands.
    // A SPAWN THAT FAILED is a death nothing else will report — a synchronous
    // subagent arms no task, so its own call's status is the whole of what
    // happened. Once: a row already saying `failed` has had its line.
    // ... AND IT IS THE ROW'S OWN GUARD THAT KEEPS IT TO ONE LINE: every failed
    // frame comes through here, and {@link #dies} mints once and then refines the
    // line it already wrote with the sentence that lands a beat later.
    const failed = spawned !== undefined && status === "failed";
    const died =
      armed?.ended !== undefined && armed.ended !== null
        ? this.#dies(
            key,
            spawned === undefined ? "background task" : "agent",
            armed.description ??
              sentToDo(spawned ?? { kind: null, said: null }, title),
            armed.ended,
            move.progress,
          )
        : failed && spawned !== undefined
          ? this.#dies(
              key,
              "agent",
              sentToDo(spawned, title),
              "failed",
              move.progress,
            )
          : (EMPTY as Change<Row>);
    // A REPEAT IS NOT A SECOND REPORT, compared BEFORE the open paragraph is
    // closed only in the sense that the close happens either way and only the
    // row is spared.
    if (held !== undefined && same(contentOf(held), content)) {
      return plus(closed, died);
    }
    // A call reported on again is a call its turn has NOT walked away from.
    this.#stranded.delete(key);
    return plus(plus(closed, this.#put(key, content)), died);
  }

  /**
   * A question somebody is waiting on, under the id the caller minted for it —
   * so the row's key and the handle an answer arrives under are one string, and
   * a list of open questions is a list of row ids rather than a second
   * vocabulary that can disagree.
   *
   * `parent` is the row key of the agent that asked, or `null` for the main
   * one — {@link toolKey} is the spelling, applied by a caller that has a call
   * id.
   */
  ask(
    id: string,
    message: string,
    fields: ReadonlyArray<AskField>,
    link: AskLink | null,
    parent: string | null,
  ): Change<Row> {
    return plus(
      this.#close(),
      this.#put(id, {
        kind: "ask",
        text: message,
        ask: { fields, link, outcome: null },
        ...(parent === null ? {} : { parent }),
      } as unknown as RowContent<Row>),
    );
  }

  /** ... and how it ended. A row that is not there any more — the session was
   *  replaced under it — changes nothing rather than minting one. Says nothing
   *  twice: a question already settled stays settled. */
  settleAsk(id: string, outcome: AskOutcome): Change<Row> {
    const current = this.#rows.get(id);
    if (current === undefined || current.kind !== "ask") {
      return EMPTY as Change<Row>;
    }
    const held = current as Row & {
      ask: {
        fields: ReadonlyArray<AskField>;
        link: AskLink | null;
        outcome: AskOutcome | null;
      };
    };
    if (held.ask.outcome !== null) return EMPTY as Change<Row>;
    // THE ROW AS IT STANDS, with the outcome written into it — rather than
    // three of its fields named again here, so a field a product added to an
    // ask row is carried rather than dropped at the moment it becomes the
    // record of a decision.
    return this.#put(id, {
      ...contentOf(current),
      ask: { fields: held.ask.fields, link: held.ask.link, outcome },
    } as unknown as RowContent<Row>);
  }

  /** A death, as a NOTICE at the bottom of the transcript — once per row,
   *  whichever of the two endings got there first, and REFINED by the sentence
   *  that arrives a beat later. */
  #dies(
    key: string,
    what: string,
    name: string,
    ended: string,
    said: string | undefined = undefined,
  ): Change<Row> {
    const already = this.#ended.get(key);
    if (already === undefined) {
      // NOT CLOSING what is open. The death arrives whenever the harness says
      // so — which may be in the middle of somebody else's answer — and the
      // answer goes on being one paragraph with this line under it.
      const { key: notice, change } = this.write(
        {
          kind: "notice",
          text:
            said === undefined || said === ""
              ? endedSaid(what, name, ended)
              : said,
        } as unknown as RowContent<Row>,
        { closing: false },
      );
      this.#ended.set(key, notice);
      return change;
    }
    // The summary, arriving after the ending it belongs to. Nothing to say until
    // it does, and nothing to say twice once it has.
    if (said === undefined || said === "") return EMPTY as Change<Row>;
    const held = this.#rows.get(already) as { text?: string } | undefined;
    if (held === undefined || held.text === said) return EMPTY as Change<Row>;
    return this.#put(already, {
      ...contentOf(this.#rows.get(already) as Row),
      text: said,
    } as unknown as RowContent<Row>);
  }

  #stamp(): string {
    return new Date(this.#now()).toISOString();
  }

  #next(kind: string): string {
    return `${kind}:${++this.#minted}`;
  }

  /** Mint a row that is FINISHED the moment it is written, and answer with both
   *  its key and the change. `closing` is the one thing a caller may say about
   *  the row ABOVE it: writing a row normally ends the open paragraph, and the
   *  one caller that says no is a death ({@link #dies}). */
  #row<K extends Row["kind"]>(
    kind: K,
    text: string,
    extra: RowPatch<Row, K>,
  ): { readonly key: string; readonly change: Change<Row> } {
    return this.write({ kind, text, ...extra } as unknown as RowContent<Row>);
  }

  /** Whatever was streaming has stopped. The row is re-published because
   *  `streaming` is derived on every write, so the flag comes off by the row
   *  being written again rather than by anybody clearing a field. */
  #close(): Change<Row> {
    const open = this.#open;
    if (open === null) return EMPTY as Change<Row>;
    this.#open = null;
    const current = this.#rows.get(open);
    if (current === undefined) return EMPTY as Change<Row>;
    return this.#put(open, contentOf(current));
  }

  /** Write a row and report it. */
  #put(key: string, content: RowContent<Row>): Change<Row> {
    return { ...(EMPTY as Change<Row>), upserts: [this.#write(key, content)] };
  }

  /** ... and write it WITHOUT reporting it, for the one caller that reports a
   *  piece instead of the whole ({@link #grow}). */
  #write(key: string, content: RowContent<Row>): Row {
    const current = this.#rows.get(key);
    const row = minted<Row>(
      content,
      {
        id: key,
        // `seq` is taken off the row that is already there and minted only for
        // one that is not: a call reports itself several times, and re-numbering
        // would reorder the conversation under a reader.
        seq: current?.seq ?? ++this.#seq,
        since: current?.since ?? this.#stamp(),
      },
      {
        streaming: this.#open === key,
        stranded: this.#stranded.has(key),
        resumed: this.#outings.get(key),
      },
    );
    this.#rows.set(key, row);
    return row;
  }
}

/** A product's extra fields as a spread, with `undefined` taken as "nothing
 *  said" — which is what every other optional field of a row means.
 *
 *  NOT COSMETIC: a row holding `{ asksThroughForm: undefined }` ENCODES AS AN
 *  ERROR on kolu's wire (an optional-key field that is present must be the
 *  field's type), so the whole frame is dropped and every card in it vanishes.
 *  The caller writes `{ server: call?.server }` without thinking about whether
 *  there was a call; this is where that answers "absent". */
const present = (
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) kept[key] = value;
  }
  return kept;
};

/** A product's UNTIL-NAMED fields: taken on the frame that names the row, and
 *  never again once it has a name. That is olai's rule for an engine's own
 *  spelling of a call — a title arriving later is the row's name and must not
 *  drag a second spelling with it. */
const untilNamed = (
  untilNamed: Record<string, unknown> | undefined,
  named: boolean,
): Record<string, unknown> => (named ? {} : present(untilNamed));

/** Whether a frame said anything the row does not already say. Structural, over
 *  the content alone — the derived fields are the writer's and comparing them
 *  would make every frame news. */
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
