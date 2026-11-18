/**
 * The ACP client: one subprocess, one protocol, no browser.
 *
 * Everything about the Agent Client Protocol stops here — nothing else in olai
 * spells `session/prompt` — and nothing in here knows what a surface member, a
 * transcript entry or a browser is. A caller gets something it can boot,
 * prompt, cancel, list, load and stop, plus a stream of typed events through
 * the one handler it gave at construction ({@link ./events.ts}).
 *
 * What this owns, and why:
 *
 *   - **the subprocess and the conversation it comes up in.** Boot is
 *     adopt-or-create, and it is here rather than in the caller because it is a
 *     sequence whose order is a protocol fact: `initialize` says whether the
 *     agent even keeps sessions, `session/list` is scoped by the directory we
 *     were started in, a `session/load` replays before it answers, and the
 *     model is read off whichever result made the session. WHICH one it comes
 *     up in is {@link adopt}: the conversation this panel was last in, written
 *     down when it entered one ({@link ./memory.ts}), with the
 *     most-recently-updated one as the fallback for when that is gone — and,
 *     on the way back into it, the model it was switched to, put back through
 *     the picker the agent's own boot has just overruled ({@link restore}).
 *   - **the questions the agent asks a person**, both kinds. An
 *     `elicitation/create` is a form; a `session/request_permission` that is not
 *     one of ours is a single-select. What is HERE is that both are the same
 *     question and which methods carry them; the payload shapes are
 *     `@kolu/acp`'s (its `asks.ts`) and the promise-per-question state machine
 *     is {@link ./questions.ts}, so neither is one more thing this file's
 *     closure has to get right at the same time as a subprocess.
 *   - **which permission requests are answered without asking.** Bypass mode is
 *     the design (resolved 2026-08-09), so a call to one of the MCP servers WE
 *     handed this session — olai's mediated ops, plus whatever optional server
 *     this host answered a probe with — is allowed immediately, and everything
 *     else is a person's to answer. What is HERE is
 *     that the two paths exist and which one a request took; the rule that
 *     tells them apart is this agent's LEG (`@kolu/acp/engine`'s `Leg`), where it is a pure function
 *     with unit tests rather than a branch inside a subprocess's callback.
 *   - **reading the payloads**: which update kind this is, what a content block
 *     says, how a session list sorts. An event carries what was READ, never the
 *     raw protocol value. What any of it means to the CLAUDE CODE adapter in
 *     particular — its `_meta`, its tool naming, the message it forwards, which
 *     config option its picker is — is its LEG's (`@kolu/acp/engine`'s `Leg`); what is still
 *     here is what those readings are REMEMBERED as, which is a session's job.
 *
 * The MCP servers a session is given are olai's own internal one — the standard
 * ACP shape, and the only channel the agent has to the ops layer — plus
 * whatever OPTIONAL ones this host turns out to be running, probed per session
 * rather than at boot. This file names none of the second kind and could not:
 * the list is handed in ({@link Options.probes}) and what is on it is the
 * composition root's business, so the whole of what is here is that they are
 * asked once per conversation and what becomes of the answer
 * ({@link ./probes.ts}). The whole list travels as an event like any
 * other (`servers`), with a standing per row ({@link ./servers.ts}), so which
 * servers a conversation HAS is something the panel can say rather than
 * something the model gets asked and answers out of a context that never
 * contained it — and a detection that FAILED is one row of that answer rather
 * than the only news there is.
 *
 * `fs` capabilities are FALSE in both directions on purpose: this is not an
 * editor, and an agent that could write a file whole would be routing around
 * the format. `elicitation.form` is TRUE, and it is
 * what makes any of the above happen at all: without it the Claude Code adapter
 * puts `AskUserQuestion` in `disallowedTools`, so the agent cannot ask a
 * structured question — it has to guess, or write the question into prose and
 * hope.
 *
 * `elicitation.url` is TRUE as well, and it used to be deliberately absent.
 * The argument against it was that a URL elicitation sends a person out of the
 * panel to a page olai knows nothing about, which is a different bargain — and
 * that argument is still right about the bargain and wrong about the
 * conclusion, so the bargain is what got drawn: the card says where the link
 * goes and to WHICH MACHINE, the page is opened by the browser rather than by
 * this process, and `elicitation/complete` is what says the agent is satisfied.
 * Without it the Codex adapter withholds its device-code sign-in method
 * entirely, so an agent that needs signing in has no way to be signed in from
 * inside olai — which is what this capability is for.
 *
 * `auth.terminal` (plus the `_meta["terminal-auth"]` corner the pinned Claude
 * adapter reads) is what makes an agent offer a sign-in a CLIENT can run: with
 * it, the adapter hands over a command that prints a URL and reads a code, and
 * without it the same adapter offers only its own full-screen TUI — a screen
 * this panel cannot draw. Both are declared because the two adapters read one
 * each, and what happens after the offer is {@link signIn}'s.
 */
import { tailBytes, Terminals } from "./terminals.ts";
import { terminalMetaIn, urlOf } from "@kolu/acp";
import { type Child, childEnvOf, start as startChild } from "@kolu/child";

import {
  client as acpClient,
  CreateElicitationRequest,
  type ClientConnection,
  methods,
  RequestError,
} from "@agentclientprotocol/sdk";
import type {
  AuthMethodTerminal,
  ContentBlock,
  CreateElicitationResponse,
  InitializeResponse,
  ListSessionsResponse,
  LoadSessionResponse,
  McpServer,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  SetSessionConfigOptionResponse,
  ToolCallContent,
  ToolCallLocation,
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
  relativeTo,
  usageIn,
} from "@kolu/acp";
import type { Background, Reported, Spawn } from "@kolu/acp/engine";
import type {
  Armed,
  AskAnswer,
  AuthMethod,
  AuthStatus,
  Command,
  Server,
  Setting,
  SignIn,
  SignInLink,
  Spawned,
} from "@kolu/acp/wire";
import {
  Cause,
  Clock,
  Schema,
  Data,
  type Duration,
  Effect,
  Fiber,
  References,
  Semaphore,
} from "effect";

import type { Leg, Meta, ModelReading } from "@kolu/acp/engine";
import { acceptsSetting, settingsIn } from "./settings.ts";
import {
  modelPickerIn,
  type Picker,
  pickerValueFor,
  sameModel,
} from "./models.ts";
import { Calls } from "./calls.ts";
import { Activity } from "./activity.ts";
import { nativeActivity } from "@kolu/acp";
import { sameDirectory } from "./directory.ts";
import type { AgentEvent, Stored } from "./events.ts";
import type {
  MemorySnapshot,
  Memory,
  MemoryFailure,
  Models,
} from "./memory.ts";
import { streamOver } from "./pipes.ts";
import {
  addressesIn,
  handedIn,
  missingIn,
  type Probe,
  probed,
  type StdioServer,
} from "./probes.ts";
import * as Questions from "./questions.ts";
import { movedBy, rosterOf } from "./servers.ts";

/** An MCP server to hand a session, in olai's terms. {@link mcpServersOf}
 *  renders it into what the protocol wants. */
export interface ToolServer {
  readonly name: string;
  readonly url: string;
  /** Presented as a bearer token. The route is on the same loopback listener
   *  as everything else, and a WRITE surface any page could POST at is a
   *  different bargain from a read-only one. */
  readonly token: string;
}

/** What the plugin that owns a tool said about it: the title a person reads,
 *  and who owns it ({@link Options.advertised}). */
export interface Advertised {
  readonly title: string;
  readonly owner: string;
}

/** One sentence out of any failure — a `Cause` squashed to the error inside
 *  it, an `Error`'s message, or the value itself. */
const reasonOf = (cause: unknown): string =>
  Cause.isCause(cause)
    ? reasonOf(Cause.squash(cause))
    : cause instanceof Error
      ? cause.message
      : String(cause);

/** One log line from outside Effect — a protocol callback, a subprocess's
 *  stderr — run under the services of the fiber that yielded the emitter, so
 *  the level, the annotations and the spans in force there apply to it too.
 *  The caller supplies the logger layer; this only carries it into callbacks. */
type Emit = (line: Effect.Effect<void>) => void;
const emitter: Effect.Effect<Emit> = Effect.map(
  Effect.context<never>(),
  (services) => {
    const run = Effect.runForkWith(services);
    return (line) => {
      run(line);
    };
  },
);

/**
 * HOW a verb failed — three ways, because a caller has TWO questions and two
 * values could only ever answer one of them.
 *
 *   - `refused` — THE AGENT SAID NO. It answered the request with a JSON-RPC
 *     error: a method it does not have, a session it does not know, a mode it
 *     cannot work from. Whatever was asked for did not happen (that is
 *     JSON-RPC's own bet about its own error responses), so asking again is
 *     honest — and the agent is demonstrably THERE, because it just spoke.
 *   - `unreachable` — NOTHING WAS ASKED OF ANYTHING. This file refused before
 *     the request reached the wire: no process, a spawn that failed, no session
 *     open, a notification the pipe would not take. Also did not happen, also
 *     honest to ask again — and nothing here can say the agent is there.
 *   - `unanswered` — the request went out and NOTHING came back: the deadline
 *     passed, or the connection died with it in flight. Whether the agent acted
 *     on it cannot be known from this end — one that took a message and then
 *     went quiet is indistinguishable from one that never took it — so the
 *     honest thing to do with this is SAY so, and never quietly ask again.
 *
 * THE TWO QUESTIONS, read off the one value, which is why it is one value:
 *
 *   - *can I honestly offer this again?* — anything but `unanswered`. That is
 *     the row's `delivery` ({@link ../../surface/src/chat.ts}), which stays two
 *     valued because it is only ever asked this one;
 *   - *is the agent still there?* — `refused`, and only `refused`. It used to
 *     be unaskable: the two local arms above shared a word with the agent's own
 *     no, so a turn the agent refused was indistinguishable from a turn there
 *     was no agent to refuse it, and the panel said `not running` about a
 *     process that had just spoken to it.
 *
 * Splitting the first two rather than adding a second field is what keeps the
 * illegal combination unspellable: "the agent answered, and it is not there" is
 * not a value.
 *
 * The WIRE decides which of the first and last, not the caller: an error
 * RESPONSE arrives as the SDK's own {@link RequestError}, and every other
 * rejection — a closed connection, an interrupted deadline — is silence wearing
 * an `Error`. That reading is {@link goneOf}, and it lives here rather than in
 * `@kolu/acp/engine`'s `Leg` because it is the protocol SDK's vocabulary rather
 * than one adapter's extension. `unreachable` is never read off a rejection: it
 * is what this file mints when there was nothing to reject.
 */
export type Gone = "refused" | "unreachable" | "unanswered";

/** A VERB of this module's did not do what it was asked. Every one of them can
 *  fail this way, and where the agent is not there the next verb retries the
 *  boot — which is why a crash and a cold start are the same recovery path.
 *
 *  `why` is the sentence a person reads; {@link Gone} is what a caller can ACT
 *  on — whether what they asked for can honestly be offered again, and whether
 *  there is still an agent on the other end. Two faces in the panel are drawn
 *  entirely out of it ({@link ./chat.ts}'s `undeliverable` and the state a
 *  failed turn leaves behind). */
export class AgentGone extends Data.TaggedError("AgentGone")<{
  readonly gone: Gone;
  readonly why: string;
  /**
   * ... AND WHETHER IT SAID NO FOR WANT OF A SIGNATURE — the one refusal with
   * something to DO about it.
   *
   * A field rather than a fourth {@link Gone}, because it answers a different
   * question and the two are true at once: `gone` says whether there is still
   * an agent and whether the request can honestly be offered again (an
   * auth-required refusal is `refused` on both counts — the agent answered, and
   * the next attempt is a real attempt), and this says the one thing a caller
   * can act on beyond retrying.
   *
   * Read off the protocol's own code (`-32000`), which is the only place it is
   * ever said: ACP spells "authenticate first" as an error response, so an
   * agent that wants a sign-in before it will open a session or run a turn says
   * so exactly once, here.
   */
  readonly auth?: boolean;
  /**
   * ... AND WHETHER THE CONVERSATION IT WAS ASKED FOR IS SIMPLY NOT THERE —
   * ACP's `-32002` ("Resource not found"), answered to a `session/load` of an
   * id this engine's store has no record of.
   *
   * A second field for {@link auth}'s reason, and the same discipline: read off
   * the protocol's own code and never off the sentence, because the prose
   * around it is the adapter's to write and olai must not pattern-match an
   * agent's English. True only for a refused `session/load` — `-32002` from a
   * turn or a `session/new` is about some other resource, and a face that said
   * "this chat isn't on this machine" about it would be guessing.
   *
   * What it buys is the one refusal with a DIFFERENT way out: retrying a
   * conversation the store does not have is refused for ever, and the gesture
   * that moves is a fresh one ({@link ./chat.ts}'s `refusedOpen` carries this
   * to the browser as `Unopened.cause`).
   */
  readonly missing?: boolean;
  /**
   * ... AND WHETHER THE ACCOUNT THAT IS SIGNED IN CANNOT RUN IT — a usage
   * limit, billing, an organisation that is not allowed. A sign-in to a
   * different account is one remedy, waiting is the other, and neither is
   * "sign in" in the sense {@link auth} means.
   *
   * Read off the agent's error DATA by its leg (`Leg.accountRefusal`), because
   * which data says so is one adapter's own vocabulary; nothing is read off
   * the sentence. Never true together with {@link auth}.
   */
  readonly account?: boolean;
}> {
  override get message(): string {
    return this.why;
  }
}

/**
 * What became of a steer — and only two things can, because a steer that could
 * not be DELIVERED fails on the error channel instead of answering here. An
 * agent with no steering at all is one of those: it refuses the method, in its
 * own words, and the caller owes a person their words back exactly as it does
 * for a dead pipe or a deadline. The handshake's advertisement decides whether
 * anybody is OFFERED the gesture (`@kolu/acp/engine`'s `Leg`'s `advertised`) and
 * never what became of one that was made: a control has to be drawn before it
 * can be pressed, and what a request DID is the request's own to say.
 *
 *   - `taken` — the message is in the running turn. Nothing else to do; what
 *     the agent makes of it arrives on the transcript like everything else.
 *   - `no-turn` — the agent had nothing to steer, and has NOT taken the message
 *     (that is what the leg's steering `_meta` asks for), so
 *     the caller sends it as an ordinary prompt. This is the race rather than
 *     the ordinary path: olai steers only while it believes a turn is running,
 *     and the turn can settle between the send and the steer arriving.
 */
export type Steered = "taken" | "no-turn";

export interface Options {
  /** WHICH agent this is ({@link ./agents/roster.ts}) — the id a conversation
   *  is remembered under, so that the next boot starts the same one. */
  readonly id: string;
  /** ... and how to read what it sends. Every bet that is true of one agent
   *  and not the other is behind this (`@kolu/acp/engine`'s `Leg`); nothing in
   *  this file names an adapter. */
  readonly leg: Leg;
  /** The executable to run — the roster row's, which for the Claude leg is
   *  `KOLU_ACP_AGENT` or the adapter nix baked in. */
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Extra environment the ROSTER ROW asked for ({@link ../adapter.ts}'s
   *  `Adapter.env`), merged over this process's own at the spawn — pi-acp's
   *  `PI_ACP_PI_COMMAND` is one row that uses it, and an engine's own-memory
   *  switch (Claude's `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, Codex's
   *  `CODEX_CONFIG` overlay) is another. A value here WINS over the same name
   *  in `process.env`: the row's answer is the child's environment, which is
   *  what makes a switch an engine sets unconditional. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * ENVIRONMENT VARIABLES THIS ADAPTER MUST NOT SEE — removed from its spawn,
   * where {@link Options.env} can only add to it.
   *
   * An engine whose adapter guesses things off the environment says so here,
   * as data, and the removal happens at the spawn because that is the one place
   * a child's environment exists. The pinned Claude Code adapter is the reason
   * this field is here at all: it reads `NO_BROWSER`, `SSH_CONNECTION`,
   * `SSH_CLIENT`, `SSH_TTY` and `CLAUDE_CODE_REMOTE` to decide whether the
   * person is REMOTE, and on a remote session it offers only a full-screen
   * login TUI instead of the paste-a-code flow this panel can run. Olai
   * *is* a remote server and none of those variables is a fact about the
   * person sitting at the browser, so the adapter is told nothing about them
   * (`olai-plugin-claude`'s registration is where the five names are).
   *
   * A LIST OF NAMES and not a predicate, because there is nothing to decide:
   * the plugin knew which variables it meant, and a callback here would be that
   * decision spelled in a second package.
   */
  readonly unset?: ReadonlyArray<string>;
  /** The directory the agent works in — the served directory, absolute. It is
   *  what makes stored sessions findable: an agent keys its conversations by
   *  the directory it was started in. */
  readonly cwd: string;
  /** The tool server to hand every session, or `null` while there is none.
   *
   *  A THUNK, because the address is not known until the listener has bound and
   *  the agent is built before that — so the panel can report a boot failure
   *  rather than the boot failing to start. Read once per `session/new` and
   *  `session/load`.
   *
   *  Olai's own description, not ACP's: this module is the only one allowed to
   *  know what an `McpServer` looks like on the wire, and a composition root
   *  that hand-built one would be a second place that knows. */
  readonly tools: () => ToolServer | null;
  /**
   * The OPTIONAL servers to look for, once per conversation — whatever else
   * this host turns out to be running ({@link ./probes.ts}).
   *
   * A LIST HANDED IN, and this file names nothing that is on it. What might be
   * here is the composition root.s business, because it is the root that knows
   * which integrations this build has and which of them this serve was told to
   * run; what is here is that they are ASKED per session rather than at boot, so
   * a daemon started after olai is picked up by the next conversation instead of
   * at the next restart.
   *
   * A THUNK — and one that answers an EFFECT — rather than the list itself, and
   * that is the
   * second half of the same sentence. The list used to be built once at boot, which was exact
   * while the set of integrations could not move; it can now — a plugin is a
   * fiber on the root.s side of this wall, and one that unloads takes its probe
   * with it — so the root is asked again per session and this file holds no
   * copy. What it costs is nothing here: the answer was already asked per
   * session, and now the QUESTION is too.
   *
   * AN EFFECT because the root may have to WAIT to answer it, and a synchronous
   * signature would make that unsayable — the caller would collect whatever had
   * been settled by the time it returned and drop the rest, silently, on a path
   * whose whole subject is a tool that is missing. One microtask per session
   * open buys that away. It is an Effect rather than a promise because the root's
   * answer is one: the plugins are Effects, the waterfall that collects their
   * thunks is an Effect, and a promise here would be a bridge with a fiber on
   * both sides of it.
   *
   * OMITTED IS EMPTY, and that is the useful default rather than a convenience.
   * Every test in this package opens sessions against a fixture agent and has no
   * business waiting on a probe of this machine — before this was a parameter,
   * two suites emptied `PATH` and unset a daemon's socket variable in a
   * `beforeEach` to stop one, which is a test reaching into the process to
   * silence a dependency it could not name.
   */
  readonly advertised?: (server: string, tool: string) => Advertised | null;
  readonly probes?: () => Effect.Effect<ReadonlyArray<Probe>>;
  /** Where "which conversation is the panel's" is kept between one serve of
   *  this directory and the next ({@link ./memory.ts}). Handed in rather than
   *  built here for the reason the tool server is: this module is the one that
   *  speaks ACP, and where a machine keeps its state is not a protocol fact. */
  readonly models?: Models;
  readonly memory: Memory;
  readonly onEvent: (event: AgentEvent) => void;
}

export interface Agent {
  /** Spawn and hand-shake if that has not happened. Idempotent, and serialized
   *  against itself: two callers racing a cold start get one subprocess. */
  readonly boot: Effect.Effect<void, AgentGone>;
  /** One turn. Answers with the agent's stop reason (`end_turn`, `cancelled`,
   *  …) — the turn's END is a return value rather than an event, because the
   *  caller that asked is the one waiting. A turn the agent REFUSED fails with
   *  `refused`, which is that word's whole point: the agent answered, so the
   *  TURN ended rather than the conversation ({@link Gone}). */
  readonly prompt: (text: string) => Effect.Effect<string, AgentGone>;
  /**
   * Put a message INTO the turn already running — see {@link Steered} for the
   * two things that can come back, and the error channel for every way it
   * could not be delivered at all.
   *
   * The other half of {@link prompt}, and deliberately not a second prompt: a
   * `session/prompt` sent mid-turn is queued by the agent and reached when the
   * running turn is over, which is waiting with extra steps. This one is
   * injected, so a person can redirect an agent that is already working.
   */
  readonly steer: (text: string) => Effect.Effect<Steered, AgentGone>;
  /** Stop the turn in flight.
   *
   *  A notification, so there is nothing to WAIT for — but there is very much
   *  something that can fail: the pipe to a dead agent takes no notification
   *  either. That failure used to be swallowed, and what a person saw was the
   *  cancel button doing nothing while the turn went on streaming. It is on the
   *  channel now, so a cancel that could not be delivered refuses like every
   *  other verb. */
  readonly cancel: Effect.Effect<void, AgentGone>;
  /** Apply an advertised model value to the conversation the caller selected. */
  readonly setSetting: (
    session: string,
    config: string,
    value: string | boolean,
  ) => Effect.Effect<void, AgentGone>;
  readonly setModel: (
    session: string,
    value: string,
  ) => Effect.Effect<void, AgentGone>;
  readonly newSession: Effect.Effect<void, AgentGone>;
  readonly loadSession: (id: string) => Effect.Effect<void, AgentGone>;
  /** The stored conversations for this directory, newest first. */
  readonly sessions: Effect.Effect<ReadonlyArray<Stored>, AgentGone>;
  /**
   * Answer a question the agent asked, or — with `null` — decline it.
   *
   * Answers `false` when that question is no longer waiting: it was withdrawn,
   * or a second tab got there first. Two tabs watching one conversation is the
   * ordinary case here, so "somebody else already answered" is a state to
   * report rather than a fault, and the caller turns it into a refusal a person
   * reads.
   *
   * FAILS when the answers do not fit the question — a number field given a
   * word, a required field left empty, a key nothing asked for. The question
   * stays waiting in that case, which is the whole reason the check is here
   * rather than at the point the answer goes on the wire: settling the row and
   * then sending something else would leave a transcript claiming an answer the
   * agent never got.
   */
  readonly answer: (
    id: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ) => Effect.Effect<boolean, Questions.AnswerRefused>;
  /**
   * SIGN IN, with one of the methods the handshake advertised.
   *
   * This RUNS THE WHOLE ATTEMPT and answers when it is over, which is the one
   * shape that fits both kinds: a terminal method is a process a person types a
   * code into from wherever they are sitting, so a caller must not be able to
   * wait on it by accident — it forks this and lets the row do the waiting
   * ({@link ./chat.ts}). Everything in between is reported as {@link
   * ./events.ts}'s `signIn`.
   *
   * ONE ATTEMPT PER AGENT, and a second call while one is in flight is that
   * claim: the same method answers `attached` — the caller has attached to the
   * attempt it can already see, and nothing new was spawned — and a different
   * one refuses, because two sign-ins at once is two processes writing the same
   * credential store.
   *
   * FAILS when the method is not one this agent offers, when the process could
   * not be started at all, and when the agent refused the attempt. A sign-in
   * that ran and failed is NOT a failure here: it answers `failed`, having said
   * why on the row a person is reading ({@link ./events.ts}'s `signIn`).
   */
  readonly signIn: (method: string) => Effect.Effect<SignedIn, AgentGone>;
  /**
   * One line for the process {@link signIn} started — the code a Claude
   * subscription sign-in asks somebody to paste back.
   *
   * A LINE rather than a stream, and the newline is added HERE: what a person
   * types is a code, and every one of these CLIs reads it by line. That is the
   * same kind of protocol fact as everything else this file owns.
   *
   * FAILS when there is nothing to write to — no attempt, or an agent method,
   * which has no process behind it.
   */
  readonly signInInput: (text: string) => Effect.Effect<void, AgentGone>;
  /**
   * STOP IT — the process is killed, or the question the agent is waiting on is
   * handed back unanswered. Answers whether there was anything to stop, which
   * is what a caller says something different about (a cancel with nothing to
   * cancel is a stale tab, not a failure).
   */
  readonly signInCancel: Effect.Effect<boolean>;
  readonly stop: Effect.Effect<void>;
  readonly stopWithReason: (reason: StopReason) => Effect.Effect<void>;
}

/** Why the owner deliberately releases a subprocess. */
export type StopReason =
  | "shutdown"
  | "agent switched"
  | "plugin disabled"
  | "session list complete"
  | "node scope handoff"
  | "idle eviction"
  | "capacity eviction"
  /** Somebody pressed *Put to sleep* — the same close the two evictions above
   *  make, asked for by hand rather than by the clock or the bound. */
  | "put to sleep"
  | "scope released"
  | "stopped by app";

/** The ACP major version this client speaks. */
const PROTOCOL = 1;

/**
 * How a sign-in ended, from the caller's side of {@link Agent.signIn}.
 *
 * Four values because four different things are done about them, and none is a
 * failure of the VERB: `signed-in` is the one that reopens the conversation,
 * `failed` is already on screen as the attempt's own output (the row a person
 * is reading), `cancelled` is somebody's press and needs nobody told, and
 * `attached` is a second press that joined the first.
 */
export type SignedIn = "signed-in" | "failed" | "cancelled" | "attached";

/**
 * ACP's `_meta` corner a `terminal` auth method carries the command it wants run
 * in — the pinned Claude Code adapter's own spelling (`acp-agent.js`: the
 * method's `args` are the ADAPTER's argv, and this is the whole command line a
 * client is meant to run *instead of* its own).
 */
const TERMINAL_AUTH = "terminal-auth";

/** What running a `terminal` method takes. */
interface TerminalAuth {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The method's own environment, over olai's own. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * ONE METHOD, as this file reads it: the shape the panel draws, and what
 * running it takes.
 *
 * The two halves live together because they are one advertisement, and they go
 * to two different places: `method` is what travels to the browser
 * ({@link ./events.ts}'s `advertised`), and `run` is a command line this
 * process spawns and no browser has any business holding.
 */
interface Offered {
  readonly method: AuthMethod;
  /** What running it takes, or `null` for a method the AGENT runs — which
   *  needs no command, only the wait ({@link SignIn}'s `agent` arm). */
  readonly run: TerminalAuth | null;
}

/**
 * THE SIGN-IN IN FLIGHT, if there is one — held here because the two things
 * that act on it arrive by different roads: a person's keystroke
 * ({@link Agent.signInInput}) and the agent's own completion notification.
 *
 * One per agent, which is what makes a second press attach to the process
 * already running rather than spawn a second one.
 */
interface Attempt {
  /**
   * THE CLAIM IS THE RECORD, and it is taken BEFORE the attempt has anything
   * behind it ({@link signIn}): the fields below are filled in as the process
   * (or the request) appears, and until they are, `stop` is a no-op the runner
   * notices on its way past.
   *
   * That ordering is the whole of the mutual exclusion, and it is why nothing
   * here is `readonly`: the check-then-act a fiber would otherwise be free to
   * interleave is one step, because a claim is written down and nothing yields
   * between reading the slot and filling it.
   */
  readonly method: string;
  /** What the method is called, for the row that draws it.
   *
   *  THE METHOD'S OWN ID until the advertisement has been read, and the name it
   *  gave after: the claim has to exist BEFORE the handshake (that ordering is
   *  what makes it atomic) and the handshake is what knows the name. Nothing
   *  draws a row before the advertisement is in, so the id is only ever read by
   *  the refusal a second press gets. */
  label: string;
  /** One line to the process's stdin, or `null` while there is no process —
   *  and forever, for an agent method, which has none. */
  write: ((line: string) => void) | null;
  /**
   * SOMEBODY HAS ASKED IT TO STOP — the second half of {@link stop}, and a
   * field of the record rather than a flag beside it because that is the only
   * thing it is ever about: a cancel moves a row away, and a row exists exactly
   * while this record does. Read where an attempt ENDS (so a cancel is not
   * reported as a failure) and where something is about to be DRAWN (so a
   * cancelled attempt cannot put its row back).
   */
  stopping: boolean;
  /** Take it back: kill the process, or hand the agent back the question it is
   *  waiting on. A promise because a SHUTDOWN awaits it — a kill left in flight
   *  as the panel goes is the same class of thing the terminals beside this
   *  one wait for — while a cancel button does not.
   *
   * CALLABLE FROM THE INSTANT THE CLAIM EXISTS, which is what makes the claim
   * safe to take early: a stop that arrives before there is anything to stop
   * sets {@link stopping} (the caller's half) and the runner acts on it the
   * moment there is something to act on. */
  stop: () => Promise<void>;
  /**
   * The page this attempt is waiting on, once the agent has sent one — the
   * elicitation's own id (which is what `elicitation/complete` names) and the
   * two ways it can end.
   *
   * Written by the protocol callback and read by the completion notification
   * and by {@link Agent.signInCancel}, which is why it is a mutable field of a
   * record both can reach rather than a local of either.
   */
  link: {
    /** The id `elicitation/complete` will name, or `null` for an elicitation
     *  the agent gave none — which nothing can complete by name, so the row is
     *  settled by a person or by the sign-in ending. */
    readonly elicitationId: string | null;
    /** The agent is satisfied, or the person has backed out — both answer the
     *  request the agent is holding open, and the difference is what the agent
     *  does next (carry on, or cancel the login at its end). */
    readonly answer: (action: "accept" | "decline") => void;
    /** The row's value, for the completion notification to mark done. */
    readonly view: SignInLink;
  } | null;
}

/** How much of a sign-in's output is kept. The same order as a terminal's own
 *  cap, and for the same reason: this is a URL and a prompt, and a process that
 *  printed a book is not one a person is reading. */
const SIGN_IN_CAP = 64 * 1024;

/** A cancel that could not be delivered, said the same way on both of its
 *  paths — the refusal a caller gets, and the `trouble` the deferred one
 *  reports through. Two literals that have to match for the panel to read
 *  consistently is one literal. */
const notCancelled = (why: string): string =>
  `the turn could not be cancelled: ${why}`;

/** The server is going away, said the same way by both doors into a boot.
 *  Nothing was asked of anything, so it is `unreachable` rather than a no. */
const shuttingDown = (): AgentGone =>
  new AgentGone({ gone: "unreachable", why: "the server is shutting down" });

/** Boot is a few small round trips against a process that just started. Only it
 *  gets a deadline — a turn is a person waiting on a language model. */
const BOOT_TIMEOUT = "30 seconds";
/** A load is not small: the agent re-opens a conversation and replays every
 *  message in it before it answers. Its own, longer deadline. */
const LOAD_TIMEOUT = "120 seconds";
/** How long the agent gets to END the conversation being left. Bounded and its
 *  own: a close is a cancel plus a subprocess teardown rather than a model
 *  call, and the person waiting on it is the one who just asked for another
 *  conversation. */
const CLOSE_TIMEOUT = "10 seconds";

interface Live {
  readonly child: Child;
  readonly connection: ClientConnection;
  readonly canList: boolean;
  readonly canLoad: boolean;
}

export const make = (options: Options): Effect.Effect<Agent, never, never> =>
  Effect.gen(function* () {
    // Everything this module has to say happens in a protocol callback or on a
    // subprocess's stderr, where there is no fiber to log from — so the fiber's
    // logging settings are captured once, here, with the agent's id on every
    // line it will ever emit. Session is added per line, once one is open.
    const say = yield* Effect.annotateLogs(emitter, { agent: options.id });

    /** What this agent's leg wants on the `_meta` of the two calls that OPEN a
     *  conversation — spread into both, and EMPTY for an agent that asks for
     *  nothing. Spelled once because `session/new` and `session/load` have to
     *  agree: the Claude adapter reads the subscription off whichever of them
     *  made the session, and sending it at `new` alone is a bug this file has
     *  already had. */
    const openMeta =
      options.leg.rawMessages === null
        ? {}
        : { _meta: options.leg.rawMessages.openMeta };

    // The spawn/handshake takes its own permit, so two callers racing a cold
    // start share one subprocess rather than each getting their own.
    const booting = yield* Semaphore.make(1);
    // ... and the memory takes its own, for the reason {@link note} gives.
    const remembering = yield* Semaphore.make(1);

    let live: Live | null = null;
    // Per ACP client instance. The scheduler owns many such instances now;
    // this is no longer the package-wide answer to which session is live.
    let activeSession: string | null = null;
    /**
     * Sessions this panel has LEFT, still named so a leftover notification
     * about one can be recognised after `session` has gone null.
     *
     * `elsewhere` used to require a current session to refuse a mismatch, so
     * nulling `session` at the start of a new/load — which is what makes the
     * next `entered` the source of truth — also turned the fence off for the
     * whole open. A forwarded `init` still in flight from the conversation
     * that just closed, or a `session/update` chunk of it, then landed on the
     * next roster and the next transcript. The optional-server probes sit in
     * that window (asked fresh per conversation) and are what made the race
     * load-shaped: a slow probe is a long gap with `session === null` after
     * `sessionOver` has already emptied the panel — which is why they overlap
     * rather than run one after another ({@link ./probes.ts}'s `AT_ONCE`).
     *
     * A SET rather than the last id, because two opens in a row can still
     * have the first conversation's leftovers on the wire after the second
     * has been left too.
     *
     * Append-mostly for the panel's life: an id leaves only when that same
     * conversation is re-entered. No ceiling. The set is never iterated, a
     * lookup is O(1), and a member is one short session id per conversation
     * this process has left — dozens a day, not a thing that grows with the
     * transcript.
     */
    const closed = new Set<string>();

    /** Annotations that belong on a lifecycle line: the session when we have
     *  one, plus whatever the event itself carries. */
    const logContext = yield* Effect.service(References.CurrentLogAnnotations);
    const about = (
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      ...logContext,
      agent: options.id,
      ...(activeSession === null ? {} : { session: activeSession }),
      ...extra,
    });
    /** The annotated line, for a fiber (`yield*`) and a callback (`tell`) alike. */
    const lifecycle = (
      line: Effect.Effect<void>,
      extra: Record<string, unknown> = {},
    ): Effect.Effect<void> => Effect.annotateLogs(line, about(extra));
    const tell = (
      line: Effect.Effect<void>,
      extra: Record<string, unknown> = {},
    ): void => {
      say(lifecycle(line, extra));
    };

    /** The agent's stderr since this subprocess started, capped so a chatty
     *  one cannot grow the journal's dump without bound. Dumped at WARN when
     *  a turn fails — that is where opencode writes its JSON-RPC errors.
     *
     *  `stderrWritten` is the bytes appended since spawn, including what the
     *  cap has trimmed off the left. A turn snapshots that counter, not
     *  `stderrBuf.length`: once the cap bites, the length is stuck at the cap
     *  and a slice from there is empty — no dump, at the diagnosis moment. */
    let stderrBuf = "";
    let stderrWritten = 0;
    const STDERR_CAP = 32 * 1024;
    const takeStderr = (chunk: string): void => {
      const text = chunk.trimEnd();
      const sep = stderrBuf === "" || stderrBuf.endsWith("\n") ? "" : "\n";
      stderrBuf = `${stderrBuf}${sep}${text}`;
      stderrWritten += sep.length + text.length;
      if (stderrBuf.length > STDERR_CAP)
        stderrBuf = stderrBuf.slice(-STDERR_CAP);
      tell(Effect.logDebug(text));
    };
    const dumpStderr = (fromWritten: number): void => {
      const origin = stderrWritten - stderrBuf.length;
      const from = Math.max(0, fromWritten - origin);
      const during = stderrBuf.slice(from).trim();
      if (during === "") return;
      // ONE line, even when the agent wrote several: a newline in a logfmt
      // value is escaped, not wrapped, and N WARNs of one dump would be the
      // same event fragmented.
      tell(Effect.logWarning(during));
    };

    /** Every request this agent makes, with its refusals on the record: ONE
     *  line per rejection the agent answered with, carrying the code and the
     *  `data` the sentence was read out of ({@link saidOf}) — so a report of a
     *  refused click is diagnosable from the log alone.
     *
     *  INFO for the ordinary refusals — a signed-out `session/new`, a steer
     *  not taken, a load of a conversation the agent no longer has — which
     *  are already on screen in the agent's words and are the normal course
     *  of a session. WARN only for `-32603`: an agent calling its own answer
     *  an internal error is the one case where the log must carry more than
     *  the screen. */
    const ask = (
      connection: ClientConnection,
      method: string,
      params: unknown,
      timeout?: Duration.Input | null,
    ): Effect.Effect<unknown, AgentGone> =>
      request(
        (data) => options.leg.accountRefusal?.(data) === true,
        (cause) =>
          tell(
            (cause.code === INTERNAL_ERROR
              ? Effect.logWarning
              : Effect.logInfo)("the agent refused a request"),
            {
              method,
              code: cause.code,
              ...(cause.data === undefined
                ? {}
                : { data: refusalData(cause.data) }),
            },
          ),
        connection,
        method,
        params,
        timeout,
      );

    let stopped = false;
    const requestedStops = new WeakMap<
      Child,
      { reason: StopReason; session: string | null }
    >();
    /** A cancel that arrived before the prompt was on the wire. Remembered so
     *  every cancelled turn ends the same way, whichever half of the handshake
     *  it landed in. */
    let cancelPending = false;

    const emit = (event: AgentEvent) => {
      options.onEvent(event);
    };

    /** The sign-in row, said the one way ({@link ./events.ts}'s `signIn`): one
     *  event per move, so nothing can change the attempt without the panel
     *  hearing about it. */
    const emitSignIn = (signIn: SignIn | null): void => {
      emit({ _tag: "signIn", signIn });
    };

    // The agent's own child-session/async-task channel, in ITS spelling
    // (`@kolu/acp`'s `NativeActivity`) — and the conversation-side model of
    // what those facts mean, which is this package's. An agent with no such
    // channel has neither.
    const dialect = options.leg.nativeActivity ?? null;
    const activity = dialect === null ? null : new Activity(emit);
    const sessionRoot = (id: string): string => activity?.root(id) ?? id;
    const callId = (session: string, id: string): string =>
      activity?.toolId(session, id) ?? id;
    const terminalTools = new Map<string, readonly string[]>();
    const terminals = new Terminals((id) => {
      for (const [tool, ids] of terminalTools)
        if (ids.includes(id)) {
          emit({
            _tag: "toolTerminals",
            id: tool,
            terminals: ids.map((key) => terminals.view(key)),
          });
        }
    }, options.cwd);
    let terminalCleanup = Promise.resolve();
    const terminalSession = (session: string): void => {
      if (sessionRoot(session) !== activeSession || replaying)
        throw RequestError.invalidParams("inactive terminal session");
    };

    /**
     * HOW TO SIGN IN, as this agent advertised it at the handshake — empty
     * until one has happened, and for an agent with nothing to offer.
     *
     * Held rather than re-read, because `initialize` happens once and the
     * command a `terminal` method wants run is a spawn-time fact
     * ({@link Offered}): what the browser is told is the half a button needs,
     * and this is where the other half waits for the press.
     */
    let offered: ReadonlyArray<Offered> = [];

    /**
     * WHO THIS AGENT PROCESS IS SIGNED IN AS, as the agent itself last said —
     * or `null` for one that has said nothing (`AuthStatus`'s own account of
     * the difference from `kind: "none"`).
     *
     * A FACT ABOUT THE PROCESS rather than about the conversation, which is
     * why it is read on a connection-scoped notification with no session fence
     * and held here for as long as the subprocess lives. The panel shows it in
     * the agent line, so a person switching between two Claude Code accounts
     * can see which one a conversation is about to run on before typing into
     * it.
     *
     * HELD AND ALSO EMITTED, because the event is what moves the panel's cell:
     * this field is the agent's own copy, kept so the process's teardown can
     * say `null` — and say it only when there is a chip to take away.
     *
     * IT OUTLIVES A CONVERSATION. Replacing or reloading a session keeps the
     * same subprocess and the same account, and both pinned adapters suppress
     * a report whose payload has not changed — so clearing it on the way into
     * a conversation would lose the fact for good ({@link forgetIdentity}).
     */
    let identity: AuthStatus | null = null;

    /** The one writer of {@link identity}: a report replaces the whole value,
     *  and a payload with no usable label is not a report at all
     *  ({@link identityIn}). */
    const readIdentity = (params: unknown): void => {
      const next = identityIn(params);
      if (next === null) return;
      identity = next;
      emit({ _tag: "identity", identity: next });
    };

    /** ... and the way it goes: the process is over. `null` is a fact of its
     *  own — not reported — and the next process's first report puts the chip
     *  back. Emitted only when there was something to clear, so an engine that
     *  never reports pays nothing.
     *
     * NOT on {@link leaving}: a conversation being replaced or reloaded is the
     * same subprocess, and the value is still true for it. The two teardown
     * sites call this — the exit handler and {@link stopWithReason}. */
    const forgetIdentity = (): void => {
      if (identity === null) return;
      identity = null;
      emit({ _tag: "identity", identity: null });
    };

    /** THE SIGN-IN IN FLIGHT, if any ({@link Attempt}). */
    let attempt: Attempt | null = null;

    /**
     * THE URL ELICITATIONS THIS CONVERSATION IS WAITING ON, by the agent's own
     * id — the handle `elicitation/complete` names, mapped to the question row
     * that is on screen for it.
     *
     * A map rather than a field, because a session can hold more than one at a
     * time: two MCP servers signing in at once is two rows, and a completion
     * has to reach the one the agent meant.
     */
    const waitingLinks = new Map<string, string>();

    /**
     * THE ENVIRONMENT A CHILD OF THIS AGENT GETS: olai's own, plus what a
     * caller adds, minus what this adapter asked not to see.
     *
     * One function because there are two children now — the agent itself and
     * the process a `terminal` sign-in runs — and the subtraction has to be the
     * same for both or the second one is a hole in the first one's fence.
     */
    const childEnv = (
      extra?: Readonly<Record<string, string>>,
    ): NodeJS.ProcessEnv =>
      childEnvOf(process.env, { ...options.env, ...extra }, options.unset);

    const trouble = (message: string) => {
      tell(Effect.logWarning(message));
      emit({ _tag: "trouble", message });
    };

    /** Whether we are replaying. A `session/load` streams the whole
     *  conversation as ordinary updates, and the caller has to be able to tell
     *  history from news — a user message during a replay is something that was
     *  said, not something being said. */
    let replaying = false;

    /** The prologue this conversation's OPEN announced it would double as one
     *  ordinary chunk (`@kolu/acp/engine`'s `Leg`'s `prologueIn`), or `null`.
     *  Armed at the open and CONSUMED by the first chunk equal to it: one
     *  banner, once, and the comparison is the string the adapter itself
     *  published — never a shape of prose. */
    let prologue: string | null = null;

    /** The questions on the wire right now ({@link ./questions.ts}), told to
     *  report every ending down the same channel everything else uses. */
    const questions = Questions.make((id, outcome) => {
      emit({ _tag: "askSettled", id, outcome });
    });

    /**
     * The MCP servers this conversation was handed, by name.
     *
     * Read by the permission handler and by nothing else: a call to one of
     * these is a call to a tool olai chose to expose — the mediated ops, and
     * whatever optional server answered this session's probe — and those are
     * the ones bypass mode is for. Refilled whenever a session is opened,
     * because the set is decided per conversation (a daemon started after olai
     * shows up in the next one).
     */
    let given: ReadonlyArray<string> = [];

    /**
     * ... and the same conversation's servers as a person is shown them: every
     * one it was handed, the one it was meant to have and did not, and how each
     * stands ({@link ./servers.ts}).
     *
     * HELD rather than emitted and forgotten, because it is no longer settled
     * at session open. Olai composes it there, and the agent refines it
     * afterwards — a status per server on the Claude adapter's forwarded
     * `init`, which arrives with the first turn — so there has to be something
     * for that news to be applied TO. Refilled whenever a session is opened, by
     * the one place that decides what a session gets.
     *
     * A SECOND VALUE beside `given` and not a projection of it: that one is the
     * permission rule's and this one is the panel's, and the whole point of the
     * roster is that it holds rows for servers the session was NOT given.
     */
    let roster: ReadonlyArray<Server> = [];

    /** What has been said about each of this conversation's tool calls — which
     *  tool it is, and which agent made it ({@link ./calls.ts}). Per session,
     *  because a call id is only ever looked up inside the session that minted
     *  it. */
    const calls = new Calls(options.leg);

    /** The conversation is over — replaced, reloaded, or dead. Everything keyed
     *  to it goes: the questions nobody is going to answer now, what was said
     *  about the calls they named, which model the CLI said it was running, and
     *  the servers it was running them over. One function, because "this
     *  session is finished" is one fact and four call sites remembering four
     *  things each is how one of them ends up remembering three.
     *
     * WHAT DOES NOT GO IS {@link identity}: who the PROCESS is signed in as is
     * not keyed to a conversation, and both pinned adapters suppress a report
     * whose payload has not changed. Clearing it here lost the fact for good on
     * the path Codex takes — a sign-in pushes the new account, then the reopen
     * that follows clears it, and the session opened afterwards has nothing new
     * to say. The process ending is what clears it ({@link forgetIdentity} at
     * the two teardown sites). */
    const leaving = (): void => {
      // Named first, while `session` is still the one being left: the four
      // call sites used to null it and THEN call this, which made the closed
      // set a no-op. {@link fromElsewhere} is what a leftover is recognised
      // by, and it reads this set.
      if (activeSession !== null) closed.add(activeSession);
      terminalCleanup = Promise.all([terminalCleanup, terminals.clear()]).then(
        () => undefined,
      );
      terminalTools.clear();
      // The URL elicitations this conversation was waiting on go with it: their
      // rows are withdrawn below, and a completion arriving afterwards names a
      // question nobody is holding (`waitingLinks`).
      waitingLinks.clear();
      questions.withdrawAll();
      calls.forget();
      activity?.clear(closed);
      forgetModel();
      // ... and the doubled-prologue arm along with the rest: it names a chunk
      // the session BEING LEFT announced. Spared this line, an arm whose
      // banner never landed (an adapter that reordered it behind something
      // else) would outlive its open and spend the life of the process
      // waiting to consume the first chunk of ANY later conversation that
      // happens to equal it — the load below replays its history BEFORE the
      // answer that would disarm this, with `fromElsewhere` passing the
      // frames, and "the banner showed" (the safe direction) and "a replayed
      // message was eaten" are the same mis-set bit apart.
      prologue = null;
      // The servers were HANDED to a conversation that is over, and the next
      // one is probed fresh before it opens. Emptied rather than left standing
      // so a forwarded `init` still in flight from the finished session has
      // nothing to refine — every row it could name belongs to a conversation
      // nobody is in. That covers the gap BEFORE the next roster is announced;
      // the closed set covers the gap after, when the next conversation's
      // handed rows are already up and the leftover would have something to
      // refine.
      roster = [];
    };

    /**
     * Put a form in front of a person and wait for it — the registry holds the
     * promise, and this is the one place the row it draws is announced.
     *
     * WHO IS ASKING is worked out here rather than handed in. An asker is only
     * ever true of one form, so a caller passing both would be pairing two
     * things nothing enforces — each honest alone, and wrong together the
     * first time two questions are in flight. The form names the call it was
     * asked from and the call is what has been heard about
     * ({@link ./calls.ts}), so there is nothing left for a caller to supply.
     *
     * A form drawn in nobody's name is drawn as the main agent's, which is the
     * one thing a subagent's question must not say.
     */
    const put = (
      form: Form,
      signal: AbortSignal,
      session?: string,
      /** Told the id this question is known by, beside the row it publishes —
       *  which is what a caller that has to settle it from ANOTHER event (a URL
       *  elicitation's completion) holds on to. */
      known?: (id: string) => void,
    ): Promise<Questions.Settled> =>
      questions.ask(form, signal, (id) => {
        known?.(id);
        emit({
          _tag: "asked",
          id,
          message: form.message,
          fields: form.fields,
          link: form.link,
          parent:
            (session === undefined ? undefined : activity?.parent(session)) ??
            calls.about(form.toolCall, session).parent,
        });
      });

    /** A question we cannot draw. Declined on the wire and SAID out loud: an
     *  agent that got an empty answer and a person who never saw the question
     *  is the one shape of this failure nobody could debug. */
    const undrawable = (why: string): void => {
      trouble(`the agent asked something this chat cannot draw — ${why}`);
    };

    /**
     * THE OTHER MODE — a place to go rather than something to fill in.
     *
     * Which of two rows it becomes is decided by the SCOPE the agent sent it
     * with, and that is the protocol's own way of saying who is asking: a
     * SESSION-scoped one belongs to the conversation and is drawn in it, as the
     * same question row a form is, with a link instead of fields
     * ({@link waitingLinks} settles it when the agent says the page is done). A
     * REQUEST-scoped one belongs to a request outside any session — which here
     * means a {@link signIn}, the one request this panel makes before a
     * conversation exists — and is drawn by that attempt's own row.
     */
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
      if (fromElsewhere(sessionRoot(named), activeSession, closed))
        return { action: "cancel" };
      const settling = CreateElicitationRequest.isUrl(params)
        ? params.elicitationId
        : null;
      const settled = await put(form, signal, named, (id) => {
        // Held under the AGENT'S OWN id, which is the only name
        // `elicitation/complete` says. An elicitation with no id cannot be
        // completed by name, so nothing holds it and the row is settled by a
        // person like every other question.
        if (settling !== null) waitingLinks.set(settling, id);
      });
      // THE SAME THREE ENDINGS a form has, and the same reading of them: a
      // person who dismissed it declined, a withdrawal cancels, and an
      // answered one — which for a URL is the agent saying the page is done —
      // accepts with the empty content a field-less schema takes.
      if (settled.outcome.how === "declined") return { action: "decline" };
      if (settled.outcome.how === "withdrawn") return { action: "cancel" };
      return { action: "accept", content: settled.content };
    };

    /**
     * ... AND THE ONE A SIGN-IN IS WAITING ON, which is the same payload with
     * no session to put it in.
     *
     * The promise this returns is what the agent is blocked on for the whole of
     * a device-code sign-in — a person at a vendor's page, minutes of it — so it
     * is deliberately not answered here: {@link onElicitationComplete} answers
     * it accept when the agent says the page is done, and
     * {@link Agent.signInCancel} answers it decline when somebody gives up. What
     * this does is put the page on the row and record where to reach it.
     *
     * A request-scoped URL elicitation that is NOT part of a sign-in is
     * declined, and that is a claim rather than a fallback: the only requests
     * this panel makes outside a session are sign-ins, so a link that belongs to
     * none of them is a link to something nothing here asked for, and putting it
     * nowhere would hang the agent on a question nobody was shown.
     */
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
      let answer!: (action: "accept" | "decline") => void;
      const held = new Promise<CreateElicitationResponse>((resolve) => {
        answer = (action) =>
          resolve(
            action === "accept"
              ? { action: "accept", content: {} }
              : { action: "decline" },
          );
      });
      const view: SignInLink = { ...link, message: form.message, done: false };
      running.link = {
        // `null` for a request that named no elicitation id — which is a
        // request nothing can complete by name, so the row settles by a person
        // or by the sign-in ending. (`onUrlElicitation` only calls this for a
        // URL mode, so today that arm is a type's, not a payload's.)
        elicitationId: CreateElicitationRequest.isUrl(params)
          ? params.elicitationId
          : null,
        answer,
        view,
      };
      emitSignIn({
        kind: "agent",
        method: running.method,
        label: running.label,
        link: view,
        why: null,
      });
      return await held;
    };

    /**
     * THE AGENT SAYS A PAGE IT SENT SOMEBODY TO IS DONE.
     *
     * One notification, two things that could be waiting on it, and only one of
     * them can be true: a conversation's question row, or the sign-in row whose
     * request this elicitation belongs to. Both end the same way — the row
     * records that the agent is satisfied, and the request the agent is holding
     * is answered accept, since the agent has just said it has what it needed.
     *
     * The row for a sign-in STAYS until the sign-in itself answers: a card that
     * disappeared the moment the page said done would leave a person watching
     * nothing while the agent finished.
     */
    const onElicitationComplete = (params: unknown): void => {
      const id = completionIdOf(params);
      if (id === null) return;
      const asking = waitingLinks.get(id);
      if (asking !== undefined) {
        waitingLinks.delete(id);
        questions.answer(asking, []);
        return;
      }
      const link = attempt?.link;
      if (link === undefined || link === null || link.elicitationId !== id)
        return;
      const running = attempt;
      // ... AND THE SAME GUARD HERE, met from the other side: the agent saying
      // its page is done is not news about an attempt somebody already took
      // back, and the row it would draw is one nobody is running.
      if (running === null || running.stopping) return;
      emitSignIn({
        kind: "agent",
        method: running.method,
        label: running.label,
        link: { ...link.view, done: true },
        why: null,
      });
      link.answer("accept");
    };

    const onElicitation = async (
      params: CreateElicitationRequest,
      signal: AbortSignal,
    ): Promise<CreateElicitationResponse> => {
      // WHICH MODE, before anything else: the two draw different rows and the
      // reader of one REFUSES the other (`@kolu/acp`'s `formOf` and `urlOf`
      // each say so), so the dispatch is what keeps a place-to-go from being
      // refused as an undrawable form.
      if (params.mode === "url") return await onUrlElicitation(params, signal);
      const named = "sessionId" in params ? params.sessionId : undefined;
      if (
        typeof named === "string" &&
        fromElsewhere(sessionRoot(named), activeSession, closed)
      )
        return { action: "cancel" };
      const form = formOf(params);
      if (form instanceof Refused) {
        undrawable(form.reason);
        return { action: "decline" };
      }
      const settled = await put(
        form,
        signal,
        typeof named === "string" ? named : undefined,
      );
      // A dismissal is a DECLINE and a withdrawal is a CANCEL, and the adapter
      // reads them differently: decline tells the model the person skipped and
      // lets the turn go on, cancel aborts the tool use. Saying "cancel" for a
      // dismissal would end a turn somebody meant to continue.
      if (settled.outcome.how === "declined") return { action: "decline" };
      if (settled.outcome.how === "withdrawn") return { action: "cancel" };
      // Already typed against the schema that asked for it — `answer` refuses
      // anything that does not fit rather than settling the row and quietly
      // sending something else.
      return { action: "accept", content: settled.content };
    };

    /** Which tool a permission request is about, or `null` when nothing said —
     *  which is answered by ASKING, never by guessing. `put` above reads the
     *  other field of the same answer, and both are a lookup because the
     *  request's own words went in through the same door every frame does. */
    const toolOf = (request: RequestPermissionRequest): string | null =>
      calls.about(request.toolCall.toolCallId, request.sessionId).name ?? null;

    const onPermission = async (
      params: RequestPermissionRequest,
      signal: AbortSignal,
    ): Promise<RequestPermissionResponse> => {
      // A REQUEST'S TOOL CALL IS A FRAME ABOUT THAT CALL — the adapter builds
      // its `_meta` the same way it builds an announcement's, with the tool
      // name and, for a subagent's call, whose it is — so it goes in through
      // the same door rather than being read as a second kind of source. Both
      // questions below are then a lookup.
      calls.heard(
        params.toolCall.toolCallId,
        params.toolCall._meta,
        params.toolCall,
        params.sessionId,
      );
      // The tools olai handed this conversation are answered here and now —
      // already mediated, already validated — and everything else is put in
      // front of a person. Which is which is `allowedWithoutAsking`, and it is
      // there rather than here because it is the rule that stops this panel
      // approving its own permissions. THE WHOLE TOOL CALL goes with it: one
      // agent dispatches every MCP tool through a single builtin, so which
      // tool a request is really about is readable only in the call's own
      // input (`@kolu/acp/engine`).
      const allowed = options.leg.allowedWithoutAsking(
        toolOf(params),
        given,
        params.options,
        {
          title: params.toolCall.title,
          rawInput: params.toolCall.rawInput,
          _meta: params.toolCall._meta,
        },
      );
      if (allowed !== null) {
        return { outcome: { outcome: "selected", optionId: allowed } };
      }
      if (fromElsewhere(sessionRoot(params.sessionId), activeSession, closed))
        return { outcome: { outcome: "cancelled" } };
      const settled = await put(
        permissionFormOf(params),
        signal,
        params.sessionId,
      );
      const picked = settled.content[PERMISSION_FIELD];
      // Dismissed, withdrawn, or — impossible, since the field is required, but
      // said in one place rather than assumed in two — nothing chosen. All
      // three are `cancelled`, which is the protocol's "nobody decided".
      return typeof picked !== "string"
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId: picked } };
    };

    const onUpdate = (notification: SessionNotification): void => {
      // WHOSE SESSION, the same fence the forwarded `init` sits behind. A
      // chunk of the conversation that just closed, landing after
      // `sessionOver` has emptied the transcript, is how a new conversation
      // failed to empty: the panel showed the last turn's words in a
      // conversation nobody had spoken in. Replay is not this — a load
      // un-closes the id it is about to replay, below, before the frames
      // land.
      if (
        fromElsewhere(
          sessionRoot(notification.sessionId),
          activeSession,
          closed,
        )
      )
        return;
      const update = notification.update;
      const parent = activity?.parent(notification.sessionId);
      // A child's prose belongs in its own fold; its settings, title, usage,
      // plan and replayed user messages must never replace the root's.
      if (parent !== undefined) {
        if (update.sessionUpdate === "agent_message_chunk") {
          activity?.report(notification.sessionId, textOf(update.content));
          return;
        }
        if (
          update.sessionUpdate !== "tool_call" &&
          update.sessionUpdate !== "tool_call_update"
        )
          return;
      }
      reportServers(options.leg.serversInUpdate?.(update) ?? null);
      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          const text = textOf(update.content);
          // The doubled prologue is dropped HERE rather than anywhere narrower:
          // the chunk is otherwise speech, and every counter a chunk feeds —
          // the transcript, the silence arm's count of what the agent said —
          // is downstream of this one door.
          if (text !== "" && prologue !== null && text === prologue) {
            prologue = null;
            return;
          }
          if (text !== "") emit({ _tag: "said", text });
          return;
        }
        case "user_message_chunk": {
          const text = textOf(update.content);
          // A TASK-NOTIFICATION is not a person speaking. The harness injects
          // the subagent's report as a user-role turn (`origin.kind:
          // "task-notification"`); drawing it as a bubble puts the report in
          // the column, unrendered, which is the contract `website/docs/chat.md`
          // forbids. The report belongs in the spawning row's fold. Looked at
          // LIVE as well as on replay: the injected turn is not one olai sent,
          // so the "we already drew what we typed" skip does not apply.
          const notice = options.leg.taskNotification(
            text,
            "_meta" in update
              ? (update as { readonly _meta?: Meta })._meta
              : undefined,
          );
          if (notice !== null) {
            if (notice.onto !== null) {
              emit({
                _tag: "tool",
                id: notice.onto.toolUseId,
                title: undefined,
                status: undefined,
                detail: undefined,
                progress: undefined,
                diffs: undefined,
                called: undefined,
                row: undefined,
                reply: undefined,
                locations: undefined,
                parent: undefined,
                spawned: undefined,
                provisional: undefined,
                armed: {
                  task: notice.onto.task,
                  description: null,
                  ended: null,
                  report: notice.onto.report === "" ? null : notice.onto.report,
                },
              });
            } else {
              say(
                Effect.logDebug(
                  "task-notification named no spawning call or no task; swallowed, no row",
                ),
              );
            }
            return;
          }
          if (!replaying) return;
          if (text !== "") emit({ _tag: "userSaid", text });
          return;
        }
        // Announce and update are ONE event: the protocol distinguishes them
        // by which fields it guarantees, and a consumer keyed by call id does
        // the same thing with either.
        case "tool_call":
        case "tool_call_update": {
          const id = callId(notification.sessionId, update.toolCallId);
          // Not drawn, and not an event: what this frame said about its call —
          // which tool it is, and which agent made it — is what the two
          // handlers above need and what neither question they answer carries
          // ({@link ./calls.ts}).
          calls.heard(
            update.toolCallId,
            update._meta,
            update,
            notification.sessionId,
          );
          // Recognition belongs to the leg; ownership belongs to the live catalogue.
          const recognized = options.leg.mcpCall(
            {
              title: update.title,
              rawInput: update.rawInput,
              // ... and what the call REPORTED, for the agent that names the
              // tools a call ran only in its result (opencode 2's Code Mode).
              rawOutput: update.rawOutput,
              _meta: update._meta,
              name: calls.about(update.toolCallId, notification.sessionId).name,
            },
            given,
          );
          calls.recognized(
            update.toolCallId,
            recognized,
            notification.sessionId,
          );
          const called =
            calls.about(update.toolCallId, notification.sessionId).mcp ?? [];
          // WHAT OLAI ADVERTISES EACH OF THEM AS. A frame is one row however
          // many calls it made, so the row is composed rather than picked: a
          // Code Mode `execute` that ran three of olai's tools is three
          // advertised titles on one line, and a row that showed the first of
          // them would be claiming the other two did not happen.
          const owned = called.map(
            (one) => options.advertised?.(one.server, one.tool) ?? null,
          );
          const ours =
            owned.every((one) => one !== null) && owned.length > 0
              ? {
                  title: [...new Set(owned.map((one) => one!.title))].join(
                    " · ",
                  ),
                  // ... and the OWNER only where they agree. Two plugins' tools in
                  // one script is one row that is not either of theirs, so it
                  // draws neither one's face rather than half of one.
                  owner:
                    new Set(owned.map((one) => one!.owner)).size === 1
                      ? owned[0]!.owner
                      : undefined,
                }
              : null;
          // THE REPLY IS SINGLE-CALL ONLY, and that is the wire rather than a
          // choice: a Code Mode script returns ONE value, and which of three
          // calls it belongs to is not said anywhere. A row that drew it for a
          // batch would be filing one answer under three questions.
          const decoded =
            ours === null || called.length !== 1
              ? undefined
              : options.leg.replyIn(update.rawOutput, update.content);
          const reply =
            decoded !== undefined && isJson(decoded) ? decoded : undefined;
          // Read ONCE: the row wears it, and the terminal block below turns on
          // it. Two readings of one `_meta` corner are two places a later leg
          // could disagree with itself.
          const arming = options.leg.backgroundTask(update._meta);

          emit({
            _tag: "tool",
            id,
            title: ours?.title ?? update.title ?? undefined,
            called: update.title ?? undefined,
            row: ours?.owner,
            reply,
            // NO CAST. The protocol's four words and the panel's are the same
            // four, and this is the one seam that says so: a fifth status on
            // either side stops compiling HERE, where a person can decide what
            // the panel should do with it, rather than riding a cast onto a row
            // whose look-up table has no entry for it.
            status:
              activity?.status(id, update.status ?? undefined) ??
              update.status ??
              undefined,
            detail: detailOf(
              update.rawInput,
              ours === null ? update.rawOutput : undefined,
            ),
            progress: progressOf(update.content),
            // Direct file changes remain protocol diff blocks.
            diffs: diffsOf(update.content, options.cwd),
            locations: locationsOf(update.locations, options.cwd),
            // ... and WHO made the call, out of the same `_meta` the name came
            // from. A subagent's frames arrive on this one feed with nothing
            // in the protocol to tell them apart, so this is the only thing
            // that says a turn had more than one agent in it.
            parent:
              parent ?? options.leg.parentToolUse(update._meta) ?? undefined,
            // ... and, the other way round, whether this call SENT an agent
            // out. Read here rather than left to the parent stamp because the
            // stamp is answered by a subagent's own frames and a subagent that
            // has not made a call yet has produced none — which is the whole
            // of the stretch a person is watching a fan-out through.
            spawned: spawnedOf(
              options.leg.spawned(
                update._meta,
                update.rawInput,
                // THE REMEMBERED NAME, not this frame's: one wire announces a
                // call with its `name` and an EMPTY input, then refines it with
                // the arguments and no name (opencode 2's `subagent`), so a
                // reader asking the frame in front of it would never see both
                // halves at once. The registry holds what any frame said
                // ({@link ./calls.ts}), which is what positive recognition
                // means when the facts arrive separately.
                calls.about(update.toolCallId, notification.sessionId).name,
              ),
            ),
            // ... and whether it ARMED a background task — a monitor, a
            // background shell — which is the one kind of call that goes on
            // happening after this frame, after the turn, and (for a persistent
            // monitor) for the rest of the conversation. Read off the same
            // corner for the same reason: ACP has no place to say it, so the
            // agent that says it is read where everything else true of one
            // agent is read.
            armed: armedOf(arming),
            // ... and whether the TITLE this frame carried is a placeholder
            // the adapter has not refined yet, which decides only whether it
            // may NAME the row (`./transcript.ts`). A leg that declares
            // nothing answers `undefined` and the once-only rule is unchanged.
            provisional: options.leg.provisionalTitle?.(update),
          });
          {
            // Adapter-owned terminal IDs, like tool IDs, are scoped to a
            // session. Client-created handles are already globally unique.
            const terminalId = (raw: string): string =>
              activity !== null && !terminals.clientOwned(raw)
                ? activity.toolId(notification.sessionId, raw)
                : raw;
            // A LAUNCH IS NOT THE TASK IT LAUNCHED, and this is the one frame
            // whose terminal corners lie about which of the two they describe:
            // `Bash(run_in_background)` answers the moment the command is
            // RUNNING, so the adapter — building that answer with the reader it
            // uses for an ordinary command — sends the harness's "Command
            // running in background with ID …" notice and `exit_code: 0`, the
            // exit of the LAUNCH. Olai's patch keeps that `_meta` on the frame
            // it turns into the call's arming
            // (`packages/plugins/claude/acp/patches/README.md`). Drawn, it is a pane reading
            // *Exit 0* under a row the strip beside it says is still running.
            //
            // So such a frame contributes no terminal and clears the ones its
            // call had, taking the pane its announcement opened with them. The
            // notice is bookkeeping `armed` says better, the ending comes from
            // the harness, and the command's own output is read back by a later
            // call with a row of its own.
            const launching = arming !== null;
            const meta = (
              options.leg.terminalOutput && !launching
                ? terminalMetaIn(update._meta)
                : []
            ).map((item) => ({ ...item, id: terminalId(item.id) }));
            const refs = launching
              ? []
              : update.content?.flatMap((item) =>
                  item.type === "terminal" ? [terminalId(item.terminalId)] : [],
                );
            const ids = [
              ...new Set([
                ...(refs ?? terminalTools.get(id) ?? []),
                ...meta.map((item) => item.id),
              ]),
            ];
            terminalTools.set(id, ids);
            for (const item of meta) {
              if (item.kind === "begin") terminals.begin(item.id);
              else if (item.kind === "output")
                terminals.append(item.id, item.data);
              else terminals.finish(item.id, item.code, item.signal);
            }
            if (refs !== undefined || ids.length > 0)
              emit({
                _tag: "toolTerminals",
                id,
                terminals: ids.map((id) => terminals.view(id)),
              });
          }
          return;
        }
        case "plan":
          emit({ _tag: "plan", entries: update.entries });
          return;
        case "available_commands_update":
          emit({
            _tag: "commands",
            commands: update.availableCommands.map(
              (command): Command => ({
                name: command.name,
                description: command.description,
              }),
            ),
          });
          return;
        case "config_option_update":
          readModel(update.configOptions);
          return;
        case "session_info_update":
          if (typeof update.title === "string" && update.title !== "") {
            emit({ _tag: "sessionTitled", title: update.title });
          }
          return;
        case "usage_update": {
          // How full the context is, which is the one thing a person needs to
          // decide whether to `/compact` and the one thing nothing on screen
          // used to say. Several a turn: the agent revises `used` as it goes
          // and may revise `size` too, so the panel holds the newest rather
          // than the first.
          //
          // Read by `@kolu/acp` rather than by a leg, because this is
          // ACP's own update kind and not one adapter's extension — any agent
          // may send one, and one that never does simply leaves the header
          // saying nothing about room.
          const usage = usageIn(update);
          if (usage !== null) emit({ _tag: "usage", usage });
          return;
        }
        default:
          // Thoughts and plans. Real parts of the protocol that this panel
          // does not draw; ignored quietly rather than half-rendered.
          //
          // Quietly is right HERE and not two cases up, and the difference is
          // worth naming since both look like "we dropped something". These
          // are whole update KINDS this panel has no view for — a feature it
          // does not have, the same way it has no view for a terminal — and a
          // marker for each would be a transcript of apologies. An
          // `agent_message_chunk` whose content this panel cannot draw is the
          // other thing entirely: the agent ANSWERED, in a row that is on
          // screen, and dropping it left that row blank. That one is marked
          // (`textOf`).
          return;
      }
    };

    /**
     * WHICH MODEL — two sources, and a change in either is news.
     *
     *   - the session's CONFIG OPTION is what was PICKED. It arrives with
     *     `session/new` and again in a `config_option_update` whenever
     *     anything in that set moves;
     *   - the CLI's own `system`/`init` message is what is RUNNING. It is
     *     forwarded because `session/new` asked for it.
     *
     * They part company at a `/model` slash command: the Claude Code adapter
     * wraps a CLI that handles it internally, so the adapter never learns of
     * it and goes on reporting the model the session started on, forever.
     *
     * WHICHEVER MOVED LAST WINS, and each source is debounced against its OWN
     * previous value — which is what stops a picker RE-SENDING a value it
     * already sent from overwriting a `/model` the CLI reported since. It is
     * not that the picker stops being trusted once the CLI has spoken: when
     * the picker genuinely moves it is because the model genuinely moved (a
     * refusal fallback re-picks the row it fell back to), and a panel that had
     * decided to stop listening would sit on a stale name until the next turn.
     *
     * The picker also supplies the LABELS, and that is not a side job:
     * {@link nameFor} is what turns a live API id back into the word the
     * agent uses for it. Without it the header could only ever name a running
     * model as `claude-sonnet-5`, beside a picker calling it "Sonnet".
     *
     * And what reaches the panel is debounced once more, ON THE NAME, in
     * {@link show}. That is what makes two sources AGREEING say nothing at all
     * — the case that used to need the first live id special-cased as a
     * "baseline" on the untrue grounds that it agrees with the config option BY
     * CONSTRUCTION. It does not: the picker said `claude-fable-5[1m]` while the
     * CLI said `claude-fable-5`. They agree once resolved, which is a thing to
     * check rather than assume.
     *
     * ONE TURN LATE, and this is the adapter's floor rather than ours. The
     * `init` for a turn is emitted as that turn STARTS, so the turn that runs
     * `/model` still reports the model it began on; the new one arrives with
     * the NEXT turn's `init`. Nothing else on the wire carries it — captured
     * with `emitRawSDKMessages: true` against 0.66.0, the only trace of the
     * change in that whole turn is a `<synthetic>` assistant message saying so
     * in prose, and there is no read-only config verb to ask again with. A
     * panel that closed the gap would be reading a sentence or inventing one.
     */
    /** The name the panel is showing. Everything below is about what should be
     *  in it, and {@link show} is the only thing that writes it. */
    let shown: string | null = null;
    /** What each source last SAID, so that a source repeating itself is not a
     *  source moving: the picker re-sends its whole set whenever anything in it
     *  changes, and the live id repeats on every turn. Neither is news. */
    let picked: string | null = null;
    let announced: string | null = null;
    /** The picker, as value → label, kept so a LIVE id can be labelled the way
     *  the agent labels its own models. */
    let labels: ReadonlyMap<string, string> = new Map();

    /**
     * HOW TO READ THIS AGENT'S PICKER — which `configOptions` entry the model is
     * in, and what that agent calls its own rows (`@kolu/acp/engine`'s
     * `ModelReading`). `null` for an agent with no picker at all, and every
     * reader below takes that arm.
     *
     * It used to be two module-level constants in a leg-neutral file — the entry
     * id, and one CLI's alias tiers — sitting on the path every agent's model
     * name was read through. They are the LEG's now, because they are one
     * adapter's spelling; the arithmetic over them is still this package's.
     */
    const models = options.leg.models;
    let settings: ReadonlyArray<Setting> = [];
    const readSettings = (
      config: ReadonlyArray<SessionConfigOption> | null | undefined,
    ): void => {
      settings = settingsIn(config, models?.config ?? null);
      emit({ _tag: "settings", settings });
    };

    /** What this agent calls the model with that id, or `null` — nothing at all
     *  for an agent with no picker, where the caller says the raw id. */
    const nameFor = (id: string): string | null =>
      models === null ? null : models.nameIn(labels, id);

    /** ...and whether two model strings name one model. Two unnameable strings
     *  agree only when they are the same string, which is also the whole answer
     *  for an agent with no picker to resolve them through. */
    const sameAs = (one: string, other: string): boolean =>
      models === null ? one === other : sameModel(models, labels, one, other);

    /** Say what the header names, when it changes. */
    const show = (name: string | null): void => {
      if (name === shown) return;
      shown = name;
      emit({ _tag: "model", name });
    };

    /** The conversation is over, as far as WHICH MODEL is concerned: what the
     *  next one's sources say is news about IT. `shown` survives on purpose —
     *  it is what is on screen, and the next session naming the same model
     *  should not redraw it. */
    const forgetModel = (): void => {
      picked = null;
      announced = null;
      readSettings([]);
      labels = new Map();
      emit({ _tag: "models", choices: [] });
    };

    /**
     * A MOVE is what gets written down, and the first thing a source says in a
     * conversation is not one.
     *
     * The note exists to outlast a restart ({@link ./memory.ts}), and what it
     * is FOR is a model somebody switched to — a `/model` the agent's own boot
     * would otherwise overrule. What a source says FIRST is not that: it is
     * what this conversation came up on, which is the agent's answer already
     * and needs nothing said back to it. Writing that down too would turn every
     * conversation into a pin — a session that only ever ran the picker's
     * `default` row would come back pinned to whichever concrete model that row
     * resolved to on the day, which is a promise nobody made.
     *
     * So each source is compared against ITS OWN previous value in this session
     * ({@link forgetModel} empties both when the conversation goes), and only
     * the second value onwards is a switch. The one cost, said out loud: a
     * `/model` chosen before this olai ever saw the conversation is not a move
     * it watched, so the first restart after that still opens on the agent's
     * own answer, and switching again is what makes it stick.
     */
    const moved = (value: string): void => {
      const at = held;
      // ... and the same model in the other source's spelling is not a move
      // either — `sonnet` and `claude-sonnet-5` are one model, judged the way
      // {@link restore} judges it rather than as two strings.
      if (at === null || (at.model !== null && sameAs(at.model, value))) return;
      // NOR IS A MODEL A MOVE IN SOMEBODY ELSE'S CONVERSATION. What is mirrored
      // in `held` before this agent has entered anything is the note the last
      // boot left, which may be another agent's — and a frame can arrive in
      // that window, during a replay. Writing then would file this agent's
      // model against that agent's session id, which is the one thing the note
      // must never hold.
      if (at.agent !== options.id) return;
      // `say` is this file's escape hatch out of a protocol callback, where
      // there is no fiber to yield in — the same one a line of the subprocess's
      // stderr goes out through, carrying a write rather than a log line.
      say(
        note(
          { agent: options.id, session: at.session, model: value },
          (why) =>
            `the model this conversation is on will not survive a restart: ${why}`,
        ),
      );
    };

    /** Reconcile picker facts and return a model worth remembering. Observations
     *  only move when their source changes; a confirmed selection also overrides
     *  a CLI model when the picker repeats its old value. Persistence belongs to
     *  the caller: observations enqueue a note, selections await their own. */
    const acceptPicker = (
      picker: Picker | null,
      source: "observed" | "selected",
    ): string | null => {
      emit({
        _tag: "models",
        choices:
          picker === null
            ? []
            : [...picker.labels].map(([value, name]) => ({ value, name })),
      });
      labels = picker?.labels ?? new Map();
      if (picker === null) return null;
      const changed = picker.picked !== picked;
      const switched = picked !== null && changed;
      picked = picker.picked;
      if (changed || source === "selected")
        show(picked === null ? null : (nameFor(picked) ?? picked));
      return switched || source === "selected" ? picked : null;
    };

    const observePicker = (picker: Picker | null): void => {
      const model = acceptPicker(picker, "observed");
      if (model !== null) moved(model);
    };

    const readModel = (
      configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
    ): void => {
      // An agent with NO picker is not read at all — there is no entry to look
      // for, so `labels` stays empty and the header names whatever the agent
      // reports, raw.
      readSettings(configOptions);
      if (models !== null) observePicker(modelPickerIn(models, configOptions));
    };

    const readLiveModel = (params: unknown): void => {
      const id = options.leg.rawMessages?.modelIn(params) ?? null;
      if (id === null || id === announced) return;
      const switched = announced !== null;
      announced = id;
      const name = nameFor(id);
      if (name === null) {
        tell(
          Effect.logWarning(
            "the agent is running a model its picker does not offer",
          ),
          { model: id },
        );
      }
      // The CLI is the only source that ever reports a `/model`, so this is the
      // line the whole memory hangs off.
      if (switched) moved(id);
      show(name ?? id);
    };

    /**
     * ... and what the same message says about the agent's own connections to
     * this conversation's MCP servers.
     *
     * THE ONE FACT ACP HAS NO PLACE FOR, which is the whole warrant for reading
     * an agent's private channel about it: `session/new` takes `mcpServers` and
     * answers with a session id, so whether the agent reached any of them is
     * never on the wire and `mcp-fail-visible` said as much in its own docs.
     * One agent volunteers it (`olai-plugin-claude`'s `leg.ts`); an agent that does
     * not leaves every row where the client put it, which reads as "handed
     * over, and nobody has said what became of it".
     *
     * Re-emitted only when something actually MOVED ({@link ./servers.ts}'s
     * `movedBy`), for {@link show}'s reason one line up: this message arrives
     * once a turn, and a conversation whose servers are all fine would
     * otherwise republish an identical roster to every open tab forever.
     */
    /**
     * Whether a forwarded message is about a conversation OTHER than the one
     * this panel is in — the fence both readers below sit behind.
     *
     * The adapter stamps `sessionId` on every raw message it forwards
     * (`extNotification("_claude/sdkMessage", { sessionId, message })`,
     * unconditionally, 0.73.0), and everything one carries is a fact about that
     * one conversation. Mostly this is already fenced — the panel holds one
     * conversation at a time and `leaving()` drops what is keyed to the last —
     * but the residue is real and narrow: an `init` in flight from a session
     * that has just closed, landing AFTER the next one opened, put the old
     * conversation's model and its servers on the new one's until the next
     * turn corrected them.
     *
     * Closed-and-mismatch, never absence. An id we cannot read, or a message
     * that arrives before this end has recorded which session it is in AND is
     * not about one we have left, falls through — because the cost of being
     * wrong the other way is the header going quiet about a `/model` for the
     * life of a conversation (this notification is the only thing that ever
     * reports one), and a load's replay names the conversation before
     * {@link entered} records it. Positive recognition of the fault, in the
     * direction this file always fails. The rule itself is {@link fromElsewhere},
     * next to `adopt`: one line, and the line the leftover-session flake is
     * drawn out of.
     */
    const elsewhere = (params: unknown): boolean => {
      const named = (params as { readonly sessionId?: unknown } | null)
        ?.sessionId;
      return fromElsewhere(named, activeSession, closed);
    };

    const readLiveServers = (params: unknown): void => {
      reportServers(options.leg.rawMessages?.serversIn(params) ?? null);
    };

    const reportServers = (said: ReadonlyArray<Reported> | null): void => {
      if (said === null) return;
      const next = movedBy(roster, said);
      if (next === null) return;
      for (const [index, server] of next.entries()) {
        if (server === roster[index]) continue;
        if (server.standing === "unattached") {
          tell(Effect.logWarning("MCP server connection problem"), {
            server: server.name,
            reason: server.said,
          });
        } else if (server.standing === "connected") {
          tell(Effect.logDebug("MCP server connected"), {
            server: server.name,
          });
        }
      }
      announce(next);
    };

    /** The agent's own file would not run, said once for the two doors that
     *  report it — a malformed spawn call, and the `error` event an exec
     *  failure actually arrives on. It names the COMMAND, because the whole
     *  value of this reason over the broken pipe that follows it is that a
     *  person can see what they set. */
    const notStarted = (why: string): AgentGone =>
      new AgentGone({
        // Nothing was asked of anything: there is no process to ask.
        gone: "unreachable",
        why: `could not start the agent \`${options.command}\`: ${why}`,
      });

    // Nanosecond clock readings measure only this operation, never server uptime.
    const elapsedSince = (started: bigint) =>
      Effect.map(
        Clock.monotonicTimeNanos,
        (now) => `${Math.round(Number(now - started) / 1_000_000)}ms`,
      );

    const start = (): Effect.Effect<Live, AgentGone> =>
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        const child = yield* Effect.try({
          try: () =>
            startChild(options.command, [...options.args], {
              cwd: options.cwd,
              processGroup: true,
              // The row's extra env OVER olai's own — one key only when the row
              // asked for one — minus whatever this adapter must not see (a
              // `pi` the probe found on a search path this process's PATH may
              // not share; the five variables the Claude Code adapter reads as
              // "the person is remote"). Built unconditionally now rather than
              // inherited when the row asked for nothing: `undefined` cannot
              // express a removal, and the value is the same one either way.
              env: childEnv(),
              stdio: ["pipe", "pipe", "pipe"],
              // stdout is the ACP protocol; stealing it would be the
              // transport this file still owns. stderr is drained by the
              // socket so a pipe nobody reads cannot block the agent.
              drain: { stdout: false },
            }),
          catch: (cause) => notStarted(reasonOf(cause)),
        });
        // A BRING-UP THAT FAILS TAKES ITS PROCESS WITH IT. Nothing holds this
        // child until the handshake answers — `live` is set by the caller — so
        // a refusal or a deadline from here on would otherwise leave an
        // adapter (and whatever it spawned) running with no way to reach it,
        // one more for every retry.
        return yield* Effect.onError(connectTo(child, started), () =>
          Effect.promise(() => child.stop()),
        );
      });

    /** The spawned process, wired and greeted: its stderr, its exit, the
     *  connection, and `initialize`. */
    const connectTo = (
      child: Child,
      started: bigint,
    ): Effect.Effect<Live, AgentGone> =>
      Effect.gen(function* () {
        stderrBuf = "";
        stderrWritten = 0;

        /**
         * The same refusal, arriving the way it actually arrives.
         *
         * `KOLU_ACP_AGENT` is a path a PERSON sets, which makes it the likeliest
         * thing here to be wrong — and an exec that fails does so after `spawn`
         * has returned, so the `catch` above has never once seen one. What
         * happened instead was both halves of `@kolu/child`'s argument at
         * their worst: an uncaught `error` event dumped a stack trace on olai's
         * stderr, and the refusal a person got was ``initialize` failed: Cannot
         * call write after a stream was destroyed` — our end of a dead pipe,
         * where the sentence they needed was the name of the file that is not
         * there.
         *
         * Raced against the handshake rather than checked after it, so which
         * reason wins is not a question about the order two failures happen in.
         * The listener is attached inside `startChild`, on the line after
         * spawn — not here, and not when the race runs.
         */
        const failedToStart: Effect.Effect<never, AgentGone> = Effect.flatMap(
          Effect.promise(() => child.unstartable),
          (why) => notStarted(why),
        );

        // The agent's stderr is a log sink, not a channel: the adapter
        // redirects all its console output there. The socket already drains
        // it; this listener is the residue that turns each chunk into a DEBUG
        // line and keeps the cap the turn-failure dump reads. Set `log-level` to
        // `debug` on the olai policy node to read it. A failed turn warns because
        // that is where opencode dumps its JSON-RPC errors and the 2026-08-22
        // silent-send was otherwise undiagnosable.
        child.stderr?.on("data", (chunk: string | Buffer) => {
          takeStderr(
            typeof chunk === "string" ? chunk : chunk.toString("utf8"),
          );
        });

        // `close` rather than `exit`, and the listener is the one the socket
        // attached at spawn. `stop` nulls `live` then kills, so this handler
        // still has to log the exit of a child we asked to die —
        // `live?.child !== child` would drop the one line the operator has
        // for a clean shutdown.
        void child.closed.then(({ code, signal }) => {
          // An exec that never ran has no exit to report: the `error` event
          // is the news, and `notStarted` already named the file. Logging
          // "chat agent exited" here was an extra INFO line for a process
          // that was never a process (#367 NIT 6).
          if (child.failed() !== undefined) return;
          const ours = live?.child === child;
          const requested = requestedStops.get(child);
          requestedStops.delete(child);
          const id = requested?.session ?? (ours ? activeSession : null);
          if (ours) {
            live = null;
            // Before anything else it emits: a form left live on a dead wire is a
            // control that does nothing, and pressing it is how a person finds
            // out. {@link leaving} names the session being left, so it runs
            // before `session` is cleared.
            leaving();
            // ... AND WHO IT WAS SIGNED IN AS goes with the PROCESS, not with
            // the conversation: a conversation is reopened under the same
            // subprocess, and both adapters suppress an unchanged report, so
            // clearing it on the way into one would lose it for good.
            forgetIdentity();
            activeSession = null;
          }
          tell(Effect.logInfo("chat agent exited"), {
            ...(id === null ? {} : { session: id }),
            ...(code === null ? {} : { code }),
            ...(signal === null ? {} : { signal }),
            pid: child.pid,
            reason:
              requested?.reason ??
              (signal === null ? "process exited" : "process signaled"),
            expected: requested !== undefined,
          });
          if (stopped || !ours) return;
          emit({ _tag: "sessionOver", why: "gone" });
          emit({
            _tag: "gone",
            why: `the agent exited (code ${code ?? "none"}, signal ${signal ?? "none"})`,
          });
        });

        const opened = acpClient({ name: "olai" })
          .onNotification(methods.client.session.update, (context) => {
            onUpdate(context.params);
          })
          // THE AGENT'S OWN ACCOUNT OF WHO IT IS — for EVERY engine, and with
          // no session fence, because the notification is CONNECTION-scoped:
          // it carries no `sessionId`, and the fact belongs to the process
          // rather than to whichever conversation that process happens to
          // hold. So this is the one notification that does not go through
          // `elsewhere` — asking "whose session is this" would be a question
          // the payload does not answer, and a push arriving mid-turn about
          // the account that turn runs as is exactly the news wanted.
          //
          // Custom method, so the SDK wants a parser; there is nothing to
          // validate beyond "it is an object", and {@link identityIn} does the
          // reading (`@kolu/acp`). Subscribed unconditionally rather than off
          // the handshake marker, because the protocol says a client that
          // never saw the marker still accepts the notification — and the
          // empty `agentCapabilities._meta.authStatus` marker is therefore
          // informational and deliberately not read here.
          .onNotification(
            AUTH_STATUS_METHOD,
            (params: unknown) => params,
            (context) => {
              readIdentity(context.params);
            },
          );
        const stream = streamOver(child);
        const extension =
          dialect === null
            ? { stream, clientMeta: {} }
            : nativeActivity(
                opened,
                stream,
                ({ session, update }) => {
                  if (
                    !fromElsewhere(sessionRoot(session), activeSession, closed)
                  )
                    activity?.read(session, update);
                },
                dialect,
              );
        // The agent's own message, forwarded verbatim because the call that
        // OPENED this conversation asked for it (the leg's `openMeta`, on
        // `session/new` and `session/load` both — the Claude adapter reads the
        // subscription off whichever one made the session, and asking at `new`
        // alone left every restored conversation silent). Asking and then not
        // listening is what this used to do, which is why the header could name
        // a model the session had stopped running.
        //
        // SUBSCRIBED ONLY WHERE THERE IS SOMETHING TO SUBSCRIBE TO: an agent
        // whose leg forwards nothing (opencode does not) is one this method
        // never arrives from, and a handler for a notification nobody sends is
        // a reader's question with no answer in the file. Custom method, so the
        // SDK wants a parser: there is nothing to validate beyond "it is an
        // object", and the two readers below take one field each out of it.
        const raw = options.leg.rawMessages;
        const connection = (
          raw === null
            ? opened
            : opened.onNotification(
                raw.method,
                (params: unknown) => params,
                (context) => {
                  // WHOSE SESSION, asked once for both readers. Everything this
                  // notification carries is a fact about ONE conversation — the
                  // model it runs and the servers it got — and the adapter stamps
                  // the session it is about on every one of them.
                  if (elsewhere(context.params)) return;
                  readLiveModel(context.params);
                  // The same message, read for the other thing it carries. TWO
                  // readers over one notification rather than one that answers
                  // both: the model moves the header and the servers move the
                  // roster, they are true at different rates, and a single reader
                  // returning a pair would make every message that changed one of
                  // them look like news about both.
                  readLiveServers(context.params);
                },
              )
        )
          // Allowed without asking when it is one of the tools we handed this
          // session, and PUT IN FRONT OF A PERSON otherwise — the rule, and
          // what it used to cost to get it wrong, in `@kolu/acp/engine`.
          .onRequest(methods.client.session.requestPermission, (context) =>
            onPermission(context.params, context.signal),
          )
          // The agent's own structured question, which is a thing it can only
          // ask because `initialize` said we can draw one.
          .onRequest(methods.client.elicitation.create, (context) =>
            onElicitation(context.params, context.signal),
          )
          // ... AND ITS OTHER HALF, which only a URL elicitation ever sends: the
          // page a person was sent to has been dealt with, so the row can say so
          // and the request the agent is holding can be answered
          // ({@link onElicitationComplete}).
          .onNotification(methods.client.elicitation.complete, (context) => {
            onElicitationComplete(context.params);
          })
          .onRequest(methods.client.terminal.create, ({ params }) => {
            terminalSession(params.sessionId);
            return terminals.create(params);
          })
          .onRequest(methods.client.terminal.output, ({ params }) => {
            terminalSession(params.sessionId);
            return terminals.output(params);
          })
          .onRequest(methods.client.terminal.waitForExit, ({ params }) => {
            terminalSession(params.sessionId);
            return terminals.wait(params);
          })
          .onRequest(methods.client.terminal.kill, ({ params }) => {
            terminalSession(params.sessionId);
            return terminals.kill(params);
          })
          .onRequest(methods.client.terminal.release, ({ params }) => {
            terminalSession(params.sessionId);
            return terminals.release(params);
          })
          .connect(extension.stream);

        const initialized = (yield* Effect.raceFirst(
          ask(connection, methods.agent.initialize, {
            protocolVersion: PROTOCOL,
            clientCapabilities: {
              // Not an editor: the agent reaches the outlines through the ops
              // tools or not at all.
              fs: { readTextFile: false, writeTextFile: false },
              // BOTH MODES, and the URL half is a decision this file used to
              // record the other way. What changed is not the bargain — a
              // person does leave the panel for a page olai knows nothing
              // about — but what it costs to refuse it: the Codex adapter
              // withholds its device-code sign-in method entirely from a
              // client that does not advertise this (`getCodexAuthMethods`),
              // so the one flow that could sign somebody in from inside olai
              // never appears. The bargain is drawn instead: the card names
              // the machine the link goes to and the page is the browser's to
              // open, never this process's.
              elicitation: { form: {}, url: {} },
              // A SIGN-IN WE CAN RUN. `auth.terminal` is the protocol's own
              // spelling and `_meta["terminal-auth"]` is the pinned Claude
              // adapter's (`acp-agent.js`: it lists its paste-a-code methods
              // only for a client that advertises one of these, and falls
              // back to a full-screen TUI login this panel cannot draw). Both
              // are declared because the two adapters read one each.
              auth: { terminal: true },
              terminal: true,
              _meta: {
                ...(options.leg.terminalOutput
                  ? { terminal_output: true }
                  : {}),
                "terminal-auth": true,
                ...extension.clientMeta,
              },
              session: { configOptions: { boolean: {} } },
              // WHAT IS NOT ASKED FOR, named here because this is where it
              // would be asked for and a decision recorded anywhere else is a
              // decision nobody finds: `_meta["subagent-transcript"]: true`.
              // The pinned adapter reads that flag off these capabilities
              // (`supportsSubagentTranscript`) and, with it, forwards a
              // SPAWNED agent's own text and thinking as chunks stamped with
              // the `Agent` call they came from; without it those blocks are
              // stripped from the feed entirely. So a subagent's narration is
              // not something this panel is missing — it is something it has
              // not asked for, and the difference matters because asking is
              // one line. It is not asked for yet because a second voice in
              // the transcript is a feature with its own drawing to decide
              // (`olai-plugin-claude`'s `leg.ts` says what the panel does know about a
              // spawn), and because the flag's absence is what guarantees a
              // subagent's prose cannot arrive unattributed in the main
              // agent's voice.
            },
            clientInfo: { name: "olai", version: "0.1.0" },
          }),
          // A handshake against a process that never ran cannot win this, and
          // the point is which REASON is reported when it loses.
          failedToStart,
        )) as InitializeResponse;

        const capabilities = initialized.agentCapabilities;
        // WHAT IT SAYS IT CAN DO, out of the same answer and read by the leg —
        // the two facts a panel cannot work out for itself and must not guess
        // at: whether a message sent while it is busy is HELD (so the composer
        // may promise it will be got to), and whether it can be INTERRUPTED on
        // purpose (so the composer may offer the gesture that does it).
        //
        // Said as an event rather than kept here, because it is news about the
        // conversation like the model and the servers are, and the panel's own
        // state is where facts about the agent live. Emitted before anything
        // else this connection will say: `initialize` is the first round trip,
        // and a panel that heard about a turn before it heard about the agent
        // would draw one frame of an agent it knows nothing about.
        //
        // UNDER THE SAME `stopped` GUARD the exit path carries, and for its
        // reason rather than for a schedule anybody has demonstrated: a
        // handshake that finishes after this module was stopped is news about
        // a subprocess nobody is talking to, and the one thing it must never
        // do is attach to whatever replaced it. The swap already drops it
        // (`../chat.ts` answers a `talking` of `null` with nothing), so this is
        // the asymmetry closed rather than a bug fixed — one line, and the
        // pattern is already the file's.
        if (!stopped) {
          // WHAT IT OFFERS TO SIGN IN WITH, read once here and kept for the
          // press: the half a button needs travels (below), and the command
          // line a `terminal` method wants run stays where the spawn happens.
          offered = methodsIn(
            initialized,
            options.command,
            options.args,
            options.leg.terminalAuth,
          );
          emit({
            _tag: "advertised",
            steers: options.leg.steering?.advertised(initialized) ?? false,
            queues: options.leg.queues(initialized),
            methods: offered.map((one) => one.method),
          });
        }
        // AFTER the handshake, not after `spawn` returns: an exec failure
        // arrives later, and logging "spawned" for a command that never ran
        // is the silent-send class of lie — a line that says the process is
        // up when the next line is the ENOENT.
        yield* lifecycle(Effect.logDebug("chat agent command"), {
          command: options.command,
          args: options.args.join(" "),
        });
        yield* lifecycle(Effect.logInfo("chat agent ready"), {
          pid: child.pid,
          duration: yield* elapsedSince(started),
        });
        return {
          child,
          connection,
          canList: capabilities?.sessionCapabilities?.list != null,
          canLoad: capabilities?.loadSession === true,
        };
      });

    /** The stored conversations for our own directory, newest first.
     *
     *  The `cwd` we send is a REQUEST, not a filter: the Claude Code adapter
     *  scopes its answer by PREFIX, so a server started in a checkout is told
     *  about every agent working under it — a worktree, an orchestrator in the
     *  root. Adopting the newest of what came back would make somebody else's
     *  coding session this panel's conversation, so the list is narrowed to the
     *  exact directory here, once, and everything downstream draws from it.
     *
     *  NO LIMIT IS SENT and no `nextCursor` is followed: the protocol
     *  defaults apply, which on pi-acp is a page of fifty (its own
     *  `PAGE_SIZE`) — a directory with more stored pi conversations than one
     *  page draws the newest and loses the rest. opencode 2.2.7 is the other
     *  shape and costs nothing: it answers the WHOLE directory in one page,
     *  ignores a `limit` entirely, and hands a `nextCursor` anyway — one that
     *  answers zero rows when it is followed (captured over three stored
     *  conversations). The posture is agreed, not parked: the list answers
     *  which-conversation-recently rather than indexing an agent's database,
     *  and `website/docs/chat.md` says the size `pi`'s adapter pages at. */
    const storedFor = (
      at: Live,
    ): Effect.Effect<ReadonlyArray<Stored>, AgentGone> =>
      at.canList
        ? Effect.map(
            ask(at.connection, methods.agent.session.list, {
              cwd: options.cwd,
            }),
            (raw) =>
              (raw as ListSessionsResponse).sessions
                .filter((entry) => sameDirectory(entry.cwd, options.cwd))
                .map((entry): Stored => {
                  // What the AGENT'S OWN CORNER of the answer added, on top of
                  // the protocol's four fields — read by the leg, who is the
                  // only one that knows the corner's name; a listing that said
                  // nothing extra answers `null`, which is what a row says
                  // rather than a zero.
                  const listed = options.leg.listedIn(entry._meta);
                  return {
                    id: entry.sessionId,
                    title: entry.title ?? null,
                    updatedAt: entry.updatedAt ?? null,
                    messageCount: listed?.messageCount ?? null,
                    supersededBy: listed?.supersededBy ?? null,
                  };
                })
                .sort(newestFirst),
          )
        : Effect.succeed([]);

    const openSession = (at: Live): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const stored = at.canLoad ? yield* storedFor(at) : [];
        // Nothing stored is nothing to restore, and the memory is not read at
        // all then: an agent that keeps no conversations has no answer this
        // could change, and a boot that could not have restored anything must
        // not report a memory it never needed.
        if (stored.length === 0) {
          yield* fresh(at);
          return;
        }
        // Read INTO the mirror before anything is opened, because entering a
        // conversation writes the mirror back out ({@link entered}) — a recall
        // discarded here would be this boot forgetting what it had just read.
        if (options.models === undefined) held = yield* recalled;
        const wanted = adopt(
          options.models === undefined ? rememberedHere() : null,
          stored,
        );
        if (wanted !== undefined) {
          // The model goes with the conversation it was written down for. Adopt
          // the FALLBACK — the remembered one is gone — and there is nothing
          // remembered about the one we opened instead.
          yield* readChoice(wanted.id);
          yield* load(at, wanted.id, wanted.title, modelFor(wanted.id));
          return;
        }
        yield* fresh(at);
      });

    /**
     * A memory verb whose failure is a NOTICE rather than a refusal.
     *
     * The panel works without a memory — it opens the newest conversation, which
     * is what it always used to do — so neither of these may fail a boot, and
     * neither may be quiet about it either. One function for the rule, because
     * it is one rule: what a memory failure COSTS is the sentence, and it is the
     * only part that differs between the two.
     *
     * A failure answers `null`, which is what a recall that found nothing
     * answers anyway; the caller that had nothing to read in the first place
     * discards it.
     */
    const said = <A>(
      what: Effect.Effect<A, MemoryFailure>,
      cost: (why: string) => string,
    ): Effect.Effect<A | null> =>
      Effect.catchTag(what, "MemoryFailure", (failure) =>
        Effect.sync(() => {
          trouble(cost(failure.why));
          return null;
        }),
      );

    /** What this panel was last in and on, and `null` when nothing says. */
    const recalled: Effect.Effect<MemorySnapshot | null> = said(
      options.memory.recall,
      (why) =>
        `the conversation this directory was last in could not be read (${why}) — ` +
        `opening the most recent one instead`,
    );

    /**
     * What the memory says, as far as this process knows.
     *
     * MIRRORED rather than re-read, because both things that write it need the
     * other half: entering a conversation has to keep the model already written
     * down for it, and a model moving has to be written down against the
     * conversation it moved in. Re-reading the file for each would be two disk
     * reads answering a question this closure is holding the answer to.
     */
    let held: MemorySnapshot | null = null;

    /**
     * The remembered model for THIS conversation, and `null` for every other.
     *
     * The invariant the whole note turns on, spelled once because it is the one
     * that costs something when a call site forgets it: a model re-asserted
     * onto a conversation it was not remembered for is this note doing the very
     * thing it exists to undo. Every caller that opens a conversation asks
     * here rather than reading `held.model`.
     */
    const modelFor = (id: string): string | null =>
      held?.agent === options.id && held.session === id ? held.model : null;

    /** The conversation this panel was last in, when it was one of OURS.
     *
     *  A conversation belongs to one agent and a session id means nothing to
     *  another: asking opencode to load a Claude session id gets a refusal, and
     *  a note written for one agent adopted by the other would spend a boot
     *  finding that out. So the id is read only when the note names this agent,
     *  and a note about a different one leaves this boot with nothing
     *  remembered — which is the ordinary "adopt the newest" path, in an agent
     *  this panel has just been asked to talk to. */
    const readChoice = (session: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (options.models === undefined) return;
        const model = yield* said(
          options.models.read({ agent: options.id, session }),
          (why) =>
            `the model chosen for this conversation could not be read: ${why}`,
        );
        held = { agent: options.id, session, model };
      });

    const rememberedHere = (): string | null =>
      held?.agent === options.id ? held.session : null;

    /** The one write, whatever moved. What a failure COSTS is the caller's to
     *  say — a lost conversation and a lost model are different sentences to
     *  the person who will meet the consequence — and everything else about
     *  remembering is the same either way. */
    const note = (
      next: MemorySnapshot,
      cost: (why: string) => string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        held = next;
        // ONE AT A TIME: entering a conversation and the model under it moving
        // are two writes to one file, arriving from a boot fiber and a protocol
        // callback. Unordered, the older of them can land last and the next
        // boot reads a memory that was true a moment before it was written.
        yield* remembering.withPermit(
          Effect.asVoid(
            said(
              options.models === undefined
                ? options.memory.remember(next)
                : next.model === null
                  ? Effect.void
                  : options.models.write(next, next.model),
              cost,
            ),
          ),
        );
      });

    /**
     * The panel is in this conversation now: the id the verbs act in, the row
     * the panel draws, and the fact the next boot reads back.
     *
     * ONE function for the three, because they are one event: a session that
     * the verbs act in but the panel was never told about, or one the panel
     * shows and the next boot has never heard of, are both this fact half
     * done. It was two lines repeated at the two places a session is opened,
     * and writing it down is exactly the kind of third step a third call site
     * remembers two of.
     */
    const entered = (
      id: string,
      title: string | null,
      how: "new" | "loaded",
      started: bigint,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        activeSession = id;
        // Coming back into a conversation we left makes its leftovers news
        // about THIS visit. Load un-closes before the replay too, because the
        // frames land before this runs.
        closed.delete(id);
        yield* note(
          // The model is a fact ABOUT a conversation, so it travels with one:
          // coming back into the conversation we remember keeps what it was
          // running, and opening any OTHER one keeps nothing. A model carried
          // across would be re-asserted onto somebody else's conversation,
          // which is this note doing the thing it exists to undo.
          { agent: options.id, session: id, model: modelFor(id) },
          (why) =>
            `this conversation will not be restored after a restart: ${why}`,
        );
        // The session event makes the panel idle. Publish it after the local
        // write settles, so restarting an apparently ready conversation cannot
        // interrupt its memory and restore the previous selection. A failed
        // write still opens the conversation with note's existing notice.
        emit({ _tag: "session", id, title });
        yield* lifecycle(Effect.logInfo("conversation opened"), {
          how,
          duration: yield* elapsedSince(started),
        });
      });

    /**
     * The roster moved, so say so — the one place that writes it and the one
     * place that publishes it.
     *
     * TWO SITES CHANGE IT and each has to do both: a session opening composes
     * a fresh one, and the agent's own report refines the one that is up. Left
     * as two lines twice, "remember it and publish it" is a rule in somebody's
     * head — and the half that gets forgotten is silent, because a roster
     * written and not published looks exactly like a roster nothing has
     * changed. `entered` above is the same shape for the same reason.
     */
    const announce = (next: ReadonlyArray<Server>): void => {
      roster = next;
      emit({ _tag: "servers", servers: next });
    };

    /** The MCP servers this conversation gets: olai's own tool server, and
     *  whatever optional ones this host turns out to be running
     *  ({@link Options.probes}). Asked FRESH every time a session is opened
     *  rather than once at boot, so a daemon started after olai is picked up by
     *  the next conversation instead of the next restart. */
    const servers = Effect.map(
      // THE LIST IS ASKED FOR FIRST, and it can wait: the composition root
      // dispatches an event to collect it, and a listener that awaited before
      // contributing would otherwise be dropped with nothing red
      // ({@link Options.probes}). What comes back is the same list `probed` has
      // always taken, and the bounded concurrency below is untouched.
      Effect.flatMap(options.probes?.() ?? Effect.succeed([]), probed),
      // ONE probing answers both halves, and both are read off the ONE array
      // this callback is handed. `handedIn` takes what a session is given, and
      // `missingIn` takes what a person is owed about the ones it was not —
      // which used to be dropped here on the grounds that nothing drew it.
      // Something does now (`mcp-fail-visible`), and it reads the same answers
      // rather than probing a second time: two probings could disagree, and the
      // one a session was opened on is the one that is true about it.
      (found) => {
        const handing = mcpServersOf(options.tools(), handedIn(found));
        // Remembered as they are handed over, because "the tools we gave this
        // conversation" is exactly the set the permission handler allows
        // without asking — and it is decided per conversation.
        //
        // OFF `handing` AND NOT OFF THE ROSTER BELOW, which is built from the
        // same array one line down. The roster is a thing to LOOK at and this
        // is the set that decides which permission requests are answered
        // without a person, so it is read from the literal list going on the
        // wire rather than from a display model that could one day grow a row
        // for a server nobody handed over ({@link ./servers.ts} says why it
        // deliberately does not).
        given = handing.map((server) => server.name);
        // Before the session, always — and now on EVERY conversation rather
        // than only on a broken one. A roster is the answer to "which servers
        // does this conversation have?", which is a question about a healthy
        // session as much as a failed one — and a panel told only about
        // failures leaves the other answer to the model, which is the incident
        // this comes from (`mcp-roster-visible`).
        announce(rosterOf(handing, missingIn(found), addressesIn(found)));
        return handing;
      },
    );

    const fresh = (at: Live): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        // WHAT IS BEING OPENED, before it is asked for — `null` because a fresh
        // conversation picks its own and belongs to nobody until it exists.
        // Said even so: what this clears is the LAST attempt's subject, and a
        // refused `session/new` wearing the node of a load refused before it
        // would be the one wrong thing the face can say.
        emit({ _tag: "opening", id: null });
        const made = (yield* ask(at.connection, methods.agent.session.new, {
          cwd: options.cwd,
          mcpServers: [...(yield* servers)],
          ...openMeta,
        })) as NewSessionResponse;
        // ARMED HERE, immediately on the answer being read: the doubled chunk
        // is written after the response on the one stream (pi-acp emits it
        // from a `setTimeout` behind its own `session/new` return), and a
        // response's continuation runs before the next notification can be
        // pulled — see the microtask argument at `Leg.prologueIn`. An adapter
        // that reorders ships the banner to the transcript instead, which is
        // the safe direction.
        prologue = options.leg.prologueIn(made);
        readModel(made.configOptions);
        yield* askForBypass(at, made.sessionId, made.configOptions);
        yield* entered(made.sessionId, null, "new", started);
      });

    const load = (
      at: Live,
      id: string,
      title: string | null,
      /** The model this conversation was last known to be running, when it is
       *  one somebody switched it to — {@link restore}'s whole subject. */
      wanted: string | null,
    ): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        // WHICH CONVERSATION THIS OPEN IS FOR, before the request that can be
        // refused ({@link ./events.ts}'s `opening`). It is the only line the
        // BOOT's adopted conversation is named on: nothing above this call ever
        // told the panel which one a boot chose.
        emit({ _tag: "opening", id });
        // Before the flag below, because a detection is not a replay.
        const mcpServers = [...(yield* servers)];
        // THIS conversation is the one we are coming back to. Leftover frames
        // from a previous visit of it are now news about this one — and the
        // replay that follows names this id before {@link entered} records it.
        // Closed it when we left; un-close before the frames land, or the
        // load of a conversation we just left would draw nothing.
        closed.delete(id);
        // Everything between these two is history. The flag is set before the
        // call because a load replays THEN answers.
        replaying = true;
        emit({ _tag: "replayStarted" });
        const loaded = (yield* Effect.onExit(
          ask(
            at.connection,
            methods.agent.session.load,
            // The same `_meta` a fresh session sends, and for a reason that is
            // this call's own: the adapter reads the raw-message subscription
            // off whichever request MADE the session, and a load makes one. Sent
            // only at `session/new`, the CLI's `init` never arrived for a
            // RESTORED conversation — so the header could not follow a `/model`
            // in one, and neither could the memory that has to remember it.
            { sessionId: id, cwd: options.cwd, mcpServers, ...openMeta },
            LOAD_TIMEOUT,
          ),
          () =>
            Effect.sync(() => {
              replaying = false;
              emit({ _tag: "replayEnded" });
            }),
        )) as LoadSessionResponse | undefined;
        // A REARM, not the disarm: that already happened in {@link leaving},
        // before a single frame of the replay above could arrive — which is
        // the ordering that matters, because the replay lands DURING the ask
        // and this line of it after. A `session/load` that announces a
        // prologue of its own arms it here; this adapter's answers `null`,
        // and null is "drop nothing", the whole of the claim.
        prologue = options.leg.prologueIn(loaded ?? null);
        // AFTER THE ANSWER, and that ordering is the whole of one bug. Entering
        // a conversation is what this module records being IN one — it sets the
        // session every later verb acts on, and it writes the note the next boot
        // reads. Done before the request, a load the agent REFUSED left both
        // pointing at a conversation the agent had just said no to: every
        // prompt after it failed, and the next boot went back and asked for the
        // same one again.
        //
        // Nothing is lost by waiting. The replay's own frames need no session —
        // they are rows, and `replayStarted` has already emptied the transcript
        // for them — so what the panel is short of in between is the title,
        // which it gets a moment later along with everything else.
        yield* restore(at, id, loaded?.configOptions, wanted);
        yield* askForBypass(at, id, loaded?.configOptions);
        yield* entered(id, title, "loaded", started);
      });

    /**
     * Put a restored conversation back on the model it was switched to.
     *
     * THE BUG THIS IS (`chat-model-reverts-on-restart`): a person switches the
     * chat with `/model`, olai is redeployed, and the same conversation comes
     * back on the model the container pins. Nothing in the panel had gone wrong
     * — the agent really is running that model, and the header really is naming
     * what it was told. The pin outranks the conversation at the agent's end:
     * the adapter (captured at 0.66.0) resolves a session's model as env, then
     * `settings.json`, then the resumed transcript, and for a RESUMED session
     * it deliberately re-asserts the first two over the third with `setModel`,
     * because "a resumed session lands on the transcript's model regardless of
     * env/settings". A `/model` lives only in that transcript. So it loses,
     * every boot, silently, and the only remedy that did not need code was to
     * go and delete a line from a file inside the container.
     *
     * WHAT IS DONE ABOUT IT: the model is the picker, and the picker is a
     * config option a client may SET. So the panel says, once, after the load,
     * what this conversation was running — and the agent's own re-assert, which
     * ran during the load, is a thing that happened before we said it.
     *
     * SAID ONLY WHEN IT DISAGREES, and disagreement is judged in names rather
     * than in strings ({@link sameAs}): what we remember is as often a live
     * API id (`claude-fable-5`) as a picker value (`fable`), and those are the
     * same model. A conversation that came back on the model it left on is one
     * this says nothing about at all — no round trip, and no request to fail.
     *
     * SAID IN THE PICKER'S OWN WORDS, for the same reason one step further on
     * ({@link pickerValueFor}): a config option takes the values the picker
     * offers, and what we remember is the id the CLI reported. The pinned
     * adapter would resolve `claude-fable-5` onto its `fable` row; an agent
     * that checked its own list would refuse, and refusing leaves the
     * conversation on the pin. So the row is named where a row can be found.
     *
     * WHAT IT COSTS, and this is the honest half: olai's note is not the only
     * way this conversation's model can move. A `/model` typed into a terminal
     * `claude --resume` on the SAME conversation between two olai boots lands
     * in the transcript, arrives here as a picker that disagrees with the note,
     * and is put back. Olai cannot tell that from the pin it exists to overrule
     * — the wire says which model, never who decided it — and between a panel
     * that loses the choice made IN it every single restart and one that can
     * lose a choice made elsewhere while it was not running, the second is the
     * better failure. Said in `website/docs/chat.md` rather than only here.
     *
     * A REFUSAL IS A ROW, not a boot failure: the conversation is open and
     * usable on the agent's own model, which is exactly what it was before this
     * existed. The memory is left ALONE on that path — untouched, so the next
     * boot tries again — and the header goes on naming what the agent said.
     */
    const restore = (
      at: Live,
      id: string,
      configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
      wanted: string | null,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        // NOTHING TO PUT BACK on an agent with no picker: there is no config
        // option to address the request to and no vocabulary to say it in, so
        // the conversation opens on whatever the agent chose — which is what it
        // did before any of this existed.
        readSettings(configOptions);
        if (models === null) return;
        const picker = modelPickerIn(models, configOptions);
        const settled =
          wanted === null ||
          picker === null ||
          (picker.picked !== null &&
            sameModel(models, picker.labels, picker.picked, wanted))
            ? picker
            : yield* putModel(at, models, id, picker, wanted);
        // ONE TAIL, whichever of the three ways it got here: what the header
        // names is read from the picker that had the last word — the one the
        // load answered with, or the one the agent answered our request with.
        observePicker(settled);
      });

    /** The request half of {@link restore}, and what a refusal costs: a row,
     *  the model the load already reported, and a memory left alone. */
    const putModel = (
      at: Live,
      models: ModelReading,
      id: string,
      picker: Picker,
      wanted: string,
    ): Effect.Effect<Picker | null> =>
      Effect.gen(function* () {
        const answered = yield* Effect.result(
          requestModel(
            at,
            models,
            id,
            pickerValueFor(models, picker.labels, wanted) ?? wanted,
          ),
        );
        if (answered._tag === "Failure") {
          trouble(
            `this conversation was on ${models.nameIn(picker.labels, wanted) ?? wanted} and ` +
              `could not be put back: ${answered.failure.why}`,
          );
          return picker;
        }
        return answered.success;
      });

    /** The ACP exchange shared by restoration and selection. It accepts an exact
     *  picker value and returns what the agent confirmed; each caller owns its
     *  alias translation, refusal handling, and persistence policy. */
    const requestModel = (
      at: Live,
      models: ModelReading,
      id: string,
      value: string,
    ): Effect.Effect<Picker | null, AgentGone> =>
      Effect.map(
        ask(at.connection, methods.agent.session.setConfigOption, {
          sessionId: id,
          configId: models.config,
          value,
        }),
        (answer) => {
          const config = (answer as SetSessionConfigOptionResponse)
            .configOptions;
          readSettings(config);
          return modelPickerIn(models, config);
        },
      );

    /** Apply the engine's permission policy before activating the session.
     *  Some engines require it; others retain their permission backstop when
     *  the adapter refuses. Neither refusal is silent. */
    const askForBypass = (
      at: Live,
      id: string,
      config: ReadonlyArray<SessionConfigOption> | null | undefined,
    ): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const mode = options.leg.bypassMode;
        if (mode === null) return;
        const result = yield* Effect.result(
          ask(at.connection, methods.agent.session.setMode, {
            sessionId: id,
            modeId: mode,
          }),
        );
        if (result._tag === "Failure") {
          const why = `could not select permission mode ${mode} for session ${id}: ${result.failure.why}`;
          if (options.leg.bypassModeRequired === true) {
            // Replay and settings can arrive before selection. Withdraw that
            // provisional visit and fence its late notifications just like a
            // session we left; no active session or memory claim was made.
            closed.add(id);
            leaving();
            show(null);
            emit({ _tag: "sessionOver", why: "refused" });
            return yield* new AgentGone({ gone: result.failure.gone, why });
          }
          trouble(
            `${why}; continuing with the adapter's existing permission mode`,
          );
          return;
        }
        // set_mode may acknowledge without publishing config_option_update.
        // Reflect its confirmed value only in an advertised mode control that
        // actually offers that value; unrelated settings retain their last update.
        const ids = new Set(
          (config ?? [])
            .filter((option) => option.category === "mode")
            .map((option) => option.id),
        );
        let changed = false;
        settings = settings.map((option) => {
          if (
            !ids.has(option.id) ||
            option.kind === "boolean" ||
            !acceptsSetting(option, mode) ||
            option.value === mode
          )
            return option;
          changed = true;
          return { ...option, value: mode };
        });
        if (changed) emit({ _tag: "settings", settings });
      });

    /** The subprocess, and nothing about a conversation. Its own step because
     *  the two things a caller can want are genuinely different: {@link boot}
     *  wants the panel IN a conversation, and {@link opening} and
     *  {@link listing} want only somebody to talk to — because what each does
     *  next either says which conversation itself, or is a question about no
     *  conversation at all. */
    const bringUpProcess = Effect.gen(function* () {
      if (stopped) return yield* shuttingDown();
      const started = live ?? (yield* start());
      live = started;
      return started;
    });

    /**
     * SIGN IN — {@link Agent.signIn}'s own argument, and the four ways it ends.
     *
     * THE PROCESS AND NOT A CONVERSATION, which is the whole reason this does
     * not boot: signing in is what an agent is asked for when opening a session
     * was REFUSED for want of a signature, so a path that insisted on a session
     * first would refuse to run the one thing that fixes the refusal. It takes
     * the live process when there is one and starts one when there is not
     * ({@link bringUpProcess}), and neither the session list nor the memory is
     * touched.
     *
     * ONE ATTEMPT PER AGENT, and a press while one is in flight is that claim:
     * the same method ATTACHES (the caller is looking at the row the attempt is
     * already drawing, and a second process writing the same credential store is
     * the one thing this must not do), and a different one is refused with a
     * sentence.
     */
    const signIn = (method: string): Effect.Effect<SignedIn, AgentGone> =>
      // `suspend`, NOT `gen`: everything below the claim has to happen with
      // NOTHING yielded in between, and a generator's body is allowed to be
      // suspended at every `yield*` — which is exactly the gap two presses in
      // one tick would otherwise both walk through.
      Effect.suspend(() => {
        if (stopped) return shuttingDown();
        // WHETHER THIS IS EVEN A METHOD is asked FURTHER DOWN, once there is an
        // advertisement to ask: a cold agent has `offered` empty until it has
        // handshaken, and the handshake is one of the things the claim below
        // has to be taken before.
        const running = attempt;
        if (running !== null) {
          if (running.method === method)
            return Effect.succeed("attached" as const);
          return Effect.fail(
            new AgentGone({
              gone: "refused",
              why: `a sign-in is already running (${running.label})`,
            }),
          );
        }
        // THE CLAIM, TAKEN HERE: read-then-write with no suspension point
        // between them, so a second caller — another tab, another press, the
        // same tick — reads a slot that is already full and attaches or is
        // refused. The record starts EMPTY ON PURPOSE (no process, no line, a
        // `stop` that does nothing yet, the method's id where its name will go)
        // and the runner fills it in as the thing it is about to own appears; a
        // stop that lands in that window sets `stopping`, which the runner
        // reads the moment there is something to act on.
        const claim: Attempt = {
          method,
          label: method,
          write: null,
          stopping: false,
          stop: () => Promise.resolve(),
          link: null,
        };
        attempt = claim;
        return Effect.ensuring(
          Effect.gen(function* () {
            const at = yield* bringUpProcess;
            // ... AND ONLY NOW can the advertisement be read, because the
            // handshake above is what fills it. A method this agent does not
            // offer is refused HERE rather than before the claim: the claim is
            // what a cold start must not be able to walk through twice, and it
            // cannot be taken after a yield.
            const found = offered.find((one) => one.method.id === method);
            if (found === undefined) {
              return yield* new AgentGone({
                gone: "refused",
                why: `\`${method}\` is not a sign-in this agent offers`,
              });
            }
            claim.label = found.method.name;
            // NOTHING TO PRESS, so nothing to run: a method whose sign-in is a
            // wizard that refuses a pipe is drawn as a label and a command
            // line, and a press that reached here anyway (an old tab, a
            // scripted client) is told the same thing the card says rather
            // than quietly starting the AGENT arm instead.
            if (found.method.runs === "hand") {
              return yield* new AgentGone({
                gone: "refused",
                why: `\`${found.method.name}\` is run by hand: ${found.method.command ?? "see the sign-in card"}`,
              });
            }
            return found.run === null
              ? yield* runAgent(claim, at, found)
              : yield* runTerminal(claim, found, found.run);
          }),
          // ... AND THE CLAIM IS LET GO, whatever happened — which takes the
          // record's own `stopping` with it, there being no flag left to reset.
          Effect.sync(() => {
            attempt = null;
          }),
        );
      });

    /**
     * A TERMINAL METHOD: a process this panel runs, whose output is the row.
     *
     * The environment it gets is `BROWSER=true` over everything else
     * ({@link childEnv}), and that one variable is not decoration: the `claude`
     * CLI opens a browser when it thinks one is available, and on a server that
     * is either an error or somebody's OTHER desktop. `true` is the traditional
     * way of saying "there is no browser here, print the URL" — which is exactly
     * the flow this panel draws.
     *
     * Exit 0 is the whole of "it worked", which is the contract every one of
     * these CLIs keeps; anything else leaves the output on the row AS the
     * failure, because for a CLI the output is what a person needs to read.
     */
    const runTerminal = (
      claim: Attempt,
      found: Offered,
      run: TerminalAuth,
    ): Effect.Effect<SignedIn, AgentGone> =>
      Effect.gen(function* () {
        const method = found.method.id;
        const label = found.method.name;
        let output = "";
        const say = (running: boolean, code: number | null): void => {
          emitSignIn({
            kind: "terminal",
            method,
            label,
            output,
            running,
            code,
            why: null,
          });
        };
        const child = yield* Effect.try({
          try: () =>
            startChild(run.command, [...run.args], {
              cwd: options.cwd,
              // Its own group, like the agent's: this process is ours and a
              // cancel must reach whatever it started.
              processGroup: true,
              env: childEnv({ BROWSER: "true", ...run.env }),
              stdio: ["pipe", "pipe", "pipe"],
              // Both pipes are read here, so neither may be drained behind our
              // back — the row IS the reader.
              drain: { stdout: false, stderr: false },
            }),
          catch: (cause) =>
            new AgentGone({
              gone: "unreachable",
              why: `could not run \`${run.command}\`: ${reasonOf(cause)}`,
            }),
        });
        // NOTHING IS DRAWN FOR A STOPPED ATTEMPT, and the chunks are why:
        // a process that was killed still has whatever it wrote in flight, and
        // a chunk that landed between the kill and the close would re-draw the
        // row the cancel just took away — for a moment, until the close said
        // otherwise, which is the one frame nobody should see.
        const stopped = (): boolean => claim.stopping;
        const appended = (chunk: string): void => {
          if (stopped()) return;
          output = tailBytes(output + chunk, SIGN_IN_CAP).output;
          say(true, null);
        };
        for (const stream of [child.stdout, child.stderr]) {
          stream?.setEncoding("utf8");
          stream?.on("data", appended);
        }
        // A write to a process that has gone is not this row's news: the close
        // below is, and an unhandled `error` on a pipe would be a stack trace
        // on olai's stderr for somebody typing into a finished login.
        child.stdin?.on("error", () => {});
        // ... AND THE CLAIM GETS ITS HANDS: the process exists from here on, so
        // a stop that arrived before it did has something to kill at last.
        claim.write = (line) => {
          if (child.stdin === null || child.stdin.destroyed) return;
          child.stdin.write(line);
        };
        claim.stop = () => child.stop().then(() => undefined);
        // A STOP THAT BEAT THE SPAWN is acted on here rather than never: the
        // claim is taken before the process is, which is the price of the
        // atomicity, and this is where it is paid.
        if (stopped()) {
          yield* Effect.promise(() => child.stop());
          emitSignIn(null);
          return "cancelled";
        }
        say(true, null);
        // The same refusal the agent itself can meet: a command that is not
        // there fails AFTER `spawn` returned, so it arrives here rather than in
        // the `catch` above. Said on the row, because the row is what a person
        // is looking at.
        void child.unstartable.then((why) => {
          if (stopped() || attempt?.method !== method) return;
          // ONCE, as the REASON. It used to be appended to the output as
          // well, and the card draws both — so a failure to start read as the
          // same sentence twice, once quoted as the process's own words when
          // the process never produced any.
          emitSignIn({
            kind: "terminal",
            method,
            label,
            output,
            running: false,
            code: null,
            why,
          });
        });
        // THE WAIT, with the kill behind it: this fiber is the panel's (it runs
        // the attempt to its end, `./chat.ts`), and when it goes — a cancel, a
        // shutdown, the engine switched off — the process goes with it. A stop
        // of a process that has already closed is a no-op (`@kolu/child`: ESRCH
        // is success), so the ordinary ending pays nothing for the guarantee.
        const close = yield* Effect.ensuring(
          Effect.promise(() => child.closed),
          Effect.promise(() => child.stop()),
        );
        if (child.failed() !== undefined) return "failed";
        // A CANCEL THAT LOST THE RACE IS NOT AN ENDING. A login that exited 0
        // has written the credential store, so calling it `cancelled` tells
        // the caller there is nothing to restart for, and the running agent
        // then keeps the signature it started with while the store holds a
        // different one. The row comes down either way — the person asked for
        // that — but the answer is what happened.
        if (stopped() && close.code !== 0) {
          emitSignIn(null);
          return "cancelled";
        }
        if (close.code === 0) {
          emitSignIn(null);
          return "signed-in";
        }
        say(false, close.code);
        return "failed";
      });

    /**
     * AN AGENT METHOD: a page, a person, and the agent's word for when it is
     * done. Nothing here is a process — what this panel runs is the WAIT.
     *
     * The request is FORKED so that a cancel can take it back, and it has no
     * deadline at all: a device-code sign-in is somebody finding their password
     * and their phone. What ends it is the adapter answering, which for the
     * pinned Codex adapter happens the moment its own login completes.
     *
     * THE END IS AWAITED, NOT JOINED, and that is not a style choice: joining
     * an interrupted fiber INTERRUPTS THE JOINER, so the cancel arm below would
     * never run and the promise that a cancelled sign-in says nothing would
     * hold only by accident — `Effect.ensuring` cleaning up on the way past.
     * Awaiting hands back the Exit instead, which is what a reading of "how did
     * it end" wants anyway.
     */
    const runAgent = (
      claim: Attempt,
      at: Live,
      found: Offered,
    ): Effect.Effect<SignedIn, AgentGone> =>
      Effect.gen(function* () {
        const method = found.method.id;
        const label = found.method.name;
        const say = (link: SignInLink | null, why: string | null): void => {
          emitSignIn({ kind: "agent", method, label, link, why });
        };
        say(null, null);
        const request = yield* Effect.forkChild(
          ask(
            at.connection,
            methods.agent.authenticate,
            { methodId: method },
            null,
          ),
        );
        // ... AND THE CLAIM LEARNS WHERE THE REQUEST IS, so a stop that arrived
        // while the agent was still being reached takes it back the moment
        // there is something to take back.
        const stopped = (): boolean => claim.stopping;
        claim.stop = () => {
          // BOTH HALVES, in this order: the question the agent is holding goes
          // back unanswered — which is what makes a device-code login cancel the
          // login at ITS end rather than wait forever — and then our request is
          // taken back, since nothing is left to hear from it.
          claim.link?.answer("decline");
          return Effect.runPromise(Fiber.interrupt(request));
        };
        // A STOP THAT BEAT THE FORK is acted on here rather than never, for the
        // reason the terminal runner's is: the claim is taken before the
        // request is, and this is where that is paid for.
        if (stopped()) {
          claim.link?.answer("decline");
          yield* Fiber.interrupt(request);
          emitSignIn(null);
          return "cancelled";
        }
        const outcome = yield* Fiber.await(request);
        // A CANCEL READS AS A CANCEL whichever half of it lands first: the
        // press sets `stopping`, and the interrupt it asks for comes back here
        // as an exit whose cause is nothing but an interruption — the same
        // shape an agent scope going away leaves, which is the other way this
        // attempt can end without anything to say.
        if (
          stopped() ||
          (outcome._tag === "Failure" && Cause.hasInterrupts(outcome.cause))
        ) {
          emitSignIn(null);
          return "cancelled";
        }
        if (outcome._tag === "Failure") {
          say(null, reasonOf(outcome.cause));
          return "failed";
        }
        emitSignIn(null);
        return "signed-in";
      });

    /** One line for the process a sign-in is running ({@link
     *  Agent.signInInput}). Refuses when there is nothing behind it, which is
     *  both "no attempt" and "the agent is running this one". */
    const signInInput = (text: string): Effect.Effect<void, AgentGone> =>
      Effect.suspend(() => {
        const write = attempt?.write ?? null;
        if (write === null) {
          return Effect.fail(
            new AgentGone({
              gone: "refused",
              why: "no sign-in is waiting for a line to be typed into it",
            }),
          );
        }
        return Effect.sync(() => write(`${text}\n`));
      });

    /** ... and stopping it ({@link Agent.signInCancel}). The boolean is
     *  whether there was anything to stop: a cancel with nothing behind it is a
     *  stale tab, and the panel says nothing about those. */
    const signInCancel: Effect.Effect<boolean> = Effect.sync(() => {
      const running = attempt;
      if (running === null) return false;
      // Set BEFORE the stop, because the fiber that owns the attempt reads it
      // on the way out: which of the two endings it is depends on whether a
      // PERSON asked, and this is the only moment that is known.
      running.stopping = true;
      void running.stop();
      return true;
    });

    /**
     * The boot itself, WITHOUT the permit — so that a caller which has to hold
     * that permit across more than a boot can ({@link opening}).
     *
     * Split from {@link boot} rather than duplicated, because the thing being
     * serialized is not "booting" but OPENING A CONVERSATION, and there are two
     * ways in.
     */
    const bringUp = Effect.gen(function* () {
      // BEFORE the short-circuit below rather than inside {@link bringUpProcess}
      // alone: a stopped agent that is still holding an open session would
      // otherwise answer this verb as if nothing were wrong.
      if (stopped) return yield* shuttingDown();
      if (live !== null && activeSession !== null) return;
      // Whether THIS bring-up is the one that spawns the process: only then is
      // the open below the process's first, and its failure the process's own.
      const spawning = live === null;
      const started = yield* bringUpProcess;
      // `onError` hands the fiber's CAUSE, not the failure — `String` on one
      // of those is `Cause([Fail(…)])` with the reason buried in it, which
      // is a notice a person reads. `reasonOf` squashes it back down.
      yield* Effect.onError(openSession(started), (cause) =>
        Effect.gen(function* () {
          trouble(`the agent could not open a session: ${reasonOf(cause)}`);
          // ... AND THE PROCESS GOES WITH THE OPEN THAT STARTED IT: an agent
          // that would not open its first conversation is a failure a caller
          // cannot work around, and a child left running with nothing to talk
          // to is the leak. The ONE refusal that keeps it is nobody being
          // signed in: the process that refused is the one a sign-in has to
          // run against.
          const failure = Cause.squash(cause);
          if (!spawning) return;
          if (failure instanceof AgentGone && failure.auth === true) return;
          yield* abandon(started);
        }),
      );
    });

    /** A process nothing will talk to, stopped: it stops being `live` first,
     *  so its exit is not reported as the agent going away. */
    const abandon = (at: Live): Effect.Effect<void> =>
      Effect.promise(async () => {
        if (live === at) live = null;
        forgetIdentity();
        at.connection.close();
        await at.child.stop();
      });

    const boot = booting.withPermit(bringUp);

    /** The process that came up, or the refusal that there is none. The tail
     *  both doors below share. */
    const onLive = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> => {
      const at = live;
      return at === null
        ? Effect.fail(
            new AgentGone({
              gone: "unreachable",
              why: "the agent is not running",
            }),
          )
        : use(at);
    };

    /** Every verb: boot if necessary, then act on the process that came up. */
    const withLive = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      Effect.gen(function* () {
        yield* boot;
        return yield* onLive(use);
      });

    /**
     * ... and the verbs that want THE PROCESS AND NOT A CONVERSATION, which
     * hold the boot's own permit for the whole of what they do.
     *
     * ONE OPEN AT A TIME, and this is what makes that structural. `boot`
     * short-circuits on the module being in a conversation, and a conversation
     * is not entered until the agent has agreed to it ({@link load}) — so
     * between a `session/load` going out and its answer coming back, the module
     * is in none, and any verb that booted in that window would start a SECOND
     * open against a live one. The composer is never disabled and a prompt
     * typed while the panel is `booting` is accepted, so that window is a
     * person's ordinary next keystroke rather than a race somebody has to
     * arrange: it ended with two conversations opened and the panel in whichever
     * finished last, which is not the one they asked for.
     *
     * A concurrent verb WAITS here rather than being refused. There is nothing
     * to tell it — the conversation it should act in is the one being opened —
     * and the initial boot has always behaved this way; what was missing is
     * that a picker-driven open released the permit before doing its work.
     *
     * BOTH CALLERS ARE VERBS THAT OPEN ONE, and they say which one themselves
     * — which is why they must not let `bringUp` pick a different one first
     * (the boot's adopted conversation, replayed in full, only to be replaced).
     * That was invisible while the process was always already up by the time
     * anybody pressed anything; an agent that is started when a conversation
     * needs it ({@link ./chat.ts}) reaches this cold every time somebody picks
     * one.
     */
    const opening = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      booting.withPermit(
        Effect.gen(function* () {
          yield* bringUpProcess;
          return yield* onLive(use);
        }),
      );

    /**
     * END THE CONVERSATION BEING LEFT, at the agent — ACP's `session/close`.
     *
     * MEASURED, against the pinned Claude adapter 0.81.2: a session's work runs
     * in its own SDK `query()`, and `query()` SPAWNS A `claude` CLI the moment
     * the session is made. Nothing ever ends that CLI except `session/close` or
     * the connection dying, so a client that opens a second conversation on one
     * adapter and never closes the first leaves the first CLI running for the
     * life of the process — one `claude` per conversation anybody ever left.
     *
     * BEFORE the next open, so a host never carries two CLIs for one agent, and
     * an open that fails does not leave the old conversation running with
     * nothing able to reach it. It does not FORGET the conversation: the agent's
     * stored transcript is untouched (forgetting is `session/delete`), so a
     * later load of the same id is still a load.
     *
     * SWALLOWED, and said only in the log. There is no capability to read
     * first, so an agent without the method answers "method not found", and a
     * refusal to end a conversation nobody is in is no reason to refuse a
     * person the one they asked for.
     */
    const release = (at: Live, left: string | null): Effect.Effect<void> =>
      left === null
        ? Effect.void
        : Effect.catchTag(
            Effect.asVoid(
              ask(
                at.connection,
                methods.agent.session.close,
                { sessionId: left },
                CLOSE_TIMEOUT,
              ),
            ),
            "AgentGone",
            (gone) =>
              Effect.sync(() => {
                tell(
                  Effect.logWarning(
                    "the conversation being left could not be closed; the agent may still be holding it",
                  ),
                  { session: left, why: gone.why },
                );
              }),
          );

    /**
     * ... and the LISTING, which wants the same process and holds the permit
     * for no longer than starting one.
     *
     * A different rule, and the difference is the whole reason it is not spelled
     * {@link opening}: {@link Agent.sessions} opens nothing, so "one open at a
     * time" is not what it needs. What it needs is "one COLD START at a time" —
     * and a process that is already up needs no start at all, so it takes NO
     * PERMIT. That is the whole of the fix: {@link opening} holds this same
     * permit across a `session/load` AND ITS REPLAY, so a listing that queued
     * on it waited out the replay of a conversation it has nothing to do with.
     * Opening the list while the agent you are talking to is opening one is
     * exactly when somebody does it, and the answer to it — what is stored —
     * cannot be changed by the open in flight.
     *
     * The reverse ordering is the one the permit is FOR and it is untouched: a
     * listing that has to start the process holds it for that, so nothing opens
     * a conversation against a handshake in flight.
     *
     * It must not BOOT either way, which is the half it shares with the verbs
     * above: a listing is a question, not a visit, and it is asked of agents
     * this panel is not talking to at all ({@link ./listings.ts}). An agent
     * started to answer it and stopped again must not enter, replay and
     * REMEMBER a conversation on the way past.
     */
    const listing = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      Effect.suspend(() =>
        live !== null
          ? onLive(use)
          : Effect.flatMap(booting.withPermit(bringUpProcess), () =>
              onLive(use),
            ),
      );

    /** ... and the ones that also need a conversation to act IN. */
    const withSession = <A>(
      use: (at: Live, id: string) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      withLive((at) => {
        const id = activeSession;
        return id === null
          ? Effect.fail(
              new AgentGone({
                gone: "unreachable",
                why: "the agent has no session open",
              }),
            )
          : use(at, id);
      });

    const prompt = (text: string) =>
      withSession((at, id) =>
        Effect.gen(function* () {
          // A cancel that arrived during the handshake is sent the moment the
          // prompt is on the wire, so every cancelled turn ends the same way.
          //
          // FORKED because it has to outlive this line and cannot be waited on
          // — the prompt below is what holds the turn open — but a forked
          // failure is one nobody is watching, and this one used to go
          // nowhere at all: the deferred cancel never landed, the turn ran to
          // the end, and the panel said nothing about either. `trouble` is
          // where a failure with no caller belongs (the boot path uses it for
          // the same reason), so it reaches the transcript rather than the
          // fiber's dump.
          if (cancelPending) {
            cancelPending = false;
            // OWNED BY THIS AGENT, not by the global scope. It was
            // `Effect.forkDetach`, so a session stopped inside the ten
            // milliseconds below sent its cancel to a connection that had
            // already closed — small, and the same class as the panel's own
            // forks one file over ({@link ./chat.ts}'s `aside`).
            yield* aside(
              Effect.onError(
                Effect.andThen(
                  Effect.sleep("10 millis"),
                  Effect.ensuring(
                    notify(at, methods.agent.session.cancel, { sessionId: id }),
                    Effect.promise(() => terminals.cancel()),
                  ),
                ),
                (cause) =>
                  Effect.sync(() => trouble(notCancelled(reasonOf(cause)))),
              ),
            );
          }
          // Size, never content: a prompt is somebody's words and the journal
          // is for the operator, not a transcript. UTF-8 bytes, not UTF-16
          // code units — `text.length` would under-count anything non-ASCII.
          const from = stderrWritten;
          const started = Date.now();
          yield* lifecycle(Effect.logInfo("prompt sent"), {
            bytes: Buffer.byteLength(text),
          });
          // A TURN THE AGENT REFUSES fails like any other request and needs
          // nothing said about it here: `refused` means the agent answered, so
          // the caller already has what it needs to end the turn without
          // burying the conversation with it ({@link Gone}). The journal still
          // names the error verbatim, and the agent's stderr for this turn
          // lands at WARN — that dump is the diagnosis the silent-send had
          // none of.
          const outcome = yield* Effect.result(
            ask(
              at.connection,
              methods.agent.session.prompt,
              { sessionId: id, prompt: [{ type: "text", text }] },
              // A turn is a person waiting on a model: no deadline.
              null,
            ),
          );
          const duration = `${Date.now() - started}ms`;
          if (outcome._tag === "Failure") {
            dumpStderr(from);
            yield* lifecycle(Effect.logWarning("turn failed"), {
              error: outcome.failure.why,
              duration,
            });
            return yield* Effect.fail(outcome.failure);
          }
          const stopReason = (outcome.success as PromptResponse).stopReason;
          yield* lifecycle(Effect.logInfo("turn ended"), {
            stopReason,
            duration,
          });
          return stopReason;
        }),
      );

    /**
     * The steering half of {@link prompt}: hand the running turn something
     * more to work with.
     *
     * It takes a DEADLINE where a prompt takes none ({@link STEER_TIMEOUT}),
     * and an agent with no steering at all needs nothing special: it refuses
     * the method and that refusal travels the error channel, in the agent's own
     * words, like every other way this can fail. `initialize` advertises the
     * extension and that advertisement was being read into a `canSteer` flag —
     * a prediction of what the request itself proves, and a second answer to a
     * question that already had one.
     *
     * What the ANSWER means is {@link steerTaken}'s, beside the two spellings
     * the request is made of: it is one adapter extension's vocabulary, and
     * reading half of it here would be the same bet made in two files.
     */
    const steer = (text: string): Effect.Effect<Steered, AgentGone> => {
      const steering = options.leg.steering;
      // AN AGENT THAT CANNOT STEER IS NEVER ASKED TO. A caller reads
      // {@link Agent.steers} and sends an ordinary prompt instead — this arm is
      // the belt to that brace, and it refuses rather than inventing an outcome
      // so that a caller which got it wrong loses a round trip rather than a
      // person's words.
      if (steering === null) {
        return Effect.fail(
          new AgentGone({
            gone: "unreachable",
            why: "this agent takes no message into a turn that is already running",
          }),
        );
      }
      return withSession((at, id) =>
        Effect.map(
          ask(
            at.connection,
            steering.method,
            {
              sessionId: id,
              prompt: [{ type: "text", text }],
              ...(steering.meta === undefined ? {} : { _meta: steering.meta }),
            },
            steering.timeout,
          ),
          (answered): Steered =>
            steering.taken(answered) ? "taken" : "no-turn",
        ),
      );
    };

    const cancel = Effect.suspend(() => {
      const at = live;
      const id = activeSession;
      if (at === null || id === null) {
        // Nothing to cancel yet — remember it for the prompt that is still
        // being handshaked into place.
        cancelPending = true;
        return Effect.void;
      }
      // Said in the words of the thing that was asked for, not of the method
      // that carries it: what reaches a person is a refusal under the button
      // they pressed, and "`session/cancel` failed" names our transport where
      // their sentence is "the turn is still running".
      return Effect.mapError(
        Effect.ensuring(
          notify(at, methods.agent.session.cancel, { sessionId: id }),
          Effect.promise(() => terminals.cancel()),
        ),
        // The sentence is re-worded and the READING is not: whether the cancel
        // could have taken effect is what the transport has already decided.
        (gone) =>
          new AgentGone({ gone: gone.gone, why: notCancelled(gone.why) }),
      );
    });

    /** WORK THIS AGENT STARTED BESIDE ITS OWN FIBER — one site, the deferred
     *  cancel, and the same shape `./chat.ts`'s panel keeps: forked so nothing
     *  waits on it, tracked so stopping can reach it. */
    const beside = new Set<Fiber.Fiber<void, unknown>>();
    const aside = <E>(work: Effect.Effect<void, E>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const running: Fiber.Fiber<void, E> = yield* Effect.forkDetach(
          Effect.ensuring(
            work,
            Effect.sync(() => {
              beside.delete(running);
            }),
          ),
        );
        beside.add(running);
      });

    const stopWithReason = (reason: StopReason) =>
      Effect.promise(async () => {
        stopped = true;
        const alongside = [...beside];
        beside.clear();
        const at = live;
        if (at !== null)
          requestedStops.set(at.child, { reason, session: activeSession });
        live = null;
        // A SIGN-IN IS THIS AGENT'S PROCESS TOO, and the scope going away is
        // exactly what the claim is tied to: a login left running would keep
        // printing at nobody and could still write a credential after the engine
        // it belongs to was switched off. Stopped here rather than in `leaving`,
        // which is about a CONVERSATION — a sign-in outlives the session it is
        // for, and is often the reason there is no session at all.
        // ... AND ONLY WHEN THERE IS ONE, which is the record saying so rather
        // than a flag beside it: `stopping` is a fact about an attempt, and a
        // shutdown with no attempt in flight has none to describe.
        const signing = attempt;
        if (signing !== null) signing.stopping = true;
        leaving();
        // ... AND WHO IT WAS SIGNED IN AS, because this is the process going:
        // the panel must not keep a chip for a subprocess it has just stopped.
        forgetIdentity();
        activeSession = null;
        // Close the protocol and process before joining requests waiting on it.
        if (at !== null) at.connection.close();
        await Promise.all([
          at?.child.stop(),
          terminalCleanup,
          signing?.stop(),
          ...alongside.map((fiber) =>
            Effect.runPromise(Fiber.interrupt(fiber)),
          ),
        ]);
        attempt = null;
      });

    const setSetting = (
      session: string,
      config: string,
      value: string | boolean,
    ) =>
      withSession((at, id) =>
        Effect.gen(function* () {
          const setting = settings.find((option) => option.id === config);
          if (
            id !== session ||
            setting === undefined ||
            !acceptsSetting(setting, value)
          ) {
            return yield* new AgentGone({
              gone: "refused",
              why: "that setting is no longer available in this conversation",
            });
          }
          if (
            models !== null &&
            config === models.config &&
            typeof value === "string"
          ) {
            const model = acceptPicker(
              yield* requestModel(at, models, id, value),
              "selected",
            );
            if (model !== null)
              yield* note(
                { agent: options.id, session: id, model },
                (why) =>
                  "the model this conversation is on will not survive a restart: " +
                  why,
              );
          } else {
            const answer = (yield* ask(
              at.connection,
              methods.agent.session.setConfigOption,
              {
                sessionId: id,
                configId: config,
                ...(typeof value === "boolean"
                  ? { type: "boolean" as const, value }
                  : { value }),
              },
            )) as SetSessionConfigOptionResponse;
            readModel(answer.configOptions);
          }
        }),
      );

    return {
      boot,
      prompt,
      steer,
      setSetting,
      setModel: (session, value) =>
        setSetting(session, models?.config ?? "", value),
      cancel,
      newSession: opening((at) =>
        Effect.gen(function* () {
          // BEFORE the break, so the question is settled on the row it is
          // drawn on rather than after that row has been cleared away.
          // {@link leaving} names the session being left, so it runs before
          // `session` is cleared — nulling first is what used to turn the
          // leftover fence off for the whole of the next open.
          const left = activeSession;
          leaving();
          activeSession = null;
          emit({ _tag: "sessionOver", why: "new" });
          yield* release(at, left);
          yield* fresh(at);
        }),
      ),
      loadSession: (id: string) =>
        opening((at) =>
          Effect.gen(function* () {
            if (!at.canLoad) {
              return yield* new AgentGone({
                gone: "unreachable",
                why: `\`${id}\` cannot be opened: this agent does not keep conversations`,
              });
            }
            const stored = yield* storedFor(at);
            const wanted = stored.find((entry) => entry.id === id);
            const left = activeSession;
            leaving();
            activeSession = null;
            emit({ _tag: "sessionOver", why: "load" });
            // Re-opening the conversation this panel is the memory OF puts it
            // back on its model, exactly as a restart does; opening any other
            // conversation carries nothing, because nothing here is a fact
            // about that one. The memory is one conversation deep, like the id
            // beside it.
            yield* readChoice(id);
            // ... and the one being left is ended at the agent first: a load
            // of the same id re-opens it from the agent's store either way.
            yield* release(at, left);
            yield* load(at, id, wanted?.title ?? null, modelFor(id));
          }),
        ),
      // THE PROCESS, not a conversation, and the permit only for as long as
      // starting one — see {@link listing}. This used to boot into a
      // conversation, which was invisible while the only thing that ever asked
      // was a panel already in one, and is not invisible now that an agent is
      // started to answer this and stopped again.
      sessions: listing(storedFor),
      answer: (id, answers) =>
        Effect.suspend(() => {
          const took = questions.answer(id, answers);
          if (took instanceof Questions.AnswerRefused) return Effect.fail(took);
          return Effect.succeed(took === "settled");
        }),
      signIn,
      signInInput,
      signInCancel,
      stop: stopWithReason("stopped by app"),
      stopWithReason,
    };
  });

// ── talking to the process ─────────────────────────────────────────────

/**
 * One request, as an Effect.
 *
 * Every protocol failure — a rejection, a dead pipe, a deadline — becomes the
 * one error this module has, because from a caller's side they are the same
 * thing: the agent did not answer.
 *
 * The result is `unknown` and each call site narrows it against the SDK's own
 * response type. The alternative is threading the SDK's method-keyed table
 * through this wrapper, which types the pair correctly and then makes the
 * timeout, the error mapping and the `null`-timeout arm generic over it as
 * well. The cast is at the four call sites, where the expected shape is written
 * down beside the method name.
 *
 * `refused` is handed every rejection the AGENT answered with, before it is
 * worded: the sentence a person reads is one line, and the code and `data`
 * behind it belong in the log, which only {@link make} can write to with the
 * agent and session on the line. Required rather than defaulted, so no call
 * site can quietly opt out of the record. `accountIn` is the leg's reading of
 * a rejection's `data` ({@link AgentGone}'s `account`), which only
 * {@link make} holds the leg for.
 */
const request = (
  accountIn: (data: unknown) => boolean,
  refused: (cause: RequestError) => void,
  connection: ClientConnection,
  method: string,
  params: unknown,
  timeout: Duration.Input | null = BOOT_TIMEOUT,
): Effect.Effect<unknown, AgentGone> => {
  // The SIGNAL is what makes a deadline a cancellation rather than a walk-away.
  // The SDK keys every request it sends into a pending map and only clears an
  // entry when a response arrives or the connection closes — so a timeout that
  // merely stops waiting leaves the entry, and the closure holding that
  // request's params, for the life of the subprocess. That was invisible while
  // every deadline-bearing call happened once per boot or per click; `steer`
  // is the first that happens once per MESSAGE, and a server that runs for
  // weeks is the wrong place to find out. Handed the signal, the SDK cancels
  // on the wire and the agent's reply clears the entry.
  const call: Effect.Effect<unknown, AgentGone> = Effect.tryPromise({
    try: (signal) =>
      (
        connection.agent as unknown as {
          request: (
            method: string,
            params: unknown,
            options?: { readonly cancellationSignal?: AbortSignal },
          ) => Promise<unknown>;
        }
      ).request(method, params, { cancellationSignal: signal }),
    catch: (cause) => {
      if (cause instanceof RequestError) refused(cause);
      return new AgentGone({
        gone: goneOf(cause),
        why: `\`${method}\` failed: ${saidOf(cause)}`,
        auth: authOf(cause),
        account:
          cause instanceof RequestError &&
          !authOf(cause) &&
          accountIn(cause.data),
        // THE READING IS BY CODE; the GATE is the method, and it is here
        // because here is the one place the method is in hand. `-32002` means
        // "the resource you named is not here", and which resource that is
        // comes from what was asked: a load's resource is the conversation.
        missing: method === methods.agent.session.load && missingOf(cause),
      });
    },
  });
  if (timeout === null) return call;
  // `Effect.timeout` INTERRUPTS what it is timing out, which is what fires the
  // signal above — so the deadline and the cancellation are one mechanism
  // rather than a deadline and a cleanup somebody has to remember.
  return Effect.catchTag(Effect.timeout(call, timeout), "TimeoutError", () =>
    Effect.fail(
      new AgentGone({
        // The deadline is the definition of `unanswered`: the request is on
        // the wire, nothing came back, and interrupting our own wait tells us
        // nothing about what the agent did with it.
        gone: "unanswered",
        why: `\`${method}\` did not answer in ${String(timeout)}`,
      }),
    ),
  );
};

/**
 * Whether the agent ANSWERED the request this rejection came out of — with a
 * no, which is still an answer — or said nothing at all.
 *
 * The SDK gives exactly one shape to an error RESPONSE, its own
 * `RequestError`, minted where an `{ error: … }` frame is matched to the
 * request waiting on it. Everything else it can reject with is silence:
 * `close()` rejects every pending request with the reason the connection died
 * of, and a write that fails leaves the request pending until one of those two
 * happens. So the whole of the reading is this `instanceof`, and the losing
 * direction is the safe one — an unrecognised rejection reads as `unanswered`,
 * which offers a person nothing rather than offering a retry that could
 * duplicate a message the agent already has.
 *
 * ONE ARM IS A BET, and it is JSON-RPC's rather than ours: that an error
 * RESPONSE means the request did not take effect. An agent that took a steer
 * and then answered it with an error would be read as a refusal and offered a
 * retry — a protocol violation, and the only shape in here that could produce a
 * duplicate.
 *
 * IT ANSWERS TWO OF THE THREE {@link Gone} VALUES and never the third, which is
 * the whole reason there are three: `unreachable` is what this file mints where
 * there was nothing to reject at all, so a value read off a REJECTION cannot be
 * it. That is what makes `refused` mean exactly one thing here — the agent
 * spoke — and what a caller deciding whether there is still an agent reads.
 *
 * The SDK also mints a `RequestError` ITSELF for a response frame it cannot
 * parse (`invalidRequest`), which is the agent having said SOMETHING
 * unreadable rather than having said no. Read as a refusal, like the rest. It
 * was worth excluding by code and is deliberately not: `-32600` off the WIRE is
 * a genuine refusal ("your request was invalid"), so the guard would trade one
 * rare misreading for another and pay a magic number for it — while pinning
 * this file to which code the SDK happens to construct locally.
 *
 * Exported for its own test: it is one line, and it is the line the panel's two
 * faces are drawn out of.
 */
export const goneOf = (cause: unknown): Gone =>
  cause instanceof RequestError ? "refused" : "unanswered";

/**
 * ... AND WHETHER IT SAID NO FOR WANT OF A SIGNATURE — ACP's own `-32000`
 * ("Authentication required"), which is the only way an agent ever asks to be
 * signed in: the protocol spells it as an error RESPONSE to whatever was
 * refused, so an agent that needs one says so on `session/new`, on
 * `session/load` and on a turn alike, and every one of those reaches this file
 * through {@link request}.
 *
 * ONE CODE, read where the code is: a `RequestError` whose number is that one.
 * It is deliberately not guessed from the message — "not signed in" is prose and
 * an agent may write any sentence it likes around it — and it is deliberately
 * not widened to the SDK's other `invalidParams` (`-32602`) that the pinned
 * Codex adapter answers a failed `authenticate` with, because that one is
 * "the sign-in did not go through" rather than "you are not signed in".
 *
 * Exported for its own test, beside {@link goneOf}: they are the two readings of
 * one rejection and the panel's auth row is drawn out of the pair.
 */
export const authOf = (cause: unknown): boolean =>
  cause instanceof RequestError && cause.code === AUTH_REQUIRED;

/** ACP's code for "authenticate first" — the protocol's own number, named once
 *  so the two readers of a rejection sit beside the constant they read. */
const AUTH_REQUIRED = -32000;

/**
 * ... AND WHETHER THE THING IT WAS ASKED FOR IS NOT THERE — ACP's `-32002`,
 * the protocol's "Resource not found".
 *
 * THE WHOLE READING IS THE NUMBER, which is the point. Every agent words this
 * refusal its own way — "no such conversation", "session not found", a path
 * and an `ENOENT` — so a face that matched prose would be a face that worked
 * on the adapter it was written against and quietly stopped working on the
 * next one. The code is the one thing all of them agree on.
 *
 * It says nothing about WHICH resource: that is the method's to say, and
 * {@link request} is where the two meet ({@link AgentGone}'s `missing` is set
 * only for a `session/load`). A caller that reads it off a rejection with no
 * method in hand is reading half a fact.
 *
 * Exported for its own test, beside {@link goneOf} and {@link authOf}: another
 * reading of one rejection, and the one the "this chat isn't on this machine"
 * face is drawn out of.
 */
export const missingOf = (cause: unknown): boolean =>
  cause instanceof RequestError && cause.code === RESOURCE_NOT_FOUND;

/** ACP's code for "the resource you named is not here" — the protocol's own
 *  number, named once beside {@link AUTH_REQUIRED} for the same reason. */
const RESOURCE_NOT_FOUND = -32002;

/**
 * ... AND WHAT IT SAID, in the agent's own sentence rather than the protocol's
 * code word.
 *
 * The SDK's `errorToResult` — which is what the pinned Claude adapter answers
 * every failure of `session/set_config_option` through — turns a plain thrown
 * `Error` into `-32603 "Internal error"` and puts the real sentence in
 * `data.details` (or, when the message parsed as JSON, makes `data` that
 * object). So a model the account is not entitled to ("… isn't available for
 * your account yet") reached a person as "Internal error", and so did an
 * organisation's restriction and a `PreModelSwitch` hook's veto. `.message` is
 * the code's NAME; the sentence is in `data`.
 *
 * `details` first because it is what the SDK writes; `data.message` because a
 * parsed-JSON `data` from an `Error`-shaped body carries its sentence there;
 * otherwise the message, as before. No `(Internal error)` suffix beside the
 * sentence: once the agent has said why, the code word adds nothing a person
 * can act on — the code is in the log ({@link make}'s `refused`).
 *
 * Exported for its own test, beside {@link goneOf} and {@link authOf}: the
 * third reading of one rejection.
 */
export const saidOf = (cause: unknown): string => {
  if (
    cause instanceof RequestError &&
    typeof cause.data === "object" &&
    cause.data !== null
  ) {
    const data = cause.data as {
      readonly details?: unknown;
      readonly message?: unknown;
    };
    if (typeof data.details === "string" && data.details.trim() !== "")
      return data.details;
    if (typeof data.message === "string" && data.message.trim() !== "")
      return data.message;
  }
  return reasonOf(cause);
};

/** JSON-RPC's "Internal error" — what the SDK's `errorToResult` answers any
 *  thrown `Error` with, and so the one refusal code the log raises to WARN. */
const INTERNAL_ERROR = -32603;

/** How much of a refusal's `data` reaches the log: enough for any sentence an
 *  adapter writes, not enough for an agent that echoes a whole payload back. */
const REFUSAL_DATA_CAP = 2 * 1024;

/** A refusal's `data` as one bounded JSON value for a log line. `undefined`
 *  when there is none; `String` for what `JSON.stringify` cannot take (a
 *  cycle, a BigInt) — the record must never be the thing that throws. */
export const refusalData = (data: unknown): string | undefined => {
  if (data === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(data) ?? String(data);
  } catch {
    text = String(data);
  }
  return text.length > REFUSAL_DATA_CAP
    ? `${text.slice(0, REFUSAL_DATA_CAP)}…`
    : text;
};

/**
 * Whether a notification is about a conversation this panel is not in.
 *
 * A named session is about one conversation. It is from elsewhere when that
 * conversation is one this panel has LEFT, or when this panel is IN a
 * conversation and this is not it.
 *
 * A MISMATCH while we are in none is not elsewhere on its own: a load's
 * replay, and an `init` that beats `session/new`'s answer, both arrive before
 * this end has recorded which session it is in. Closed is what names the
 * session they must not be about. An unnamed notification is not a mismatch
 * either — absence is a shape we have not seen, and dropping one would go
 * quiet about a `/model` for the life of a conversation.
 *
 * Exported for its own test: it is one line, and it is the line the leftover-
 * session flake is drawn out of.
 */
export const fromElsewhere = (
  named: unknown,
  current: string | null,
  closed: ReadonlySet<string>,
): boolean =>
  typeof named === "string" &&
  (closed.has(named) || (current !== null && named !== current));

const notify = (
  at: Live,
  method: string,
  params: unknown,
): Effect.Effect<void, AgentGone> =>
  Effect.tryPromise({
    try: () =>
      (
        at.connection.agent as unknown as {
          notify: (method: string, params: unknown) => Promise<void>;
        }
      ).notify(method, params),
    // A notification is never answered, so there is no silence to tell from a
    // no: what fails here is the WRITE, and a write that failed put nothing on
    // the wire. (A write that SUCCEEDS is evidence of nothing at all — see
    // `cancel` in {@link ./chat.ts} — but that path does not come through
    // here.)
    catch: (cause) =>
      new AgentGone({
        gone: "unreachable",
        why: `\`${method}\` failed: ${reasonOf(cause)}`,
      }),
  });

// ── reading the payloads ───────────────────────────────────────────────

/**
 * WHAT AN AGENT WILL SIGN SOMEBODY IN WITH, out of the handshake — the two
 * halves of one advertisement, read once.
 *
 * Three kinds exist in the protocol and TWO are offered here, which is a
 * decision rather than a filter that fell out:
 *
 *   - `terminal` — a command this panel runs. The command line comes from the
 *     method's own `_meta` corner where the adapter wrote one (`TERMINAL_AUTH`;
 *     the pinned Claude adapter puts the whole thing there, argv included), and
 *     otherwise from the protocol's own sentence about the field: these `args`
 *     are for the AGENT BINARY, which is the command olai spawned. Either way it
 *     is a command this process knows how to run, and `BROWSER=true` is added at
 *     the spawn ({@link runTerminal}).
 *   - `agent` — the agent runs it. All the panel has to do is wait, and draw the
 *     page the agent sends when it sends one.
 *   - `env_var` — NO. A method that wants an API key typed into a form is a
 *     credential box, which is a different feature with a different argument to
 *     make (where the key is kept, what happens to it, whether it is ever shown
 *     again). Offering the button without that argument would be offering
 *     something this panel cannot finish.
 *
 * A method whose name is empty is dropped too, because a button with no word on
 * it is one nobody can press on purpose.
 */
const methodsIn = (
  response: InitializeResponse,
  command: string,
  /** The agent's own argv, which a method that wrote no command line of its own
   *  is read against: the protocol says such a method's `args` are "additional
   *  arguments to pass when running the AGENT BINARY", so the command line is
   *  this agent's own with them appended. */
  baseArgs: ReadonlyArray<string>,
  /** ... and the agent's own word on whether its `terminal` method can be run
   *  here at all (`@kolu/acp/engine`'s `Leg.terminalAuth`). `byHand` spawns
   *  nothing and offers no button: the method becomes a label carrying one
   *  command line — this binary, those arguments — to type into a terminal on
   *  the server. */
  terminalAuth: Leg["terminalAuth"],
): ReadonlyArray<Offered> => {
  const offered: Array<Offered> = [];
  for (const method of response.authMethods ?? []) {
    if (method.name === "") continue;
    // WHICH KIND, read from the protocol's own discriminator: the union has an
    // arm that carries NONE — the plain `agent` method — so the field is
    // reached through `in`, and ANYTHING TYPED AS SOMETHING ELSE than
    // `terminal` is skipped rather than read as an agent method. Today that is
    // `env_var`, a credential box whose storage and display are a different
    // feature's questions; written as "not terminal" rather than as that one
    // name, so a THIRD kind lands the same way instead of being drawn as a
    // sign-in nobody can run.
    if ("type" in method && method.type !== "terminal") continue;
    const terminal =
      "type" in method && method.type === "terminal" ? method : null;
    if (terminal === null) {
      offered.push({
        method: {
          id: method.id,
          name: method.name,
          description: method.description ?? null,
          runs: "agent",
          command: null,
        },
        run: null,
      });
      continue;
    }
    // BY HAND: the words a person needs, and nothing to press. The program is
    // the one THIS client resolved — an absolute path, because an agent found
    // through olai's own search path is not on the shell's `PATH` either — and
    // the arguments are the leg's, the wire's being the ones that cannot run
    // here.
    const byHand = terminalAuth?.byHand;
    if (byHand !== undefined) {
      offered.push({
        method: {
          id: method.id,
          name: method.name,
          description: method.description ?? null,
          runs: "hand",
          command: [command, ...byHand].join(" "),
        },
        run: null,
      });
      continue;
    }
    const written = terminalAuthIn(terminal);
    offered.push({
      method: {
        id: method.id,
        name: method.name,
        description: method.description ?? null,
        runs: "client",
        command: null,
      },
      run: {
        command: written?.command ?? command,
        args: written?.args ?? [...baseArgs, ...(terminal.args ?? [])],
        env: written?.env ?? { ...terminal.env },
      },
    });
  }
  return offered;
};

/** The command line a `terminal` method asks for in its own `_meta`, or `null`
 *  when it wrote none — in which case the protocol's `args` are for the agent
 *  binary olai already knows. */
const terminalAuthIn = (
  method: AuthMethodTerminal,
): {
  command: string;
  args: ReadonlyArray<string>;
  env: Readonly<Record<string, string>>;
} | null => {
  const corner = method._meta?.[TERMINAL_AUTH];
  if (typeof corner !== "object" || corner === null) return null;
  if (
    !("command" in corner) ||
    typeof corner.command !== "string" ||
    corner.command === ""
  )
    return null;
  const args =
    "args" in corner && Array.isArray(corner.args)
      ? corner.args.filter((one): one is string => typeof one === "string")
      : [];
  const env: Record<string, string> = { ...method.env };
  if (
    "env" in corner &&
    typeof corner.env === "object" &&
    corner.env !== null
  ) {
    for (const [name, value] of Object.entries(corner.env)) {
      if (typeof value === "string") env[name] = value;
    }
  }
  return { command: corner.command, args, env };
};

/** Which elicitation a completion notification is about. The protocol's own
 *  field, read defensively because a notification is not a request: an agent
 *  that sent a shape this end cannot use gets nothing done about it rather than
 *  an exception inside a callback. */
const completionIdOf = (params: unknown): string | null => {
  if (typeof params !== "object" || params === null) return null;
  if (!("elicitationId" in params)) return null;
  const id = params.elicitationId;
  return typeof id === "string" && id !== "" ? id : null;
};

/**
 * What a content block says — and, when it is not prose, THAT IT WAS THERE.
 *
 * The panel draws text and nothing else, which is a fair thing for it to do and
 * was never a fair thing for it to do silently: a block this returned `""` for
 * was dropped by every caller, so an agent that answered with a picture, a
 * sound or an attached resource left a blank in the conversation where its
 * answer had been. A reader cannot tell that from an agent that said nothing,
 * and the two need entirely different things done about them.
 *
 * So a marker, in the shape the transcript already uses for its own asides
 * (`[image]`), naming what arrived and — where the protocol gives one — what it
 * was called. Rendering the picture itself is a bigger question that belongs
 * with the attachments the composer already sends; what is owed here is the
 * difference between "nothing" and "something this panel cannot draw".
 *
 * The `default` arm is not dead code: `ContentBlock` is somebody else's union
 * and it gains variants, so an unknown block is a marker rather than a hole.
 */
const textOf = (content: ContentBlock): string => {
  switch (content.type) {
    case "text":
      return content.text;
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    case "resource_link":
      return `[resource: ${content.name}]`;
    case "resource":
      return `[resource: ${content.resource.uri}]`;
    default:
      return "[unsupported content]";
  }
};

/**
 * What a running call has to say for itself, out of the protocol's content
 * blocks.
 *
 * A tool call is not instantaneous, and until this was read an unfolded one
 * showed its arguments and then nothing at all until it completed — a grep over
 * a large tree, a long shell command, a file being written line by line, all
 * indistinguishable from a call that had hung.
 *
 * The protocol's three block kinds are read for the one thing a transcript row
 * can show as a line: text. `content` is prose or an embedded resource, and
 * `terminal` is an id whose output is handled separately by the terminal ledger.
 *
 * A `diff` is NOT read here any more, and that inversion is the whole of
 * `chat-edit-diffs`. It used to be flattened to the sentence `— <path>` on the
 * argument that a unified diff in a folded frame is a page of text where a line
 * was wanted, and that the outline itself is where an olai edit shows up
 * anyway. The second half is what stopped being true: a direct edit to a `.md`
 * or a source file shows up in NO outline, so naming the file was the whole of
 * what a person got and the answer to "what changed" was a terminal. It travels
 * structurally now (`@kolu/acp`'s `diffsOf`) and the panel draws it, trimmed —
 * naming it here as well would be the same file reported twice, once as a
 * change and once as a sentence about one.
 *
 * REPLACES rather than appends, which is the protocol's own rule for an update:
 * a report carries the call's content as it stands now, so accumulating them
 * would print the first half of the output twice.
 */
const progressOf = (
  content: ReadonlyArray<ToolCallContent> | null | undefined,
): string | undefined => {
  if (content == null || content.length === 0) return undefined;
  const lines = content
    .map((block) => (block.type === "content" ? textOf(block.content) : ""))
    .filter((line) => line !== "");
  return lines.length === 0 ? undefined : lines.join("\n");
};

/** Where the call is working. `path:line` when the agent said which line, and
 *  the path alone when it did not — a `:0` invented for the second case would
 *  be a claim about a file nobody made.
 *
 *  Spelled root-relative by the same rule a diff's path is (`@kolu/acp`'s
 *  `relativeTo`), because these two land on ONE row: a follow-along location and
 *  the diff under it naming the same file in two different ways is the row
 *  disagreeing with itself. */
const locationsOf = (
  locations: ReadonlyArray<ToolCallLocation> | null | undefined,
  cwd: string,
): ReadonlyArray<string> | undefined => {
  if (locations == null || locations.length === 0) return undefined;
  return locations.map((at) => {
    const path = relativeTo(cwd, at.path);
    return typeof at.line === "number" ? `${path}:${at.line}` : path;
  });
};

/** A tool call's arguments and result, as one folded block. JSON rather than
 *  prose: it is detail somebody opens deliberately, and the shape is the
 *  agent's own. */
const detailOf = (input: unknown, output: unknown): string | undefined => {
  const parts: Array<string> = [];
  if (input !== undefined && input !== null)
    parts.push(JSON.stringify(input, null, 2));
  if (output !== undefined && output !== null)
    parts.push(JSON.stringify(output, null, 2));
  return parts.length === 0 ? undefined : parts.join("\n\n");
};

/**
 * NEWEST FIRST, and an entry the agent gave no timestamp sorts LAST.
 *
 * One comparator because two consumers depend on the same answer and must not
 * be able to disagree about it: this file's sort is what a boot picks the
 * conversation to adopt from ({@link adopt}), and {@link ./listings.ts}'s merge
 * is what the picker draws. Change the tie-break in one — fall back to the id
 * for two `/clear` siblings sharing a stamp, stop coercing `null` to `""` —
 * and the conversation the panel comes back to and the row a person clicks stop
 * agreeing about which of two identical-looking rows is the newest.
 *
 * GENERIC over just the field it reads, so the stored and the wire row — which
 * differ in everything but the stamp — sort by the one rule. The undated rule
 * is the load-bearing half: an agent that gave no timestamp has said nothing
 * about when, and reading that as "just now" would put it over every
 * conversation that did say — including, at a boot, over the one this directory
 * was actually in.
 */
export const newestFirst = <R extends { readonly updatedAt: string | null }>(
  a: R,
  b: R,
): number => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/**
 * WHICH stored conversation the panel opens in, out of the ones this directory
 * has and the one it remembers being in.
 *
 * The remembered one, when it is still there. Newest-in-directory otherwise —
 * and `undefined` when there is nothing stored at all, which is the caller's
 * cue to start a fresh conversation.
 *
 * The demotion is the whole fix. Newest-by-`updatedAt` is an answer to "what
 * was written to last", and it was standing in for "which one is MINE": a
 * terminal `claude` in the served directory, a `/clear` sibling that shares its
 * predecessor's title, or an adapter that touches a timestamp for a reason of
 * its own would each take the panel over, silently, with the panel showing a
 * conversation somebody was in the middle of. What it is still the right answer
 * to is the case it now covers: the remembered conversation is GONE — deleted,
 * cleared out, or on a machine whose agent has been repointed — and something
 * has to be opened.
 *
 * Pure, and exported for its own test, for the reason a leg's rules
 * are: it is the sentence a boot turns on, and reaching it through a subprocess
 * is not how anybody should have to check it. `stored` arrives NEWEST FIRST
 * ({@link storedFor} sorts it), so the fallback is the head of the list.
 *
 * "Still there" is MEMBERSHIP of that list and not loadability, which is the
 * only thing a list can answer: a session the agent lists and then refuses to
 * replay is tried again at the next boot, exactly as the newest one used to be.
 */
export const adopt = (
  remembered: string | null,
  stored: ReadonlyArray<Stored>,
): Stored | undefined =>
  stored.find((entry) => entry.id === remembered) ?? stored[0];

/** What a session is handed, as ACP's `mcpServers`. The one place the
 *  protocol's shape for either transport is spelled: olai's own tool server is
 *  http because it is a route on the listener this process already has, and an
 *  optional one is stdio because it is somebody else's program on this host.
 *
 *  A LIST for the second argument, in the order they were probed
 *  ({@link ./probes.ts} keeps it), and olai's own first because olai's own is
 *  handed first. It is the order the roster is read off, so it is the order a
 *  person sees. */
export const mcpServersOf = (
  server: ToolServer | null,
  stdio: ReadonlyArray<StdioServer>,
): ReadonlyArray<McpServer> => [
  ...(server === null
    ? []
    : [
        {
          type: "http" as const,
          name: server.name,
          url: server.url,
          headers: [{ name: "Authorization", value: `Bearer ${server.token}` }],
        },
      ]),
  ...stdio.map((one) => ({
    name: one.name,
    command: one.command,
    args: [...one.args],
    env: Object.entries(one.env).map(([name, value]) => ({ name, value })),
  })),
];

const isJson = Schema.is(Schema.Json);

/**
 * WHAT A LEG SAID about a spawned subagent or an armed task, as the event
 * carries it.
 *
 * The leg answers STRUCTURALLY — a field it knows nothing about is absent —
 * and an event is a value on a wire, where `undefined` is not one of the words.
 * So the translation happens once, here: `null` is "this frame says nothing
 * about it", and a consumer keeps what an earlier frame said.
 */
const spawnedOf = (spawn: Spawn | null): Spawned | undefined =>
  spawn === null
    ? undefined
    : { kind: spawn.kind ?? null, said: spawn.said ?? null };

const armedOf = (task: Background | null): Armed | undefined =>
  task === null
    ? undefined
    : {
        task: task.task,
        description: task.description ?? null,
        ended: task.ended ?? null,
        report: task.report ?? null,
      };
