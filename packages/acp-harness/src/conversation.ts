import { readFile } from "node:fs/promises";
import {
  type Agent,
  type AgentEvent,
  AgentGone,
  AnswerRefused,
  type ContentBlock,
  type Handed,
  make,
  type Memory,
  type Models,
  type Probe,
  type SignedIn,
  type StopReason,
  type Stored,
} from "@kolu/acp-client";
import type { Adapter, Leg } from "@kolu/acp/engine";
import type {
  AskAnswer,
  AuthMethod,
  AuthStatus,
  Command,
  Model,
  Phase,
  PlanStep,
  Server,
  Setting,
  SignIn,
  SignInReason,
  SigningIn,
  TerminalView,
  Usage,
  Watching,
} from "@kolu/acp/wire";
import { Effect, Logger, References } from "effect";
import {
  type AnyRow,
  type Change,
  plus,
  type RowContent,
  type RowPatch,
  says,
  Transcript,
  type TranscriptOptions,
  toolKey,
} from "./transcript.ts";
import { type Turn, Turns } from "./turns.ts";

type NoPayload = undefined;

/**
 * NOTHING WAS ASKED OF ANYTHING, or nothing came back. `why` is a whole
 * sentence and nothing composes around it.
 *
 * The product's half of the client's own three-way reading
 * (`@kolu/acp-client`'s `Gone`): an `unreachable` and an `unanswered` are both
 * this, because what a caller does about either is the same — nothing was
 * delivered that this end can see, and the row says so.
 */
export class HarnessUnavailable extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.name = "HarnessUnavailable";
    this.why = why;
  }
}

/** A REFUSAL, with the agent demonstrably there — or this end's own no, on the
 *  one path where an answer never reaches the wire. `signIn` is whether a
 *  signature could fix it, which the client reads off the protocol's own code
 *  and the agent's own data, never off its prose. */
export class HarnessRefused extends Error {
  readonly why: string;
  readonly signIn: SignInReason | "no";
  /** ... and whether what was asked for is SIMPLY NOT THERE — ACP's `-32002`
   *  answered to a `session/load` of an id this engine's store has no record
   *  of, read off the code by the client. A closed value rather than prose,
   *  because the sentence around it is the adapter's to write and a panel must
   *  not pattern-match an agent's English. It is the one refusal whose way out
   *  is a different gesture: retrying a conversation the store does not have
   *  is refused for ever, and starting a new one is what moves. */
  readonly missing: boolean;
  constructor(why: string, signIn: SignInReason | "no", missing: boolean) {
    super(why);
    this.name = "HarnessRefused";
    this.why = why;
    this.signIn = signIn;
    this.missing = missing;
  }
}

/** One MCP server to hand this conversation as a PROGRAM on this host —
 *  somebody else's binary, spoken to over its stdin/stdout. The client's own
 *  shape, named here because it is what a caller fills in. */
export type StdioServer = Extract<Handed, { readonly kind: "stdio" }>;

/** One MCP server to hand this conversation as an HTTP ENDPOINT — a server
 *  somebody is already running, reached over streamable HTTP rather than
 *  spawned.
 *
 *  It is how a product hands over a face that is IN ITS OWN PROCESS and covers
 *  more than one machine: a stdio server could only ever be a program on ONE
 *  of them. `headers` is where its bearer token rides — such an endpoint is on
 *  loopback, and loopback is not a gate. */
export type HttpServer = Extract<Handed, { readonly kind: "http" }>;

/** ONE FILE RIDING A PERSON'S MESSAGE, as little of it as this package reads:
 *  what it is called, what it is, how big it is, and where the bytes are. The
 *  product owns the rest of whatever it records on the row — an id, a
 *  thumbnail, a ring — and hands a value that answers these four. */
export interface PromptFile {
  readonly name: string;
  readonly mimeType: string;
  /** Size on disk, as the product measured it. The caps below refuse on it. */
  readonly bytes: number;
  /** Absolute, on the machine the agent is running on. */
  readonly path: string;
}

/**
 * WHAT A PERSON SAID, as this conversation is handed it.
 *
 * FOUR FIELDS BECAUSE THE ROW AND THE WIRE ARE NOT THE SAME THING. `text` is
 * what the transcript records — their words, unadorned, which is what a person
 * reads back and what *send again* sends. `body` is what goes to the AGENT
 * under them, which is the product's to compose: kolu writes the block naming
 * the terminals a message was about, and an agent that was told nothing of
 * them would answer about a context it never had. `extra` is the product's
 * half of the row ({@link Transcript}), copied on and never read here.
 */
export interface PersonSaid<Row extends AnyRow> {
  readonly text: string;
  readonly body: string;
  readonly extra: RowPatch<Row, "user">;
  readonly files: ReadonlyArray<PromptFile>;
}

/**
 * HOW A CONVERSATION OPENS — the three questions a product answers before the
 * agent is spawned, as a closed set rather than a nullable id.
 *
 * `adopt` is the one that cannot be answered without a live agent: which
 * conversations this engine has stored for this directory is something only
 * the process on the other end of the pipe knows, so the product hands over
 * the memory it keeps and this end asks at the open.
 */
export type Opening =
  | { readonly kind: "resume"; readonly id: string }
  | { readonly kind: "fresh" }
  | { readonly kind: "adopt"; readonly memory: Memory };

/** ONE TOOL FRAME, as the product is asked to read it — everything the client
 *  said about the call that this package does not itself put on the row. */
export interface ToolFrame {
  /** EVERY MCP server and tool this frame's call was positively recognised as,
   *  and empty where the agent's leg matched no server we handed over. A list
   *  rather than one, because an agent that dispatches every MCP tool through
   *  ONE builtin names several in a frame, and a row's title and owner are
   *  composed from all of them — a reader handed only the first would draw one
   *  card for a call that did several things. */
  readonly mcp: ReadonlyArray<{
    readonly server: string;
    readonly tool: string;
  }>;
  /** Whether this call's question reaches a person as a FORM (the agent's own
   *  "ask the human" tool), or `undefined` where no frame has said. */
  readonly asksThroughForm: boolean | undefined;
  /** What the agent wrote as the call's input, as it arrived — free JSON, and
   *  free to be half-written. */
  readonly input: unknown;
  /** ... and the structured answer, where one has come back. */
  readonly answer: unknown;
  /** What the agent CALLED it and whose row it is, as the leg read them off
   *  the frame — the two a product with plugins of its own draws a card's
   *  name and owner from. `undefined` is "this frame said nothing about it". */
  readonly called: string | undefined;
  readonly row: string | undefined;
  /** ... and the opaque reply that row's own face renders. */
  readonly reply: unknown;
  /** THE PANES THIS CALL IS RUNNING IN — the agent's own terminals for it, as
   *  far as they have run. They arrive on frames OF THEIR OWN, so a frame
   *  carrying them says nothing else: every field above is `undefined` or
   *  empty, and a reader that writes only what it was told keeps whatever it
   *  last said about the call. `undefined` is a frame that is not about
   *  terminals at all. */
  readonly terminals: ReadonlyArray<TerminalView> | undefined;
}

/**
 * WHAT A PRODUCT MADE OF ONE FRAME — its half of the tool row, in the two
 * kinds a product's own field can be.
 *
 * `extra` is written on every frame that says it, newest winning.
 * `untilNamed` is written only while the row has not been named yet and kept
 * for good once it has: a call's raw spelling is worth drawing until the
 * friendly title arrives, and the frame that brings that title must not bring
 * the spelling back with it.
 */
export interface ToolReading<Row extends AnyRow> {
  readonly extra?: RowPatch<Row, "tool">;
  readonly untilNamed?: RowPatch<Row, "tool">;
}

export interface HarnessOptions<Row extends AnyRow> {
  /** WHICH AGENT THIS IS, in the product's own name for it: the key the
   *  client files the conversation's memory and model notes under (beside the
   *  session id), and the `agent` on every line it logs. A product with
   *  several engines names the one this conversation runs on, so a note read
   *  back at the next start is found under the engine it was written for. */
  readonly agent: string;
  /** How to read what this agent sends. Every bet that is true of one agent and
   *  not another is behind this; nothing in this file names an adapter. */
  readonly leg: Leg;
  /** What to spawn to reach it, with the environment the engine asked for and
   *  the environment it must not see. */
  readonly adapter: Adapter;
  /** `$HOME` of the machine hosting this conversation: the directory it works
   *  in. */
  readonly cwd: string;
  /**
   * THE DIRECTORY THIS AGENT READS ITS SIGNATURE OUT OF, on this host.
   *
   * Named in every sentence a signed-out panel shows, and that is the whole of
   * what it is for: the first question a surprising "not signed in" raises is
   * WHICH store was read, and a panel that cannot answer it sends the next
   * person guessing between `$HOME/.claude`, a `CLAUDE_CONFIG_DIR` somebody
   * exported and whatever the launcher under the adapter might redirect.
   *
   * THE CALLER'S, because the layout is the AGENT's: this file knows no
   * agent's credential store and never opens one. Nothing here reads, writes
   * or copies it — the sign-in kolu runs is the agent's own CLI, which owns
   * the store on both sides of the flow.
   */
  readonly configDir: string;
  /** What this conversation's hands are, FIXED: each is either a program to
   *  spawn on this machine or an HTTP endpoint already serving, and the list
   *  is the same for every session this harness opens. */
  readonly mcpServers: ReadonlyArray<StdioServer | HttpServer>;
  /**
   * ... AND WHAT IS FOUND AFRESH AT EVERY OPEN, for a product whose hands are
   * discovered rather than listed: each probe answers the server to hand over
   * (or nothing), the sentence a person is owed about one that is NOT there,
   * and the page that server's own face lives at. What comes back joins the
   * fixed list above, and what did NOT becomes a `missing` row of
   * `state.servers` — which is the one way a panel can say "the tool this
   * conversation works through is not installed on this host" rather than
   * drawing an agent with silently fewer hands.
   *
   * ASKED PER OPEN rather than once, because what is on a machine moves: a
   * server installed while the panel was open is one the next conversation
   * gets. Omitted is "nothing to discover", which is the honest answer for a
   * product that hands over a fixed list.
   */
  readonly probes?: () => Effect.Effect<ReadonlyArray<Probe>>;
  /** The standing prompt, which rides under the first message of a session
   *  that has not been taught. The WORDS are the caller's — they name the
   *  product's own MCP verbs, and this package knows no tool but the
   *  protocol's. */
  readonly teaching: string;
  /**
   * Whether the session being resumed HAS ALREADY BEEN TAUGHT — the standing
   * prompt went out under a message of it, and this conversation owes it
   * nothing.
   *
   * The caller's because it is the caller that remembers a session across a
   * restart: a harness is replaced for reasons that have nothing to do with
   * the conversation (an upgrade, a crash, a sign-in), and one that assumed
   * nothing re-taught a conversation the agent had already been taught — the
   * standing prompt again, in the middle of a chat, every restart. A fresh
   * session is `false`, and a caller that resumes nothing says `false`.
   */
  readonly taught: boolean;
  readonly log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
  /**
   * HOW THIS CONVERSATION OPENS, which is three different questions and not a
   * nullable id:
   *
   *   - `{ kind: "resume", id }` — come back to THAT conversation. What a
   *     refusal does is {@link whenLoadRefused}'s.
   *   - `{ kind: "fresh" }` — open a new one and adopt nothing.
   *   - `{ kind: "adopt", memory }` — the conversation this directory was last
   *     in, else the agent's most recent stored one, else a fresh one. The
   *     stored list is a question only a LIVE agent can answer, which is why
   *     this is a policy here rather than a decision a caller makes before the
   *     spawn: a product that worked it out itself would spawn a second
   *     adapter to ask. `memory` is where "which conversation was this
   *     directory's" is kept between one serve and the next — the product's,
   *     because where a machine keeps its state is not a protocol fact.
   */
  readonly opens: Opening;
  /**
   * The highest `seq` among the rows the caller has ALREADY PERSISTED for this
   * conversation, so this harness mints its ids and its ordering past them.
   *
   * A RESUMED conversation is two records of one thing: the caller's rows, and
   * the replay `session/load` re-emits. A caller that keeps its own rows keeps
   * the richer record — they carry readings the agent's transcript knows
   * nothing about — so what this number buys is that nothing minted here can
   * collide with one of them or sort above it. Absent means an empty
   * transcript, which is what a fresh conversation is.
   */
  readonly resumedSeq?: number;
  /**
   * Whether the LAST row the caller has persisted for this conversation is a
   * break. A replacement harness builds a fresh transcript, and the rule that
   * refuses a second break beside the first one can only read its own rows —
   * so without this a `newSession` right after a respawn minted a break beside
   * the caller's, every time. Means nothing to a product that clears
   * ({@link whenNewSession}), which mints no break at all.
   */
  readonly resumedEndsWithDivider?: boolean;
  /**
   * The model a PERSON chose, as the id it was chosen under — or `null` for a
   * conversation nobody has moved off whatever the agent picks.
   *
   * Re-asked after every open, because the agent's own pin outranks a
   * conversation at the agent's end: a model picked here comes back as the
   * host's default on the next restart unless somebody says otherwise, once,
   * after the session is open.
   */
  readonly model?: string | null;
  /**
   * WHERE A PERSON'S MODEL CHOICE IS KEPT, per conversation — the client's
   * own port, for a product that keeps that record itself (on disk, keyed by
   * agent and session). When it is handed over, the client reads and writes
   * it directly, and {@link model} is not read. Absent, the harness keeps the
   * choice in memory, seeded from {@link model}, for the life of the process.
   */
  readonly models?: Models;
  /**
   * WHAT A TOOL CALL IS READ AS, on the product's half of the row.
   *
   * The whole of what this package knows about a tool call is the protocol's
   * ({@link ToolFrame}); what a card SAYS about one — which of the product's
   * own things it is about, what it was asked to do, what came back — is the
   * product's reading of that frame, and it is the one thing a generic JSON
   * card cannot be made into without the product's own words.
   *
   * `held` is what this same call was last read as, because the adapter does
   * not send a call's input and its answer on the same frame: the arming frame
   * carries the input and the settling frame the answer, so a reading made
   * from either alone is missing the half the other had. The reader folds the
   * two — it, not this package, knows which fields a later frame may take back
   * — and what it answers is both the row's new `extra` and the `held` of the
   * next frame. `undefined` is "nothing to say about this call", which is what
   * lets a background task's own report stay a report rather than minting a
   * card for a call nobody made.
   *
   * TWO HALVES, because two different things are true of a product's fields.
   * `extra` is the ordinary one: the newest frame wins. `untilNamed` is taken
   * only while the row has no name of its own — an engine's raw spelling of a
   * call, say — because a frame that arrives later with the friendly title
   * must not drag a second spelling along with it.
   *
   * Cleared with the conversation, for the reason the client's own registry
   * is: a call id is only ever looked up inside the session that minted it,
   * and a daemon meant to run for weeks must not keep every call it ever saw.
   */
  readonly readCall: (
    frame: ToolFrame,
    held: RowPatch<Row, "tool"> | undefined,
  ) => ToolReading<Row> | undefined;
  /**
   * ... AND WHEN A CALL'S ROW MAY BE RENAMED after it has already been named,
   * or omitted for "never".
   *
   * Never is the rule a title needs: a title is a display string an agent may
   * rewrite mid-call, so the first frame that carries one picks it and no
   * later frame moves it. A product whose engines have one shape more — a raw
   * label first and the row's real name a frame later, with the ownership —
   * answers the new title for that one case and `undefined` for every other.
   */
  readonly retitle?: TranscriptOptions<Row>["retitle"];
  /**
   * WHAT A NEW SESSION DOES TO THE TRANSCRIPT — the first of the three
   * policies, and the one the other two lean on.
   *
   * `"divide"` — one transcript, two conversations, with a BREAK row between
   * them saying the agent's memory was reset. What was said before it stays
   * exactly where it was; the product declares a row of kind `divider` and
   * draws it as the rule across the page.
   *
   * `"clear"` — the rows go. A panel that holds its conversation only in
   * memory has nothing to divide, and a break above an empty transcript is a
   * rule drawn across nothing.
   */
  readonly whenNewSession: "divide" | "clear";
  /**
   * ... AND HOW THE ROWS ARE NUMBERED, which is the same question asked of
   * the numbers rather than of the rows.
   *
   * `"continues"` — the numbering runs on for the life of the process, and
   * the first row minted here sorts just after the highest `seq` the caller
   * already holds ({@link resumedSeq}). A product that WRITES its rows to a
   * store needs both: a wipe must not mint a `seq` a restored row already has.
   *
   * `"restarts"` — a wipe starts the numbering again and the first row of a
   * conversation is zero. A product whose panel is the only copy reads a row's
   * `seq` as "how many rows are older than this one", and that count is wrong
   * from the first row if the numbers began anywhere else.
   */
  readonly numbering: "continues" | "restarts";
  /**
   * ... AND WHAT A CONVERSATION THE AGENT CANNOT COME BACK TO DOES.
   *
   * `"fresh"` — open a new one in its place, with the break and a line
   * carrying the agent's own sentence for why. The id is a string the product
   * wrote down for a store the agent has since forgotten; the agent REFUSED,
   * which is the protocol's own proof that it is there and talking, and a
   * product whose conversation outlives the agent's memory of it would rather
   * keep talking.
   *
   * `"report"` — open nothing. The refusal stands as the refusal it is, this
   * harness comes up with it published, and the caller decides. A product
   * whose panel is the only copy of the conversation does not silently get a
   * different one.
   */
  readonly whenLoadRefused: "fresh" | "report";
  /**
   * ... AND WHAT A REPLAY'S FRAMES DO.
   *
   * `"drop"` — counted and thrown away. `session/load` re-emits every message
   * of the conversation before it answers, and a product that persists its own
   * rows already holds them in a richer form; folding the replay in would mint
   * a second, poorer copy of every row on screen.
   *
   * `"keep"` — folded in like any other frame, which is how a product with no
   * record of its own gets a resumed conversation back on screen at all.
   */
  readonly whenReplayed: "drop" | "keep";
  /**
   * WHEN THE CALLER STOPS WANTING THIS BRING-UP, and why — the signal aborts
   * while the agent is still being started or the conversation opened, and
   * the process is stopped with `reason` before anything more happens.
   *
   * A product that starts a conversation for a reader who may leave before
   * it is up (a tab that re-subscribes, then goes) needs the open NOT to
   * happen: an open probes the product's servers and spends the agent's
   * memory of the conversation, for nobody. Absent for a caller that always
   * waits for its bring-up.
   */
  readonly abandonWhen?: {
    readonly signal: AbortSignal;
    readonly reason: StopReason;
  };
  readonly onChange: (change: HarnessChange<Row>) => void;
}

/**
 * WHAT A HARNESS CAN ANSWER FOR — the conversation, and nothing a caller
 * already knows.
 *
 * Every field here is a fact this end learned from the agent or minted about
 * its own rows. What a product keeps BESIDE a conversation — which install it
 * is, what the agent is called, the directory it was started in, whatever its
 * host is watching, whatever it could not read off its own disk — is the
 * caller's, and a harness that published any of it would be overwriting the
 * caller's own answer with a copy of it.
 *
 * Typed with `@kolu/acp/wire`'s shapes, which is what makes it publishable:
 * every product that draws a conversation draws these same words.
 */
export interface HarnessState {
  readonly phase: Phase;
  readonly sessionId: string | null;
  readonly model: Model | null;
  readonly usage: Usage | null;
  readonly options: ReadonlyArray<Setting>;
  readonly commands: ReadonlyArray<Command>;
  readonly servers: ReadonlyArray<Server>;
  readonly watching: ReadonlyArray<Watching>;
  /** Every question still waiting on a human, in the order it was asked. */
  readonly openAsks: ReadonlyArray<string>;
  readonly signIn: SigningIn | null;
  /** THE WAYS IN the agent advertised at the handshake, whether or not a
   *  sign-in is on screen. `signIn` is the row a panel DRAWS and exists only
   *  while there is something to draw; this is the standing fact a `/login`
   *  button is drawn (or not drawn) from, and an agent that offered nothing is
   *  an empty list rather than a button that refuses. */
  readonly methods: ReadonlyArray<AuthMethod>;
  readonly identity: AuthStatus | null;
  /** A conversation the agent would not OPEN, in the agent's own words. */
  readonly refusal: string | null;
  /** The agent's OWN NAME for the conversation that is open, or `null` while
   *  it has named none. It goes with the conversation: a title left standing
   *  over the next one names a chat nobody is in. */
  readonly title: string | null;
  /** Whether a message may be STEERED into the turn that is running. */
  readonly steers: boolean;
  /** ... and whether the agent HOLDS a message sent while a turn is running
   *  and runs it next, as it said at the handshake. The other half of the same
   *  question, and a different answer: an agent that queues loses nothing when
   *  somebody sends mid-turn, and an agent that does not is one a composer
   *  must not leave a person typing into. */
  readonly queues: boolean;
  /** When the turn in flight began, or `null` while nothing is running. */
  readonly busySince: string | null;
  /** Whether the standing prompt has gone out under a message of THIS
   *  session. Published because it is the one fact a caller must remember for
   *  the harness that replaces this one ({@link HarnessOptions.taught}) — a
   *  conversation taught twice is the standing prompt arriving in the middle
   *  of a chat. */
  readonly taught: boolean;
}

/**
 * WHAT MOVED — the three things a reader of a conversation can be told.
 *
 * Rows travel as the deltas a caller folds into its own map, because a
 * streaming answer is one row and six hundred pieces and publishing the whole
 * of it per piece is quadratic in the length of the answer. State travels
 * whole, because it is small and a patch of it would be a second thing to get
 * right.
 *
 * AND A TURN SAYS HOW IT ENDED, once, when it ends. The rows and the state
 * both move while a turn runs, and neither of them answers "what became of
 * the message I sent" — a caller that wanted to know had to read the English
 * of a notice row, which is a panel pattern-matching sentences this package
 * writes. So the ending is reported as a value: which row's turn it was, how
 * it ended, the sentence when there is one, and whether the agent said
 * anything at all while it ran.
 */
export type HarnessChange<Row extends AnyRow> =
  | { readonly kind: "state"; readonly state: HarnessState }
  | {
      readonly kind: "rows";
      readonly upserts: ReadonlyArray<Row>;
      readonly removes: ReadonlyArray<string>;
      readonly appends: ReadonlyArray<{
        of: string;
        at: number;
        text: string;
      }>;
    }
  | TurnEnded;

/**
 * HOW ONE TURN ENDED — reported when it does, and never read off prose.
 *
 *   - `"ended"` — the agent finished it. `why` is `null`.
 *   - `"cancelled"` — somebody stopped it, which the agent answers as the
 *     turn's own stop reason. Nothing failed.
 *   - `"refused"` — the agent said no, with its sentence in `why`.
 *   - `"unanswered"` — nothing came back at all (the pipe died, a deadline
 *     passed), with this end's sentence in `why`.
 *
 * `silent` is whether the agent said NOTHING while the turn ran — no prose, no
 * tool call, no plan, no question. It is a fact about a turn that ENDED (an
 * agent that refused said nothing by definition), and what a product does
 * about it is its own: a panel that wants to say "the turn said nothing"
 * needs to be told, and counting rows afterwards cannot tell a silent turn
 * from one whose words went to a different row.
 */
export interface TurnEnded {
  readonly kind: "turn";
  /** The row the turn was the delivery of — a person's message, or the row a
   *  turn this end started was drawn as. */
  readonly row: string;
  readonly outcome: "ended" | "cancelled" | "refused" | "unanswered";
  readonly why: string | null;
  readonly silent: boolean;
}

export interface Harness<Row extends AnyRow> {
  readonly state: () => HarnessState;
  /** Whether there is still a subprocess to talk to. Asked by a caller that
   *  would otherwise replace a harness over `phase`, which answers a different
   *  question: an agent that refused the open for want of a signature is
   *  OFFLINE and ALIVE, and replacing it kills the process the sign-in it is
   *  offering has to run against. */
  readonly alive: () => boolean;
  readonly rows: () => ReadonlyArray<Row>;
  prompt(
    said: PersonSaid<Row>,
    /** STEER rather than queue: put the words INTO the turn that is running.
     *  Honoured only while a turn runs and `state.steers` holds; a steer the
     *  agent did not take goes out as a plain prompt, so the words are never
     *  lost — except when the turn it was aimed at was CANCELLED under it,
     *  which is a refusal rather than a fresh turn nobody asked for. */
    steer: boolean,
  ): Promise<{ rowId: string }>;
  /**
   * A TURN THIS END STARTS — nobody typed it. kolu's Conductor is woken by a
   * terminal that stopped, asked, or died; another product has its own reason.
   *
   * A turn like any other: it mints a row, waits behind whatever is running,
   * can be cancelled, refused or go unanswered, and the row carries every mark
   * a person's message does. What differs is whose words they are, which is
   * the row the caller hands over and nothing else here — and `text`, which is
   * what goes to the agent under them.
   */
  hostTurn(row: RowContent<Row>, text: string): Promise<{ rowId: string }>;
  /**
   * SEND THAT MESSAGE AGAIN — the one already on screen, not a second copy of
   * it.
   *
   * A message the agent refused is still the person's, marked as not
   * delivered, and *send again* is a gesture about THAT row: prompting afresh
   * would mint a second row saying the same thing and leave the first one
   * standing as a failure nobody can clear. So the row is re-sent where it is
   * — queued, taken, sent or refused again exactly as a new prompt would be —
   * and `body` is what goes on the wire, because a product that composed
   * something above the words the first time composes it again, and a file the
   * row names may live somewhere else now.
   *
   * REFUSED for a row that is not waiting to be sent: one that went, one
   * nothing ever answered about (an agent that went quiet may have the message
   * already, so a second copy is a duplicate offered to somebody with no way
   * to tell), and one this conversation never minted.
   */
  sendAgain(
    rowId: string,
    body: string,
    files: ReadonlyArray<PromptFile>,
  ): Promise<void>;
  /**
   * THE CONVERSATIONS THIS ENGINE HAS STORED for the directory it is working
   * in, newest first — asked of the agent that is ALREADY RUNNING.
   *
   * A picker that spawned an adapter of its own to ask would be a second
   * process, a second handshake and a second credential read, for a list the
   * process on the other end of this pipe can answer. Refused the way every
   * other verb is when there is nothing to ask.
   */
  sessions(): Promise<ReadonlyArray<Stored>>;
  /** MOVE TO ANOTHER STORED CONVERSATION in this same process — the agent is
   *  already running and already signed in, and a product that switched by
   *  replacing the harness would pay for a spawn and a handshake to read a
   *  conversation this one can load. What it does to the transcript, to a
   *  refusal and to the replay is the policies'
   *  ({@link HarnessOptions.whenNewSession},
   *  {@link HarnessOptions.whenLoadRefused},
   *  {@link HarnessOptions.whenReplayed}), exactly as at the bring-up. */
  loadSession(id: string): Promise<void>;
  cancel(): Promise<void>;
  answer(
    askId: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ): Promise<boolean>;
  /** RUN ONE OF THE ADVERTISED METHODS. `signed-in` means the credential
   *  store was written and NOTHING here changed conversation: the caller
   *  restarts this harness so the new process's `initialize` reads it. */
  signIn(method: string): Promise<SignedIn>;
  /** A person asks to sign in — signed in or not. Puts the sign-in row on
   *  screen unless one is there already. */
  askSignIn(): void;
  signInInput(text: string): Promise<void>;
  signInCancel(): Promise<boolean>;
  setOption(id: string, value: string): Promise<void>;
  /** A new conversation at the agent, and whatever
   *  {@link HarnessOptions.whenNewSession} says that does to the rows. */
  newSession(): Promise<void>;
  /** The wipe: a new session at the agent AND this conversation's rows
   *  deleted, `held` naming the ones the caller holds that the harness never
   *  minted. */
  clearSession(held: ReadonlyArray<string>): Promise<void>;
  /** End the conversation and the process, saying WHY: the client writes the
   *  reason on the line that records the agent's exit, which is how a person
   *  reading a log tells a reaped conversation from a crash. */
  stop(reason: StopReason): Promise<void>;
}

/**
 * How a sign-in ended. Four values because four different things are done about
 * them and none is a failure of the VERB: `signed-in` is a credential store
 * that was written and so a caller that must restart this agent against it,
 * `failed` is already on screen as the attempt's own output, `cancelled` is
 * somebody's press with nothing written and needs nobody told, and `attached`
 * is a second press that joined the first.
 */
export type { SignedIn };

/** ONE STORED CONVERSATION this engine remembers for the directory it works
 *  in — the client's own shape, re-offered here because {@link
 *  Harness.sessions} answers in it and a picker must be able to name what it
 *  draws without reaching past this door. */
export type { Stored };

/** WHERE A PRODUCT KEEPS "which conversation was this directory's" between
 *  one serve and the next, and WHAT IT ASKS A MACHINE for the hands a session
 *  is handed — the client's own ports, re-offered here because an `adopt`
 *  opening takes the first and {@link HarnessOptions.probes} takes the
 *  second. */
export type { Memory, Probe };

/** WHY A CONVERSATION WAS STOPPED, in the client's own closed vocabulary —
 *  re-offered here because {@link Harness.stop} takes it. */
export type { StopReason };

const ATTACHMENT_CAP = 10 * 1024 * 1024;
const PROMPT_CAP = 20 * 1024 * 1024;

const CANCELLED_UNDER_IT =
  "the turn these words were steered into was cancelled, so they were not sent";

/**
 * Spawn the agent, shake hands, and open the conversation — all of it, before
 * this promise settles.
 *
 * BRING-UP IS THE CALLER'S CALL and the whole of it is here, because the steps
 * are one sequence whose order is a protocol fact and a harness handed back
 * half-open would be a caller's problem to discover. ONE `try` covers the lot,
 * so a refusal or a deadline anywhere in it stops the subprocess instead of
 * leaving an adapter — and whatever it spawned — running for every retry. The
 * refusal is PUBLISHED before it is thrown: a caller's exception reaches a log,
 * and the panel somebody is looking at would otherwise be an idle composer
 * over a host with no agent on it.
 *
 * THE ONE REFUSAL THAT RESOLVES is `auth`. Nobody being signed in is the
 * failure with something to DO about it, the process that refused is the
 * process a sign-in runs against, and so the harness comes back alive and
 * offline with `state.signIn` filled in. The conversation itself waits for the
 * caller's RESTART ({@link Harness.signIn}): a signature reaches an adapter
 * only through a fresh `initialize`, so a conversation opened by this process
 * after a sign-in would be one the new credential never reached.
 */
export const startHarness = async <Row extends AnyRow>(
  options: HarnessOptions<Row>,
): Promise<Harness<Row>> => {
  const { leg, adapter, log } = options;

  const logging = Logger.layer([
    Logger.make<unknown, void>(({ message, logLevel, fiber }) => {
      const about = fiber.getRef(References.CurrentLogAnnotations);
      const said = Array.isArray(message)
        ? message.map((one) => String(one)).join(" ")
        : String(message);
      if (logLevel === "Error" || logLevel === "Fatal") log.error(about, said);
      else if (logLevel === "Warn") log.warn(about, said);
      else log.info(about, said);
    }),
  ]);

  const refusalOf = (cause: unknown): Error => {
    if (cause instanceof AnswerRefused) {
      return new HarnessRefused(
        `that answer was not sent: ${cause.reason}`,
        "no",
        false,
      );
    }
    if (!(cause instanceof AgentGone)) {
      return new HarnessUnavailable(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    if (cause.gone !== "refused") return new HarnessUnavailable(cause.why);
    return new HarnessRefused(
      cause.why,
      cause.auth === true
        ? "signed-out"
        : cause.account === true
          ? "account"
          : "no",
      cause.missing === true,
    );
  };

  const run = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
    const outcome = await Effect.runPromise(
      Effect.provide(
        Effect.provideService(
          Effect.result(effect),
          References.MinimumLogLevel,
          "Info",
        ),
        logging,
      ),
    );
    if (outcome._tag === "Failure") throw refusalOf(outcome.failure);
    return outcome.success;
  };

  const BREAK_KIND = "divider";

  const hostRows = new Set<string>();

  const transcript = new Transcript<Row>({
    from: options.resumedSeq ?? 0,
    now: Date.now,
    endsWithDivider: options.resumedEndsWithDivider ?? false,
    deliverable: (row) => row.kind === "user" || hostRows.has(row.id),
    countersSurviveClear: options.numbering === "continues",
    firstSeq: options.numbering === "continues" ? "afterFrom" : "zero",
    ...(options.retitle === undefined ? {} : { retitle: options.retitle }),
    ...(options.whenNewSession === "clear" ? {} : { breakKind: BREAK_KIND }),
  });
  const PLAN_KEY = "plan";

  const refusalMark = (
    key: string,
    signIn: SignInReason | "no",
  ): Partial<Row> =>
    signIn === "no" || transcript.entries().get(key)?.kind !== "user"
      ? {}
      : ({ signIn } as unknown as Partial<Row>);

  const sameSteps = (held: unknown, steps: ReadonlyArray<PlanStep>): boolean =>
    JSON.stringify(held) === JSON.stringify(steps);

  const plan = (steps: ReadonlyArray<PlanStep>): Change<Row> => {
    const closed = transcript.stopSaying();
    if (steps.length === 0) {
      if (!transcript.entries().has(PLAN_KEY)) return closed;
      transcript.forget(PLAN_KEY);
      return plus(closed, transcript.remove(PLAN_KEY));
    }
    const held = transcript.entries().get(PLAN_KEY);
    if (
      held?.kind === "plan" &&
      "steps" in held &&
      sameSteps(held.steps, steps)
    ) {
      return closed;
    }
    return plus(
      closed,
      transcript.upsert(PLAN_KEY, {
        kind: "plan",
        steps,
      } as unknown as RowContent<Row>),
    );
  };

  const turns = new Turns<undefined>();
  const readings = new Map<string, RowPatch<Row, "tool">>();

  let advertisedSteering = false;
  let queuesWhenBusy = false;
  /**
   * Whether THIS CONVERSATION has ever held a message behind a running turn.
   *
   * IT WITHDRAWS THE INTERRUPTION, and it is the one rule in this file that
   * works around somebody else's defect rather than stating a rule of its own.
   * The pinned adapter leaves a turn's `session/prompt` unanswered forever if a
   * `_session/steering` is injected into any turn of a session that has once
   * held a queued one — the steered words run and stream, and only a cancel
   * ends the turn. Measured on the wire by olai, which is where the latch and
   * its measurement come from (`packages/acp-claude/adapter/patches/README.md`).
   */
  let queuedHere = false;
  let busyAt: number | null = null;
  let cancelSaid = false;

  let stopped = false;
  let dead = false;
  let taught = options.taught;
  let sessionId: string | null = null;
  let title: string | null = null;
  let heard = 0;
  let model: Model | null = null;
  let usage: Usage | null = null;
  let identity: AuthStatus | null = null;
  let refusal: string | null = null;
  let commands: ReadonlyArray<Command> = [];
  let settings: ReadonlyArray<Setting> = [];
  let labels: ReadonlyMap<string, string> = new Map();
  let openAsks: ReadonlyArray<string> = [];
  let replaying = false;
  let replayed = 0;

  const countDroppedReplayFrame = (): boolean => {
    if (!replaying || options.whenReplayed === "keep") return false;
    replayed += 1;
    return true;
  };

  let carries = { image: false, embeddedContext: false };
  let servers: ReadonlyArray<Server> = [];

  let onOffer: ReadonlyArray<AuthMethod> = [];
  let agentSaid: string | null = null;
  let cause: SigningIn["cause"] | null = null;
  let attempt: SigningIn["attempt"] = null;
  let cancelling = false;

  const storedAt = `the signature is read from ${options.configDir}`;

  const nothingOffered = (): string =>
    `${agentSaid ?? "the agent"} offered no way to sign in: the handshake` +
    ' asked for terminal auth (`auth.terminal` and `_meta["terminal-auth"]`)' +
    " and the reply carried no `authMethods`. The adapter is" +
    ` \`${adapter.command}\`, and ${storedAt}`;

  const askedFor = (): SigningIn["cause"] => ({
    kind: "person",
    said: `${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
  });

  const signInRow = (): SigningIn | null =>
    cause === null && attempt === null
      ? null
      : {
          cause: cause ?? askedFor(),
          methods: onOffer,
          attempt,
        };

  const offerSignIn = (why: string): void => {
    if (attempt !== null) return;
    cause = {
      kind: "agent",
      why: `${why} — ${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
    };
  };

  const withdrawSignIn = (): void => {
    if (attempt !== null) return;
    cause = null;
  };

  const emit = (event: AgentEvent): void => {
    switch (event._tag) {
      case "said": {
        if (countDroppedReplayFrame()) return;
        if (event.text === "") return;
        heard += 1;
        report(transcript.say(event.text));
        return;
      }
      case "userSaid":
        if (countDroppedReplayFrame()) return;
        report(transcript.userSaid(event.text));
        return;
      case "tool":
        if (countDroppedReplayFrame()) return;
        heard += 1;
        writeTool(event);
        return;
      case "plan":
        if (countDroppedReplayFrame()) return;
        heard += 1;
        report(plan(event.entries));
        return;
      case "toolTerminals": {
        if (countDroppedReplayFrame()) return;
        const panes = options.readCall(
          {
            mcp: [],
            asksThroughForm: undefined,
            input: undefined,
            answer: undefined,
            called: undefined,
            row: undefined,
            reply: undefined,
            terminals: event.terminals,
          },
          readings.get(event.id),
        );
        if (panes?.extra === undefined) return;
        readings.set(event.id, panes.extra);
        report(transcript.tool(event.id, { extra: panes.extra }));
        publish();
        return;
      }
      case "commands":
        commands = event.commands;
        publish();
        return;
      case "settings":
        settings = event.settings;
        publish();
        return;
      case "models":
        labels = new Map(event.choices.map((one) => [one.value, one.name]));
        return;
      case "model":
        model = event.id === null ? null : modelOf(event.id, event.name);
        publish();
        return;
      case "usage":
        usage = event.usage;
        publish();
        return;
      case "servers":
        servers = event.servers;
        publish();
        return;
      case "identity":
        writeIdentity(event.identity);
        return;
      case "signIn":
        attempt = attemptOf(event.signIn);
        publish();
        return;
      case "advertised":
        advertisedSteering = event.steers;
        queuesWhenBusy = event.queues;
        carries = {
          image: event.image,
          embeddedContext: event.embeddedContext,
        };
        onOffer = event.methods;
        agentSaid = event.agent;
        return;
      case "asked":
        heard += 1;
        openAsks = [...openAsks, event.id];
        report(
          transcript.ask(
            event.id,
            event.message,
            event.fields,
            event.link,
            event.parent === undefined ? null : toolKey(event.parent),
          ),
        );
        publish();
        return;
      case "askSettled":
        openAsks = openAsks.filter((one) => one !== event.id);
        report(transcript.settleAsk(event.id, event.outcome));
        publish();
        return;
      case "session":
        title = event.title;
        enter(event.id);
        return;
      case "sessionTitled":
        title = event.title;
        publish();
        return;
      case "opening":
        return;
      case "sessionOver":
        leaving();
        return;
      case "replayStarted":
        replaying = true;
        replayed = 0;
        return;
      case "replayEnded":
        replaying = false;
        if (replayed > 0) {
          log.info(
            { session: sessionId, frames: replayed },
            "dropped a session's replay; the caller's own rows are the record",
          );
        }
        replayed = 0;
        return;
      case "gone": {
        dead = true;
        leaving();
        identity = null;
        report(transcript.abandon());
        if (!stopped) notice(event.why);
        publish();
        return;
      }
      case "trouble":
        notice(event.message);
        return;
    }
    event satisfies never;
  };

  const writeTool = (event: Extract<AgentEvent, { _tag: "tool" }>): void => {
    const said = options.readCall(
      {
        mcp: event.mcp,
        asksThroughForm: event.asksThroughForm,
        input: event.rawInput,
        answer: event.answer,
        called: event.called,
        row: event.row,
        reply: event.reply,
        terminals: undefined,
      },
      readings.get(event.id),
    );
    if (said?.extra !== undefined) readings.set(event.id, said.extra);
    report(
      transcript.tool(event.id, {
        title: event.title,
        status: event.status,
        detail: event.detail,
        asked: event.asked,
        progress: event.progress,
        diffs: event.diffs,
        locations: event.locations,
        extra: said?.extra,
        untilNamed: said?.untilNamed,
        parent: event.parent === undefined ? undefined : toolKey(event.parent),
        spawned: event.spawned,
        armed: event.armed,
        provisional: event.provisional,
      }),
    );
    publish();
  };

  const writeIdentity = (next: AuthStatus | null): void => {
    identity = next;
    // THE AGENT'S OWN WORD IS WHAT OFFERS THE SIGN-IN. `kind: "none"` is a
    // KNOWN logged-out agent — ACP's `-32000` is not the only way one asks
    // for a signature, and against the pair kolu ships it is not even the
    // first: MEASURED against the pinned adapter 0.81.2 over
    // agent-distro's `claude` 2.1.319, a signed-out `session/new`
    // SUCCEEDS, this notification arrives saying `{kind:"none"}`, and the
    // refusal does not come until the TURN. An offer published only by a
    // refused OPEN therefore never appeared at all on the one pair this
    // build pins: the panel drew a composer over an agent that could not
    // answer, and the sign-in button said the agent had offered nothing.
    if (next === null) {
      publish();
      return;
    }
    if (next.kind === "none") offerSignIn(next.label);
    else withdrawSignIn();
    publish();
  };

  const agentAttempt = (
    said: Extract<SignIn, { kind: "agent" }>,
  ): SigningIn["attempt"] => ({
    method: said.method,
    state: said.why === null ? "running" : "failed",
    output: said.why ?? "",
    code: null,
    link: said.link,
  });

  const terminalAttempt = (
    said: Exclude<SignIn, { kind: "agent" | "choosing" }>,
  ): SigningIn["attempt"] => ({
    method: said.method,
    state: said.running ? "running" : said.code === 0 ? "succeeded" : "failed",
    output: said.why === null ? said.output : `${said.output}${said.why}\n`,
    code: said.running ? null : said.code,
    link: null,
  });

  const attemptOf = (said: SignIn | null): SigningIn["attempt"] => {
    if (said === null || said.kind === "choosing") return null;
    return said.kind === "agent" ? agentAttempt(said) : terminalAttempt(said);
  };

  const report = (change: Change<Row>): void => {
    if (stopped || !says(change)) return;
    options.onChange({
      kind: "rows",
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends.map((one) => ({ ...one })),
    });
  };

  const state = (): HarnessState => ({
    phase:
      !alive() || refusal !== null
        ? "offline"
        : openAsks.length > 0
          ? "asking"
          : turns.busy
            ? "working"
            : sessionId === null
              ? "starting"
              : "idle",
    sessionId,
    model,
    usage,
    options: settings,
    commands,
    servers,
    watching: transcript.watching(),
    openAsks,
    signIn: signInRow(),
    methods: onOffer,
    identity,
    refusal,
    title,
    steers: advertisedSteering && !queuedHere,
    queues: queuesWhenBusy,
    busySince: busyAt === null ? null : new Date(busyAt).toISOString(),
    taught,
  });

  const publish = (): void => {
    if (stopped) return;
    options.onChange({ kind: "state", state: state() });
  };

  const notice = (text: string): void => {
    report(transcript.add("notice", text));
  };

  const alive = (): boolean => !dead && !stopped;

  const modelOf = (id: string, name: string | null): Model => ({
    id,
    name: name ?? id,
    window: leg.models?.windowIn?.(labels, id) ?? null,
  });

  const leaving = (): void => {
    if (sessionId === null) return;
    sessionId = null;
    title = null;
    readings.clear();
    hostRows.clear();
    openAsks = [];
    taught = false;
    queuedHere = false;
    usage = null;
    commands = [];
  };

  const enter = (id: string): void => {
    sessionId = id;
    refusal = null;
    if (identity?.kind !== "none") withdrawSignIn();
    publish();
  };

  const load = async (id: string): Promise<void> => {
    try {
      await run(agent.loadSession(id));
      return;
    } catch (lost) {
      if (!(lost instanceof HarnessRefused) || lost.signIn === "signed-out") {
        throw lost;
      }
      if (options.whenLoadRefused === "report") throw lost;
      log.warn(
        { session: id, why: lost.why },
        "the remembered conversation is not one this agent has; opening a new one",
      );
      await freshInstead(lost.why);
    }
  };

  const freshInstead = async (why: string): Promise<void> => {
    const mark = transcript.writeBreak("new session");
    report(mark.change);
    notice(
      `the previous conversation could not be resumed, so this is a new one: ${why}`,
    );
    try {
      await run(agent.newSession);
    } catch (cause) {
      if (mark.key !== null) report(transcript.remove(mark.key));
      throw cause;
    }
  };

  const openConversation = async (): Promise<void> => {
    if (options.opens.kind === "resume") {
      await load(options.opens.id);
      return;
    }
    if (options.opens.kind === "adopt") {
      await run(agent.boot);
      return;
    }
    await run(agent.newSession);
  };

  const refusedOpen = (cause: unknown): boolean => {
    refusal = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof HarnessRefused && cause.signIn === "signed-out") {
      offerSignIn(cause.why);
      publish();
      return true;
    }
    publish();
    return false;
  };

  const memory: Memory =
    options.opens.kind === "adopt"
      ? options.opens.memory
      : { recall: Effect.succeed(null), remember: () => Effect.void };
  let wanted: string | null = options.model ?? null;
  const models: Models = options.models ?? {
    read: () => Effect.succeed(wanted),
    write: (_to, chosen) =>
      Effect.sync(() => {
        wanted = chosen;
      }),
  };

  const agent: Agent = await run(
    make({
      id: options.agent,
      leg,
      command: adapter.command,
      args: adapter.args,
      ...(adapter.env === undefined ? {} : { env: adapter.env }),
      ...(adapter.unset === undefined ? {} : { unset: adapter.unset }),
      cwd: options.cwd,
      tools: () => options.mcpServers,
      ...(options.probes === undefined ? {} : { probes: options.probes }),
      memory,
      models,
      onEvent: emit,
    }),
  );
  const abandon = options.abandonWhen;
  const abandoned = (): boolean => abandon?.signal.aborted === true;
  const stopAbandoned = (): void => {
    if (abandon === undefined) return;
    void run(agent.stopWithReason(abandon.reason)).catch((cause: unknown) => {
      log.warn({ cause }, "an abandoned bring-up did not stop cleanly");
    });
  };
  const leaveAbandoned = async (): Promise<never> => {
    if (abandon !== undefined) await run(agent.stopWithReason(abandon.reason));
    throw new HarnessUnavailable("the conversation was abandoned");
  };
  abandon?.signal.addEventListener("abort", stopAbandoned, { once: true });
  try {
    if (abandoned()) await leaveAbandoned();
    await openConversation();
  } catch (cause) {
    if (abandoned()) await leaveAbandoned();
    if (!refusedOpen(cause)) {
      await run(agent.stop);
      throw cause;
    }
  } finally {
    abandon?.signal.removeEventListener("abort", stopAbandoned);
  }
  if (abandoned()) await leaveAbandoned();

  const bodyOf = (body: string): string => {
    if (taught) return body;
    taught = true;
    return options.teaching === "" ? body : `${options.teaching}\n\n${body}`;
  };

  const runTurn = async (
    ticket: Turn<NoPayload>,
    body: string,
    blocks: ReadonlyArray<ContentBlock>,
  ): Promise<void> => {
    const quietAt = heard;
    let outcome: TurnEnded["outcome"] = "ended";
    let why: string | null = null;
    try {
      const stopReason = await run(agent.prompt(blocks));
      report(transcript.sent(ticket.key));
      if (stopReason === "cancelled") {
        outcome = "cancelled";
        if (!ticket.stopped || !cancelSaid) {
          cancelSaid = ticket.stopped;
          notice("the turn was cancelled");
        }
      }
    } catch (cause) {
      why = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof HarnessRefused) {
        outcome = "refused";
        why = cause.why;
        report(
          transcript.refused(
            ticket.key,
            refusalMark(ticket.key, cause.signIn),
            body,
          ),
        );
        if (cause.signIn === "signed-out") {
          offerSignIn(cause.why);
          publish();
        }
      } else {
        outcome = "unanswered";
        if (heard === quietAt) report(transcript.unanswered(ticket.key));
      }
      notice(`the turn could not be run: ${why}`);
    } finally {
      const last = turns.leave(ticket);
      if (last) busyAt = null;
      report(last ? transcript.settle() : transcript.stopSaying());
      report(transcript.taken(ticket.key));
      const head = turns.head;
      if (head !== null) report(transcript.taken(head.key));
      publish();
      if (!stopped) {
        options.onChange({
          kind: "turn",
          row: ticket.key,
          outcome,
          why,
          silent: heard === quietAt,
        });
      }
    }
  };

  const openTurn = (key: string): Turn<NoPayload> => {
    if (!turns.busy) busyAt = Date.now();
    return turns.open(key);
  };

  const send = (
    key: string,
    body: string,
    blocks: ReadonlyArray<ContentBlock>,
  ): void => {
    const waiting = turns.busy;
    if (waiting) queuedHere = true;
    if (waiting) report(transcript.queued(key));
    report(transcript.begins());
    const ticket = openTurn(key);
    publish();
    void runTurn(ticket, body, blocks);
  };

  type SteerOutcome = "absorbed" | "send-as-prompt";

  const steerInto = async (
    key: string,
    body: string,
    aimed: Turn<NoPayload>,
  ): Promise<SteerOutcome> => {
    if (leg.steering === null) return "send-as-prompt";
    try {
      const went = await run(agent.steer(body));
      if (went === "taken") return "absorbed";
      if (aimed.stopped) {
        report(transcript.refused(key));
        notice(CANCELLED_UNDER_IT);
        publish();
        return "absorbed";
      }
      return "send-as-prompt";
    } catch (cause) {
      if (cause instanceof HarnessRefused) {
        report(transcript.refused(key, refusalMark(key, cause.signIn), body));
        if (cause.signIn === "signed-out") offerSignIn(cause.why);
      } else {
        report(transcript.unanswered(key));
      }
      notice(
        `the message could not be steered into the turn: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      publish();
      return "absorbed";
    }
  };

  const inConversation = (): void => {
    if (!alive() || sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
  };

  /**
   * An agent that advertises steering but promises NO queue takes a busy send
   * through steering whether it was asked for or not — a second ordinary
   * prompt can overwrite such an agent's pending turn, leaving the first
   * request unanswered forever (olai measured it on opencode).
   */
  const prompt = async (
    said: PersonSaid<Row>,
    steer: boolean,
  ): Promise<{ rowId: string }> => {
    inConversation();
    const attached = await blocksOf(said.files, carries);
    const { key, change } = transcript.user(said.text, said.extra);
    report(change);
    const aimed = turns.head;
    const body = bodyOf(said.body);
    if (
      (steer || !queuesWhenBusy) &&
      aimed !== null &&
      advertisedSteering &&
      !queuedHere &&
      // A MESSAGE WITH FILES IS NEVER STEERED. A steer carries ONE text block
      // and nothing else — that is the shape of the steering extension — so
      // steering a message with a picture on it would deliver the words and
      // silently drop the picture, which is the one failure a composer with a
      // chip in it must never have. It goes the ordinary way instead: the
      // blocks below carry every attachment, and a turn in flight means it
      // queues rather than vanishes.
      attached.length === 0
    ) {
      publish();
      const went = await steerInto(key, body, aimed);
      if (went === "absorbed") return { rowId: key };
    }
    send(key, body, [{ type: "text", text: body }, ...attached]);
    return { rowId: key };
  };

  const hostTurn = async (
    row: RowContent<Row>,
    text: string,
  ): Promise<{ rowId: string }> => {
    inConversation();
    const { key, change } = transcript.write(row);
    hostRows.add(key);
    report(change);
    const body = bodyOf(text);
    send(key, body, [{ type: "text", text: body }]);
    return { rowId: key };
  };

  const sendAgain = async (
    rowId: string,
    body: string,
    files: ReadonlyArray<PromptFile>,
  ): Promise<void> => {
    inConversation();
    if (transcript.undelivered(rowId) === null) {
      throw new HarnessRefused(
        "that message is not waiting to be sent again",
        "no",
        false,
      );
    }
    const attached = await blocksOf(files, carries);
    report(transcript.sent(rowId));
    send(rowId, body, [{ type: "text", text: body }, ...attached]);
  };

  const sessions = async (): Promise<ReadonlyArray<Stored>> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    return await run(agent.sessions);
  };

  const cancel = async (): Promise<void> => {
    if (!alive() || sessionId === null) return;
    turns.stopping();
    cancelSaid = false;
    try {
      await run(agent.cancel);
    } finally {
      publish();
    }
  };

  const answer = async (
    askId: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ): Promise<boolean> => await run(agent.answer(askId, answers));

  const setOption = async (id: string, value: string): Promise<void> => {
    inConversation();
    await run(agent.setSetting(sessionId ?? "", id, settingValueOf(id, value)));
    publish();
  };

  const newSession = async (): Promise<void> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    if (options.whenNewSession === "clear") {
      await clearSession([]);
      return;
    }
    const mark = transcript.writeBreak("new session");
    report(mark.change);
    try {
      await run(agent.newSession);
    } catch (cause) {
      if (mark.key !== null) report(transcript.remove(mark.key));
      refusedOpen(cause);
      throw cause;
    }
    publish();
  };

  const clearSession = async (held: ReadonlyArray<string>): Promise<void> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    try {
      await run(agent.newSession);
    } catch (cause) {
      refusedOpen(cause);
      throw cause;
    }
    report(transcript.clear(held));
    publish();
  };

  const loadSession = async (id: string): Promise<void> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    if (options.whenNewSession === "clear") report(transcript.clear([]));
    const mark = transcript.writeBreak("new session");
    report(mark.change);
    try {
      await load(id);
    } catch (cause) {
      if (mark.key !== null) report(transcript.remove(mark.key));
      refusedOpen(cause);
      throw cause;
    }
    publish();
  };

  /**
   * HOW A SETTING'S NEW VALUE GOES ON THE WIRE, which is two shapes and not
   * one: a select's value is the row's own id and a BOOLEAN is a boolean — the
   * pinned Claude adapter refuses the string `"true"` for its FAST MODE toggle
   * outright (`Invalid value for config option fast`).
   */
  const settingValueOf = (id: string, value: string): string | boolean => {
    const option = settings.find((one) => one.id === id);
    if (option?.kind !== "boolean") return value;
    if (value !== "true" && value !== "false") {
      throw new HarnessRefused(
        `\`${option.name}\` is a switch and takes \`true\` or \`false\`, not \`${value}\``,
        "no",
        false,
      );
    }
    return value === "true";
  };

  const signIn = async (method: string): Promise<SignedIn> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    cancelling = false;
    const ended = await run(agent.signIn(method));
    const said = cancelling && ended !== "signed-in" ? "cancelled" : ended;
    cancelling = false;
    if (ended === "signed-in") cause = null;
    publish();
    return said;
  };

  const signInCancel = async (): Promise<boolean> => {
    cancelling = true;
    const stopping = await run(agent.signInCancel);
    if (cause?.kind === "person") {
      cause = null;
      publish();
      return true;
    }
    publish();
    return stopping;
  };

  const stop = async (reason: StopReason): Promise<void> => {
    stopped = true;
    await run(agent.stopWithReason(reason));
    leaving();
    identity = null;
    turns.drain();
    busyAt = null;
    options.onChange({ kind: "state", state: state() });
  };

  publish();

  return {
    state,
    alive,
    rows: () => transcript.rows(),
    prompt,
    hostTurn,
    sendAgain,
    sessions,
    cancel,
    answer,
    signIn,
    askSignIn: () => {
      if (stopped || signInRow() !== null) return;
      cause = askedFor();
      publish();
    },
    signInInput: async (text: string) => {
      await run(agent.signInInput(text));
    },
    signInCancel,
    setOption,
    newSession,
    loadSession,
    clearSession,
    stop,
  };
};

const blocksOf = async (
  attachments: ReadonlyArray<PromptFile>,
  carries: { readonly image: boolean; readonly embeddedContext: boolean },
): Promise<ReadonlyArray<ContentBlock>> => {
  let total = 0;
  const blocks: Array<ContentBlock> = [];
  for (const one of attachments) {
    if (one.bytes > ATTACHMENT_CAP) {
      throw new HarnessRefused(
        `\`${one.name}\` is ${sized(one.bytes)} and the most one attachment` +
          ` may carry is ${sized(ATTACHMENT_CAP)}`,
        "no",
        false,
      );
    }
    total += one.bytes;
    if (total > PROMPT_CAP) {
      throw new HarnessRefused(
        `that is ${sized(total)} of attachments and the most one message may` +
          ` carry is ${sized(PROMPT_CAP)}`,
        "no",
        false,
      );
    }
    blocks.push(await blockOf(one, carries));
  }
  return blocks;
};

const blockOf = async (
  one: PromptFile,
  carries: { readonly image: boolean; readonly embeddedContext: boolean },
): Promise<ContentBlock> => {
  const mimeType = essenceOf(one.mimeType);
  if (mimeType.startsWith("image/")) {
    if (!carries.image) {
      throw new HarnessRefused(
        `this agent did not advertise \`image\` at \`initialize\`, so` +
          ` \`${one.name}\` cannot be sent to it`,
        "no",
        false,
      );
    }
    return {
      type: "image",
      data: (await bytesOf(one)).toString("base64"),
      mimeType,
    };
  }
  if (TEXT_LIKE[mimeType] === true || mimeType.startsWith("text/")) {
    if (!carries.embeddedContext) {
      throw new HarnessRefused(
        `this agent did not advertise \`embeddedContext\` at \`initialize\`,` +
          ` so the contents of \`${one.name}\` cannot be sent to it`,
        "no",
        false,
      );
    }
    return {
      type: "resource",
      resource: {
        uri: uriOf(one),
        mimeType,
        text: (await bytesOf(one)).toString("utf8"),
      },
    };
  }
  return {
    type: "resource_link",
    uri: uriOf(one),
    name: one.name,
    mimeType,
    size: one.bytes,
  };
};

const TEXT_LIKE: Readonly<Record<string, true>> = {
  "application/json": true,
  "application/xml": true,
  "application/javascript": true,
};

const essenceOf = (mimeType: string): string =>
  (mimeType.split(";")[0] ?? mimeType).trim().toLowerCase();

const bytesOf = async (one: PromptFile): Promise<Buffer> => {
  try {
    return await readFile(one.path);
  } catch {
    throw new HarnessRefused(
      `\`${one.name}\` is no longer readable at \`${one.path}\`, so there are` +
        ` no bytes to send`,
      "no",
      false,
    );
  }
};

const uriOf = (one: PromptFile): string => `file://${one.path}`;

const sized = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MiB`;
