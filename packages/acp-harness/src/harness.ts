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
 * `fs` capabilities are FALSE in both directions on purpose: the orchestrator
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

import {
  client as acpClient,
  type ClientConnection,
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
import type { Adapter, Leg, Spawn } from "@kolu/acp/engine";
import type { AskAnswer, AskLink, AuthStatus, Usage } from "@kolu/acp/wire";
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
  methodsIn,
  type Offered,
  progressOf,
  saidOf,
  textOf,
} from "./payloads.ts";
import { streamOver } from "./pipes.ts";
import { AnswerRefused, Questions } from "./questions.ts";
import type {
  OrchestratorCommand,
  OrchestratorKoluCall,
  OrchestratorMention,
  OrchestratorModel,
  OrchestratorOption,
  OrchestratorPhase,
  OrchestratorRow,
  OrchestratorServer,
  OrchestratorSignIn,
  OrchestratorState,
} from "./rows.ts";
import { type Change, says, Transcript } from "./transcript.ts";
import { Turns } from "./turns.ts";

// ── what a caller hands over, and what it gets back ────────────────────

/** One MCP server to hand this conversation, as a program on this host. Every
 *  server an orchestrator gets is stdio — `kolu mcp` first among them — because
 *  padi runs on the host whose terminals these are. */
export interface StdioServer {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

export interface HarnessOptions {
  /** What the agent is CALLED — "Claude Code". The panel never spells it. */
  readonly agentName: string;
  /** How to read what this agent sends. Every bet that is true of one agent and
   *  not another is behind this; nothing in this file names an adapter. */
  readonly leg: Leg;
  /** What to spawn to reach it, with the environment the engine asked for and
   *  the environment it must not see. */
  readonly adapter: Adapter;
  /** `$HOME` of this padi's host: the directory the conversation works in. */
  readonly cwd: string;
  readonly mcpServers: ReadonlyArray<StdioServer>;
  /** The standing prompt's lines ({@link ./teaching.ts}), which ride under the
   *  first message of every session. */
  readonly teaching: ReadonlyArray<string>;
  readonly log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
  /** Resume this session id instead of opening a fresh one — padi's last
   *  conversation, read back out of its own store. */
  readonly resume?: string | null;
  readonly onChange: (change: HarnessChange) => void;
}

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
  | { readonly kind: "state"; readonly state: OrchestratorState }
  | {
      readonly kind: "rows";
      readonly upserts: ReadonlyArray<OrchestratorRow>;
      readonly removes: ReadonlyArray<string>;
      readonly appends: ReadonlyArray<{
        of: string;
        at: number;
        text: string;
      }>;
    };

export interface Harness {
  readonly state: () => OrchestratorState;
  readonly rows: () => ReadonlyArray<OrchestratorRow>;
  prompt(
    text: string,
    mentions: ReadonlyArray<OrchestratorMention>,
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

/** THE AGENT SAID NO — it answered the request with a JSON-RPC error, so the
 *  agent is demonstrably there and asking again is honest. `auth` is the one
 *  refusal with something to DO about it: nobody is signed in, which is ACP's
 *  own `-32000` and the only way an agent ever asks for a signature. */
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
/** How much of a sign-in's output is kept. A process that printed a book is not
 *  one a person is reading. */
const SIGN_IN_CAP = 64 * 1024;
/** The agent's stderr since this subprocess started, capped so a chatty one
 *  cannot grow a log line without bound. This is where an adapter writes its
 *  JSON-RPC errors, and a turn that failed with nothing else to say is what the
 *  dump exists for. */
const STDERR_CAP = 32 * 1024;

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
 * BRING-UP IS THE CALLER'S CALL and the whole of it is here, because the three
 * steps are one sequence whose order is a protocol fact and a harness handed
 * back half-open would be a caller's problem to discover. A refusal on any of
 * them rejects: {@link HarnessRefused} when the agent answered no — which, with
 * `auth`, is the one a person can do something about — and
 * {@link HarnessUnavailable} when there was nothing to answer.
 */
export const startHarness = async (
  options: HarnessOptions,
): Promise<Harness> => {
  const { leg, adapter, log } = options;

  // ── the state this conversation is ───────────────────────────────────

  const transcript = new Transcript();
  const turns = new Turns();
  const calls = new Calls(leg);
  const fleet = new Fleet();
  /** The accumulated kolu reading per call id — see `refineKoluCall`. Cleared
   *  with the conversation, for the reason `Calls.forget` gives: a call id is
   *  only ever looked up inside the session that minted it, and a daemon meant
   *  to run for weeks must not keep every call it ever saw. */
  const koluReadings = new Map<string, OrchestratorKoluCall>();
  const questions = new Questions((id, outcome) => {
    report(transcript.settleAsk(id, outcome));
    publish();
  });

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
  let stopped = false;
  let phase: OrchestratorPhase = "starting";
  let taught = false;
  let model: OrchestratorModel | null = null;
  let usage: Usage | null = null;
  let identity: AuthStatus | null = null;
  let refusal: string | null = null;
  let commands: ReadonlyArray<OrchestratorCommand> = [];
  let settings: ReadonlyArray<OrchestratorOption> = [];
  let labels: ReadonlyMap<string, string> = new Map();
  let offered: ReadonlyArray<Offered> = [];
  let signIn: OrchestratorSignIn | null = null;
  let attempt: Attempt | null = null;
  /** The MCP servers this conversation was handed, by name — read by the
   *  permission handler and by nothing else. */
  const given = options.mcpServers.map((server) => server.name);
  const servers: ReadonlyArray<OrchestratorServer> = given.map((name) => ({
    name,
    standing: "handed" as const,
    said: null,
    where: null,
  }));
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
    if (!says(change)) return;
    options.onChange({
      kind: "rows",
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends.map((one) => ({ ...one })),
    });
  };

  const state = (): OrchestratorState => ({
    install: { kind: "installed" },
    phase:
      live === null || stopped
        ? "offline"
        : questions.open().length > 0
          ? "asking"
          : turns.busy
            ? "working"
            : phase,
    agentName: options.agentName,
    sessionId: activeSession,
    cwd: options.cwd,
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
  });

  const publish = (): void => {
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
      timeout === null
        ? null
        : (setTimeout(() => controller.abort(), timeout).unref?.() ??
          setTimeout(() => controller.abort(), timeout));
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
      if (timer !== null && typeof timer === "object") clearTimeout(timer);
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
    // in. A replay is not this — a load un-closes the id it is about to replay,
    // before the frames land.
    if (fromElsewhere(notification.sessionId, activeSession, closed)) return;
    const update = notification.update;
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
        if (!replaying) return;
        if (text !== "") report(transcript.userSaid(text));
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

  const readSettings = (
    config: ReadonlyArray<SessionConfigOption> | null | undefined,
  ): void => {
    const read: Array<OrchestratorOption> = [];
    let picker: OrchestratorOption | null = null;
    for (const option of config ?? []) {
      // A SELECT'S ROWS, which the protocol lets an agent send as groups of
      // rows rather than as rows. A group has no id of its own and is not a
      // value anybody can pick, so only the leaves are offered: a picker drawn
      // with a group in it would be one whose heading is selectable.
      const choices = choicesOf(option);
      const row: OrchestratorOption = {
        id: option.id,
        name: option.name,
        description: option.description ?? null,
        value: optionValueOf(option),
        choices,
      };
      if (leg.models !== null && option.id === leg.models.config) picker = row;
      else read.push(row);
    }
    settings = read;
    if (picker === null) return;
    labels = new Map(
      picker.choices.map((choice) => [choice.value, choice.label]),
    );
    const id = picker.value;
    model =
      id === null
        ? null
        : {
            id,
            name: leg.models?.nameIn(labels, id) ?? id,
            // A `window` of `null` is a REFUSAL rather than a failure: the
            // running model does not always state its context window, and
            // naming one five times the real size in the line you would read to
            // decide whether to compact is worse than naming nothing.
            window: null,
          };
  };

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

  const connection = acpClient({ name: "kolu" })
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
    })
    .connect(streamOver(child));

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
    phase = "offline";
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
    enter(made.sessionId);
  };

  const load = async (id: string): Promise<void> => {
    // THIS conversation is the one we are coming back to: leftover frames from
    // a previous visit are now news about this one, and the replay that follows
    // names this id before {@link enter} records it.
    closed.delete(id);
    replaying = true;
    try {
      const loaded = (await request(
        methods.agent.session.load,
        // The SAME `_meta` and the SAME servers a fresh session sends: an
        // adapter reads its subscription off whichever request MADE the
        // session, and a load makes one.
        { sessionId: id, ...opening() },
        LOAD_TIMEOUT,
      )) as LoadSessionResponse | undefined;
      prologue = leg.prologueIn(loaded ?? null);
      readSettings(loaded?.configOptions);
    } finally {
      replaying = false;
    }
    enter(id);
  };

  /** The harness is in this conversation now. */
  const enter = (id: string): void => {
    activeSession = id;
    // Coming back into a conversation we left makes its leftovers news about
    // THIS visit.
    closed.delete(id);
    phase = "idle";
    refusal = null;
    publish();
  };

  try {
    if (typeof options.resume === "string") await load(options.resume);
    else await fresh();
  } catch (cause) {
    // A conversation the agent would not OPEN is the one failure a caller
    // cannot work around, so the subprocess goes with it rather than being left
    // running with nothing to talk to.
    refusal = cause instanceof Error ? cause.message : String(cause);
    await child.stop();
    throw cause;
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
    mentions: ReadonlyArray<OrchestratorMention>,
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
    ticket: { key: string; stopped: boolean },
    body: string,
    sessionId: string,
  ): Promise<void> => {
    const from = stderrWritten;
    try {
      const answered = (await request(
        methods.agent.session.prompt,
        { sessionId, prompt: [{ type: "text", text: body }] },
        // A turn is a person waiting on a model: no deadline.
        null,
      )) as PromptResponse;
      report(transcript.sent(ticket.key));
      if (answered.stopReason === "cancelled") notice("the turn was cancelled");
    } catch (cause) {
      const said = stderrSince(from);
      if (said !== "")
        log.warn({ said }, "the agent's own words for a turn that failed");
      const why = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof HarnessRefused) {
        report(transcript.refused(ticket.key, body, cause.auth));
      } else {
        // NOTHING CAME BACK: the agent may have the message already, so no
        // retry is offered — an offered duplicate is worse than none.
        report(transcript.unanswered(ticket.key));
      }
      notice(`the turn could not be run: ${why}`);
    } finally {
      const last = turns.leave(ticket);
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

  const prompt = async (
    text: string,
    mentions: ReadonlyArray<OrchestratorMention>,
  ): Promise<{ rowId: string }> => {
    const sessionId = activeSession;
    if (live === null || sessionId === null) {
      throw new HarnessUnavailable("the agent has no session open");
    }
    // AT THE AGENT, NEXT IN LINE — this end sent a prompt while a turn of its
    // own was still in flight. kolu's fact about its own conversation, not a
    // queue: the message goes out now, on the wire, exactly as it would have.
    const waiting = turns.busy;
    const { key, change } = transcript.user(
      text,
      mentions.length === 0 ? {} : { mentions },
    );
    report(change);
    if (waiting) report(transcript.queued(key));
    report(transcript.begins());
    const ticket = turns.open(key);
    publish();
    void runTurn(ticket, bodyOf(text, mentions), sessionId);
    return { rowId: key };
  };

  const cancel = async (): Promise<void> => {
    const sessionId = activeSession;
    if (live === null || sessionId === null) return;
    turns.stopping();
    // The questions this turn was holding go back UNANSWERED rather than being
    // fabricated into an answer the agent never got.
    questions.withdrawAll();
    try {
      await notify(methods.agent.session.cancel, { sessionId });
    } catch (cause) {
      // Said in the words of the thing that was asked for, not of the method
      // that carries it: what reaches a person is a refusal under the button
      // they pressed.
      throw new HarnessUnavailable(
        `the turn could not be cancelled: ${cause instanceof Error ? cause.message : String(cause)}`,
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
        // The question STAYS UP: settling the row and then sending something
        // else would leave a transcript claiming an answer the agent never got.
        throw new HarnessRefused(cause.message, false);
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
      value,
    })) as SetSessionConfigOptionResponse;
    // A REFUSED CHANGE LEAVES THE VALUE WHERE IT WAS, which is what reading the
    // answer rather than the request buys: the row says what the agent
    // confirmed, never what was asked for.
    readSettings(answered.configOptions);
    publish();
  };

  const newSession = async (): Promise<void> => {
    // BEFORE the break, so every question is settled on the row it is drawn on
    // rather than after that row has been cleared away.
    leaving();
    activeSession = null;
    report(transcript.clear());
    report(transcript.add("divider", "new session"));
    await fresh();
    publish();
  };

  // ── signing in ───────────────────────────────────────────────────────

  const sayAttempt = (running: Attempt): void => {
    signIn = {
      why: signIn?.why ?? "",
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
    try {
      return found.run === null
        ? await runAgentSignIn(claim, found)
        : await runTerminalSignIn(claim, found.run);
    } finally {
      attempt = null;
    }
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
        `could not run \`${run.command}\`: ${cause instanceof Error ? cause.message : String(cause)}`,
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
    if (claim.stopping) {
      await process_.stop();
      clearAttempt();
      return "cancelled";
    }
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
    if (claim.stopping) {
      clearAttempt();
      return "cancelled";
    }
    if (close.code === 0) {
      claim.state = "succeeded";
      sayAttempt(claim);
      clearAttempt();
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
    if (claim.stopping) {
      clearAttempt();
      return "cancelled";
    }
    try {
      await request(
        methods.agent.authenticate,
        { methodId: found.method.id },
        null,
      );
    } catch (cause) {
      if (claim.stopping) {
        clearAttempt();
        return "cancelled";
      }
      claim.state = "failed";
      claim.output = `${claim.output}${cause instanceof Error ? cause.message : String(cause)}\n`;
      sayAttempt(claim);
      return "failed";
    }
    if (claim.stopping) {
      clearAttempt();
      return "cancelled";
    }
    claim.state = "succeeded";
    sayAttempt(claim);
    clearAttempt();
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
    stopped = true;
    const at = live;
    live = null;
    const signing = attempt;
    if (signing !== null) signing.stopping = true;
    leaving();
    identity = null;
    activeSession = null;
    phase = "offline";
    turns.drain();
    // Close the protocol before the process, and before joining anything
    // waiting on it.
    at?.connection.close();
    await Promise.all([at?.child.stop(), signing?.stop()]);
    attempt = null;
    publish();
  };

  publish();

  return {
    state,
    rows: () => transcript.rows(),
    prompt,
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
    readonly id?: unknown;
    readonly name?: unknown;
    readonly description?: unknown;
  };
  if (typeof row.id !== "string" || row.id === "") return null;
  return {
    value: row.id,
    label: typeof row.name === "string" ? row.name : row.id,
    hint: typeof row.description === "string" ? row.description : null,
  };
};
