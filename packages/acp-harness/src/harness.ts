/**
 * THE ACP CLIENT: one subprocess, one protocol, no browser.
 *
 * Everything about the Agent Client Protocol stops here — nothing else in kolu
 * spells `session/prompt` — and nothing in here knows what a surface member, a
 * cell or a browser is. A caller gets something it can prompt, cancel, answer,
 * sign in and stop, plus the rows and the state of the conversation through the
 * one callback it gave at construction.
 *
 * What this owns, and why:
 *
 *   - **the subprocess and the conversation it comes up in.** Bring-up is one
 *     sequence whose order is a protocol fact: `initialize` says what the agent
 *     can do, `session/new` and `session/load` take the SAME servers and the
 *     same `_meta`, and a load replays its whole history before it answers. It
 *     is all inside {@link startHarness}'s promise, because a harness that
 *     resolved into a half-open state would be a caller's problem to discover.
 *   - **the questions the agent asks a person**, both kinds. An
 *     `elicitation/create` is a form; a `session/request_permission` that is not
 *     one of ours is a single-select. What is HERE is that both are the same
 *     question and which methods carry them; the payload shapes are
 *     `@kolu/acp`'s and the promise-per-question state machine is
 *     {@link ./questions.ts}.
 *   - **which permission requests are answered without asking.** A call to one
 *     of the MCP servers WE handed this session is allowed immediately and
 *     everything else is a person's to answer. What is HERE is that the two
 *     paths exist; the rule that tells them apart is the agent's LEG, where it
 *     is a pure function with unit tests rather than a branch inside a
 *     subprocess's callback — and it is POSITIVE RECOGNITION, never "the first
 *     option", because one adapter's options lead with the refusal and the
 *     other's lead with the allow.
 *   - **reading the payloads**: which update kind this is, what a content block
 *     says, which kolu terminal a call is about. A row carries what was READ,
 *     never the raw protocol value.
 *
 * `fs` capabilities are FALSE in both directions on purpose: the conductor
 * is not an editor, and an agent that could write a file whole would be routing
 * around the terminals it is supposed to be driving. `elicitation.form` is TRUE
 * and is what makes any of the asking happen at all — without it the pinned
 * Claude adapter puts `AskUserQuestion` in `disallowedTools`, so the agent
 * cannot ask a structured question and has to guess. `elicitation.url` is TRUE
 * because without it the adapters withhold their device-code sign-in entirely,
 * and `auth.terminal` (plus the `_meta["terminal-auth"]` corner the pinned
 * Claude adapter reads) is what makes an agent offer a sign-in a CLIENT can
 * run: with it, the adapter hands over a command that prints a URL and reads a
 * code; without it, the same adapter offers only a full-screen TUI this panel
 * cannot draw.
 *
 * WHAT IS DELIBERATELY NOT HERE: a client-side prompt queue. Every send is a
 * plain `session/prompt`, busy or idle, and the agent holds a busy one behind
 * the turn it is working on — the queue is the AGENT'S and nothing is held on
 * this side. The row's own *queued* mark is kolu's fact about its own
 * conversation ({@link ./turns.ts}) and not a second queue.
 */

import { readFile } from "node:fs/promises";
import {
  client as acpClient,
  type ClientConnection,
  type ContentBlock,
  CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  type LoadSessionResponse,
  methods,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import {
  AUTH_STATUS_METHOD,
  diffsOf,
  type Form,
  formOf,
  identityIn,
  PERMISSION_FIELD,
  permissionFormOf,
  Refused,
  urlOf,
  usageIn,
} from "@kolu/acp";
import type {
  Adapter,
  Leg,
  RawMessages,
  Reported,
  Spawn,
} from "@kolu/acp/engine";
import type { AskAnswer, AskLink, AuthStatus, Usage } from "@kolu/acp/wire";
import { Duration } from "effect";
import { Calls } from "./calls.ts";
import { type Child, childEnvOf, start as startChild } from "./child.ts";
import { Fleet, koluCallOf, refineKoluCall } from "./kolu.ts";
import {
  authOf,
  completionIdOf,
  detailOf,
  fromElsewhere,
  goneOf,
  locationsOf,
  mcpServersOf,
  messageOf,
  methodsIn,
  type Offered,
  progressOf,
  saidOf,
  textOf,
} from "./payloads.ts";
import { streamOver } from "./pipes.ts";
import { AnswerRefused, Questions } from "./questions.ts";
import type {
  ConductorAttachment,
  ConductorCommand,
  ConductorKoluCall,
  ConductorMention,
  ConductorModel,
  ConductorOption,
  ConductorRow,
  ConductorServer,
  ConductorSignIn,
  ConductorState,
  ConductorWakeEvent,
} from "./rows.ts";
import { type Change, says, Transcript } from "./transcript.ts";
import { type Turn, Turns } from "./turns.ts";

// ── what a caller hands over, and what it gets back ────────────────────

/** One MCP server to hand this conversation as a PROGRAM on this host —
 *  somebody else's binary, spoken to over its stdin/stdout.
 *
 *  `kind` is the IN-TREE discriminant and never reaches the wire: ACP's stdio
 *  arm is the one with no `type` key at all, and an entry that carries
 *  `type: "stdio"` is silently dropped by the pinned adapter. `mcpServersOf`
 *  owns that translation and states the measurement. */
export interface StdioServer {
  readonly kind: "stdio";
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

/** One MCP server to hand this conversation as an HTTP ENDPOINT — a server
 *  somebody is already running, reached over streamable HTTP rather than
 *  spawned.
 *
 *  This is how kolu hands over the FLEET: one face, in kolu-server's own
 *  process, covering every host's terminals. A stdio server could only ever be
 *  a program on ONE machine, which is the shape the fleet grew out of.
 *  `headers` is where its bearer token rides — the endpoint is on loopback,
 *  and loopback is not a gate. */
export interface HttpServer {
  readonly kind: "http";
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

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
  /** The standing prompt's lines, which ride under the first message of every
   *  session. The WORDS are the caller's — they name kolu's own MCP verbs, and
   *  this package knows no tool but the protocol's. */
  readonly teaching: ReadonlyArray<string>;
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
 *  six facts it would only be echoing back. `install` and `agentName` are
 *  the ENGINE's, settled when kolu was built, and `cwd` is the directory padi
 *  handed in — a harness that published them would be overwriting the caller's
 *  own answer with a copy of it. `watched`, `seen`, `work` and `held` are the
 *  SERVER's in the same way: which terminals kolu wakes this conversation
 *  about, how each of them stands and since when, how they group into pieces
 *  of work, and whose news is waiting for the turn to end, are facts about
 *  kolu's watch rather than about the conversation — this end only ever
 *  learns of them as a {@link Harness.wake}. */
export type HarnessState = Omit<
  ConductorState,
  "install" | "agentName" | "cwd" | "watched" | "seen" | "work" | "held"
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
  signIn(method: string): Promise<SignedIn>;
  signInInput(text: string): Promise<void>;
  signInCancel(): Promise<boolean>;
  setOption(id: string, value: string): Promise<void>;
  newSession(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * How a sign-in ended. Four values because four different things are done about
 * them and none is a failure of the VERB: `signed-in` reopens the conversation,
 * `failed` is already on screen as the attempt's own output, `cancelled` is
 * somebody's press and needs nobody told, and `attached` is a second press that
 * joined the first.
 */
export type SignedIn = "signed-in" | "failed" | "cancelled" | "attached";

/**
 * NOTHING WAS ASKED OF ANYTHING, or nothing came back.
 *
 * `why` is a whole sentence and nothing composes around it: padi narrows this
 * at its one seam into the declared wire error of the same shape. A failure
 * that is NEITHER this nor {@link HarnessRefused} stays a defect and crashes,
 * deliberately — wrapping an unexpected throw in one of these to be polite is
 * how a bug becomes a sentence a person is asked to act on.
 */
export class HarnessUnavailable extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.name = "HarnessUnavailable";
    this.why = why;
  }
}

/** A REFUSAL, with the agent demonstrably there — it answered a request with a
 *  JSON-RPC error, so asking again is honest. `auth` is the one refusal with
 *  something to DO about it: nobody is signed in, which is ACP's own `-32000`
 *  and the only way an agent ever asks for a signature.
 *
 *  Also this end's own no, on the one path where there is one: an answer that
 *  does not typecheck against the schema the agent asked in is refused HERE
 *  and never sent. Same shape, same `auth: false`, and the sentence says which
 *  end said it — what a caller does with either is identical, which is why
 *  there is not a third class. */
export class HarnessRefused extends Error {
  readonly why: string;
  readonly auth: boolean;
  constructor(why: string, auth: boolean) {
    super(why);
    this.name = "HarnessRefused";
    this.why = why;
    this.auth = auth;
  }
}

// ── the constants this client is ───────────────────────────────────────

/** The ACP major version this client speaks. */
const PROTOCOL = 1;
/** Boot is a few small round trips against a process that just started. Only it
 *  gets a deadline — a turn is a person waiting on a language model. */
const BOOT_TIMEOUT = 30_000;
/** A load is not small: the agent re-opens a conversation and replays every
 *  message in it before it answers. Its own, longer deadline. */
const LOAD_TIMEOUT = 120_000;
/** How long the agent gets to END the conversation being left
 *  ({@link startHarness}'s `release`). Bounded and its own: a close is a
 *  cancel plus a subprocess teardown rather than a model call, and the person
 *  waiting on it is the one who just pressed NEW CONVERSATION. */
const CLOSE_TIMEOUT = 10_000;
/** How much of a sign-in's output is kept. A process that printed a book is not
 *  one a person is reading. */
const SIGN_IN_CAP = 64 * 1024;
/** The agent's stderr since this subprocess started, capped so a chatty one
 *  cannot grow a log line without bound. This is where an adapter writes its
 *  JSON-RPC errors, and a turn that failed with nothing else to say is what the
 *  dump exists for. */
const STDERR_CAP = 32 * 1024;
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

/**
 * THE KINDS THAT RE-TELL WHAT WAS SAID — the only frames a replay is dropped
 * on the floor for.
 *
 * `session/load` sends two unlike things down one stream before it answers:
 * the conversation's HISTORY, which the caller already holds in a richer form,
 * and news about the session AS IT IS NOW — which commands it offers, which
 * settings it is on, how full its context is. Dropping the whole stream drops
 * the second with the first, and {@link startHarness}'s `leaving` has just
 * reset exactly those fields: a resumed conversation would spend the rest of
 * its life with no `/` completion and no context meter, which is the opposite
 * of what the fence is for. So the partition is BY KIND and it is written
 * here, named, rather than inline — a kind this client learns to draw later is
 * then added to a list somebody can read, instead of quietly arriving as news
 * about a conversation that has not happened yet.
 */
const REPLAYED_UPDATES: Readonly<Record<string, true>> = {
  agent_message_chunk: true,
  user_message_chunk: true,
  tool_call: true,
  tool_call_update: true,
  plan: true,
};

/** THE SIGN-IN IN FLIGHT, if there is one — held because the two things that
 *  act on it arrive by different roads: a person's keystroke, and the agent's
 *  own completion notification. One per agent, which is what makes a second
 *  press ATTACH to the process already running rather than spawn a second one
 *  writing the same credential store. */
interface Attempt {
  readonly method: string;
  /** What the method is called, for the row that draws it — the method's own id
   *  until the advertisement has been read, since the CLAIM has to exist before
   *  the handshake and the handshake is what knows the name. */
  label: string;
  /** One line to the process's stdin, or `null` while there is no process — and
   *  forever, for an agent method, which has none. */
  write: ((line: string) => void) | null;
  /** SOMEBODY HAS ASKED IT TO STOP. Read where an attempt ENDS (so a cancel is
   *  not reported as a failure) and where something is about to be DRAWN (so a
   *  cancelled attempt cannot put its row back). */
  stopping: boolean;
  stop: () => Promise<void>;
  /** The page this attempt is waiting on, once the agent has sent one. */
  link: {
    readonly elicitationId: string | null;
    readonly answer: (action: "accept" | "decline") => void;
    readonly url: AskLink;
    readonly message: string;
  } | null;
  output: string;
  state: "running" | "succeeded" | "failed";
}

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
 * offline with `state.signIn` filled in — the conversation opens itself once
 * the signature lands ({@link Harness.signIn}).
 */
export const startHarness = async (
  options: HarnessOptions,
): Promise<Harness> => {
  const { leg, adapter, log } = options;

  // ── the state this conversation is ───────────────────────────────────

  /** The rows, minted PAST what is already persisted elsewhere: padi hands in
   *  the highest `seq` it holds, so nothing this process mints can collide
   *  with a restored row's id or sort above it — and whether the last of those
   *  rows is a break, which is the one thing a fresh transcript cannot see
   *  about the conversation it is continuing. */
  const transcript = new Transcript(
    options.resumedSeq ?? 0,
    Date.now,
    options.resumedEndsWithDivider ?? false,
  );
  const turns = new Turns();
  const calls = new Calls(leg);
  const fleet = new Fleet(options.fleet ?? []);
  /** The accumulated kolu reading per call id — see `refineKoluCall`. Cleared
   *  with the conversation, for the reason `Calls.forget` gives: a call id is
   *  only ever looked up inside the session that minted it, and a daemon meant
   *  to run for weeks must not keep every call it ever saw. */
  const koluReadings = new Map<string, ConductorKoluCall>();
  const questions = new Questions((id, outcome) => {
    report(transcript.settleAsk(id, outcome));
    publish();
  });

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
   * its measurement come from (`packages/integrations/claude-code/acp/patches/README.md`).
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

  let live: { child: Child; connection: ClientConnection } | null = null;
  let activeSession: string | null = null;
  /**
   * Sessions this harness has LEFT, still named so a leftover notification
   * about one can be recognised after `activeSession` has gone null.
   *
   * A SET rather than the last id, because two opens in a row can still have
   * the first conversation's leftovers on the wire after the second has been
   * left too. An id leaves only when that same conversation is re-entered.
   */
  const closed = new Set<string>();
  let replaying = false;
  /** How many frames the replay of a resumed conversation has been dropped on
   *  the floor — counted so the one log line a load writes can say how much
   *  history the agent re-sent (and padi already had). */
  let replayed = 0;
  let stopped = false;
  let taught = false;
  let model: ConductorModel | null = null;
  /** The model a PERSON chose, as the id they chose it under — handed in by
   *  the caller that remembered it, and kept current by {@link setOption} so
   *  that a conversation opened after a switch opens on the switch rather than
   *  on what was remembered at boot. */
  let wanted: string | null = options.model ?? null;
  let usage: Usage | null = null;
  let identity: AuthStatus | null = null;
  let refusal: string | null = null;
  /**
   * THE CONVERSATION THIS HARNESS WAS TOLD TO COME BACK TO, for as long as
   * there is one to come back to.
   *
   * Starts as the caller's `resume` and goes null the moment the agent says
   * it does not know that id ({@link load}) — because the two doors into an
   * open are the same door ({@link openConversation}), and a sign-in that
   * succeeds after a refused load would otherwise send the SAME dead id back
   * down the wire and take the same refusal a second time.
   */
  let resumable: string | null =
    typeof options.resume === "string" ? options.resume : null;
  let commands: ReadonlyArray<ConductorCommand> = [];
  let settings: ReadonlyArray<ConductorOption> = [];
  let labels: ReadonlyMap<string, string> = new Map();
  let offered: ReadonlyArray<Offered> = [];
  /** WHAT THE AGENT CALLS ITSELF, out of the handshake's `agentInfo` — kept
   *  for the one sentence that has to name it: a sign-in with nothing to press
   *  is a dead end, and which adapter said so is most of what is left to say
   *  about it. */
  let agentSaid: string | null = null;
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
  let signIn: ConductorSignIn | null = null;
  let attempt: Attempt | null = null;
  /** The MCP servers this conversation was handed, by name — read by the
   *  permission handler and by nothing else. */
  const given = options.mcpServers.map((server) => server.name);
  /**
   * THE ROSTER: what this conversation was handed, and what has been said
   * about it since. A VALUE rather than a constant, because the second half is
   * news that arrives later — the agent's own account of which of these
   * servers it actually reached ({@link reported}).
   *
   * `where` is WHERE WE SENT IT and it is on the row from the start: "kolu is
   * missing" is a sentence nobody can act on without the place that was tried.
   * For a program that is the absolute command; for an HTTP server it is the
   * URL — the token beside it stays out of the row, because a row is something
   * a person reads on screen.
   */
  let servers: ReadonlyArray<ConductorServer> = options.mcpServers.map(
    (server) => ({
      name: server.name,
      standing: "handed" as const,
      said: null,
      where: server.kind === "http" ? server.url : server.command,
    }),
  );
  /** The URL elicitations this conversation is waiting on, by the agent's own
   *  id — the handle `elicitation/complete` names, mapped to the question row
   *  on screen for it. A map rather than a field, because a session can hold
   *  more than one at a time. */
  const waitingLinks = new Map<string, string>();
  /** The prologue this conversation's OPEN announced it would ALSO send as one
   *  ordinary chunk, or `null`. Armed at the open and CONSUMED by the first
   *  chunk equal to it: one banner, once, compared against the string the
   *  adapter itself published rather than against a shape of prose. */
  let prologue: string | null = null;

  let stderrBuf = "";
  let stderrWritten = 0;

  /** What this agent's leg wants on the `_meta` of the two calls that OPEN a
   *  conversation — spread into BOTH, because `session/new` and `session/load`
   *  have to agree: an adapter reads its subscription off whichever of them
   *  made the session, and sending it at `new` alone leaves every restored
   *  conversation silent. */
  const openMeta =
    leg.rawMessages === null ? {} : { _meta: leg.rawMessages.openMeta };
  const handing = mcpServersOf(options.mcpServers);

  // ── saying what moved ────────────────────────────────────────────────

  const report = (change: Change): void => {
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
    // up, which is the one case `live` alone gets wrong.
    phase:
      live === null || stopped || refusal !== null
        ? "offline"
        : questions.open().length > 0
          ? "asking"
          : turns.busy
            ? "working"
            : activeSession === null
              ? "starting"
              : "idle",
    sessionId: activeSession,
    model,
    usage,
    options: settings,
    commands,
    servers,
    watching: transcript.watching(),
    openAsks: questions.open(),
    fleet: [...fleet.ids()],
    signIn,
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

  // ── talking to the process ───────────────────────────────────────────

  /** One request. Every protocol failure — a rejection, a dead pipe, a deadline
   *  — becomes one of this package's two errors, because from a caller's side
   *  they are the same thing: the agent did not answer.
   *
   *  The SIGNAL is what makes a deadline a CANCELLATION rather than a
   *  walk-away: the SDK keys every request into a pending map and clears an
   *  entry only when a response arrives or the connection closes, so a timeout
   *  that merely stopped waiting would leak the entry — and the closure holding
   *  that request's params — for the life of the subprocess. */
  const request = async (
    method: string,
    params: unknown,
    timeout: number | null = BOOT_TIMEOUT,
  ): Promise<unknown> => {
    const at = live;
    if (at === null) {
      throw new HarnessUnavailable("the agent is not running");
    }
    const controller = new AbortController();
    const timer =
      timeout === null ? null : setTimeout(() => controller.abort(), timeout);
    // ONE timer, then asked not to hold the process open. Written as a
    // statement rather than as `unref() ?? setTimeout(…)`, which schedules a
    // SECOND deadline on any runtime whose handle has no `unref` — two aborts
    // for one request, and the spare one still armed after it answered.
    timer?.unref?.();
    try {
      return await (
        at.connection.agent as unknown as {
          request: (
            method: string,
            params: unknown,
            options?: { readonly cancellationSignal?: AbortSignal },
          ) => Promise<unknown>;
        }
      ).request(method, params, { cancellationSignal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) {
        // The deadline is the definition of `unanswered`: the request is on the
        // wire, nothing came back, and interrupting our own wait tells us
        // nothing about what the agent did with it.
        throw new HarnessUnavailable(
          `\`${method}\` did not answer in ${String(timeout)}ms`,
        );
      }
      throw refusalOf(method, cause);
    } finally {
      clearTimeout(timer ?? undefined);
    }
  };

  /** One rejection, read twice: whether the AGENT answered it, and whether it
   *  answered for want of a signature. */
  const refusalOf = (method: string, cause: unknown): Error => {
    const why = `\`${method}\` failed: ${saidOf(cause)}`;
    if (goneOf(cause) === "refused") {
      return new HarnessRefused(why, authOf(cause));
    }
    return new HarnessUnavailable(why);
  };

  /** A notification is never answered, so there is no silence to tell from a
   *  no: what fails here is the WRITE, and a write that failed put nothing on
   *  the wire. */
  const notify = async (method: string, params: unknown): Promise<void> => {
    const at = live;
    if (at === null) {
      throw new HarnessUnavailable("the agent is not running");
    }
    try {
      await (
        at.connection.agent as unknown as {
          notify: (method: string, params: unknown) => Promise<void>;
        }
      ).notify(method, params);
    } catch (cause) {
      throw new HarnessUnavailable(`\`${method}\` failed: ${saidOf(cause)}`);
    }
  };

  // ── the questions the agent asks a person ────────────────────────────

  /** Put a form in front of a person and wait for it — the registry holds the
   *  promise, and this is the one place the row it draws is announced. WHO IS
   *  ASKING is worked out here rather than handed in: the form names the call
   *  it was asked from and the call is what has been heard about, so there is
   *  nothing left for a caller to supply. A form drawn in nobody's name is
   *  drawn as the main agent's, which is the one thing a subagent's question
   *  must not say. */
  const put = (
    form: Form,
    signal: AbortSignal,
    known?: (id: string) => void,
  ): Promise<{
    readonly outcome: { how: "answered" | "declined" | "withdrawn" };
    readonly content: Record<string, string | number | boolean | Array<string>>;
  }> =>
    questions.ask(form, signal, (id) => {
      known?.(id);
      const parent = calls.about(form.toolCall).parent ?? null;
      report(
        transcript.ask(
          id,
          form.message,
          form.fields,
          form.link,
          parent === undefined ? null : parent,
        ),
      );
      publish();
    });

  /** A question we cannot draw. Declined on the wire and SAID out loud: an
   *  agent that got an empty answer and a person who never saw the question is
   *  the one shape of this failure nobody could debug. */
  const undrawable = (why: string): void => {
    notice(`the agent asked something this panel cannot draw — ${why}`);
    log.warn({ why }, "undrawable question");
  };

  const onElicitation = async (
    params: CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<CreateElicitationResponse> => {
    // WHICH MODE, before anything else: the two draw different rows and the
    // reader of one REFUSES the other, so the dispatch is what keeps a
    // place-to-go from being refused as an undrawable form.
    if (params.mode === "url") return await onUrlElicitation(params, signal);
    const named = "sessionId" in params ? params.sessionId : undefined;
    if (fromElsewhere(named, activeSession, closed))
      return { action: "cancel" };
    const form = formOf(params);
    if (form instanceof Refused) {
      undrawable(form.reason);
      return { action: "decline" };
    }
    const settled = await put(form, signal);
    // A dismissal is a DECLINE and a withdrawal is a CANCEL, and the adapter
    // reads them differently: decline tells the model the person skipped and
    // lets the turn go on, cancel aborts the tool use.
    if (settled.outcome.how === "declined") return { action: "decline" };
    if (settled.outcome.how === "withdrawn") return { action: "cancel" };
    return { action: "accept", content: settled.content };
  };

  /** THE OTHER MODE — a place to go rather than something to fill in. Which of
   *  two rows it becomes is decided by the SCOPE the agent sent it with, which
   *  is the protocol's own way of saying who is asking: a SESSION-scoped one
   *  belongs to the conversation, and a REQUEST-scoped one belongs to the one
   *  request this harness makes before a conversation exists — a sign-in. */
  const onUrlElicitation = async (
    params: CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<CreateElicitationResponse> => {
    const form = urlOf(params);
    if (form instanceof Refused) {
      undrawable(form.reason);
      return { action: "decline" };
    }
    const named = "sessionId" in params ? params.sessionId : undefined;
    if (typeof named !== "string") return await onLoginLink(params, form);
    if (fromElsewhere(named, activeSession, closed))
      return { action: "cancel" };
    const settling = CreateElicitationRequest.isUrl(params)
      ? params.elicitationId
      : null;
    const settled = await put(form, signal, (id) => {
      // Held under the AGENT'S OWN id, which is the only name
      // `elicitation/complete` says. One with no id cannot be completed by
      // name, so nothing holds it and the row is settled by a person.
      if (settling !== null) waitingLinks.set(settling, id);
    });
    if (settled.outcome.how === "declined") return { action: "decline" };
    if (settled.outcome.how === "withdrawn") return { action: "cancel" };
    return { action: "accept", content: settled.content };
  };

  /** ... AND THE ONE A SIGN-IN IS WAITING ON, which is the same payload with no
   *  session to put it in. The promise this returns is what the agent is
   *  blocked on for the whole of a device-code sign-in, so it is deliberately
   *  not answered here: the completion notification accepts it when the agent
   *  says the page is done, and {@link signInCancel} declines it when somebody
   *  gives up. */
  const onLoginLink = async (
    params: CreateElicitationRequest,
    form: Form,
  ): Promise<CreateElicitationResponse> => {
    const running = attempt;
    // A CANCEL ALREADY ASKED FOR THIS ONE'S END, so the page is answered away
    // rather than drawn: the row the cancel took down must not come back
    // because the agent got as far as sending its card.
    if (running?.stopping) return { action: "decline" };
    const link = form.link;
    if (running === null || running.write !== null || link === null) {
      undrawable("the agent sent a link for something that is not a sign-in");
      return { action: "decline" };
    }
    const { promise, resolve } =
      Promise.withResolvers<CreateElicitationResponse>();
    running.link = {
      elicitationId: CreateElicitationRequest.isUrl(params)
        ? params.elicitationId
        : null,
      answer: (action) =>
        resolve(
          action === "accept"
            ? { action: "accept", content: {} }
            : { action: "decline" },
        ),
      url: link,
      message: form.message,
    };
    sayAttempt(running);
    return await promise;
  };

  /** THE AGENT SAYS A PAGE IT SENT SOMEBODY TO IS DONE. One notification, two
   *  things that could be waiting on it and only one of them can be true: a
   *  conversation's question row, or the sign-in row whose request this
   *  elicitation belongs to. */
  const onElicitationComplete = (params: unknown): void => {
    const id = completionIdOf(params);
    if (id === null) return;
    const asking = waitingLinks.get(id);
    if (asking !== undefined) {
      waitingLinks.delete(id);
      questions.answer(asking, []);
      return;
    }
    const running = attempt;
    if (running === null || running.stopping) return;
    if (running.link === null || running.link.elicitationId !== id) return;
    running.link.answer("accept");
  };

  const onPermission = async (
    params: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> => {
    // A REQUEST'S TOOL CALL IS A FRAME ABOUT THAT CALL — the adapter builds its
    // `_meta` the same way it builds an announcement's — so it goes in through
    // the same door rather than being read as a second kind of source.
    calls.heard(params.toolCall.toolCallId, params.toolCall._meta);
    const named = calls.about(params.toolCall.toolCallId).name ?? null;
    // The tools kolu handed this conversation are answered here and now, and
    // everything else is put in front of a person. Which is which is the leg's
    // `allowedWithoutAsking`, where it is POSITIVE RECOGNITION: the tool is
    // named, the name belongs to a server WE handed over, and the request
    // offers an allow-FLAVOURED option — never "the first option".
    const allowed = leg.allowedWithoutAsking(named, given, params.options);
    if (allowed !== null) {
      return { outcome: { outcome: "selected", optionId: allowed } };
    }
    if (fromElsewhere(params.sessionId, activeSession, closed)) {
      return { outcome: { outcome: "cancelled" } };
    }
    const settled = await put(permissionFormOf(params), signal);
    const picked = settled.content[PERMISSION_FIELD];
    return typeof picked !== "string"
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId: picked } };
  };

  // ── the session stream ───────────────────────────────────────────────

  const onUpdate = (notification: SessionNotification): void => {
    // WHOSE SESSION. A chunk of the conversation that just closed, landing
    // after the next one opened, is how a new conversation failed to empty: the
    // panel showed the last turn's words in a conversation nobody had spoken
    // in.
    if (fromElsewhere(notification.sessionId, activeSession, closed)) return;
    const update = notification.update;
    // A REPLAY IS HISTORY SOMEBODY ELSE ALREADY HAS. `session/load` re-emits
    // every message of the conversation before it answers, and the rows the
    // caller restored are strictly richer than that re-emission: they carry
    // kolu's own readings — tool cards, notices, the fleet, who asked what —
    // which no agent's transcript holds. So the replay is counted and dropped,
    // and the persisted rows stand as the record (the harness mints past their
    // `seq`, so nothing after this can collide with one).
    //
    // ONLY the history, though: {@link REPLAYED_UPDATES} says which frames are
    // the re-telling, and everything else on that stream is this session as it
    // stands right now — the commands it offers, the settings it is on, how
    // full its context is — which nobody else can tell us.
    if (replaying && REPLAYED_UPDATES[update.sessionUpdate] === true) {
      replayed += 1;
      return;
    }
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textOf(update.content);
        // The doubled prologue is dropped HERE rather than anywhere narrower:
        // the chunk is otherwise speech, and every counter a chunk feeds is
        // downstream of this one door.
        if (text !== "" && prologue !== null && text === prologue) {
          prologue = null;
          return;
        }
        if (text !== "") report(transcript.say(text));
        return;
      }
      case "user_message_chunk": {
        const text = textOf(update.content);
        // A TASK-NOTIFICATION is not a person speaking: the harness injects a
        // background task's report as a user-role turn, and drawing it as a
        // bubble puts the report in the human's column. It belongs in the
        // arming row's fold. Looked at LIVE as well as on replay, because the
        // injected turn is not one kolu sent.
        const notification = leg.taskNotification(
          text,
          "_meta" in update
            ? (update as { readonly _meta?: Record<string, unknown> })._meta
            : undefined,
        );
        if (notification !== null) {
          if (notification.onto !== null) {
            report(
              transcript.tool(notification.onto.toolUseId, {
                armed: {
                  task: notification.onto.task,
                  ...(notification.onto.report === ""
                    ? {}
                    : { report: notification.onto.report }),
                },
              }),
            );
            publish();
          }
          return;
        }
        // A LIVE user chunk is kolu's own message coming back: the row for it
        // was minted when somebody pressed send, and drawing the echo would
        // double every message in the conversation.
        return;
      }
      // Announce and update are ONE event: the protocol distinguishes them by
      // which fields it guarantees, and a consumer keyed by call id does the
      // same thing with either.
      case "tool_call":
      case "tool_call_update": {
        onToolCall(update);
        return;
      }
      // `status` is copied, not narrowed like a tool call's `statusOf`: the
      // SDK parses every `session/update` before this sees it, and a plan
      // entry whose status is outside its three-word union is SKIPPED there
      // (`vecSkipError(zPlanEntry)`), and a wider SDK union stops compiling
      // here — the row's own `Literals` are the same three words.
      case "plan":
        report(
          transcript.plan(
            update.entries.map((entry) => ({
              content: entry.content,
              status: entry.status,
              priority: entry.priority ?? null,
            })),
          ),
        );
        return;
      case "available_commands_update":
        commands = update.availableCommands.map((command) => ({
          name: command.name,
          description: command.description ?? null,
        }));
        publish();
        return;
      case "config_option_update":
        readSettings(update.configOptions);
        publish();
        return;
      case "usage_update": {
        // How full the context is — the one thing a person needs to decide
        // whether to compact. Several a turn: the agent revises `used` as it
        // goes and may revise `size` too, so the newest wins.
        const read = usageIn(update);
        if (read !== null) {
          usage = read;
          publish();
        }
        return;
      }
      default:
        // Thoughts, and the kinds this panel has no view for. Ignored QUIETLY
        // rather than half-rendered: a marker for each would be a transcript of
        // apologies about features kolu does not have. A chunk whose CONTENT
        // cannot be drawn is the other thing entirely, and `textOf` marks it.
        return;
    }
  };

  const onToolCall = (update: {
    readonly toolCallId: string;
    readonly title?: string | null;
    readonly status?: string | null;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<unknown> | null;
    readonly locations?: ReadonlyArray<unknown> | null;
    readonly _meta?: { readonly [key: string]: unknown } | null | undefined;
  }): void => {
    // Not drawn and not published: what this frame said about its call — which
    // tool it is, and which agent made it — is what the two question handlers
    // need and what neither question they answer carries.
    calls.heard(update.toolCallId, update._meta);
    const recognized = leg.mcpCall(
      {
        title: update.title,
        rawInput: update.rawInput,
        _meta: update._meta,
        name: calls.about(update.toolCallId).name,
      },
      given,
    );
    calls.recognized(update.toolCallId, recognized);
    const call = calls.about(update.toolCallId).mcp ?? null;
    // A TOOL WE CANNOT POSITIVELY NAME GETS NO READING. `call` is non-null only
    // where the leg matched this agent's own spelling against a server WE
    // handed over, so a kolu reading is minted for a kolu tool and for nothing
    // that merely looks like one.
    // THE ANSWER THROUGH THE LEG. An MCP server's reply reaches this adapter
    // as the TEXT of a content block — `kolu mcp` answers JSON, so `rawOutput`
    // arrives as a JSON STRING and not an object — and which corner of a frame
    // an agent puts its structured answer in is exactly the question a leg
    // exists to answer. Reading `rawOutput` directly left every `create` card
    // nameless and the fleet empty against the real adapter.
    const answer = leg.replyIn(update.rawOutput) ?? update.rawOutput;
    const seen =
      call === null ? null : koluCallOf(call.tool, update.rawInput, answer);
    // ACCUMULATED, not per-frame: the arming frame carries the input and the
    // settling frame carries the answer, so a card built from either alone is
    // missing the half the other had. `refineKoluCall` keeps whichever frame
    // said something, because a frame refines and never retracts.
    const kolu = refineKoluCall(
      koluReadings.get(update.toolCallId) ?? null,
      seen,
    );
    if (kolu !== null) koluReadings.set(update.toolCallId, kolu);
    if (kolu !== null && fleet.touch(kolu)) publish();
    const armed = leg.backgroundTask(update._meta);
    report(
      transcript.tool(update.toolCallId, {
        title: update.title ?? undefined,
        status: statusOf(update.status),
        server: call?.server,
        tool: call?.tool,
        detail: detailOf(update.rawInput, update.rawOutput),
        asked: detailOf(update.rawInput, undefined),
        progress: progressOf(
          update.content as Parameters<typeof progressOf>[0],
        ),
        diffs: diffsOf(
          update.content as Parameters<typeof diffsOf>[0],
          options.cwd,
        ),
        locations: locationsOf(
          update.locations as Parameters<typeof locationsOf>[0],
          options.cwd,
        ),
        ...(kolu === null ? {} : { kolu }),
        // WHO made the call, out of the same `_meta` the name came from: a
        // subagent's frames arrive on this one feed with nothing in the
        // protocol to tell them apart.
        parent: leg.parentToolUse(update._meta) ?? undefined,
        // ... and, the other way round, whether this call SENT an agent out.
        // The leg answers structurally — absent where it knows nothing — and
        // the row says `null` for the same, because a row is a value on a wire
        // and `undefined` is not one of its words.
        spawned: spawnedOf(leg.spawned(update._meta, update.rawInput)),
        // ... and whether it ARMED a background task, which is the one kind of
        // call that goes on happening after this frame and after the turn.
        armed: armed ?? undefined,
        provisional: leg.provisionalTitle?.(update),
      }),
    );
    publish();
  };

  /** The protocol's four words and the panel's are the same four, and this is
   *  the one seam that says so: a fifth status on either side stops compiling
   *  HERE, where a person can decide what the panel should do with it, rather
   *  than riding a cast onto a row whose look-up table has no entry for it. */
  const statusOf = (
    status: string | null | undefined,
  ): "pending" | "in_progress" | "completed" | "failed" | undefined => {
    switch (status) {
      case "pending":
      case "in_progress":
      case "completed":
      case "failed":
        return status;
      default:
        return undefined;
    }
  };

  // ── the settings, and the one of them that is the model ──────────────

  /**
   * EVERY SETTING THE AGENT OFFERS, and which of them is the model.
   *
   * The model row is BOTH THINGS AT ONCE and used to be only one: it is the
   * reading the header draws its name and its context size from, AND it is the
   * agent's own model picker. Pulled out into `picker` and left out of
   * `settings`, it became a header that said "Opus 5.5" over a popover with no
   * MODEL section in it — the panel offered every setting the agent advertised
   * except the one a person opens that popover to change. So it goes in BOTH,
   * marked `model` and published first, because the model is what the brief
   * and olai's own panel put at the top of that list.
   *
   * The MARK is what a drawer needs and cannot work out for itself: a select
   * is drawn as rows, a boolean as one toggle on one line, and a boolean told
   * apart by "has no choices" would also catch a select whose rows this end
   * could not read — which is a heading with nothing under it, which is what
   * FAST MODE drew.
   */
  const readSettings = (
    config: ReadonlyArray<SessionConfigOption> | null | undefined,
  ): void => {
    const read: Array<ConductorOption> = [];
    let picker: ConductorOption | null = null;
    for (const option of config ?? []) {
      // A SELECT'S ROWS, which the protocol lets an agent send as groups of
      // rows rather than as rows. A group has no id of its own and is not a
      // value anybody can pick, so only the leaves are offered: a picker drawn
      // with a group in it would be one whose heading is selectable.
      const choices = choicesOf(option);
      const isModel = leg.models !== null && option.id === leg.models.config;
      const row: ConductorOption = {
        id: option.id,
        name: option.name,
        description: option.description ?? null,
        value: optionValueOf(option),
        choices,
        kind: isModel ? "model" : kindOf(option, choices),
      };
      if (isModel) picker = row;
      else read.push(row);
    }
    settings = picker === null ? read : [picker, ...read];
    if (picker === null) return;
    labels = new Map(
      picker.choices.map((choice) => [choice.value, choice.label]),
    );
    const id = picker.value;
    model = id === null ? null : modelOf(id);
  };

  /** The model row, under whichever id has just named one: the picker's
   *  confirmed value, or the live id the agent's own channel reported. ONE
   *  reader for both, because they are the same question asked at two moments
   *  — and a header that took the NAME from one and the SIZE from the other
   *  would be describing two conversations. */
  const modelOf = (id: string): ConductorModel => ({
    id,
    name: leg.models?.nameIn(labels, id) ?? id,
    // A `window` of `null` is a REFUSAL rather than a failure: a leg's table
    // answers for the models its picker names and for nothing else, and naming
    // one five times the real size in the line you would read to decide
    // whether to compact is worse than naming nothing. A leg that declares no
    // `windowIn` at all reads the same way — `@kolu/acp` is shared vocabulary
    // and the member is optional precisely so a leg written before it existed
    // stays legal.
    window: leg.models?.windowIn?.(labels, id) ?? null,
  });

  const optionValueOf = (option: SessionConfigOption): string | null => {
    if (!("currentValue" in option)) return null;
    const value = (option as { currentValue?: unknown }).currentValue;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "true" : "false";
    return null;
  };

  // ── bringing it up ───────────────────────────────────────────────────

  const childEnv = (
    extra?: Readonly<Record<string, string>>,
  ): NodeJS.ProcessEnv =>
    childEnvOf(process.env, { ...adapter.env, ...extra }, adapter.unset);

  const child = startChild(adapter.command, adapter.args, {
    cwd: options.cwd,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr?.on("data", (chunk: string | Buffer) => {
    const text = (
      typeof chunk === "string" ? chunk : chunk.toString("utf8")
    ).trimEnd();
    const sep = stderrBuf === "" || stderrBuf.endsWith("\n") ? "" : "\n";
    stderrBuf = `${stderrBuf}${sep}${text}`;
    stderrWritten += sep.length + text.length;
    if (stderrBuf.length > STDERR_CAP) stderrBuf = stderrBuf.slice(-STDERR_CAP);
  });

  /** The agent's own words since a turn began. `stderrWritten` is the bytes
   *  appended since spawn INCLUDING what the cap has trimmed off the left, and
   *  a turn snapshots that counter rather than the buffer's length — once the
   *  cap bites, the length is stuck at the cap and a slice from there is empty,
   *  at the diagnosis moment. */
  const stderrSince = (from: number): string => {
    const origin = stderrWritten - stderrBuf.length;
    return stderrBuf.slice(Math.max(0, from - origin)).trim();
  };

  /**
   * ONE OF THOSE MESSAGES, read for the two things it is subscribed to for.
   *
   * The MODEL is why the subscription exists: an adapter that handles a model
   * switch inside the CLI it wraps never sees a config change, so its
   * `configOptions` go on naming the model the session STARTED on while the
   * turns run on another. The newest word wins, and it is drawn exactly like
   * the picker's own ({@link modelOf}) so the header cannot say one model and
   * size another.
   *
   * The SERVERS ride it, at the cost of one more read of a message already
   * being read.
   */
  const onRaw = (raw: RawMessages, params: unknown): void => {
    const id = raw.modelIn(params);
    if (id !== null && model?.id !== id) {
      model = modelOf(id);
      publish();
    }
    const reports = raw.serversIn(params);
    if (reports !== null) reported(reports);
  };

  /**
   * THE ROSTER MOVED, because the agent said something about a server.
   *
   * ONLY THE AGENT'S OWN WORD moves a row off `handed`, and only for a server
   * WE HANDED OVER: a name the agent reports and this conversation never gave
   * it adds no row, because the roster answers "what did this conversation get
   * and what became of it" and a row nobody handed over is an answer to some
   * other question. `missing` is not minted here at all — that one is a
   * prober's no, decided before anything was handed over, and an agent may not
   * overwrite it.
   *
   * POSITIVE RECOGNITION, the leg's rule read one layer up: `connected` is the
   * row the leg said was attached, and every other word it carried — a
   * failure, a `needs-auth`, a word no version has sent yet — is `unattached`
   * with that word beside it, because a person can act on `needs-auth` quite
   * differently from `failed`.
   */
  const reported = (reports: ReadonlyArray<Reported>): void => {
    let moved = false;
    servers = servers.map((row) => {
      const said = reports.find((one) => one.name === row.name);
      if (said === undefined) return row;
      const standing = said.attached
        ? ("connected" as const)
        : ("unattached" as const);
      if (row.standing === standing && row.said === said.said) return row;
      moved = true;
      return { ...row, standing, said: said.said };
    });
    if (moved) publish();
  };

  const app = acpClient({ name: "kolu" })
    .onNotification(methods.client.session.update, (context) => {
      onUpdate(context.params);
    })
    // THE AGENT'S OWN ACCOUNT OF WHO IT IS, with no session fence, because the
    // notification is CONNECTION-scoped: it carries no `sessionId`, and the
    // fact belongs to the PROCESS rather than to whichever conversation that
    // process happens to hold — so it survives a `newSession`. Subscribed
    // unconditionally rather than off a handshake marker, because the protocol
    // says a client that never saw the marker still accepts the notification.
    .onNotification(
      AUTH_STATUS_METHOD,
      (params: unknown) => params,
      (context) => {
        const next = identityIn(context.params);
        if (next === null) return;
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
        if (next.kind === "none") offerSignIn(next.label);
        else if (attempt === null) signIn = null;
        publish();
      },
    )
    .onRequest(methods.client.session.requestPermission, (context) =>
      onPermission(context.params, context.signal),
    )
    .onRequest(methods.client.elicitation.create, (context) =>
      onElicitation(context.params, context.signal),
    )
    .onNotification(methods.client.elicitation.complete, (context) => {
      onElicitationComplete(context.params);
    });

  // THE AGENT'S OWN MESSAGES, for an agent that forwards any — subscribed only
  // where its leg names a channel, because the method is an extension and
  // there is no leg-neutral spelling of one. This is what the open's `_meta`
  // pays for ({@link RawMessages}), and it buys the two facts ACP proper has
  // nowhere to carry: which model a turn is really running on, and what the
  // agent says about its own connection to each server we handed it.
  const raw = leg.rawMessages;
  if (raw !== null) {
    app.onNotification(
      raw.method,
      (params: unknown) => params,
      (context) => {
        onRaw(raw, context.params);
      },
    );
  }

  const connection = app.connect(streamOver(child));

  live = { child, connection };

  // `close` rather than `exit`, and the listener is the one attached at spawn.
  void child.closed.then(({ code, signal }) => {
    if (child.failed() !== undefined) return;
    if (live?.child !== child) return;
    live = null;
    // Before anything else: a form left live on a dead wire is a control that
    // does nothing, and pressing it is how a person finds out.
    leaving();
    identity = null;
    activeSession = null;
    report(transcript.abandon());
    if (!stopped) {
      notice(
        `the agent exited (code ${code ?? "none"}, signal ${signal ?? "none"})`,
      );
    }
    publish();
  });

  /** The conversation is over — replaced, reloaded, or dead. Everything keyed
   *  to it goes. {@link closed} is named FIRST, while `activeSession` is still
   *  the one being left: nulling it first is what turns the leftover fence off
   *  for the whole of the next open. */
  const leaving = (): void => {
    if (activeSession !== null) closed.add(activeSession);
    waitingLinks.clear();
    questions.withdrawAll();
    calls.forget();
    fleet.clear();
    koluReadings.clear();
    // ... and the doubled-prologue arm with the rest: it names a chunk the
    // session BEING LEFT announced, and an arm whose banner never landed would
    // otherwise spend the life of the process waiting to eat the first chunk of
    // any later conversation that happens to equal it.
    prologue = null;
    taught = false;
    // ... AND THE INTERRUPTION COMES BACK. The latch is about a SESSION the
    // adapter poisoned, not about the agent: a conversation that is over
    // cannot be hung by a steer into it, and the next one starts clean.
    queuedHere = false;
    model = null;
    usage = null;
    commands = [];
    settings = [];
  };

  // THE HANDSHAKE, raced against an exec that never happened: a bad adapter
  // path fails AFTER `spawn` returns, and the refusal a person needs is the
  // name of the file that is not there rather than our end of a dead pipe.
  const failedToStart = child.unstartable.then((why) => {
    throw new HarnessUnavailable(
      `could not start the agent \`${adapter.command}\`: ${why}`,
    );
  });

  // ── opening the conversation ─────────────────────────────────────────

  const opening = (): NewSessionRequest =>
    ({
      cwd: options.cwd,
      mcpServers: [...handing],
      ...openMeta,
    }) as NewSessionRequest;

  const fresh = async (): Promise<void> => {
    const made = (await request(
      methods.agent.session.new,
      opening(),
    )) as NewSessionResponse;
    // ARMED ON THE RESPONSE, immediately: the doubled chunk is written after
    // the response on the one stream, and a response's continuation runs before
    // the next notification can be pulled. An adapter that reorders ships the
    // banner to the transcript instead, which is the safe direction.
    prologue = leg.prologueIn(made);
    readSettings(made.configOptions);
    await restoreModel(made.sessionId);
    await askForBypass(made.sessionId, made.configOptions);
    enter(made.sessionId);
  };

  /**
   * END THE CONVERSATION BEING LEFT, at the agent — ACP's `session/close`.
   *
   * MEASURED, against the pinned Claude adapter 0.81.2: a session's work runs
   * in its own SDK `query()`, and `query()` SPAWNS A `claude` CLI the moment
   * the session is made (`dist/acp-agent.js`, the `session/create …
   * phase=prepare-query` leg). Nothing ever ends that CLI except
   * `session/close` — which cancels the turn, ends the input stream and calls
   * `query.close()`, terminating the subprocess — or the connection dying,
   * whose `dispose()` runs that same teardown over every session still held.
   * So a client that opens a second conversation on one adapter and never
   * closes the first leaves the first CLI running for the life of the
   * process: one `session/new`, one `claude`, for ever. Counted on this box
   * with two `session/new` calls down one adapter: two live `claude`
   * children, and one once this close goes between them. A production padi
   * was found holding five, at ~35% CPU each.
   *
   * BEFORE the new open rather than after it, for two reasons. A host must
   * never carry two agent CLIs for one panel — the second one is the whole
   * cost this prevents. And an open that FAILS would otherwise leave the old
   * conversation running with nothing on this side able to reach it:
   * `activeSession` is already null by then, and the only thing that ever
   * enters an id again is a resume at startup.
   *
   * WHAT IT DOES NOT DO is forget the conversation. Closing a session ends
   * its process; the agent's stored transcript is untouched (ACP spells
   * forgetting `session/delete`), which is what makes a later resume of the
   * id padi persisted still a resume.
   *
   * SWALLOWED, and no row. There is no capability to read first — ACP
   * advertises `loadSession`, `session/list`, `session/delete` and not this —
   * so an agent without it answers "method not found", and a refusal to end a
   * conversation nobody is in is not a reason to refuse a person the new one
   * they asked for, nor a sentence anybody could act on. It is logged,
   * because the thing it leaves behind is a process.
   */
  const release = async (sessionId: string | null): Promise<void> => {
    if (sessionId === null) return;
    try {
      await request(methods.agent.session.close, { sessionId }, CLOSE_TIMEOUT);
    } catch (cause) {
      log.warn(
        { session: sessionId, why: messageOf(cause) },
        "the conversation we left could not be closed; the agent may still be holding it",
      );
    }
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
   * So a REFUSAL that is not an auth refusal falls through to one
   * `session/new`, once, and nothing is retried. An AUTH refusal does NOT:
   * `-32000` says the agent will not open ANY conversation for want of a
   * signature, and a fresh session asked for in the same breath is the same
   * refusal again — that one keeps its offer of a sign-in ({@link
   * refusedOpen}). Anything that is not a refusal at all — a load that never
   * answered, a pipe that died — is the broken agent, and it goes out of here
   * the way it always did.
   *
   * WHAT THE FALL-THROUGH KEEPS is the transcript: it is kolu's record of the
   * conversation, not the CLI's, and the rows in it are ours whatever the
   * agent remembers. What it adds is the one thing a reader cannot see
   * otherwise — the break where the resumed conversation could not be
   * ({@link Transcript.divider}, the same mark a `newSession` mints and under
   * the same rules), and a line carrying the agent's own sentence for why.
   */
  const load = async (id: string): Promise<void> => {
    // THIS conversation is the one we are coming back to: leftover frames from
    // a previous visit are now news about this one, and the replay that follows
    // names this id before {@link enter} records it.
    closed.delete(id);
    replaying = true;
    replayed = 0;
    let loaded: LoadSessionResponse | undefined;
    /** The agent's own sentence, when the answer was a NO this end can act on
     *  — read after the `finally` rather than acted on inside it, because the
     *  session opened instead is not a replay and its frames must not be
     *  dropped by a flag this `try` has not cleared yet. */
    let lost: string | null = null;
    try {
      loaded = (await request(
        methods.agent.session.load,
        // The SAME `_meta` and the SAME servers a fresh session sends: an
        // adapter reads its subscription off whichever request MADE the
        // session, and a load makes one.
        { sessionId: id, ...opening() },
        LOAD_TIMEOUT,
      )) as LoadSessionResponse | undefined;
    } catch (cause) {
      if (!(cause instanceof HarnessRefused) || cause.auth) throw cause;
      lost = cause.why;
    } finally {
      replaying = false;
      // ONE LINE FOR THE WHOLE REPLAY, and it is a count rather than a
      // transcript: a conversation of six hundred frames logging each of them
      // is how a resume becomes the longest thing in the file.
      if (replayed > 0) {
        log.info(
          { session: id, frames: replayed },
          "dropped a session's replay; the persisted rows are the record",
        );
      }
    }
    if (lost !== null) {
      // NOTHING LEFT TO COME BACK TO: the id is spent, so every later open in
      // this process — the one a sign-in asks for, above all — is a fresh one
      // rather than this refusal again.
      resumable = null;
      log.warn(
        { session: id, why: lost },
        "the remembered conversation is not one this agent has; opening a new one",
      );
      await freshInstead(lost);
      return;
    }
    prologue = leg.prologueIn(loaded ?? null);
    readSettings(loaded?.configOptions);
    await restoreModel(id);
    await askForBypass(id, loaded?.configOptions);
    enter(id);
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
    const mark = transcript.divider("new session");
    report(mark.change);
    notice(
      `the previous conversation could not be resumed, so this is a new one: ${why}`,
    );
    try {
      await fresh();
    } catch (cause) {
      if (mark.key !== null) report(transcript.withdraw(mark.key));
      throw cause;
    }
  };

  /**
   * ASK FOR THE PERMISSION MODE THIS CONVERSATION'S WORK NEEDS, on every open.
   *
   * The leg names the mode and nothing here knows what it means — ACP leaves
   * mode ids to the agent. Asked after a LOAD as well as after a NEW, because
   * a mode belongs to the SESSION rather than to the process: a restored
   * conversation that never asked is the one where every write through kolu's
   * own MCP face becomes a question somebody has to answer by hand.
   *
   * A REFUSAL IS A ROW rather than a failed bring-up, unless the leg says
   * otherwise: the pinned Claude adapter omits this mode under root unless
   * `IS_SANDBOX` is set, and a host that cannot have it is a host whose
   * conductor still works — `allowedWithoutAsking` is the backstop that was
   * always underneath it.
   */
  const askForBypass = async (
    id: string,
    config: ReadonlyArray<SessionConfigOption> | null | undefined,
  ): Promise<void> => {
    const mode = leg.bypassMode;
    if (mode === null) return;
    try {
      await request(methods.agent.session.setMode, {
        sessionId: id,
        modeId: mode,
      });
    } catch (cause) {
      const why = `the permission mode \`${mode}\` was not selected: ${messageOf(cause)}`;
      if (leg.bypassModeRequired === true) {
        // The visit is WITHDRAWN rather than left half-made: nothing entered
        // this conversation, so its late frames are fenced exactly like those
        // of a session this harness has left.
        closed.add(id);
        throw cause instanceof HarnessRefused
          ? new HarnessRefused(why, cause.auth)
          : new HarnessUnavailable(why);
      }
      notice(`${why} — carrying on with the mode the agent chose`);
      return;
    }
    // A MODE CONFIRMED AND NOT ANNOUNCED. `session/set_mode` answers an empty
    // object and an adapter is under no obligation to follow it with a
    // `config_option_update`, so the row drawn from the open's own settings
    // would go on naming the mode this call just moved off. Only a row that is
    // a MODE and offers this very value is touched: everything else in there
    // is somebody's setting, and nothing here knows what one means.
    const modes = new Set(
      (config ?? [])
        .filter((one) => one.category === "mode")
        .map((one) => one.id),
    );
    let moved = false;
    settings = settings.map((option) => {
      if (!modes.has(option.id) || option.value === mode) return option;
      if (!option.choices.some((choice) => choice.value === mode))
        return option;
      moved = true;
      return { ...option, value: mode };
    });
    if (moved) publish();
  };

  /**
   * PUT THE CONVERSATION BACK ON THE MODEL SOMEBODY CHOSE.
   *
   * The agent's own pin outranks a conversation at the agent's end — the
   * pinned adapter resolves a session's model as env, then settings, then the
   * resumed transcript, and deliberately re-asserts the first two over the
   * third — so a model picked in this panel comes back as whatever the host
   * pins, every restart, silently. The remedy is the picker itself: say it
   * once, after the open, in the picker's own vocabulary.
   *
   * SAID ONLY WHEN IT DISAGREES. A conversation that came back on the model it
   * left on costs no round trip and has no request to fail, and disagreement
   * is judged in picker ROWS rather than in strings, because an id padi
   * remembered is as often a live API id as a picker value and those are the
   * same model ({@link pickerValueFor}).
   *
   * A REFUSAL IS A ROW: the conversation is open and usable on the agent's own
   * model, which is exactly what it was before any of this existed.
   */
  const restoreModel = async (id: string): Promise<void> => {
    const models = leg.models;
    if (models === null || wanted === null) return;
    const value = pickerValueFor(wanted);
    if (model !== null && pickerValueFor(model.id) === value) return;
    try {
      const answered = (await request(methods.agent.session.setConfigOption, {
        sessionId: id,
        configId: models.config,
        value,
      })) as SetSessionConfigOptionResponse;
      // The answer rather than the request, for {@link setOption}'s reason: the
      // row says what the agent confirmed.
      readSettings(answered.configOptions);
    } catch (cause) {
      notice(
        `this conversation was on ${models.nameIn(labels, wanted) ?? wanted}` +
          ` and could not be put back: ${messageOf(cause)}`,
      );
    }
  };

  /** What the PICKER calls the model named here — the value a
   *  `session/set_config_option` takes, out of the id that was remembered. A
   *  live id and the alias row that names it are one model said two ways, and
   *  a request in the wrong vocabulary is one the agent refuses, which leaves
   *  the conversation on the pin this exists to overrule. */
  const pickerValueFor = (id: string): string => {
    if (labels.has(id)) return id;
    const named = leg.models?.nameIn(labels, id) ?? null;
    if (named === null) return id;
    for (const [value, label] of labels) if (label === named) return value;
    return id;
  };

  /** The harness is in this conversation now. */
  const enter = (id: string): void => {
    activeSession = id;
    // Coming back into a conversation we left makes its leftovers news about
    // THIS visit.
    closed.delete(id);
    refusal = null;
    // ... and there is nothing left to sign into — UNLESS the agent says there
    // is. This used to be unconditional, on the reasoning that a sign-in row
    // exists because an OPEN was refused: MEASURED, that is false for the pair
    // kolu ships, whose signed-out `session/new` succeeds. An open is no
    // longer evidence of a signature, so the offer stands until the agent's
    // own `_auth/status_update` stops saying `none`.
    if (identity?.kind !== "none") signIn = null;
    publish();
  };

  /** The conversation this harness was asked for — the one padi named, or a
   *  fresh one. ONE DOOR, because a sign-in that succeeds opens the same
   *  conversation the refused bring-up was going to.
   *
   *  {@link resumable} rather than the caller's option, so that a signature
   *  taken after a load the agent refused opens the conversation it CAN open:
   *  the id is already known not to be there, and asking for it again would
   *  make `Sign-in failed` the first thing somebody who has just signed in
   *  reads. */
  const openConversation = async (): Promise<void> => {
    if (resumable !== null) await load(resumable);
    else await fresh();
  };

  // ── what a sign-in is OFFERED for ────────────────────────────────────
  //
  // HERE rather than beside the rest of the sign-in, because the handshake is
  // the first thing that reaches for them: an agent can refuse the open before
  // this function has finished declaring itself, and a `const` read from above
  // its own line is a `ReferenceError` on the one path that matters.

  /** WHERE THIS HOST KEEPS THE SIGNATURE, in every sentence a signed-out panel
   *  shows. Stated, never plumbed: kolu does not read the store, copy it or
   *  point the agent at another one — it names the path so the next person
   *  looks at a directory instead of guessing which one was read. */
  const storedAt = `the signature is read from ${options.configDir}`;

  /**
   * ... AND WHAT A SIGN-IN WITH NOTHING TO PRESS HAS TO SAY FOR ITSELF.
   *
   * An agent that will not work and advertises no way to fix it is a dead end,
   * and the only useful thing left is the whole of what was asked and what came
   * back: which adapter was spawned, what it calls itself, what kolu asked for
   * in the handshake, and the store it reads. A button invented here instead —
   * "offer a login anyway" — would run nothing, which is the failure this
   * sentence exists to replace.
   */
  const nothingOffered = (): string =>
    `${agentSaid ?? "the agent"} offered no way to sign in: kolu's handshake` +
    ' asked for terminal auth (`auth.terminal` and `_meta["terminal-auth"]`)' +
    " and the reply carried no `authMethods`. The adapter is" +
    ` \`${adapter.command}\`, and ${storedAt}`;

  /**
   * OFFER THE SIGN-IN — the methods the handshake advertised, under the
   * sentence that made them offerable.
   *
   * ONE DOOR for all three ways an agent asks for a signature: it says nobody
   * is signed in, it refuses the OPEN, or it refuses a TURN. They used to be
   * one and a half — only the refused open published anything — and the half
   * that was missing is the whole of the pair kolu ships.
   *
   * A RUNNING ATTEMPT IS NOT OVERWRITTEN: that row belongs to
   * {@link sayAttempt}, and re-publishing the chooser over it would take the
   * output a person is reading off the screen. Publishing is the CALLER's, so
   * one event stays one state.
   */
  const offerSignIn = (why: string): void => {
    if (attempt !== null) return;
    signIn = {
      why: `${why} — ${offered.length === 0 ? nothingOffered() : storedAt}.`,
      methods: offered.map((one) => one.method),
      attempt: null,
    };
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
    refusal = messageOf(cause);
    if (cause instanceof HarnessRefused && cause.auth) {
      offerSignIn(cause.why);
      publish();
      return true;
    }
    publish();
    return false;
  };

  // THE HANDSHAKE AND THE OPEN, in one `try` because they are one sequence and
  // a caller holds nothing until it ends: a refusal or a deadline between them
  // used to reject with the subprocess still running, and every retry left
  // another adapter — and another `claude` under it — on the host.
  try {
    const initialized = (await Promise.race([
      request(methods.agent.initialize, {
        protocolVersion: PROTOCOL,
        clientCapabilities: {
          // Not an editor: the agent reaches this host through its terminals or
          // not at all.
          fs: { readTextFile: false, writeTextFile: false },
          elicitation: { form: {}, url: {} },
          auth: { terminal: true },
          _meta: { "terminal-auth": true },
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "kolu", version: "0.1.0" },
      }),
      failedToStart,
    ])) as InitializeResponse;
    offered = methodsIn(initialized, adapter.command, adapter.args);
    agentSaid =
      initialized.agentInfo === undefined || initialized.agentInfo === null
        ? null
        : `${initialized.agentInfo.name} ${initialized.agentInfo.version}`;
    // WHAT THIS AGENT TAKES MID-TURN, read ONCE, here. Both are claims the
    // agent makes about itself at the handshake, and both are read POSITIVELY:
    // an agent that says nothing is offered no interruption and promises no
    // queue, which is the direction either is safe to lose in.
    advertisedSteering = leg.steering?.advertised(initialized) ?? false;
    queuesWhenBusy = leg.queues(initialized);
    const takes = initialized.agentCapabilities?.promptCapabilities;
    carries = {
      image: takes?.image === true,
      embeddedContext: takes?.embeddedContext === true,
    };
    await openConversation();
  } catch (cause) {
    // Everything except the signature goes with the subprocess: a conversation
    // the agent would not open is a failure a caller cannot work around, and a
    // child left running with nothing to talk to is the leak.
    if (!refusedOpen(cause)) {
      await child.stop();
      throw cause;
    }
  }

  // ── the verbs ────────────────────────────────────────────────────────

  /** What actually goes on the wire under a person's words: the standing prompt
   *  the first time this session is spoken to, then the terminals the message
   *  was ABOUT, then what they typed.
   *
   *  The mentions are repeated as a reference block because the agent cannot see
   *  the chips: what reached it has to carry the same four fields the row does,
   *  or the panel is claiming a context the model never had. */
  const bodyOf = (
    text: string,
    mentions: ReadonlyArray<ConductorMention>,
  ): string => {
    const parts: Array<string> = [];
    if (!taught) {
      taught = true;
      parts.push(options.teaching.join("\n"));
    }
    if (mentions.length > 0) {
      parts.push(
        mentions
          .map(
            (one) =>
              `[kolu] about terminal ${one.name} (${one.terminalId})` +
              `${one.cwd === null ? "" : ` · ${one.cwd}`}` +
              `${one.intent === null ? "" : ` — ${one.intent}`}`,
          )
          .join("\n"),
      );
    }
    parts.push(text);
    return parts.join("\n\n");
  };

  const runTurn = async (
    ticket: Turn,
    blocks: ReadonlyArray<ContentBlock>,
    sessionId: string,
  ): Promise<void> => {
    const from = stderrWritten;
    try {
      const answered = (await request(
        methods.agent.session.prompt,
        { sessionId, prompt: blocks },
        // A turn is a person waiting on a model: no deadline.
        null,
      )) as PromptResponse;
      report(transcript.sent(ticket.key));
      if (answered.stopReason === "cancelled") notice("the turn was cancelled");
    } catch (cause) {
      const said = stderrSince(from);
      if (said !== "")
        log.warn({ said }, "the agent's own words for a turn that failed");
      const why = messageOf(cause);
      if (cause instanceof HarnessRefused) {
        report(transcript.refused(ticket.key, cause.auth));
        // A TURN REFUSED FOR WANT OF A SIGNATURE IS THE OTHER DOOR onto the
        // sign-in, and on the pinned pair it is the FIRST one a person reaches:
        // the conversation opened, the composer was there, and `-32000` is what
        // came back from `session/prompt`. Without this the only remedy stayed
        // off the screen for the whole life of a process that had already said
        // exactly what was wrong.
        if (cause.auth) {
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
  const openTurn = (key: string): Turn => {
    if (!turns.busy) busyAt = Date.now();
    return turns.open(key);
  };

  /**
   * Run one prompt as a turn, for a row that is already on screen.
   *
   * The ORDINARY LANE, whoever's words they are: a plain `session/prompt`,
   * which starts a turn this file owns whether or not another is already
   * running. What the agent does with a second one is the agent's own business
   * — it holds it behind the first and runs it next, in order.
   */
  const send = (
    key: string,
    blocks: ReadonlyArray<ContentBlock>,
    sessionId: string,
  ): void => {
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
    void runTurn(ticket, blocks, sessionId);
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
    aimed: Turn,
    sessionId: string,
  ): Promise<"handled" | "prompt"> => {
    const steering = leg.steering;
    // Belt to the brace of `state.steers`: an agent with no steering is never
    // asked, and a caller that got it wrong loses nothing at all.
    if (steering === null) return "prompt";
    try {
      const answered = await request(
        steering.method,
        {
          sessionId,
          prompt: [{ type: "text", text: body }],
          ...(steering.meta === undefined ? {} : { _meta: steering.meta }),
        },
        // Its own deadline, where a turn has none: this adapter answers a
        // steer as soon as the message is on the SDK's input, so silence past
        // it is an agent that stopped listening rather than a slow turn.
        Duration.toMillis(steering.timeout),
      );
      if (steering.taken(answered)) return "handled";
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
        report(transcript.refused(key, cause.auth));
        if (cause.auth) offerSignIn(cause.why);
      } else {
        report(transcript.unanswered(key));
      }
      notice(
        `the message could not be steered into the turn: ${messageOf(cause)}`,
      );
      publish();
      return "handled";
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
    const sessionId = activeSession;
    if (live === null || sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
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
      // and nothing else — that is the shape of `_session/steering` — so
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
      const went = await steerInto(key, body, aimed, sessionId);
      // A steer that LANDED starts nothing here — the words are in a turn this
      // file already owns — so no ticket and no queued mark.
      if (went === "handled") return { rowId: key };
    }
    send(key, [{ type: "text", text: body }, ...attached], sessionId);
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
    const sessionId = activeSession;
    if (live === null || sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
    const { key, change } = transcript.wake(text, events);
    report(change);
    send(key, [{ type: "text", text: bodyOf(text, []) }], sessionId);
    return { rowId: key };
  };

  const cancel = async (): Promise<void> => {
    const sessionId = activeSession;
    if (live === null || sessionId === null) return;
    // The questions this turn was holding go back UNANSWERED rather than being
    // fabricated into an answer the agent never got.
    questions.withdrawAll();
    // ... and every ticket in flight remembers being stopped, which is what a
    // steer still on the wire is read against ({@link steerInto}).
    turns.stopping();
    try {
      await notify(methods.agent.session.cancel, { sessionId });
    } catch (cause) {
      // Said in the words of the thing that was asked for, not of the method
      // that carries it: what reaches a person is a refusal under the button
      // they pressed.
      throw new HarnessUnavailable(
        `the turn could not be cancelled: ${messageOf(cause)}`,
      );
    } finally {
      publish();
    }
  };

  const answer = async (
    askId: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ): Promise<boolean> => {
    try {
      return questions.answer(askId, answers);
    } catch (cause) {
      if (cause instanceof AnswerRefused) {
        // THIS END SAID NO, and the sentence says so: the answer did not
        // typecheck against the schema the agent asked in, so nothing went on
        // the wire. The question STAYS UP — settling the row and then sending
        // something else would leave a transcript claiming an answer the agent
        // never got.
        throw new HarnessRefused(
          `that answer was not sent: ${cause.message}`,
          false,
        );
      }
      throw cause;
    }
  };

  const setOption = async (id: string, value: string): Promise<void> => {
    const sessionId = activeSession;
    if (sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
    const answered = (await request(methods.agent.session.setConfigOption, {
      sessionId,
      configId: id,
      ...settingValueOf(id, value),
    })) as SetSessionConfigOptionResponse;
    // A REFUSED CHANGE LEAVES THE VALUE WHERE IT WAS, which is what reading the
    // answer rather than the request buys: the row says what the agent
    // confirmed, never what was asked for.
    readSettings(answered.configOptions);
    // ... and if the MODEL is what moved, that is now the model a person
    // chose: the next conversation this process opens opens on it, rather than
    // on whatever was remembered when the harness started.
    if (leg.models !== null && id === leg.models.config) {
      wanted = model?.id ?? wanted;
    }
    publish();
  };

  const newSession = async (): Promise<void> => {
    // THE ONE BEING LEFT, named while it still is: {@link leaving} reads
    // `activeSession` and the line after it nulls it.
    const left = activeSession;
    // BEFORE the break, so every question is settled on the row it is drawn on
    // rather than after that row has been cleared away.
    leaving();
    activeSession = null;
    // THE HISTORY STAYS. A conversation ends and another begins in ONE
    // transcript, with the divider between them — that is the product, and it
    // is also the only version padi can persist without lying: these rows are
    // padi's own and a `clear` would remove ids this harness never minted.
    // The counters are monotonic for the life of the process, so the divider
    // and everything after it sorts below what is already there.
    const mark = transcript.divider("new session");
    report(mark.change);
    // ... and the conversation just left is ENDED at the agent before the next
    // one is opened, rather than left running beside it ({@link release}).
    await release(left);
    try {
      await fresh();
    } catch (cause) {
      // A BREAK THAT BROKE NOTHING COMES BACK OUT. The divider says one thing
      // — the agent's memory was reset — and a conversation that would not
      // open has reset nothing a reader needs told about. Left standing, it is
      // also what a retry stacks on: the owner's screenshot was four
      // `— NEW SESSION —` lines with no conversation between them, one per
      // attempt, over a host whose adapter would not open a session.
      if (mark.key !== null) report(transcript.withdraw(mark.key));
      // SAID BEFORE IT IS THROWN: a conversation that would not open leaves a
      // panel with a composer and nothing to explain it, and the caller's own
      // error reaches a log rather than this screen.
      refusedOpen(cause);
      throw cause;
    }
    publish();
  };

  /**
   * HOW A SETTING'S NEW VALUE GOES ON THE WIRE, which is two shapes and not
   * one: `session/set_config_option` carries a select's value as the row's own
   * id and a BOOLEAN as `{type: "boolean", value: true}` — the pinned Claude
   * adapter refuses the string `"true"` for its FAST MODE toggle outright
   * (`Invalid value for config option fast`).
   *
   * The string stays padi's whole vocabulary: a wire that carried two value
   * types would be a second thing for every layer above to get right, and the
   * one end that knows which settings are booleans is this one — it read the
   * advertisement.
   */
  const settingValueOf = (
    id: string,
    value: string,
  ):
    | { readonly value: string }
    | { readonly type: "boolean"; readonly value: boolean } => {
    const option = settings.find((one) => one.id === id);
    if (option?.kind !== "boolean") return { value };
    if (value !== "true" && value !== "false") {
      throw new HarnessRefused(
        `\`${option.name}\` is a switch and takes \`true\` or \`false\`, not \`${value}\``,
        false,
      );
    }
    return { type: "boolean", value: value === "true" };
  };

  // ── signing in ───────────────────────────────────────────────────────

  const sayAttempt = (running: Attempt): void => {
    // A WITHDRAWN ATTEMPT IS NOT DRAWN: the runner goes on finishing the
    // process it started after the slot was given up, and the row a cancel
    // took away must not come back behind it.
    if (running.stopping) return;
    signIn = {
      // The agent's own sentence, which is on the state already: it is the
      // refusal that made this sign-in offerable in the first place. An empty
      // one means nobody refused anything and somebody asked for a sign-in
      // anyway, which is a true thing to say and not a row anybody draws.
      why: signIn?.why ?? refusal ?? "",
      methods: offered.map((one) => one.method),
      attempt: {
        method: running.method,
        state: running.state,
        output: running.output,
        link: running.link === null ? null : { ...running.link.url },
      },
    };
    publish();
  };

  const clearAttempt = (): void => {
    signIn =
      signIn === null
        ? null
        : { why: signIn.why, methods: signIn.methods, attempt: null };
    publish();
  };

  /** ... AND THE WHOLE OFFER, once a sign-in SUCCEEDED. Exit 0 is the whole of
   *  "it worked" for every one of these CLIs, and a chooser left standing over
   *  an agent somebody has just signed into is a row that invites a second
   *  login. Not merged into {@link clearAttempt}: a CANCELLED attempt must
   *  leave the methods on screen, which is the same call and the opposite
   *  answer. If this end is wrong — the command exited 0 and signed nobody in
   *  — the agent's own next word puts the offer back, which is what the two
   *  doors into {@link offerSignIn} are for. */
  const signedInNow = (): void => {
    signIn = null;
    publish();
  };

  const doSignIn = async (method: string): Promise<SignedIn> => {
    if (stopped) throw new HarnessUnavailable("the harness is shutting down");
    const running = attempt;
    if (running !== null) {
      // ONE ATTEMPT PER AGENT: the same method ATTACHES to the row already
      // being drawn, and a different one is refused — two sign-ins at once is
      // two processes writing the same credential store.
      if (running.method === method) return "attached";
      throw new HarnessRefused(
        `a sign-in is already running (${running.label})`,
        false,
      );
    }
    const found = offered.find((one) => one.method.id === method);
    if (found === undefined) {
      throw new HarnessRefused(
        `\`${method}\` is not a sign-in this agent offers`,
        false,
      );
    }
    // THE CLAIM, taken with nothing awaited between reading the slot and
    // filling it, so a second press in the same tick attaches rather than
    // spawning a second process.
    const claim: Attempt = {
      method,
      label: found.method.name,
      write: null,
      stopping: false,
      stop: () => Promise.resolve(),
      link: null,
      output: "",
      state: "running",
    };
    attempt = claim;
    let ended: SignedIn;
    try {
      ended =
        found.run === null
          ? await runAgentSignIn(claim, found)
          : await runTerminalSignIn(claim, found.run);
    } finally {
      attempt = null;
    }
    // A CANCEL IS DECIDED ONCE, here, by the one place that owns the slot a
    // cancel withdraws. A runner crosses five awaits and a person can press
    // the button at any of them; re-pairing the ending with its clean-up at
    // each boundary was five chances to pair them wrong.
    if (claim.stopping) {
      clearAttempt();
      ended = "cancelled";
    }
    // ... AND THE CONVERSATION THE REFUSAL COST, opened here rather than by
    // whoever pressed the button. The thing that knows what to open — this
    // session id or a fresh one, these servers, this `_meta` — is the harness
    // that was refused. A caller told to "start again" would have to spawn a
    // second adapter to reach a conversation this process is one request away
    // from.
    //
    // FRESH EVEN WHEN ONE IS ALREADY OPEN, because an open conversation is not
    // evidence of a usable one: a signed-out `session/new` SUCCEEDS on the
    // pinned pair, and the SDK query behind that session was created by a
    // `claude` with no credential. The adapter recreates such a query only
    // under `--hide-claude-auth` (`markSessionForSignOutRespawn` returns at
    // once without the flag, and kolu passes no flag), and its own note says
    // the credential that replaced the cached one "is invisible until a new
    // `initialize` runs". Left alone, every turn in the conversation somebody
    // just signed into would go on being refused.
    if (ended === "signed-in" && !stopped) {
      const left = activeSession;
      if (left !== null) {
        leaving();
        activeSession = null;
        await release(left);
      }
      try {
        await openConversation();
      } catch (cause) {
        // The signature was taken and the conversation still would not open.
        // That belongs on the panel rather than under the button, which has
        // already done the job it was pressed for.
        refusedOpen(cause);
        notice(`the conversation could not be opened: ${refusal ?? ""}`);
      }
    }
    return ended;
  };

  /** A TERMINAL METHOD: a process this harness runs, whose output IS the row.
   *
   *  `BROWSER=true` is not decoration — a CLI that thinks a browser is
   *  available opens one, and on a host that is either an error or somebody
   *  else's desktop. Exit 0 is the whole of "it worked", which is the contract
   *  every one of these CLIs keeps; anything else leaves the output on the row
   *  AS the failure, because for a CLI the output is what a person reads. */
  const runTerminalSignIn = async (
    claim: Attempt,
    run: {
      command: string;
      args: ReadonlyArray<string>;
      env: Readonly<Record<string, string>>;
    },
  ): Promise<SignedIn> => {
    let process_: Child;
    try {
      process_ = startChild(run.command, run.args, {
        cwd: options.cwd,
        env: childEnv({ BROWSER: "true", ...run.env }),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (cause) {
      throw new HarnessUnavailable(
        `could not run \`${run.command}\`: ${messageOf(cause)}`,
      );
    }
    const appended = (chunk: string): void => {
      // NOTHING IS DRAWN FOR A STOPPED ATTEMPT: a killed process still has
      // whatever it wrote in flight, and a chunk landing between the kill and
      // the close would re-draw the row the cancel just took away.
      if (claim.stopping) return;
      claim.output = `${claim.output}${chunk}`.slice(-SIGN_IN_CAP);
      sayAttempt(claim);
    };
    for (const stream of [process_.stdout, process_.stderr]) {
      stream?.setEncoding("utf8");
      stream?.on("data", appended);
    }
    // A write to a process that has gone is not this row's news, and an
    // unhandled `error` on a pipe would take padi down for somebody typing into
    // a finished login.
    process_.stdin?.on("error", () => {});
    claim.write = (line) => {
      if (process_.stdin === null || process_.stdin.destroyed) return;
      process_.stdin.write(line);
    };
    claim.stop = () => process_.stop().then(() => undefined);
    // A STOP THAT BEAT THE SPAWN is acted on here rather than never: the claim
    // is taken before the process is, which is the price of the atomicity.
    if (claim.stopping) await process_.stop();
    sayAttempt(claim);
    const close = await process_.closed;
    if (process_.failed() !== undefined) {
      claim.state = "failed";
      claim.output = `${claim.output}${process_.failed() ?? ""}\n`.slice(
        -SIGN_IN_CAP,
      );
      sayAttempt(claim);
      return "failed";
    }
    if (close.code === 0) {
      claim.state = "succeeded";
      sayAttempt(claim);
      signedInNow();
      return "signed-in";
    }
    claim.state = "failed";
    sayAttempt(claim);
    return "failed";
  };

  /** AN AGENT METHOD: a page, a person, and the agent's word for when it is
   *  done. Nothing here is a process — what this harness runs is the WAIT, and
   *  it has no deadline at all: a device-code sign-in is somebody finding their
   *  password and their phone. */
  const runAgentSignIn = async (
    claim: Attempt,
    found: Offered,
  ): Promise<SignedIn> => {
    sayAttempt(claim);
    claim.stop = async () => {
      // BOTH HALVES, in this order: the question the agent is holding goes back
      // unanswered — which is what makes a device-code login cancel the login at
      // ITS end rather than wait forever.
      claim.link?.answer("decline");
    };
    try {
      await request(
        methods.agent.authenticate,
        { methodId: found.method.id },
        null,
      );
    } catch (cause) {
      claim.state = "failed";
      claim.output = `${claim.output}${messageOf(cause)}\n`;
      sayAttempt(claim);
      return "failed";
    }
    claim.state = "succeeded";
    sayAttempt(claim);
    signedInNow();
    return "signed-in";
  };

  /** One line for the process a sign-in is running. The newline is added HERE:
   *  what a person types is a code, and every one of these CLIs reads it by
   *  line — the same kind of protocol fact as everything else this file owns. */
  const signInInput = async (text: string): Promise<void> => {
    const write = attempt?.write ?? null;
    if (write === null) {
      throw new HarnessRefused(
        "no sign-in is waiting for a line to be typed into it",
        false,
      );
    }
    write(`${text}\n`);
  };

  /** ... and stopping it. The boolean is whether there was anything to stop: a
   *  cancel with nothing behind it is a stale tab, not a failure. */
  const signInCancel = async (): Promise<boolean> => {
    const running = attempt;
    if (running === null) return false;
    // Set BEFORE the stop, because the runner reads it on its way out: which of
    // the two endings this is depends on whether a PERSON asked, and this is
    // the only moment that is known.
    running.stopping = true;
    await running.stop();
    clearAttempt();
    return true;
  };

  const stop = async (): Promise<void> => {
    // NOTHING MORE IS PUBLISHED FROM HERE, which is what `stopped` buys on its
    // way through {@link report} and {@link publish}: a turn still on the wire
    // ends somewhere inside the awaits below, its questions go back
    // withdrawn, and every one of those rows would be a row padi writes to
    // disk for a conversation the daemon has already let go. The one frame a
    // shutdown owes a reader is the last line of this function, sent by hand.
    stopped = true;
    const at = live;
    live = null;
    const signing = attempt;
    if (signing !== null) signing.stopping = true;
    leaving();
    identity = null;
    activeSession = null;
    turns.drain();
    busyAt = null;
    // Close the protocol before the process, and before joining anything
    // waiting on it.
    at?.connection.close();
    await Promise.all([at?.child.stop(), signing?.stop()]);
    attempt = null;
    options.onChange({ kind: "state", state: state() });
  };

  publish();

  return {
    state,
    // Whether there is still a subprocess to talk to — the fact `state`'s own
    // offline arm reads, said on its own because `phase` answers a different
    // question: an agent that refused the open for want of a signature is
    // offline AND alive, and a caller that replaced it would be killing the
    // process the sign-in is about to run against.
    alive: () => live !== null && !stopped,
    rows: () => transcript.rows(),
    prompt,
    wake,
    cancel,
    answer,
    signIn: doSignIn,
    signInInput,
    signInCancel,
    setOption,
    newSession,
    stop,
  };
};

/** What a leg said about an agent this call SENT OUT, in the row's own words.
 *
 *  The leg answers STRUCTURALLY — a field it knows nothing about is absent —
 *  and a row is a value on a wire, where `undefined` is not one of the words.
 *  So the translation happens once, here, rather than at the one call site
 *  where it would read as a spread nobody can see the shape of. */
const spawnedOf = (
  spawn: Spawn | null,
):
  | { readonly kind: string | null; readonly said: string | null }
  | undefined =>
  spawn === null
    ? undefined
    : { kind: spawn.kind ?? null, said: spawn.said ?? null };

/**
 * ONE SETTING'S ROWS, flattened.
 *
 * ACP lets a select carry GROUPS of rows as well as rows — a model picker that
 * sorts its aliases under headings is the shape in the wild — and a group has
 * no id of its own because it is not a value anybody can pick. So the leaves
 * are what this answers, in the agent's own order: a picker drawn with the
 * groups left in would be one whose headings are selectable, and a picker that
 * dropped the grouped rows would be one missing most of its models.
 *
 * Read through `in` and `Array.isArray` rather than through the SDK's own
 * guards because a setting that is not a select has no rows at all, and an
 * empty list is exactly the right answer for one.
 */
const choicesOf = (
  option: SessionConfigOption,
): ReadonlyArray<{
  readonly value: string;
  readonly label: string;
  readonly hint: string | null;
}> => {
  if (!("options" in option) || !Array.isArray(option.options)) return [];
  const rows: Array<{ value: string; label: string; hint: string | null }> = [];
  for (const entry of option.options as ReadonlyArray<unknown>) {
    if (typeof entry !== "object" || entry === null) continue;
    if ("options" in entry && Array.isArray(entry.options)) {
      for (const leaf of entry.options as ReadonlyArray<unknown>) {
        const row = choiceOf(leaf);
        if (row !== null) rows.push(row);
      }
      continue;
    }
    const row = choiceOf(entry);
    if (row !== null) rows.push(row);
  }
  return rows;
};

/** One leaf of {@link choicesOf} — `null` for anything that names no value,
 *  because a choice a person could pick and this end could not send back is
 *  worse than one that is not offered. */
const choiceOf = (
  entry: unknown,
): { value: string; label: string; hint: string | null } | null => {
  if (typeof entry !== "object" || entry === null) return null;
  const row = entry as {
    readonly value?: unknown;
    readonly name?: unknown;
    readonly description?: unknown;
  };
  // `value` is the protocol's own word for what a row SENDS BACK — a select's
  // rows are `{value, name, description}` while the setting around them is
  // `{id, name, …}`, and reading the setting's word here matched nothing: a
  // picker whose every row was dropped is a picker with no labels, so the
  // header named the raw id and there was no vocabulary left to say a model
  // change in.
  if (typeof row.value !== "string" || row.value === "") return null;
  return {
    value: row.value,
    label: typeof row.name === "string" ? row.name : row.value,
    hint: typeof row.description === "string" ? row.description : null,
  };
};

/**
 * WHICH CONTROL THIS SETTING IS, for a panel that has to draw it.
 *
 * A boolean is the one setting with no rows to offer — ACP's own
 * `type: "boolean"`, which the pinned Claude adapter sends for FAST MODE
 * because kolu advertised `session.configOptions.boolean` — and a panel that
 * guessed from "offers no choices" would draw the same empty heading for a
 * select whose rows this end could not read. So the VALUE is what decides it:
 * a boolean `currentValue` and nothing to pick is a switch, and everything
 * else is a list of rows.
 */
const kindOf = (
  option: SessionConfigOption,
  choices: ReadonlyArray<unknown>,
): "choice" | "boolean" =>
  choices.length === 0 &&
  "currentValue" in option &&
  typeof option.currentValue === "boolean"
    ? "boolean"
    : "choice";

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
        false,
      );
    }
    total += one.bytes;
    if (total > PROMPT_CAP) {
      throw new HarnessRefused(
        `that is ${sized(total)} of attachments and the most one message may` +
          ` carry is ${sized(PROMPT_CAP)}`,
        false,
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
      false,
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
