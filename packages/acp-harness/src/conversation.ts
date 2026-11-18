/**
 * THE CONVERSATION: one session at a time, its turns, its rows and its state.
 *
 * The protocol is `@kolu/acp-client`'s: it owns the process, the handshake,
 * which session is open, the questions on the wire, the sign-in attempt and
 * the reading of every frame, and it says what the agent said through one
 * closed union of events. What is HERE is everything a kolu conversation is
 * made of on top of that — which session is opened or resumed and what the
 * transcript does about it, the turns in flight, the steering latch, the rows
 * a person reads, and the state a panel is a view of. A caller gets something
 * it can prompt, cancel, answer, sign in and stop, plus the rows and the state
 * through the one callback it gave at construction.
 *
 * The three rules that are KOLU'S rather than the protocol's, and so are here
 * rather than in the client:
 *
 *   - **a conversation the agent cannot come back to opens a fresh one**, with
 *     the break that says the agent's memory was reset and a line carrying the
 *     agent's own sentence for why. The client refuses the load and says so;
 *     what is done about it is the product's, because what it costs is a
 *     transcript the product owns.
 *   - **a replay's history is dropped and its news is kept.** `session/load`
 *     re-emits every message of the conversation before it answers, and kolu
 *     already holds those rows in a richer form — they carry readings no
 *     agent's transcript has. What the same stream says about the session AS
 *     IT STANDS is kept, because nobody else knows it.
 *   - **an attachment is a content block, with the caps.** What a file becomes
 *     on the wire, what the agent said it can take, and the two sentences that
 *     refuse one that is too big are all decisions about a person's message.
 *
 * ... and **what a row carries**: what was READ, never the raw protocol value
 * — which kolu terminal a call is about is {@link ./kolu.ts}'s reading, made
 * out of the input and the answer the client hands over.
 *
 * WHAT IS DELIBERATELY NOT HERE: a client-side prompt queue. Every send is a
 * plain prompt, busy or idle, and the agent holds a busy one behind the turn
 * it is working on — the queue is the AGENT'S and nothing is held on this
 * side. The row's own *queued* mark is kolu's fact about its own conversation
 * ({@link ./turns.ts}) and not a second queue.
 */

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
  type SignedIn,
} from "@kolu/acp-client";
import type { Adapter, Leg } from "@kolu/acp/engine";
import type {
  AskAnswer,
  AuthMethod,
  AuthStatus,
  Command,
  PlanStep,
  Server,
  Setting,
  SignIn,
  SignInReason,
  Usage,
} from "@kolu/acp/wire";
import { Effect, Logger, References } from "effect";
import { aboutBlock } from "./aboutBlock.ts";
import { Fleet, koluCallOf, refineKoluCall } from "./kolu.ts";
import type {
  ConductorAttachment,
  ConductorKoluCall,
  ConductorMention,
  ConductorModel,
  ConductorRow,
  ConductorSignIn,
  ConductorState,
  ConductorWakeEvent,
} from "./rows.ts";
import { type Change, plus, says, Transcript } from "./transcript.ts";
import { type Turn, Turns } from "./turns.ts";

/** kolu keeps nothing in a turn's payload: its turns are `async` functions, and
 *  a cancel reaches them through the agent rather than through a handle here. */
type NoPayload = undefined;

// ── what a caller hands over, and what it gets back ────────────────────

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
  constructor(why: string, signIn: SignInReason | "no") {
    super(why);
    this.name = "HarnessRefused";
    this.why = why;
    this.signIn = signIn;
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
 *  This is how kolu hands over the FLEET: one face, in kolu-server's own
 *  process, covering every host's terminals. A stdio server could only ever be
 *  a program on ONE machine, which is the shape the fleet grew out of.
 *  `headers` is where its bearer token rides — the endpoint is on loopback,
 *  and loopback is not a gate. */
export type HttpServer = Extract<Handed, { readonly kind: "http" }>;

export interface HarnessOptions {
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
  /** What this conversation's hands are. Each is either a program to spawn on
   *  this machine or an HTTP endpoint already serving — kolu hands exactly one
   *  of the second kind, its fleet face. */
  readonly mcpServers: ReadonlyArray<StdioServer | HttpServer>;
  /** The standing prompt, which rides under the first message of every
   *  session. The WORDS are the caller's — they name kolu's own MCP verbs, and
   *  this package knows no tool but the protocol's. */
  readonly teaching: string;
  readonly log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
  /** Resume this session id instead of opening a fresh one — padi's last
   *  conversation, read back out of its own store. */
  readonly resume?: string | null;
  /**
   * The highest `seq` among the rows the caller has ALREADY PERSISTED for this
   * conversation, so this harness mints its ids and its ordering past them.
   *
   * A RESUMED conversation is two records of one thing: the caller's rows, and
   * the replay `session/load` re-emits. The caller's are the ones kept — they
   * carry kolu's own readings, which the agent's transcript knows nothing
   * about — so what this number buys is that nothing minted here can collide
   * with one of them or sort above it. Absent means an empty transcript, which
   * is what a fresh conversation is.
   */
  readonly resumedSeq?: number;
  /**
   * Whether the LAST row the caller has persisted for this conversation is a
   * break. A replacement harness builds a fresh transcript, and the rule that
   * refuses a second `— NEW SESSION —` beside the first one can only read its
   * own rows — so without this a `newSession` right after a respawn minted a
   * break beside padi's, every time.
   */
  readonly resumedEndsWithDivider?: boolean;
  /**
   * The terminals the caller REMEMBERS this conversation was working with, as
   * the fleet stood when it was last persisted.
   *
   * Membership otherwise accrues only from tool-call frames, and a resumed
   * conversation's frames are history the caller already holds — so a harness
   * that started from an empty fleet would publish one on its first breath and
   * the caller would write that emptiness back over its own record. A resumed
   * conversation would forget every terminal it had been working with, once,
   * permanently. Seeded here; new terminals still join as they are touched.
   */
  readonly fleet?: ReadonlyArray<string>;
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
  readonly onChange: (change: HarnessChange) => void;
}

/** WHAT A HARNESS CAN ANSWER FOR: padi's whole conductor state minus the
 *  seven facts it would only be echoing back. `install` and `agentName` are
 *  the ENGINE's, settled when kolu was built, and `cwd` is the directory padi
 *  handed in — a harness that published them would be overwriting the caller's
 *  own answer with a copy of it. `seen`, `work` and `held` are the SERVER's in
 *  the same way: how each watched terminal stands and since when, how the
 *  watched terminals group into the pieces of work that ARE the membership
 *  list, and whose news is waiting for the turn to end, are facts about
 *  kolu's watch rather than about the conversation — this end only ever
 *  learns of them as a {@link Harness.wake}. `unreadable` is the server's
 *  too, and the furthest from a harness of all of them: it says which
 *  REMEMBERED RECORD would not decode, which is a fact about a file this end
 *  has never seen — and about a conversation that could not be started
 *  BECAUSE of it, so there is no harness to answer for it. `workAsks` is the
 *  server's as well: the questions kolu put about its pieces of work, read
 *  off records this end never holds. */
export type HarnessState = Omit<
  ConductorState,
  | "install"
  | "agentName"
  | "cwd"
  | "seen"
  | "work"
  | "held"
  | "unreadable"
  | "workAsks"
>;

/**
 * WHAT MOVED — the two things a reader of a conversation can be told, and
 * deliberately not one.
 *
 * Rows travel as the deltas padi folds into its own map, because a streaming
 * answer is one row and six hundred pieces and publishing the whole of it per
 * piece is quadratic in the length of the answer. State travels whole, because
 * it is small and a patch of it would be a second thing to get right.
 */
export type HarnessChange =
  | { readonly kind: "state"; readonly state: HarnessState }
  | {
      readonly kind: "rows";
      readonly upserts: ReadonlyArray<ConductorRow>;
      readonly removes: ReadonlyArray<string>;
      readonly appends: ReadonlyArray<{
        of: string;
        at: number;
        text: string;
      }>;
    };

export interface Harness {
  readonly state: () => HarnessState;
  /** Whether there is still a subprocess to talk to. Asked by a caller that
   *  would otherwise replace a harness over `phase`, which answers a different
   *  question: an agent that refused the open for want of a signature is
   *  OFFLINE and ALIVE, and replacing it kills the process the sign-in it is
   *  offering has to run against. */
  readonly alive: () => boolean;
  readonly rows: () => ReadonlyArray<ConductorRow>;
  prompt(
    text: string,
    mentions: ReadonlyArray<ConductorMention>,
    attachments: ReadonlyArray<ConductorAttachment>,
    /** STEER rather than queue: put the words INTO the turn that is running.
     *  Honoured only while a turn runs and `state.steers` holds; a steer the
     *  agent did not take goes out as a plain prompt, so the words are never
     *  lost — except when the turn it was aimed at was CANCELLED under it,
     *  which is a refusal rather than a fresh turn nobody asked for. */
    steer: boolean,
  ): Promise<{ rowId: string }>;
  /**
   * KOLU'S OWN LINE — a turn this end starts because a watched terminal
   * stopped, asked, or died.
   *
   * A turn like any other: it mints a row, waits behind whatever is running,
   * can be cancelled, refused or go unanswered, and the row carries every
   * mark a person's message does. What differs is whose words they are, which
   * is the row's kind and nothing else here.
   */
  wake(
    text: string,
    events: ReadonlyArray<ConductorWakeEvent>,
  ): Promise<{ rowId: string }>;
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
  newSession(): Promise<void>;
  /** The wipe: a new session at the agent AND this conversation's rows
   *  deleted, `held` naming the ones the caller holds that the harness never
   *  minted. */
  clearSession(held: ReadonlyArray<string>): Promise<void>;
  stop(): Promise<void>;
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

// ── the constants this conversation is ─────────────────────────────────

/** THE MOST ONE ATTACHMENT MAY WEIGH, and the most a prompt may carry in all.
 *  Both are refused with a sentence naming the limit rather than trimmed or
 *  dropped: an image that silently did not travel is a person asking about a
 *  picture the model never saw, and the only honest versions of "too big" are
 *  a number and a no. The bytes counted are the ones the row declares, which
 *  is the number the panel drew beside the chip. */
const ATTACHMENT_CAP = 10 * 1024 * 1024;
const PROMPT_CAP = 20 * 1024 * 1024;

/** What a message steered into a turn SOMEBODY STOPPED is told.
 *
 *  The agent's answer is *nothing to steer*, which it also gives for a turn
 *  that simply finished — and those two want opposite things done. A turn that
 *  ended on its own makes these words an ordinary prompt; a turn a person
 *  cancelled makes starting a fresh one with them this end un-cancelling on
 *  their behalf. So the words stay on the row, theirs to send again. */
const CANCELLED_UNDER_IT =
  "the turn these words were steered into was cancelled, so they were not sent";

/** WHICH AGENT THIS IS, for the client's log lines and for the key its memory
 *  would be written under. One conversation per harness and one harness per
 *  conductor, so the name is what this conversation is FOR rather than a
 *  roster id — kolu runs exactly one. */
const AGENT_ID = "conductor";

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
export const startHarness = async (
  options: HarnessOptions,
): Promise<Harness> => {
  const { leg, adapter, log } = options;

  // ── the one place an Effect is run ───────────────────────────────────

  /**
   * THE CLIENT'S LOG LINES, forwarded to the one log this caller handed in.
   *
   * The client is written in Effect and says what it has to say through
   * `Effect.log*`, with the agent, the session and whatever else the line is
   * about as annotations — which is exactly the shape this caller's logger
   * takes (an object, then a message). So the layer is the translation and
   * nothing else.
   *
   * DEBUG IS NOT PRODUCED AT ALL rather than mapped onto `info`: the client
   * writes every line of the agent's stderr at DEBUG, and a door with three
   * levels has nowhere to put those but the operator's journal.
   */
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

  /**
   * HOW THE CLIENT'S REFUSALS REACH A CALLER OF THIS ONE.
   *
   * `refused` is the agent's own no — it answered, so the verb failed and the
   * conversation did not — and everything else is this end's nothing-happened
   * ({@link HarnessUnavailable}). The two extra things the client reads off a
   * rejection ride the refusal as the one mark a row can carry: ACP's `-32000`
   * is `signed-out`, and the agent's own data saying the ACCOUNT cannot run it
   * is `account`.
   *
   * An answer that did not FIT the question it was for is the other refusal
   * the client can give, and it is this end's own no: nothing went on the wire,
   * and the question is still up.
   */
  const refusalOf = (cause: unknown): Error => {
    if (cause instanceof AnswerRefused) {
      return new HarnessRefused(
        `that answer was not sent: ${cause.reason}`,
        "no",
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
    );
  };

  /**
   * THE BOUNDARY, and the only one: the client's verbs are Effects and this
   * package's door is promises, so every one of them crosses here — with the
   * logger layer that carries its lines to the caller's log, and with its
   * failure turned into the refusal a caller of this package reads.
   *
   * ONE helper rather than a run per verb, which is what keeps the edge
   * countable (`packages/tests/governance/runEdges.ts`): a second site would
   * be a second place the layer could be forgotten.
   */
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

  // ── the state this conversation is ───────────────────────────────────

  /** The rows, minted PAST what is already persisted elsewhere: padi hands in
   *  the highest `seq` it holds, so nothing this process mints can collide
   *  with a restored row's id or sort above it — and whether the last of those
   *  rows is a break, which is the one thing a fresh transcript cannot see
   *  about the conversation it is continuing. */
  const transcript = new Transcript<ConductorRow>({
    from: options.resumedSeq ?? 0,
    now: Date.now,
    endsWithDivider: options.resumedEndsWithDivider ?? false,
    // TWO KINDS A TURN IS THE DELIVERY OF here: what a person typed, and kolu's
    // own wake — both can wait behind another turn, be refused, or go
    // unanswered, and both carry the marks that say so.
    deliverable: (row) => row.kind === "user" || row.kind === "wake",
    countersSurviveClear: true,
    breakKind: "divider",
  });
  /**
   * THE BREAK BETWEEN TWO CONVERSATIONS — the row that says the agent's memory
   * was reset, and says nothing else.
   *
   * Answers with its key because the break is minted BEFORE the next
   * conversation is open — so that the new one's own rows sort under it — and an
   * open that then fails has reset nothing a reader needs told: the caller takes
   * the row back out again ({@link Transcript.remove}).
   *
   * A SECOND BREAK WITH NOTHING BETWEEN IS NOT MINTED. Two of them in a row say
   * exactly what one says, and the stack of them is what a caller retrying a
   * refused open leaves behind: four `— NEW SESSION —` lines with no
   * conversation between them.
   */
  const divider = (
    text: string,
  ): { readonly key: string | null; readonly change: Change<ConductorRow> } =>
    transcript.endsWithBreak()
      ? { key: null, change: { upserts: [], removes: [], appends: [] } }
      : transcript.write({ kind: "divider", text });

  /** The one key a plan row lives at, for the life of a session. */
  const PLAN_KEY = "plan";

  /**
   * THE REFUSAL MARK A ROW CAN CARRY, and none where it cannot.
   *
   * `extra` is the PRODUCT's half of a refusal, and kolu's half — which sign-in
   * would fix the message — belongs to words a PERSON typed. A wake is kolu's
   * own line, drawn full width with no *send again* under it, and its row schema
   * has no `signIn`: passing one would write a field the contract does not
   * declare, which the encoder then refuses — the whole frame dropped, every row
   * in it gone.
   */
  const refusalMark = (
    key: string,
    signIn: SignInReason | "no",
  ): { signIn?: SignInReason } =>
    signIn === "no" || transcript.entries().get(key)?.kind !== "user"
      ? {}
      : { signIn };

  /**
   * THE AGENT'S PLAN — one row at one key for the life of a session, because
   * each `plan` update REPLACES the whole thing and an empty update removes it.
   *
   * KOLU'S OWN ROW KIND, which is why it lives here rather than in the shared
   * transcript: olai's chat panel has no plan row at all, and a method for one
   * in the class would be a product's word in a class that names neither.
   */
  const plan = (steps: ReadonlyArray<PlanStep>): Change<ConductorRow> => {
    const closed = transcript.stopSaying();
    if (steps.length === 0) {
      if (!transcript.entries().has(PLAN_KEY)) return closed;
      transcript.forget(PLAN_KEY);
      return plus(closed, transcript.remove(PLAN_KEY));
    }
    const held = transcript.entries().get(PLAN_KEY);
    // A REPEAT IS NOT A SECOND REPORT, the same rule every other row obeys: the
    // plan is the one row a frame replaces whole, so its content is the whole of
    // what a frame says.
    if (
      held?.kind === "plan" &&
      JSON.stringify(held.steps) === JSON.stringify(steps)
    ) {
      return closed;
    }
    return plus(closed, transcript.upsert(PLAN_KEY, { kind: "plan", steps }));
  };

  const turns = new Turns<undefined>();
  const fleet = new Fleet(options.fleet ?? []);
  /** The accumulated kolu reading per call id — see `refineKoluCall`. Cleared
   *  with the conversation, for the reason the client's own registry is: a call
   *  id is only ever looked up inside the session that minted it, and a daemon
   *  meant to run for weeks must not keep every call it ever saw. */
  const koluReadings = new Map<string, ConductorKoluCall>();

  /**
   * WHAT THIS AGENT SAID ABOUT TAKING A MESSAGE MID-TURN, read at the
   * handshake and never again — `steering.advertised` and `queues`, which are
   * questions about the agent rather than about a request, and a control has
   * to be drawn (or not drawn) before anybody presses it.
   *
   * Both start FALSE, which is the honest state of an agent that has not
   * spoken yet: a composer offering an interruption an agent never claimed is
   * a person pressing a button that will be refused.
   */
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
   *
   * WHAT IT COSTS is said out loud because it is not small: after one message
   * sent while a turn was running, this conversation offers no steer for the
   * rest of its life. It is the SESSION the adapter poisons, so a new one
   * clears it ({@link leaving}) — and a turn kolu's own wake started is a turn
   * like any other, which means a person typing behind one spends the latch
   * exactly as they would behind anybody else's.
   */
  let queuedHere = false;
  /** When the turns in flight went from none to some — the instant every
   *  reader's "working · 2m" counts from, and `null` while nothing runs. Kept
   *  rather than derived because it is a CLOCK reading: the oldest ticket
   *  knows which row it is for and not when it started. */
  let busyAt: number | null = null;

  let stopped = false;
  /** Whether the subprocess has gone. The client reports it once, and the
   *  verbs below read it rather than asking the client to start another: a
   *  conversation whose agent died is REPLACED by the caller, with the rows it
   *  is holding and the session it was in — a harness that quietly spawned a
   *  second process would be deciding that for it. */
  let dead = false;
  let taught = false;
  /** The conversation this harness is in now, as the client last said. */
  let sessionId: string | null = null;
  let model: ConductorModel | null = null;
  let usage: Usage | null = null;
  let identity: AuthStatus | null = null;
  let refusal: string | null = null;
  let commands: ReadonlyArray<Command> = [];
  let settings: ReadonlyArray<Setting> = [];
  /** The picker as value → label, for the reading the header draws its name
   *  and its context size from ({@link modelOf}). */
  let labels: ReadonlyMap<string, string> = new Map();
  /** Every question still waiting, in the order it was asked — what the
   *  state's `openAsks` is, kept here because the row a question is drawn as
   *  is this half's. */
  let openAsks: ReadonlyArray<string> = [];
  /** Whether the client is replaying a conversation at us, and how many frames
   *  of it have been dropped ({@link emit}'s transcript arms). */
  let replaying = false;
  let replayed = 0;

  /**
   * WHAT THIS AGENT SAID IT CAN BE SENT, beyond the text every agent takes —
   * read off `initialize` and nothing else.
   *
   * ACP makes an image block and an embedded resource OPT-IN at the agent's
   * end: an adapter that never advertised `image` is one an image is not legal
   * to send to, and sending one anyway is a turn that fails somewhere inside
   * the agent with a sentence nobody wrote for a person. So an attachment the
   * agent cannot take is refused HERE, naming the capability
   * ({@link blocksOf}), and both start FALSE because nothing is advertised
   * before the handshake.
   */
  let carries = { image: false, embeddedContext: false };
  /**
   * THE ROSTER: what this conversation was handed, and what has been said
   * about it since — the client's own answer, composed off the very list it
   * put on the wire and refined by whatever the agent then said about each
   * row. Empty until the first open, which is when a session is handed
   * anything at all.
   */
  let servers: ReadonlyArray<Server> = [];

  // ── the sign-in row, composed from three sources ─────────────────────

  /**
   * THE SIGN-IN, as kolu draws it: WHY it is on screen, what is on offer, and
   * the attempt in flight.
   *
   * THREE SOURCES AND ONE ROW. The methods are the handshake's; the attempt is
   * the client's, which is the half holding a process and a question; the
   * CAUSE is kolu's own — a refusal this end met, or a person who pressed the
   * button. The client's `signIn` event and this row are two layers on purpose
   * and are not merged: one is what the agent is doing, the other is what this
   * panel is asking about.
   */
  let onOffer: ReadonlyArray<AuthMethod> = [];
  /** What the agent calls itself, for the dead end's own sentence. */
  let agentSaid: string | null = null;
  let cause: ConductorSignIn["cause"] | null = null;
  let attempt: ConductorSignIn["attempt"] = null;
  /** Whether the attempt in flight is one a PERSON asked to stop — read where
   *  the attempt ENDS, so a cancel is not reported as a failure. */
  let cancelling = false;

  /** Where this host keeps the signature, in every sentence that names it. */
  const storedAt = `the signature is read from ${options.configDir}`;

  /**
   * ... AND WHAT A SIGN-IN WITH NOTHING TO PRESS HAS TO SAY FOR ITSELF.
   *
   * An agent that will not work and advertises no way to fix it is a dead
   * end, and the only useful thing left is the whole of what was asked and
   * what came back: which adapter was spawned, what it calls itself, what
   * kolu asked for in the handshake, and the store it reads.
   */
  const nothingOffered = (): string =>
    `${agentSaid ?? "the agent"} offered no way to sign in: kolu's handshake` +
    ' asked for terminal auth (`auth.terminal` and `_meta["terminal-auth"]`)' +
    " and the reply carried no `authMethods`. The adapter is" +
    ` \`${adapter.command}\`, and ${storedAt}`;

  /** What a person is told when THEY ask to sign in. */
  const askedFor = (): ConductorSignIn["cause"] => ({
    kind: "person",
    said: `${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
  });

  /** THE ROW, composed: or `null` when there is nothing to draw. */
  const signInRow = (): ConductorSignIn | null =>
    cause === null && attempt === null
      ? null
      : {
          cause: cause ?? askedFor(),
          methods: onOffer,
          attempt,
        };

  /** THE AGENT'S OWN ACCOUNT puts the offer up, unless an attempt is already
   *  running: that row belongs to the attempt. */
  const offerSignIn = (why: string): void => {
    if (attempt !== null) return;
    cause = {
      kind: "agent",
      why: `${why} — ${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
    };
  };

  /** THE OFFER COMES DOWN, whoever put it up, unless an attempt is running: an
   *  agent that now names an account has answered the question the row was
   *  asking, whether the agent or a person asked it. */
  const withdrawSignIn = (): void => {
    if (attempt !== null) return;
    cause = null;
  };

  // ── saying what moved ────────────────────────────────────────────────

  /**
   * THE DOOR THE CLIENT REPORTS THROUGH.
   *
   * Everything that arrives from the agent — a notification, a question it is
   * waiting on, the session it opened, the process's own exit — reaches this
   * half as one member of the client's closed union, and this has one case for
   * each member. What is inside each case is what a kolu conversation does
   * about it.
   *
   * SYNCHRONOUS on purpose: a row is still reported before state is published,
   * and nothing puts a promise hop between a message arriving and the work its
   * arrival does.
   */
  const emit = (event: AgentEvent): void => {
    switch (event._tag) {
      case "said": {
        if (replaying) {
          replayed += 1;
          return;
        }
        if (event.text !== "") report(transcript.say(event.text));
        return;
      }
      case "userSaid":
        // A PERSON'S WORDS COME BACK ONLY IN A REPLAY, and a replay is history
        // this caller already holds in a richer form.
        replayed += 1;
        return;
      case "tool":
        if (replaying) {
          replayed += 1;
          return;
        }
        writeTool(event);
        return;
      case "plan":
        if (replaying) {
          replayed += 1;
          return;
        }
        report(plan(event.entries));
        return;
      case "toolTerminals":
        // The panes an agent's own terminal calls would be drawn in. kolu's
        // conductor draws none: its terminals are the fleet's, which a card
        // names through kolu's own reading of a call ({@link ./kolu.ts}).
        return;
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
        // THE READING IS THE PANEL'S: the client says which id the agent named
        // and what its picker calls it, and the size comes out of the same
        // rows ({@link modelOf}).
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
        // Read once, at the handshake. The two mid-turn claims and what a
        // message may carry are assigned without a publish — the open that
        // follows publishes the state that carries them — and the methods are
        // what a sign-in row is drawn from, which no refusal has composed yet.
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
        openAsks = [...openAsks, event.id];
        report(
          transcript.ask(
            event.id,
            event.message,
            event.fields,
            event.link,
            event.parent ?? null,
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
        enter(event.id);
        return;
      case "sessionTitled":
        // The agent's own name for the conversation. kolu's conductor has one
        // conversation per host and names it after the host.
        return;
      case "opening":
        // Which conversation is being opened, said before the request that can
        // be refused. This half asked for it, so it already knows.
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
        // ONE LINE FOR THE WHOLE REPLAY, and it is a count rather than a
        // transcript: a conversation of six hundred frames logging each of
        // them is how a resume becomes the longest thing in the file.
        if (replayed > 0) {
          log.info(
            { session: sessionId, frames: replayed },
            "dropped a session's replay; the persisted rows are the record",
          );
        }
        replayed = 0;
        return;
      case "gone": {
        dead = true;
        // Before anything else: a form left live on a dead wire is a control
        // that does nothing, and pressing it is how a person finds out.
        leaving();
        identity = null;
        report(transcript.abandon());
        if (!stopped) notice(event.why);
        publish();
        return;
      }
      case "trouble":
        // SOMETHING FAILED WHERE NOBODY WAS WAITING — a permission mode the
        // agent would not take, a model it would not go back to, a question
        // this panel cannot draw. Already logged by the client; this is the
        // sentence a person reads, and a notice is where kolu says one.
        notice(event.message);
        return;
    }
    // A MEMBER ADDED WITHOUT A CASE FAILS HERE, which is what keeps this door
    // and the union one fact rather than two.
    event satisfies never;
  };

  /** ... and the row a tool frame becomes, which is the conversation's. */
  const writeTool = (event: Extract<AgentEvent, { _tag: "tool" }>): void => {
    const call = event.mcp[0];
    // A TOOL WE CANNOT POSITIVELY NAME GETS NO READING: the client recognises
    // a call only where the leg matched this agent's own spelling against a
    // server WE handed over, so a kolu reading is minted for a kolu tool and
    // for nothing that merely looks like one.
    const seen =
      call === undefined
        ? null
        : koluCallOf(call.tool, event.rawInput, event.answer);
    // ACCUMULATED, not per-frame: the arming frame carries the input and the
    // settling frame carries the answer, so a card built from either alone is
    // missing the half the other had. `refineKoluCall` keeps whichever frame
    // said something, because a frame refines and never retracts.
    const kolu = refineKoluCall(koluReadings.get(event.id) ?? null, seen);
    if (kolu !== null) koluReadings.set(event.id, kolu);
    if (kolu !== null && fleet.touch(kolu)) publish();
    // THE PRODUCT'S HALF OF THE ROW: which server and tool a recognised call
    // named, whether its question reaches a person as a form, and kolu's own
    // reading of it. The transcript copies these and reads none of them —
    // and a frame that says none of them passes `undefined`, which is what
    // lets a background task's own report stay a report rather than minting a
    // row for a call nobody made.
    const extra =
      call === undefined && event.asksThroughForm === undefined && kolu === null
        ? undefined
        : {
            server: call?.server,
            tool: call?.tool,
            // Absent rather than `false`: every optional field of a tool row
            // means UNCHANGED, and a call whose name has not arrived yet is
            // not a call anything has called ordinary.
            asksThroughForm: event.asksThroughForm,
            ...(kolu === null ? {} : { kolu }),
          };
    report(
      transcript.tool(event.id, {
        title: event.title,
        status: event.status,
        detail: event.detail,
        asked: event.asked,
        progress: event.progress,
        diffs: event.diffs,
        locations: event.locations,
        extra,
        parent: event.parent,
        spawned: event.spawned,
        armed: event.armed,
        provisional: event.provisional,
      }),
    );
    publish();
  };

  /** The agent's own word about who it is, and what it does to the sign-in
   *  row. */
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
    //
    // AND IT IS WHAT WITHDRAWS IT: an agent that now names an account has
    // answered the question the row was asking, and a sign-in row over a
    // signed-in agent is a lie a person would press.
    //
    // A PROCESS THAT HAS STOPPED REPORTING says nothing either way: `null` is
    // an agent that has not spoken, which is not a claim about a signature.
    if (next === null) {
      publish();
      return;
    }
    if (next.kind === "none") offerSignIn(next.label);
    else withdrawSignIn();
    publish();
  };

  /**
   * THE ATTEMPT IN FLIGHT, as the row draws it — out of the client's own
   * account of what the sign-in is doing.
   *
   * A TERMINAL method is a process whose output IS the row, so the row says
   * what it has printed and whether it is still running; exit 0 is the whole
   * of "it worked" for every one of these CLIs. An AGENT method has no
   * process: what this end runs is the wait, so it is `running` until the
   * agent answers, and a page it sent somebody to rides the row.
   */
  const attemptOf = (said: SignIn | null): ConductorSignIn["attempt"] => {
    if (said === null) return null;
    // A CHOOSER IS NOT AN ATTEMPT: nothing has been pressed, so nothing is
    // running. kolu draws that state as the row's own CAUSE — a person asked
    // to sign in — and the methods beside it are what they are choosing from.
    if (said.kind === "choosing") return null;
    if (said.kind === "agent") {
      return {
        method: said.method,
        state: said.why === null ? "running" : "failed",
        output: said.why ?? "",
        link:
          said.link === null
            ? null
            : { url: said.link.url, host: said.link.host },
      };
    }
    return {
      method: said.method,
      state: said.running
        ? "running"
        : said.code === 0
          ? "succeeded"
          : "failed",
      // A COMMAND THAT NEVER RAN printed nothing, and the reason it did not is
      // the only output there is.
      output: said.why === null ? said.output : `${said.output}${said.why}\n`,
      link: null,
    };
  };

  const report = (change: Change<ConductorRow>): void => {
    // NOTHING IS SAID AFTER A STOP. A turn still on the wire when the daemon
    // let go ends a moment later — settling its paragraph, withdrawing its
    // questions, writing a notice — and every one of those rows is one the
    // caller writes to disk for a conversation it has already finished with.
    // {@link stop} sends the single frame a shutdown owes a reader by hand.
    if (stopped || !says(change)) return;
    options.onChange({
      kind: "rows",
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends.map((one) => ({ ...one })),
    });
  };

  const state = (): HarnessState => ({
    // PHASE IS DERIVED, never kept: every fact it reports is already written
    // down somewhere else, and a flag beside them is a second answer free to
    // drift from the first. A refused open is OFFLINE with the process still
    // up, which is the one case `alive` alone gets wrong.
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
    fleet: [...fleet.ids()],
    signIn: signInRow(),
    identity,
    refusal,
    // BOTH HALVES IN ONE BIT, so a composer derives nothing: the agent's leg
    // advertised steering at the handshake, AND this conversation has never
    // held a message behind a running turn ({@link queuedHere}).
    steers: advertisedSteering && !queuedHere,
    busySince: busyAt === null ? null : new Date(busyAt).toISOString(),
  });

  const publish = (): void => {
    if (stopped) return;
    options.onChange({ kind: "state", state: state() });
  };

  const notice = (text: string): void => {
    report(transcript.add("notice", text));
  };

  /** Whether there is still a subprocess to talk to. */
  const alive = (): boolean => !dead && !stopped;

  /** The model row, under whichever id has just named one — the picker's
   *  confirmed value, or the live id the agent's own channel reported. ONE
   *  reader for both, because they are the same question asked at two moments
   *  — and a header that took the NAME from one and the SIZE from the other
   *  would be describing two conversations. */
  const modelOf = (id: string, name: string | null): ConductorModel => ({
    id,
    name: name ?? id,
    // A `window` of `null` is a REFUSAL rather than a failure: a leg's table
    // answers for the models its picker names and for nothing else, and naming
    // one five times the real size in the line you would read to decide
    // whether to compact is worse than naming nothing. A leg that declares no
    // `windowIn` at all reads the same way — `@kolu/acp` is shared vocabulary
    // and the member is optional precisely so a leg written before it existed
    // stays legal.
    window: leg.models?.windowIn?.(labels, id) ?? null,
  });

  // ── bringing it up ───────────────────────────────────────────────────

  /** The conversation is over — replaced, reloaded, or dead. Everything this
   *  half keeps about it goes; the client has already let go of its own. */
  const leaving = (): void => {
    // NOTHING TO LEAVE BEFORE THE FIRST OPEN. A bring-up's own `session/load`
    // says the last conversation is over before it opens one, and this harness
    // was in none — so acting on it here would throw away what the CALLER
    // seeded: the fleet it remembered, which accrues from frames a resume
    // replays and drops.
    if (sessionId === null) return;
    sessionId = null;
    fleet.clear();
    koluReadings.clear();
    openAsks = [];
    taught = false;
    // ... AND THE INTERRUPTION COMES BACK. The latch is about a SESSION the
    // adapter poisoned, not about the agent: a conversation that is over
    // cannot be hung by a steer into it, and the next one starts clean.
    queuedHere = false;
    usage = null;
    commands = [];
  };

  /** The harness is in this conversation now. */
  const enter = (id: string): void => {
    sessionId = id;
    refusal = null;
    // ... and there is nothing left to sign into — UNLESS the agent says there
    // is. This used to be unconditional, on the reasoning that a sign-in row
    // exists because an OPEN was refused: MEASURED, that is false for the pair
    // kolu ships, whose signed-out `session/new` succeeds. An open is no
    // longer evidence of a signature, so the offer stands until the agent's
    // own `_auth/status_update` stops saying `none`.
    if (identity?.kind !== "none") withdrawSignIn();
    publish();
  };

  /**
   * COME BACK TO A CONVERSATION — or, when the agent says there is no such
   * conversation, open one and SAY SO.
   *
   * TWO UNLIKE THINGS ARE SPELLED THE SAME WAY on this wire, and reading them
   * alike is what killed the adapter. "The agent is broken" is a conversation
   * the agent cannot open at all; "the id is unknown to this CLI" is a fact
   * about a string kolu wrote down, in kolu's own file, for a store the agent
   * has since forgotten (its config dir moved, its history was pruned, a
   * different `claude` answered). The agent REFUSED, which is the protocol's
   * own proof that it is there and talking. Killing it over a stale id and
   * spawning a replacement to read the same id again is a loop with a dead
   * panel at the end of it — four `the agent exited (code 0)` lines and no
   * conversation, which is where this came from.
   *
   * So a REFUSAL that is not an auth refusal falls through to one fresh
   * session, once, and nothing is retried. An AUTH refusal does NOT: `-32000`
   * says the agent will not open ANY conversation for want of a signature, and
   * a fresh session asked for in the same breath is the same refusal again —
   * that one keeps its offer of a sign-in ({@link refusedOpen}). Anything that
   * is not a refusal at all — a load that never answered, a pipe that died —
   * is the broken agent, and it goes out of here the way it always did.
   *
   * WHAT THE FALL-THROUGH KEEPS is the transcript: it is kolu's record of the
   * conversation, not the CLI's, and the rows in it are ours whatever the
   * agent remembers. What it adds is the one thing a reader cannot see
   * otherwise — the break where the resumed conversation could not be
   * ({@link divider}, the same mark a `newSession` mints and under the same
   * rules), and a line carrying the agent's own sentence for why.
   */
  const load = async (id: string): Promise<void> => {
    try {
      await run(agent.loadSession(id));
      return;
    } catch (lost) {
      if (!(lost instanceof HarnessRefused) || lost.signIn === "signed-out") {
        throw lost;
      }
      // NOTHING LEFT TO COME BACK TO: the id is spent, and the open this
      // harness was asked for is over — a later re-entry is the CALLER's
      // restart, with a fresh process and a fresh `resume`.
      log.warn(
        { session: id, why: lost.why },
        "the remembered conversation is not one this agent has; opening a new one",
      );
      await freshInstead(lost.why);
    }
  };

  /** The new conversation a lost one leaves behind, with the break and the
   *  sentence that account for it.
   *
   *  The mark comes BACK OUT if the fresh session will not open either, for
   *  {@link newSession}'s reason: a break that broke nothing is a rule drawn
   *  across a transcript where nothing happened, and a retry stacks them. The
   *  NOTICE stays — the conversation really was not resumed, and that is true
   *  whatever happens next. */
  const freshInstead = async (why: string): Promise<void> => {
    const mark = divider("new session");
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

  /** THE CONVERSATION THIS HARNESS WAS ASKED FOR — the one the caller named,
   *  or a fresh one. The BRING-UP's only, and called once: re-entering a
   *  conversation after that has exactly one owner, and it is the caller that
   *  restarts this harness (kolu-server's conductor) with the session it
   *  wants back on the new process's `resume`. A second door here — the one a
   *  sign-in used to open — is how a signature taken in a conversation the
   *  person had moved on from put them back in the one they left. */
  const openConversation = async (): Promise<void> => {
    const named = typeof options.resume === "string" ? options.resume : null;
    if (named !== null) await load(named);
    else await run(agent.newSession);
  };

  /**
   * WHAT A REFUSED OPEN LEAVES BEHIND, and whether anything is left to act on.
   *
   * Published rather than only thrown: a caller's error reaches a log, and the
   * panel a person is looking at would otherwise be an idle-looking composer
   * with no account of why nothing happens.
   *
   * `true` is the ONE refusal that keeps the subprocess: nobody is signed in,
   * which is ACP's own `-32000`, and the agent that refused is the agent the
   * sign-in has to run against. Killing it here is how the only remedy a
   * person is offered becomes unreachable.
   */
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

  /**
   * WHAT THIS HARNESS REMEMBERS, as the client's two memories.
   *
   * kolu remembers nothing HERE: padi holds the conversation's id and the
   * model a person chose, writes both to its own store, and hands them in. So
   * `recall` is the honest nothing of a client that is TOLD which conversation
   * to open rather than adopting one, and the model port answers the pin the
   * caller handed over — for the session being resumed and for any session
   * this harness opens after it, because the pin is the person's answer to
   * "what should this conversation run on" and the agent re-asserts its own
   * default over every open.
   */
  const memory: Memory = {
    recall: Effect.succeed(null),
    remember: () => Effect.void,
  };
  /** The model a PERSON chose, as the id they chose it under — handed in by
   *  the caller that remembered it, and kept current by the client's own write
   *  so that a conversation opened after a switch opens on the switch rather
   *  than on what was remembered at boot. */
  let wanted: string | null = options.model ?? null;
  const models: Models = {
    read: () => Effect.succeed(wanted),
    write: (_to, chosen) =>
      Effect.sync(() => {
        wanted = chosen;
      }),
  };

  // THE AGENT, and then the conversation. The client is built first and held,
  // so that the `try` below can stop it: the handshake and the open are one
  // sequence, a caller holds nothing until both end, and a refusal or a
  // deadline anywhere in it must not leave an adapter (and whatever it
  // spawned) running for every retry.
  //
  // The spawn and the handshake are the client's, and they happen on the first
  // verb that needs a process — which is the open below. OPENING the
  // conversation is this half's, because the rows a resume mints are ours.
  const agent: Agent = await run(
    make({
      id: AGENT_ID,
      leg,
      command: adapter.command,
      args: adapter.args,
      ...(adapter.env === undefined ? {} : { env: adapter.env }),
      ...(adapter.unset === undefined ? {} : { unset: adapter.unset }),
      cwd: options.cwd,
      tools: () => options.mcpServers,
      memory,
      models,
      onEvent: emit,
    }),
  );
  try {
    await openConversation();
  } catch (cause) {
    // Everything except the signature goes with the subprocess: a conversation
    // the agent would not open is a failure a caller cannot work around, and a
    // child left running with nothing to talk to is the leak.
    if (!refusedOpen(cause)) {
      await run(agent.stop);
      throw cause;
    }
  }

  // ── the verbs ────────────────────────────────────────────────────────

  /** What actually goes on the wire under a person's words: the standing prompt
   *  the first time this session is spoken to, then what the message was
   *  ABOUT ({@link aboutBlock}), then what they typed. */
  const bodyOf = (
    text: string,
    mentions: ReadonlyArray<ConductorMention>,
  ): string => {
    const parts: Array<string> = [];
    if (!taught) {
      taught = true;
      parts.push(options.teaching);
    }
    if (mentions.length > 0) parts.push(aboutBlock(mentions));
    parts.push(text);
    return parts.join("\n\n");
  };

  const runTurn = async (
    ticket: Turn<NoPayload>,
    blocks: ReadonlyArray<ContentBlock>,
  ): Promise<void> => {
    try {
      const stopReason = await run(agent.prompt(blocks));
      report(transcript.sent(ticket.key));
      if (stopReason === "cancelled") notice("the turn was cancelled");
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof HarnessRefused) {
        report(
          transcript.refused(ticket.key, refusalMark(ticket.key, cause.signIn)),
        );
        // A TURN REFUSED FOR WANT OF A SIGNATURE IS THE OTHER DOOR onto the
        // sign-in, and on the pinned pair it is the FIRST one a person reaches:
        // the conversation opened, the composer was there, and `-32000` is what
        // came back from the turn. Without this the only remedy stayed off the
        // screen for the whole life of a process that had already said exactly
        // what was wrong.
        if (cause.signIn === "signed-out") {
          offerSignIn(cause.why);
          publish();
        }
      } else {
        // NOTHING CAME BACK: the agent may have the message already, so no
        // retry is offered — an offered duplicate is worse than none.
        report(transcript.unanswered(ticket.key));
      }
      notice(`the turn could not be run: ${why}`);
    } finally {
      const last = turns.leave(ticket);
      // ... and the clock stops with the last of them: an idle conversation
      // counting up from a turn that ended is a panel saying work is going on.
      if (last) busyAt = null;
      // A turn that ends while ANOTHER is still running has nothing true left
      // to say about the conversation, and saying it anyway marks a working
      // panel idle. Its paragraph is still finished, which is what puts every
      // answer in a paragraph of its own.
      report(last ? transcript.settle() : transcript.stopSaying());
      const head = turns.head;
      if (head !== null) report(transcript.taken(head.key));
      publish();
    }
  };

  /** A turn is STARTING, and the clock every reader counts "working · 2m"
   *  from starts with the FIRST of them: a message sent behind a running turn
   *  does not restart the stopwatch on work that has been going for a minute. */
  const openTurn = (key: string): Turn<NoPayload> => {
    if (!turns.busy) busyAt = Date.now();
    return turns.open(key);
  };

  /**
   * Run one prompt as a turn, for a row that is already on screen.
   *
   * The ORDINARY LANE, whoever's words they are: a plain prompt, which starts
   * a turn this file owns whether or not another is already running. What the
   * agent does with a second one is the agent's own business — it holds it
   * behind the first and runs it next, in order.
   */
  const send = (key: string, blocks: ReadonlyArray<ContentBlock>): void => {
    // AT THE AGENT, NEXT IN LINE — this end sent a prompt while a turn of its
    // own was still in flight. kolu's fact about its own conversation, not a
    // queue: the message goes out now, on the wire, exactly as it would have.
    const waiting = turns.busy;
    // ... AND THE INTERRUPTION IS WITHDRAWN FROM THIS CONVERSATION from this
    // moment on ({@link queuedHere}): the pinned adapter cannot settle a turn
    // it steers once a session has queued, and a control that hangs the
    // conversation is not one to draw.
    if (waiting) queuedHere = true;
    if (waiting) report(transcript.queued(key));
    report(transcript.begins());
    const ticket = openTurn(key);
    publish();
    void runTurn(ticket, blocks);
  };

  /**
   * Put the words INTO the turn that is running, and say what became of them.
   *
   * `handled` means they are accounted for — in the running turn, or marked on
   * their own row as not delivered — and `prompt` means send them the ordinary
   * way, which is the safe direction and the only one this fails in.
   *
   * THE ONE ANSWER THAT NEEDS THE TICKET is *nothing to steer*. A turn that
   * simply finished under the steer makes these words an ordinary prompt; a
   * turn a person STOPPED makes starting a fresh one with them this end
   * un-cancelling on their behalf. The two are the same answer on the wire and
   * only the ticket the steer was aimed at tells them apart
   * ({@link Turn.stopped}).
   */
  const steerInto = async (
    key: string,
    body: string,
    aimed: Turn<NoPayload>,
  ): Promise<"handled" | "prompt"> => {
    // Belt to the brace of `state.steers`: an agent with no steering is never
    // asked, and a caller that got it wrong loses nothing at all.
    if (leg.steering === null) return "prompt";
    try {
      const went = await run(agent.steer(body));
      if (went === "taken") return "handled";
      if (aimed.stopped) {
        report(transcript.refused(key));
        notice(CANCELLED_UNDER_IT);
        publish();
        return "handled";
      }
      return "prompt";
    } catch (cause) {
      // WHICH failure it was is the wire's reading, not ours — it is what
      // knows whether anything answered — and it is the one fact the row's two
      // faces are drawn out of.
      if (cause instanceof HarnessRefused) {
        report(transcript.refused(key, refusalMark(key, cause.signIn)));
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
      return "handled";
    }
  };

  /** THE AGENT IS THERE AND IN A CONVERSATION, or there is nothing to send to.
   *  A dead agent is the CALLER's to replace — with the rows it holds and the
   *  session it was in — so nothing here quietly starts a second process. */
  const inConversation = (): void => {
    if (!alive() || sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
  };

  /**
   * SEND IT, with whatever was attached to it.
   *
   * THE BLOCKS ARE BUILT BEFORE THE ROW IS MINTED, which is the whole of the
   * refusal rule: an attachment this agent cannot be sent, or one over the
   * cap, throws before anything is drawn — so a person sees their own message
   * still theirs to send with a sentence saying why, rather than a sent row
   * whose picture the model never got.
   *
   * THE ROW CARRIES WHAT IT WAS HANDED, which is a NAME, a size and the path
   * padi wrote the bytes to — the same row whether it was minted a moment ago
   * or restored from padi's store, which is why "send again" on an old
   * message works: the bytes are read off that path either way. The browser
   * keeps its own thumbnail for the rows it minted this session; no picture
   * rides this wire.
   *
   * STEERING IS THE ASKED-FOR EXCEPTION, and every condition on it is a
   * condition on the ASK: somebody made the gesture, the agent advertised that
   * it takes one, this conversation has not spent its latch, and there is a
   * turn in flight to put the words in. Any of those missing and this is a
   * plain prompt. An agent that advertises steering but promises NO queue
   * takes a busy send through steering whether it was asked for or not — a
   * second ordinary prompt can overwrite such an agent's pending turn, leaving
   * the first request unanswered forever (olai measured it on opencode).
   *
   * AND A MESSAGE WITH FILES ON IT IS NEVER STEERED, whoever asked: the steer
   * carries one text block, so steering it would deliver the words and drop
   * the files. The words and the files go together the ordinary way instead.
   */
  const prompt = async (
    text: string,
    mentions: ReadonlyArray<ConductorMention>,
    attachments: ReadonlyArray<ConductorAttachment>,
    steer: boolean,
  ): Promise<{ rowId: string }> => {
    inConversation();
    const attached = await blocksOf(attachments, carries);
    const { key, change } = transcript.user(text, {
      ...(mentions.length === 0 ? {} : { mentions }),
      attachments,
    });
    report(change);
    // WHICH turn a steer is aimed at, read and KEPT: by the time it answers,
    // that turn may be over. The one the agent is working on, which is the
    // oldest — the ones behind it have not started, and interrupting a turn
    // that has not started is nothing at all.
    const aimed = turns.head;
    const body = bodyOf(text, mentions);
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
      // The row is on screen before the round trip: a steer takes a deadline,
      // and a person's words must not wait on it to be drawn.
      publish();
      const went = await steerInto(key, body, aimed);
      // A steer that LANDED starts nothing here — the words are in a turn this
      // file already owns — so no ticket and no queued mark.
      if (went === "handled") return { rowId: key };
    }
    send(key, [{ type: "text", text: body }, ...attached]);
    return { rowId: key };
  };

  /** KOLU'S OWN LINE — a turn this end starts about watched terminals. A
   *  prompt in every way that matters: the standing prompt rides it if it is
   *  the first message of the conversation, it waits behind whatever is
   *  running, and its row takes every delivery mark a person's does. It is
   *  never steered: these words are ABOUT a world that has moved, and a turn
   *  that is still working will be told when it ends. */
  const wake = async (
    text: string,
    events: ReadonlyArray<ConductorWakeEvent>,
  ): Promise<{ rowId: string }> => {
    inConversation();
    const { key, change } = transcript.write({
      kind: "wake",
      from: "kolu",
      events,
      text,
    });
    report(change);
    send(key, [{ type: "text", text: bodyOf(text, []) }]);
    return { rowId: key };
  };

  const cancel = async (): Promise<void> => {
    if (!alive() || sessionId === null) return;
    // ... and every ticket in flight remembers being stopped, which is what a
    // steer still on the wire is read against ({@link steerInto}). The
    // questions the turn was holding go back unanswered at the client, which
    // is where the promise each of them is lives.
    turns.stopping();
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
    inConversation();
    // THE HISTORY STAYS — which is the whole of what separates this verb from
    // the wipe beside it ({@link clearSession}). A conversation ends and
    // another begins in ONE transcript, with the divider between them; that is
    // the product. The counters are monotonic for the life of the process, so
    // the divider and everything after it sorts below what is already there.
    const mark = divider("new session");
    report(mark.change);
    try {
      // The conversation just left is ENDED at the agent before the next one is
      // opened, rather than left running beside it: the client closes it.
      await run(agent.newSession);
    } catch (cause) {
      // A BREAK THAT BROKE NOTHING COMES BACK OUT. The divider says one thing
      // — the agent's memory was reset — and a conversation that would not
      // open has reset nothing a reader needs told about. Left standing, it is
      // also what a retry stacks on: the owner's screenshot was four
      // `— NEW SESSION —` lines with no conversation between them, one per
      // attempt, over a host whose adapter would not open a session.
      if (mark.key !== null) report(transcript.remove(mark.key));
      // SAID BEFORE IT IS THROWN: a conversation that would not open leaves a
      // panel with a composer and nothing to explain it, and the caller's own
      // error reaches a log rather than this screen.
      refusedOpen(cause);
      throw cause;
    }
    publish();
  };

  /**
   * ... AND THE WIPE BESIDE IT: the agent's memory is reset AND the
   * conversation is deleted. Two verbs rather than one with a flag, because
   * what a person loses is the whole difference between them.
   *
   * IT LIVES HERE, not at the caller, because the rows are this harness's and
   * so is everything kept beside them — which call has been named, what each
   * was armed with, which deaths have been announced, which calls a turn
   * walked away from. A caller that emptied its own mirror of the rows left
   * that standing, and the next conversation's first tool call (an agent
   * numbers them from one again) landed on a row still held here, said
   * nothing new, and reached nobody.
   *
   * NO DIVIDER IS MINTED: a break is drawn between two conversations a reader
   * can see, and this one leaves nothing above it to divide.
   *
   * THE ROWS GO LAST, once the next conversation is open — an open that is
   * refused has reset nothing, and a wipe that ran anyway would have traded a
   * transcript for a failure. `held` is the ids the caller holds that this
   * instance never minted ({@link Transcript.clear}).
   */
  const clearSession = async (held: ReadonlyArray<string>): Promise<void> => {
    inConversation();
    try {
      await run(agent.newSession);
    } catch (cause) {
      refusedOpen(cause);
      throw cause;
    }
    report(transcript.clear(held));
    publish();
  };

  /**
   * HOW A SETTING'S NEW VALUE GOES ON THE WIRE, which is two shapes and not
   * one: a select's value is the row's own id and a BOOLEAN is a boolean — the
   * pinned Claude adapter refuses the string `"true"` for its FAST MODE toggle
   * outright (`Invalid value for config option fast`).
   *
   * The string stays padi's whole vocabulary: a wire that carried two value
   * types would be a second thing for every layer above to get right, and the
   * one end that knows which settings are booleans is this one — it read the
   * advertisement.
   */
  const settingValueOf = (id: string, value: string): string | boolean => {
    const option = settings.find((one) => one.id === id);
    if (option?.kind !== "boolean") return value;
    if (value !== "true" && value !== "false") {
      throw new HarnessRefused(
        `\`${option.name}\` is a switch and takes \`true\` or \`false\`, not \`${value}\``,
        "no",
      );
    }
    return value === "true";
  };

  /** RUN ONE OF THE ADVERTISED METHODS, and take the whole offer down if it
   *  worked: exit 0 is the whole of "it worked" for every one of these CLIs,
   *  and a chooser left standing over an agent somebody has just signed into
   *  is a row that invites a second login. */
  const signIn = async (method: string): Promise<SignedIn> => {
    if (!alive()) throw new HarnessUnavailable("the agent is not running");
    cancelling = false;
    const ended = await run(agent.signIn(method));
    // A CANCEL THAT LOST THE RACE IS NOT AN ENDING. The login command exited
    // 0, which means the credential store has already been written: calling
    // that `cancelled` tells the caller there is nothing to restart for, and
    // the running agent then keeps the signature it started with for ever
    // while the store holds a different one.
    const said = cancelling && ended !== "signed-in" ? "cancelled" : ended;
    cancelling = false;
    if (ended === "signed-in") cause = null;
    publish();
    return said;
  };

  /** ... and stopping it — or, for a row a PERSON asked for, closing it: a
   *  sign-in somebody asked for and then thought better of leaves everything
   *  as it was. The agent's own offer stays, with its methods, because the
   *  refusal behind it still stands. The boolean is whether there was anything
   *  to stop: a cancel with nothing behind it is a stale tab, not a failure. */
  const signInCancel = async (): Promise<boolean> => {
    // Set BEFORE the stop, because the verb above reads it on its way out:
    // which of the two endings an attempt had depends on whether a PERSON
    // asked, and this is the only moment that is known.
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

  const stop = async (): Promise<void> => {
    // NOTHING MORE IS PUBLISHED FROM HERE, which is what `stopped` buys on its
    // way through {@link report} and {@link publish}: a turn still on the wire
    // ends somewhere inside the awaits below, its questions go back
    // withdrawn, and every one of those rows would be a row padi writes to
    // disk for a conversation the daemon has already let go. The one frame a
    // shutdown owes a reader is the last line of this function, sent by hand.
    stopped = true;
    // Leaving is the agent's first — its questions go back unanswered and the
    // session is closed AT the agent — and then the rows this half owns.
    await run(agent.stop);
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
    wake,
    cancel,
    answer,
    signIn,
    /** A person asks, signed in or not. An offer already on screen — the
     *  agent's own, or a running attempt — is left exactly as it is. */
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
    clearSession,
    stop,
  };
};

/**
 * WHAT A PROMPT'S ATTACHMENTS GO ON THE WIRE AS — one ACP content block each,
 * chosen by what the file IS and refused when this agent cannot take it.
 *
 * Three kinds, because ACP has three and each is opt-in differently: an image
 * travels as base64 beside its mime type and needs the agent's
 * `promptCapabilities.image`; a text-like file travels as a `resource` with
 * its text embedded and needs `embeddedContext`; anything else travels as a
 * `resource_link` naming the absolute path padi wrote it to, which every agent
 * must accept and which an agent with a shell can go and read.
 *
 * REFUSED, NEVER DROPPED. An attachment the agent did not advertise for is a
 * sentence naming the capability, and the caps are sentences naming the limit:
 * a picture that silently did not travel is a person asking a model about an
 * image it was never shown, and no answer to that is worth one.
 */
const blocksOf = async (
  attachments: ReadonlyArray<ConductorAttachment>,
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
      );
    }
    total += one.bytes;
    if (total > PROMPT_CAP) {
      throw new HarnessRefused(
        `that is ${sized(total)} of attachments and the most one message may` +
          ` carry is ${sized(PROMPT_CAP)}`,
        "no",
      );
    }
    // ONE AT A TIME rather than in parallel: the blocks ride the prompt in
    // the order a person attached them, and a refusal further down the list
    // should not have started reads nobody will use.
    blocks.push(await blockOf(one, carries));
  }
  return blocks;
};

/** One attachment as the block it belongs in. */
const blockOf = async (
  one: ConductorAttachment,
  carries: { readonly image: boolean; readonly embeddedContext: boolean },
): Promise<ContentBlock> => {
  const mimeType = essenceOf(one.mimeType);
  if (mimeType.startsWith("image/")) {
    if (!carries.image) {
      throw new HarnessRefused(
        `this agent did not advertise \`image\` at \`initialize\`, so` +
          ` \`${one.name}\` cannot be sent to it`,
        "no",
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

/** The mime types that are TEXT without saying `text/` — the three a person
 *  really drops on a chat window. Everything else keeps its bytes and travels
 *  as a link: a PDF embedded as "text" is mojibake with a filename on it. */
const TEXT_LIKE: Readonly<Record<string, true>> = {
  "application/json": true,
  "application/xml": true,
  "application/javascript": true,
};

/** The type WITHOUT its parameters — a browser hands over
 *  `text/plain;charset=utf-8`, and a rule that compared the whole string would
 *  send the commonest text file there is as an opaque link. */
const essenceOf = (mimeType: string): string =>
  (mimeType.split(";")[0] ?? mimeType).trim().toLowerCase();

/**
 * THE BYTES, read off the file padi wrote.
 *
 * THE FILE IS THE ONLY SOURCE, and that is the point rather than an economy:
 * the base64 cannot ride the `prompt` frame — an oversized frame does not
 * fail the call, it closes the tab's socket — so the browser uploads in
 * chunks and hands this end a path. It is also what makes a RESTORED row
 * sendable: a row read back out of padi's store has a path and nothing else,
 * and a harness that wanted a `data:` URL refused every "send again" on an
 * old message.
 *
 * A file that is not there is a REFUSAL naming it, not a throw inside a
 * protocol callback: the attachment was swept, or the state root moved, and a
 * person who is told which file is missing can attach it again.
 */
const bytesOf = async (one: ConductorAttachment): Promise<Buffer> => {
  try {
    return await readFile(one.path);
  } catch {
    throw new HarnessRefused(
      `\`${one.name}\` is no longer readable at \`${one.path}\`, so there are` +
        ` no bytes to send`,
      "no",
    );
  }
};

/** Where the agent can go and find it. A `resource` and a `resource_link` both
 *  NAME the file — the protocol has no block for either without a uri — and
 *  the name is padi's own copy under its state root, which is the only path
 *  that exists on the host the agent is running on. */
const uriOf = (one: ConductorAttachment): string => `file://${one.path}`;

/** A size a person reads, for the two refusals that name one. */
const sized = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MiB`;
