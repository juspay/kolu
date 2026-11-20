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

/** One kind of row's CONTENT, every field optional — what a caller may say
 *  about a row of that kind. Exported because the package's door hands the
 *  product's own half of a `user` row and a `tool` row back and forth, and
 *  both sides have to be able to name it. */
export type RowPatch<Row extends AnyRow, K extends Row["kind"]> = Partial<
  Extract<RowContent<Row>, { kind: K }>
>;

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

const textOf = (row: unknown): string =>
  (row as { readonly text?: string }).text ?? "";

/**
 * THE TWO STATUSES THAT MEAN A CALL HAS NOT REPORTED BACK.
 *
 * `pending` is a RUNNING state, which is the one thing here that is not
 * obvious: the adapter announces EVERY tool call with it, so it means
 * "announced" rather than "not started".
 */
export const isRunningStatus = (status: ToolStatus): boolean =>
  status === "pending" || status === "in_progress";

/**
 * ... and whether a ROW's call has not come back — the same question with the
 * two facts a status alone cannot carry folded in.
 *
 * A status is STICKY: an agent that died between announcing a call and
 * reporting on it leaves that row `pending` for as long as anybody is looking,
 * deliberately, because the row is the honest record of what was said. What
 * the row adds is {@link STRANDED}'s observation that the turn walked away
 * from it, and a row that never carried a status at all is not a call anybody
 * is still waiting on.
 */
export const isStillRunning = (row: {
  readonly status?: ToolStatus | undefined;
  readonly stranded?: true | undefined;
}): boolean =>
  row.stranded !== true &&
  row.status !== undefined &&
  isRunningStatus(row.status);

/**
 * A background task that is STILL OUT — the one kind of call a turn's ending
 * says nothing about, because outliving its turn is the whole point of it.
 *
 * ONE RULE, EXPORTED, because both products ask it and had written it twice:
 * this class asks it of the rows it is stranding, and a panel asks it of the
 * rows it draws (the rail under a row, the strip above the scroll, and whether
 * a clock has anything to tick for). Two spellings is a rail that goes out
 * under a clock that goes on counting.
 *
 * TWO HALVES, and the second is why this is not simply "has an `armed` whose
 * ending is unsaid". The harness's own ending is the ordinary way a task stops
 * being out — `null` for as long as nothing has said one, which is how
 * `@kolu/acp/wire`'s `Armed` spells a field no frame has spoken about — but a
 * call can also reach a terminal status without one (a cancelled turn
 * resolving what it left outstanding), and a task whose CALL is over is not a
 * task anybody is going to hear about again.
 */
export const isTaskOut = (row: {
  readonly armed?: Armed | undefined;
  readonly status?: ToolStatus | undefined;
  readonly stranded?: true | undefined;
}): boolean =>
  row.armed !== undefined && row.armed.ended === null && isStillRunning(row);

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

const sentToDo = (spawned: Spawned, title: string): string =>
  spawned.said ?? title;

const withoutOuting = (armed: Armed): Armed => {
  const { ended: _ended, report: _report, ...before } = armed;
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
  #open: string | null = null;
  #stranded = new Set<string>();
  #named = new Set<string>();
  #asked = new Map<string, string>();
  #ended = new Map<string, string>();
  #undelivered = new Map<string, string>();
  #refusalMarks = new Map<string, ReadonlyArray<string>>();
  #outings = new Map<string, string>();
  readonly #now: () => number;
  readonly #deliverable: (row: Row) => boolean;
  readonly #countersSurviveClear: boolean;
  readonly #breakKind: string | undefined;
  readonly #firstSeq: "zero" | "afterFrom";
  readonly #retitle:
    | ((row: Row, move: ToolMove<Row>) => string | undefined)
    | undefined;
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

  writeBreak(text: string): {
    readonly key: string | null;
    readonly change: Change<Row>;
  } {
    if (this.#breakKind === undefined || this.endsWithBreak()) {
      return { key: null, change: EMPTY as Change<Row> };
    }
    return this.write({
      kind: this.#breakKind,
      text,
    } as unknown as RowContent<Row>);
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
        isRunningStatus(tool.status) &&
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
    if (retry !== undefined && says(change)) this.#undelivered.set(key, retry);
    return change;
  }

  /** NOTHING CAME BACK about that message, and that is all anybody can say. No
   *  retry is offered at all: an agent that went quiet may have the message
   *  already, so sending it again is a duplicate offered to somebody with no way
   *  to tell. */
  unanswered(key: string): Change<Row> {
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

  #grow(kind: "agent" | "user", text: string): Change<Row> {
    const open = this.#open;
    const current = open === null ? undefined : this.#rows.get(open);
    if (open !== null && current !== undefined && current.kind === kind) {
      const at = textOf(current).length;
      this.#write(open, {
        ...contentOf(current),
        text: `${textOf(current)}${text}`,
      } as unknown as RowContent<Row>);
      return { ...(EMPTY as Change<Row>), appends: [{ of: open, at, text }] };
    }
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
      if (tool.status === undefined || !isRunningStatus(tool.status)) continue;
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
    if (
      held === undefined &&
      move.title === undefined &&
      move.status === undefined &&
      move.detail === undefined &&
      move.progress === undefined &&
      move.spawned === undefined &&
      move.extra === undefined &&
      move.armed?.report != null &&
      (move.armed.ended ?? null) === null &&
      (move.armed.description ?? null) === null
    ) {
      return EMPTY as Change<Row>;
    }
    const status = move.status ?? held?.status ?? "pending";
    const reopened =
      held !== undefined &&
      !isRunningStatus(held.status) &&
      isRunningStatus(status);
    if (reopened) {
      this.#outings.set(key, this.#stamp());
      this.#ended.delete(key);
    }
    if (move.asked !== undefined) this.#asked.set(key, move.asked);
    const progress = move.progress ?? held?.progress;
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
    const spawned =
      move.spawned === undefined
        ? held?.spawned
        : {
            kind: move.spawned.kind ?? held?.spawned?.kind ?? null,
            said: move.spawned.said ?? held?.spawned?.said ?? null,
          };
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
    const armed =
      reopened && merged !== undefined ? withoutOuting(merged) : merged;
    const startedAt = (held as { startedAt?: string } | undefined)?.startedAt;
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
        ? isRunningStatus(status)
          ? { startedAt: this.#stamp() }
          : {}
        : { startedAt }),
      ...present(move.extra),
      ...untilNamed(move.untilNamed, named),
    } as unknown as RowContent<Row>;
    const lifecycle = held?.armed !== undefined && move.armed !== undefined;
    const closed = lifecycle ? (EMPTY as Change<Row>) : this.#close();
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
    if (held !== undefined && same(contentOf(held), content)) {
      return plus(closed, died);
    }
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
    return this.#put(id, {
      ...contentOf(current),
      ask: { fields: held.ask.fields, link: held.ask.link, outcome },
    } as unknown as RowContent<Row>);
  }

  #dies(
    key: string,
    what: string,
    name: string,
    ended: string,
    said: string | undefined = undefined,
  ): Change<Row> {
    const already = this.#ended.get(key);
    if (already === undefined) {
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

  #row<K extends Row["kind"]>(
    kind: K,
    text: string,
    extra: RowPatch<Row, K>,
  ): { readonly key: string; readonly change: Change<Row> } {
    return this.write({ kind, text, ...extra } as unknown as RowContent<Row>);
  }

  #close(): Change<Row> {
    const open = this.#open;
    if (open === null) return EMPTY as Change<Row>;
    this.#open = null;
    const current = this.#rows.get(open);
    if (current === undefined) return EMPTY as Change<Row>;
    return this.#put(open, contentOf(current));
  }

  #put(key: string, content: RowContent<Row>): Change<Row> {
    return { ...(EMPTY as Change<Row>), upserts: [this.#write(key, content)] };
  }

  #write(key: string, content: RowContent<Row>): Row {
    const current = this.#rows.get(key);
    const row = minted<Row>(
      content,
      {
        id: key,
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

const present = (
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) kept[key] = value;
  }
  return kept;
};

const untilNamed = (
  untilNamed: Record<string, unknown> | undefined,
  named: boolean,
): Record<string, unknown> => (named ? {} : present(untilNamed));

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
