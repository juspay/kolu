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
  type ProbedServer,
} from "./probes.ts";
import * as Questions from "./questions.ts";
import { movedBy, rosterOf } from "./servers.ts";

/**
 * ONE MCP SERVER TO HAND A SESSION, in the caller's terms —
 * {@link mcpServersOf} renders it into what the protocol wants.
 *
 * `kind` is the IN-TREE discriminant and never reaches the wire: ACP's stdio
 * arm is the one with no `type` key at all, and an entry carrying
 * `type: "stdio"` is silently dropped by the pinned Claude adapter.
 * {@link mcpServersOf} owns that translation.
 *
 * `headers` carries whatever an endpoint takes to be let in, and it stays the
 * caller's to compose.
 */
export type Handed =
  | {
      readonly kind: "stdio";
      readonly name: string;
      /** Absolute: the file that is meant to run, not a word to resolve again
       *  against whatever `PATH` the agent happens to have. */
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "http";
      readonly name: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

/** What the plugin that owns a tool said about it: the title a person reads,
 *  and who owns it ({@link Options.advertised}). */
export interface Advertised {
  readonly title: string;
  readonly owner: string;
}

const reasonOf = (cause: unknown): string =>
  Cause.isCause(cause)
    ? reasonOf(Cause.squash(cause))
    : cause instanceof Error
      ? cause.message
      : String(cause);

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
 *     cannot work from. Whatever was asked for did not happen, so asking again
 *     is honest — and the agent is demonstrably THERE, because it just spoke.
 *   - `unreachable` — NOTHING WAS ASKED OF ANYTHING. This file refused before
 *     the request reached the wire: no process, a spawn that failed, no session
 *     open, a notification the pipe would not take. Also did not happen, also
 *     honest to ask again — and nothing here can say the agent is there.
 *   - `unanswered` — the request went out and NOTHING came back: the deadline
 *     passed, or the connection died with it in flight. Whether the agent acted
 *     on it cannot be known from this end, so the honest thing to do with this
 *     is SAY so, and never quietly ask again.
 *
 * THE TWO QUESTIONS a caller reads off the one value: *can I honestly offer
 * this again?* — anything but `unanswered`; *is the agent still there?* —
 * `refused`, and only `refused`.
 */
export type Gone = "refused" | "unreachable" | "unanswered";

/** A VERB of this module's did not do what it was asked. Every one of them can
 *  fail this way, and where the agent is not there the next verb retries the
 *  boot.
 *
 *  `why` is the sentence a person reads; {@link Gone} is what a caller can ACT
 *  on — whether what they asked for can honestly be offered again, and whether
 *  there is still an agent on the other end. */
export class AgentGone extends Data.TaggedError("AgentGone")<{
  readonly gone: Gone;
  readonly why: string;
  /** ... AND WHETHER IT SAID NO FOR WANT OF A SIGNATURE. Read off the
   *  protocol's own code (`-32000`), which is the only place ACP says
   *  "authenticate first"; it is a `refused` on both of {@link Gone}'s
   *  counts. */
  readonly auth?: boolean;
  /** ... AND WHETHER THE CONVERSATION IT WAS ASKED FOR IS SIMPLY NOT THERE —
   *  ACP's `-32002` ("Resource not found"), answered to a `session/load` of an
   *  id this engine's store has no record of. Read off the protocol's own code
   *  and never off the sentence, and true only for a refused
   *  `session/load`. */
  readonly missing?: boolean;
  /** ... AND WHETHER THE ACCOUNT THAT IS SIGNED IN CANNOT RUN IT — a usage
   *  limit, billing, an organisation that is not allowed. Read off the agent's
   *  error DATA by its leg (`Leg.accountRefusal`). Never true together with
   *  {@link auth}. */
  readonly account?: boolean;
}> {
  override get message(): string {
    return this.why;
  }
}

/**
 * What became of a steer — and only two things can, because a steer that could
 * not be DELIVERED fails on the error channel instead of answering here.
 *
 *   - `taken` — the message is in the running turn. Nothing else to do; what
 *     the agent makes of it arrives on the transcript like everything else.
 *   - `no-turn` — the agent had nothing to steer, and has NOT taken the
 *     message, so the caller sends it as an ordinary prompt.
 */
export type Steered = "taken" | "no-turn";

export interface Options {
  /** WHICH agent this is — the engine registry's own key for it — the id a
   *  conversation is remembered under, so that the next boot starts the same
   *  one. */
  readonly id: string;
  /** ... and how to read what it sends. Every bet that is true of one agent
   *  and not the other is behind this (`@kolu/acp/engine`'s `Leg`); nothing in
   *  this file names an adapter. */
  readonly leg: Leg;
  /** The executable to run — the roster row's. */
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Extra environment the ROSTER ROW asked for (`@kolu/acp/engine`'s
   *  `Adapter.env`), merged over this process's own at the spawn. A value here
   *  WINS over the same name in `process.env`. */
  readonly env?: Readonly<Record<string, string>>;
  /** ENVIRONMENT VARIABLES THIS ADAPTER MUST NOT SEE — removed from its spawn,
   *  where {@link Options.env} can only add to it. */
  readonly unset?: ReadonlyArray<string>;
  /** The directory the agent works in — the served directory, absolute. It is
   *  what makes stored sessions findable: an agent keys its conversations by
   *  the directory it was started in. */
  readonly cwd: string;
  /** The MCP servers to hand every session, IN THE ORDER a person should read
   *  them — empty for a caller with none of its own. A THUNK, read once per
   *  `session/new` and `session/load`, because an address is not known until
   *  the listener that serves it has bound. */
  readonly tools: () => ReadonlyArray<Handed>;
  readonly advertised?: (server: string, tool: string) => Advertised | null;
  /** The OPTIONAL servers to look for, once per conversation
   *  ({@link ./probes.ts}). Asked per session rather than at boot, and omitting
   *  it is the empty list. */
  readonly probes?: () => Effect.Effect<ReadonlyArray<Probe>>;
  /** Where "which conversation is the panel's" is kept between one serve of
   *  this directory and the next ({@link ./memory.ts}). */
  readonly models?: Models;
  readonly memory: Memory;
  readonly onEvent: (event: AgentEvent) => void;
}

export interface Agent {
  /** Spawn and hand-shake if that has not happened. Idempotent, and serialized
   *  against itself: two callers racing a cold start get one subprocess. */
  readonly boot: Effect.Effect<void, AgentGone>;
  /** One turn, as the CONTENT BLOCKS it is made of. Answers with the agent's
   *  stop reason (`end_turn`, `cancelled`, …) — the turn's END is a return
   *  value rather than an event, because the caller that asked is the one
   *  waiting. A turn the agent REFUSED fails with `refused` ({@link Gone}).
   *
   *  What a block may BE is the agent's own answer at the handshake
   *  ({@link AgentEvent}'s `advertised`), and refusing one it cannot take
   *  belongs to the caller that let somebody attach it. */
  readonly prompt: (
    blocks: ReadonlyArray<ContentBlock>,
  ) => Effect.Effect<string, AgentGone>;
  /** Put a message INTO the turn already running — see {@link Steered} for the
   *  two things that can come back, and the error channel for every way it
   *  could not be delivered at all. */
  readonly steer: (text: string) => Effect.Effect<Steered, AgentGone>;
  /** Stop the turn in flight. A notification, so there is nothing to WAIT for,
   *  and on the error channel because the pipe to a dead agent takes no
   *  notification either. */
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
   * or a second tab got there first.
   *
   * FAILS when the answers do not fit the question — a number field given a
   * word, a required field left empty, a key nothing asked for. The question
   * stays waiting in that case.
   */
  readonly answer: (
    id: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ) => Effect.Effect<boolean, Questions.AnswerRefused>;
  /**
   * SIGN IN, with one of the methods the handshake advertised.
   *
   * This RUNS THE WHOLE ATTEMPT and answers when it is over; everything in
   * between is reported as {@link ./events.ts}'s `signIn`.
   *
   * ONE ATTEMPT PER AGENT: a second call for the same method while one is in
   * flight answers `attached`, and a different one refuses.
   *
   * FAILS when the method is not one this agent offers, when the process could
   * not be started at all, and when the agent refused the attempt. A sign-in
   * that ran and failed is NOT a failure here: it answers `failed`.
   */
  readonly signIn: (method: string) => Effect.Effect<SignedIn, AgentGone>;
  /**
   * One line for the process {@link signIn} started. A LINE rather than a
   * stream, and the newline is added HERE: every one of these CLIs reads what
   * a person types by line.
   *
   * FAILS when there is nothing to write to — no attempt, or an agent method,
   * which has no process behind it.
   */
  readonly signInInput: (text: string) => Effect.Effect<void, AgentGone>;
  /** STOP IT — the process is killed, or the question the agent is waiting on
   *  is handed back unanswered. Answers whether there was anything to stop. */
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

const PROTOCOL = 1;

/**
 * How a sign-in ended, from the caller's side of {@link Agent.signIn}.
 *
 * Four values because four different things are done about them, and none is a
 * failure of the VERB: `signed-in` is the one that reopens the conversation,
 * `failed` is already on screen as the attempt's own output, `cancelled` is
 * somebody's press and needs nobody told, and `attached` is a second press
 * that joined the first.
 */
export type SignedIn = "signed-in" | "failed" | "cancelled" | "attached";

const TERMINAL_AUTH = "terminal-auth";

interface TerminalAuth {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

interface Offered {
  readonly method: AuthMethod;
  readonly run: TerminalAuth | null;
}

interface Attempt {
  readonly method: string;
  label: string;
  write: ((line: string) => void) | null;
  stopping: boolean;
  stop: () => Promise<void>;
  link: {
    readonly elicitationId: string | null;
    readonly answer: (action: "accept" | "decline") => void;
    readonly view: SignInLink;
  } | null;
}

const SIGN_IN_CAP = 64 * 1024;

const notCancelled = (why: string): string =>
  `the turn could not be cancelled: ${why}`;

const shuttingDown = (): AgentGone =>
  new AgentGone({ gone: "unreachable", why: "the server is shutting down" });

const BOOT_TIMEOUT = "30 seconds";
const LOAD_TIMEOUT = "120 seconds";
const CLOSE_TIMEOUT = "10 seconds";

interface Live {
  readonly child: Child;
  readonly connection: ClientConnection;
  readonly canList: boolean;
  readonly canLoad: boolean;
}

export const make = (options: Options): Effect.Effect<Agent, never, never> =>
  Effect.gen(function* () {
    const say = yield* Effect.annotateLogs(emitter, { agent: options.id });

    const openMeta =
      options.leg.rawMessages === null
        ? {}
        : { _meta: options.leg.rawMessages.openMeta };

    const booting = yield* Semaphore.make(1);
    const remembering = yield* Semaphore.make(1);

    let live: Live | null = null;
    let activeSession: string | null = null;
    const closed = new Set<string>();

    const logContext = yield* Effect.service(References.CurrentLogAnnotations);
    const about = (
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      ...logContext,
      agent: options.id,
      ...(activeSession === null ? {} : { session: activeSession }),
      ...extra,
    });
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
      tell(Effect.logWarning(during));
    };

    const ask = <A = unknown>(
      connection: ClientConnection,
      method: string,
      params: unknown,
      timeout?: Duration.Input | null,
    ): Effect.Effect<A, AgentGone> =>
      request<A>(
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

    let stopped: StopReason | null = null;
    const requestedStops = new WeakMap<
      Child,
      { reason: StopReason; session: string | null }
    >();
    let cancelPending = false;

    const emit = (event: AgentEvent) => {
      options.onEvent(event);
    };

    const emitSignIn = (signIn: SignIn | null): void => {
      emit({ _tag: "signIn", signIn });
    };

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

    let offered: ReadonlyArray<Offered> = [];

    let identity: AuthStatus | null = null;

    const readIdentity = (params: unknown): void => {
      const next = identityIn(params);
      if (next === null) return;
      identity = next;
      emit({ _tag: "identity", identity: next });
    };

    const forgetIdentity = (): void => {
      if (identity === null) return;
      identity = null;
      emit({ _tag: "identity", identity: null });
    };

    let attempt: Attempt | null = null;

    const waitingLinks = new Map<string, string>();

    const childEnv = (
      extra?: Readonly<Record<string, string>>,
    ): NodeJS.ProcessEnv =>
      childEnvOf(process.env, { ...options.env, ...extra }, options.unset);

    const trouble = (message: string) => {
      tell(Effect.logWarning(message));
      emit({ _tag: "trouble", message });
    };

    let replaying = false;

    let prologue: string | null = null;

    const questions = Questions.make((id, outcome) => {
      emit({ _tag: "askSettled", id, outcome });
    });

    let given: ReadonlyArray<string> = [];

    let roster: ReadonlyArray<Server> = [];

    const calls = new Calls(options.leg);

    const leaving = (): void => {
      if (activeSession !== null) closed.add(activeSession);
      terminalCleanup = Promise.all([terminalCleanup, terminals.clear()]).then(
        () => undefined,
      );
      terminalTools.clear();
      waitingLinks.clear();
      questions.withdrawAll();
      calls.forget();
      activity?.clear(closed);
      forgetModel();
      prologue = null;
      roster = [];
    };

    const put = (
      form: Form,
      signal: AbortSignal,
      session?: string,
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

    const undrawable = (why: string): void => {
      trouble(`the agent asked something this chat cannot draw — ${why}`);
    };

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
        if (settling !== null) waitingLinks.set(settling, id);
      });
      if (settled.outcome.how === "declined") return { action: "decline" };
      if (settled.outcome.how === "withdrawn") return { action: "cancel" };
      return { action: "accept", content: settled.content };
    };

    const onLoginLink = async (
      params: CreateElicitationRequest,
      form: Form,
    ): Promise<CreateElicitationResponse> => {
      const running = attempt;
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
      if (settled.outcome.how === "declined") return { action: "decline" };
      if (settled.outcome.how === "withdrawn") return { action: "cancel" };
      return { action: "accept", content: settled.content };
    };

    const toolOf = (request: RequestPermissionRequest): string | null =>
      calls.about(request.toolCall.toolCallId, request.sessionId).name ?? null;

    const onPermission = async (
      params: RequestPermissionRequest,
      signal: AbortSignal,
    ): Promise<RequestPermissionResponse> => {
      calls.heard(
        params.toolCall.toolCallId,
        params.toolCall._meta,
        params.toolCall,
        params.sessionId,
      );
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
      return typeof picked !== "string"
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId: picked } };
    };

    const onUpdate = (notification: SessionNotification): void => {
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
          if (text !== "" && prologue !== null && text === prologue) {
            prologue = null;
            return;
          }
          if (text !== "") emit({ _tag: "said", text });
          return;
        }
        case "user_message_chunk": {
          const text = textOf(update.content);
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
                asked: undefined,
                progress: undefined,
                rawInput: undefined,
                answer: undefined,
                mcp: [],
                asksThroughForm: undefined,
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
        case "tool_call":
        case "tool_call_update": {
          const id = callId(notification.sessionId, update.toolCallId);
          calls.heard(
            update.toolCallId,
            update._meta,
            update,
            notification.sessionId,
          );
          const recognized = options.leg.mcpCall(
            {
              title: update.title,
              rawInput: update.rawInput,
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
          const said = calls.about(update.toolCallId, notification.sessionId);
          const called = said.mcp ?? [];
          const named = said.name;
          const owned = called.map(
            (one) => options.advertised?.(one.server, one.tool) ?? null,
          );
          const ours =
            owned.every((one) => one !== null) && owned.length > 0
              ? {
                  title: [...new Set(owned.map((one) => one!.title))].join(
                    " · ",
                  ),
                  owner:
                    new Set(owned.map((one) => one!.owner)).size === 1
                      ? owned[0]!.owner
                      : undefined,
                }
              : null;
          const decoded =
            ours === null || called.length !== 1
              ? undefined
              : options.leg.replyIn(update.rawOutput, update.content);
          const reply =
            decoded !== undefined && isJson(decoded) ? decoded : undefined;
          const arming = options.leg.backgroundTask(update._meta);

          emit({
            _tag: "tool",
            id,
            title: ours?.title ?? update.title ?? undefined,
            called: update.title ?? undefined,
            row: ours?.owner,
            reply,
            status: activity?.taskStatusFor(id) ?? update.status ?? undefined,
            detail: detailOf(
              update.rawInput,
              ours === null ? update.rawOutput : undefined,
            ),
            asked: detailOf(update.rawInput, undefined),
            rawInput: update.rawInput,
            answer:
              options.leg.replyIn(update.rawOutput, update.content) ??
              update.rawOutput,
            mcp: called.map((one) => ({ server: one.server, tool: one.tool })),
            asksThroughForm:
              named !== undefined &&
              options.leg.asksThroughForm?.(named) === true
                ? true
                : undefined,
            progress: progressOf(update.content),
            diffs: diffsOf(update.content, options.cwd),
            locations: locationsOf(update.locations, options.cwd),
            parent:
              parent ?? options.leg.parentToolUse(update._meta) ?? undefined,
            spawned: spawnedOf(
              options.leg.spawned(update._meta, update.rawInput, named),
            ),
            armed: armedOf(arming),
            provisional: options.leg.provisionalTitle?.(update),
          });
          {
            const terminalId = (raw: string): string =>
              activity !== null && !terminals.clientOwned(raw)
                ? activity.toolId(notification.sessionId, raw)
                : raw;
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
          const usage = usageIn(update);
          if (usage !== null) emit({ _tag: "usage", usage });
          return;
        }
        default:
          return;
      }
    };

    let shown: string | null = null;
    let picked: string | null = null;
    let announced: string | null = null;
    let labels: ReadonlyMap<string, string> = new Map();

    const models = options.leg.models;
    let settings: ReadonlyArray<Setting> = [];
    const readSettings = (
      config: ReadonlyArray<SessionConfigOption> | null | undefined,
    ): void => {
      settings = settingsIn(config, models?.config ?? null);
      emit({ _tag: "settings", settings });
    };

    const nameFor = (id: string): string | null =>
      models === null ? null : models.nameIn(labels, id);

    const sameAs = (one: string, other: string): boolean =>
      models === null ? one === other : sameModel(models, labels, one, other);

    const show = (id: string | null, name: string | null): void => {
      if (name === shown) return;
      shown = name;
      emit({ _tag: "model", id, name });
    };

    const forgetModel = (): void => {
      picked = null;
      announced = null;
      readSettings([]);
      labels = new Map();
      emit({ _tag: "models", choices: [] });
    };

    const moved = (value: string): void => {
      const at = held;
      if (at === null || (at.model !== null && sameAs(at.model, value))) return;
      if (at.agent !== options.id) return;
      say(
        note(
          { agent: options.id, session: at.session, model: value },
          (why) =>
            `the model this conversation is on will not survive a restart: ${why}`,
        ),
      );
    };

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
        show(picked, picked === null ? null : (nameFor(picked) ?? picked));
      return switched || source === "selected" ? picked : null;
    };

    const observePicker = (picker: Picker | null): void => {
      const model = acceptPicker(picker, "observed");
      if (model !== null) moved(model);
    };

    const readModel = (
      configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
    ): void => {
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
      if (switched) moved(id);
      show(id, name ?? id);
    };

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

    const notStarted = (why: string): AgentGone =>
      new AgentGone({
        gone: "unreachable",
        why: `could not start the agent \`${options.command}\`: ${why}`,
      });

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
              env: childEnv(),
              stdio: ["pipe", "pipe", "pipe"],
              drain: { stdout: false },
            }),
          catch: (cause) => notStarted(reasonOf(cause)),
        });
        return yield* Effect.onError(connectTo(child, started), () =>
          Effect.promise(() => child.stop()),
        );
      });

    const connectTo = (
      child: Child,
      started: bigint,
    ): Effect.Effect<Live, AgentGone> =>
      Effect.gen(function* () {
        stderrBuf = "";
        stderrWritten = 0;

        const failedToStart: Effect.Effect<never, AgentGone> = Effect.flatMap(
          Effect.promise(() => child.unstartable),
          (why) => notStarted(why),
        );

        child.stderr?.on("data", (chunk: string | Buffer) => {
          takeStderr(
            typeof chunk === "string" ? chunk : chunk.toString("utf8"),
          );
        });

        void child.closed.then(({ code, signal }) => {
          if (child.failed() !== undefined) return;
          const ours = live?.child === child;
          const requested = requestedStops.get(child);
          requestedStops.delete(child);
          const id = requested?.session ?? (ours ? activeSession : null);
          if (ours) {
            live = null;
            leaving();
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
        const raw = options.leg.rawMessages;
        const connection = (
          raw === null
            ? opened
            : opened.onNotification(
                raw.method,
                (params: unknown) => params,
                (context) => {
                  if (elsewhere(context.params)) return;
                  readLiveModel(context.params);
                  readLiveServers(context.params);
                },
              )
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

        const initialized = yield* Effect.raceFirst(
          ask<InitializeResponse>(connection, methods.agent.initialize, {
            protocolVersion: PROTOCOL,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              elicitation: { form: {}, url: {} },
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
            },
            clientInfo: { name: "olai", version: "0.1.0" },
          }),
          failedToStart,
        );

        const capabilities = initialized.agentCapabilities;
        if (!stopped) {
          offered = methodsIn(
            initialized,
            options.command,
            options.args,
            options.leg.terminalAuth,
          );
          const takes = initialized.agentCapabilities?.promptCapabilities;
          const said = initialized.agentInfo;
          emit({
            _tag: "advertised",
            steers: options.leg.steering?.advertised(initialized) ?? false,
            queues: options.leg.queues(initialized),
            methods: offered.map((one) => one.method),
            image: takes?.image === true,
            embeddedContext: takes?.embeddedContext === true,
            agent:
              said === undefined || said === null
                ? null
                : `${said.name} ${said.version}`,
          });
        }
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

    const storedFor = (
      at: Live,
    ): Effect.Effect<ReadonlyArray<Stored>, AgentGone> =>
      at.canList
        ? Effect.map(
            ask<ListSessionsResponse>(
              at.connection,
              methods.agent.session.list,
              { cwd: options.cwd },
            ),
            (listed) =>
              listed.sessions
                .filter((entry) => sameDirectory(entry.cwd, options.cwd))
                .map((entry): Stored => {
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
        if (stored.length === 0) {
          yield* fresh(at);
          return;
        }
        if (options.models === undefined) held = yield* recalled;
        const wanted = adopt(
          options.models === undefined ? rememberedHere() : null,
          stored,
        );
        if (wanted !== undefined) {
          yield* readChoice(wanted.id);
          yield* load(at, wanted.id, wanted.title, modelFor(wanted.id));
          return;
        }
        yield* fresh(at);
      });

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

    const recalled: Effect.Effect<MemorySnapshot | null> = said(
      options.memory.recall,
      (why) =>
        `the conversation this directory was last in could not be read (${why}) — ` +
        `opening the most recent one instead`,
    );

    let held: MemorySnapshot | null = null;

    const modelFor = (id: string): string | null =>
      held?.agent === options.id && held.session === id ? held.model : null;

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

    const note = (
      next: MemorySnapshot,
      cost: (why: string) => string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        held = next;
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

    const entered = (
      id: string,
      title: string | null,
      how: "new" | "loaded",
      started: bigint,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        activeSession = id;
        closed.delete(id);
        yield* note(
          { agent: options.id, session: id, model: modelFor(id) },
          (why) =>
            `this conversation will not be restored after a restart: ${why}`,
        );
        emit({ _tag: "session", id, title });
        yield* lifecycle(Effect.logInfo("conversation opened"), {
          how,
          duration: yield* elapsedSince(started),
        });
      });

    const announce = (next: ReadonlyArray<Server>): void => {
      roster = next;
      emit({ _tag: "servers", servers: next });
    };

    const servers = Effect.map(
      Effect.flatMap(options.probes?.() ?? Effect.succeed([]), probed),
      (found) => {
        const handing = mcpServersOf(options.tools(), handedIn(found));
        given = handing.map((server) => server.name);
        announce(rosterOf(handing, missingIn(found), addressesIn(found)));
        return handing;
      },
    );

    const fresh = (at: Live): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        emit({ _tag: "opening", id: null });
        const made = yield* ask<NewSessionResponse>(
          at.connection,
          methods.agent.session.new,
          { cwd: options.cwd, mcpServers: [...(yield* servers)], ...openMeta },
        );
        prologue = options.leg.prologueIn(made);
        yield* readChoice(made.sessionId);
        yield* restore(
          at,
          made.sessionId,
          made.configOptions,
          modelFor(made.sessionId),
        );
        yield* askForBypass(at, made.sessionId, made.configOptions);
        yield* entered(made.sessionId, null, "new", started);
      });

    const load = (
      at: Live,
      id: string,
      title: string | null,
      remembered: string | null,
    ): Effect.Effect<void, AgentGone> =>
      Effect.gen(function* () {
        const started = yield* Clock.monotonicTimeNanos;
        emit({ _tag: "opening", id });
        const mcpServers = [...(yield* servers)];
        closed.delete(id);
        replaying = true;
        emit({ _tag: "replayStarted" });
        const loaded = yield* Effect.onExit(
          ask<LoadSessionResponse | undefined>(
            at.connection,
            methods.agent.session.load,
            { sessionId: id, cwd: options.cwd, mcpServers, ...openMeta },
            LOAD_TIMEOUT,
          ),
          () =>
            Effect.sync(() => {
              replaying = false;
              emit({ _tag: "replayEnded" });
            }),
        );
        prologue = options.leg.prologueIn(loaded ?? null);
        yield* restore(at, id, loaded?.configOptions, remembered);
        yield* askForBypass(at, id, loaded?.configOptions);
        yield* entered(id, title, "loaded", started);
      });

    const restore = (
      at: Live,
      id: string,
      configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
      remembered: string | null,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        readSettings(configOptions);
        if (models === null) return;
        const picker = modelPickerIn(models, configOptions);
        const settled =
          remembered === null ||
          picker === null ||
          (picker.picked !== null &&
            sameModel(models, picker.labels, picker.picked, remembered))
            ? picker
            : yield* putModel(at, models, id, picker, remembered);
        observePicker(settled);
      });

    const putModel = (
      at: Live,
      models: ModelReading,
      id: string,
      picker: Picker,
      remembered: string,
    ): Effect.Effect<Picker | null> =>
      Effect.gen(function* () {
        const answered = yield* Effect.result(
          requestModel(
            at,
            models,
            id,
            pickerValueFor(models, picker.labels, remembered) ?? remembered,
          ),
        );
        if (answered._tag === "Failure") {
          trouble(
            `this conversation was on ${models.nameIn(picker.labels, remembered) ?? remembered} and ` +
              `could not be put back: ${answered.failure.why}`,
          );
          return picker;
        }
        return answered.success;
      });

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
          const why = `the permission mode \`${mode}\` was not selected: ${result.failure.why}`;
          if (options.leg.bypassModeRequired === true) {
            closed.add(id);
            leaving();
            show(null, null);
            emit({ _tag: "sessionOver", why: "refused" });
            return yield* new AgentGone({ gone: result.failure.gone, why });
          }
          trouble(`${why} — carrying on with the mode the agent chose`);
          return;
        }
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

    const bringUpProcess = Effect.gen(function* () {
      if (stopped !== null) return yield* shuttingDown();
      const started = live ?? (yield* start());
      if (stopped !== null && live === null) {
        const reason = stopped;
        yield* Effect.promise(async () => {
          requestedStops.set(started.child, { reason, session: null });
          started.connection.close();
          await started.child.stop();
        });
        return yield* shuttingDown();
      }
      live = started;
      return started;
    });

    const signIn = (method: string): Effect.Effect<SignedIn, AgentGone> =>
      Effect.suspend(() => {
        if (stopped) return shuttingDown();
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
            const found = offered.find((one) => one.method.id === method);
            if (found === undefined) {
              return yield* new AgentGone({
                gone: "refused",
                why: `\`${method}\` is not a sign-in this agent offers`,
              });
            }
            claim.label = found.method.name;
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
          Effect.sync(() => {
            attempt = null;
          }),
        );
      });

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
              processGroup: true,
              env: childEnv({ BROWSER: "true", ...run.env }),
              stdio: ["pipe", "pipe", "pipe"],
              drain: { stdout: false, stderr: false },
            }),
          catch: (cause) =>
            new AgentGone({
              gone: "unreachable",
              why: `could not run \`${run.command}\`: ${reasonOf(cause)}`,
            }),
        });
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
        child.stdin?.on("error", () => {});
        claim.write = (line) => {
          if (child.stdin === null || child.stdin.destroyed) return;
          child.stdin.write(line);
        };
        claim.stop = () => child.stop().then(() => undefined);
        if (stopped()) {
          yield* Effect.promise(() => child.stop());
          emitSignIn(null);
          return "cancelled";
        }
        say(true, null);
        void child.unstartable.then((why) => {
          if (stopped() || attempt?.method !== method) return;
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
        const close = yield* Effect.ensuring(
          Effect.promise(() => child.closed),
          Effect.promise(() => child.stop()),
        );
        if (child.failed() !== undefined) return "failed";
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
        const stopped = (): boolean => claim.stopping;
        claim.stop = () => {
          claim.link?.answer("decline");
          return Effect.runPromise(Fiber.interrupt(request));
        };
        if (stopped()) {
          claim.link?.answer("decline");
          yield* Fiber.interrupt(request);
          emitSignIn(null);
          return "cancelled";
        }
        const outcome = yield* Fiber.await(request);
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

    const signInCancel: Effect.Effect<boolean> = Effect.sync(() => {
      const running = attempt;
      if (running === null) return false;
      running.stopping = true;
      void running.stop();
      return true;
    });

    const bringUp = Effect.gen(function* () {
      if (stopped) return yield* shuttingDown();
      if (live !== null && activeSession !== null) return;
      const spawning = live === null;
      const started = yield* bringUpProcess;
      yield* Effect.onError(openSession(started), (cause) =>
        Effect.gen(function* () {
          trouble(`the agent could not open a session: ${reasonOf(cause)}`);
          const failure = Cause.squash(cause);
          if (!spawning) return;
          if (failure instanceof AgentGone && failure.auth === true) return;
          yield* abandon(started);
        }),
      );
    });

    const abandon = (at: Live): Effect.Effect<void> =>
      Effect.promise(async () => {
        if (live === at) live = null;
        forgetIdentity();
        at.connection.close();
        await at.child.stop();
      });

    const boot = booting.withPermit(bringUp);

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

    const withLive = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      Effect.gen(function* () {
        yield* boot;
        return yield* onLive(use);
      });

    const opening = <A>(
      use: (at: Live) => Effect.Effect<A, AgentGone>,
    ): Effect.Effect<A, AgentGone> =>
      booting.withPermit(
        Effect.gen(function* () {
          yield* bringUpProcess;
          return yield* onLive(use);
        }),
      );

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

    const prompt = (blocks: ReadonlyArray<ContentBlock>) =>
      withSession((at, id) =>
        Effect.gen(function* () {
          if (cancelPending) {
            cancelPending = false;
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
          const from = stderrWritten;
          const started = Date.now();
          yield* lifecycle(Effect.logInfo("prompt sent"), {
            bytes: blocks.reduce(
              (total, block) =>
                total +
                (block.type === "text" ? Buffer.byteLength(block.text) : 0),
              0,
            ),
            blocks: blocks.length,
          });
          const outcome = yield* Effect.result(
            ask(
              at.connection,
              methods.agent.session.prompt,
              { sessionId: id, prompt: [...blocks] },
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

    const steer = (text: string): Effect.Effect<Steered, AgentGone> => {
      const steering = options.leg.steering;
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
      questions.withdrawAll();
      if (at === null || id === null) {
        cancelPending = true;
        return Effect.void;
      }
      return Effect.mapError(
        Effect.ensuring(
          notify(at, methods.agent.session.cancel, { sessionId: id }),
          Effect.promise(() => terminals.cancel()),
        ),
        (gone) =>
          new AgentGone({ gone: gone.gone, why: notCancelled(gone.why) }),
      );
    });

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
        stopped = reason;
        const alongside = [...beside];
        beside.clear();
        const at = live;
        if (at !== null)
          requestedStops.set(at.child, { reason, session: activeSession });
        live = null;
        const signing = attempt;
        if (signing !== null) signing.stopping = true;
        leaving();
        forgetIdentity();
        activeSession = null;
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
            const answer = yield* ask<SetSessionConfigOptionResponse>(
              at.connection,
              methods.agent.session.setConfigOption,
              {
                sessionId: id,
                configId: config,
                ...(typeof value === "boolean"
                  ? { type: "boolean" as const, value }
                  : { value }),
              },
            );
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
            const stored = yield* storedFor(at);
            const wanted = stored.find((entry) => entry.id === id);
            const left = activeSession;
            leaving();
            activeSession = null;
            emit({ _tag: "sessionOver", why: "load" });
            yield* readChoice(id);
            yield* release(at, left);
            yield* load(at, id, wanted?.title ?? null, modelFor(id));
          }),
        ),
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

const request = <A = unknown>(
  accountIn: (data: unknown) => boolean,
  refused: (cause: RequestError) => void,
  connection: ClientConnection,
  method: string,
  params: unknown,
  timeout: Duration.Input | null = BOOT_TIMEOUT,
): Effect.Effect<A, AgentGone> => {
  const call: Effect.Effect<A, AgentGone> = Effect.tryPromise({
    try: (signal) =>
      (
        connection.agent as unknown as {
          request: (
            method: string,
            params: unknown,
            options?: { readonly cancellationSignal?: AbortSignal },
          ) => Promise<A>;
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
        missing: method === methods.agent.session.load && missingOf(cause),
      });
    },
  });
  if (timeout === null) return call;
  return Effect.catchTag(Effect.timeout(call, timeout), "TimeoutError", () =>
    Effect.fail(
      new AgentGone({
        gone: "unanswered",
        why: `\`${method}\` did not answer in ${String(timeout)}`,
      }),
    ),
  );
};

export const goneOf = (cause: unknown): Gone =>
  cause instanceof RequestError ? "refused" : "unanswered";

export const authOf = (cause: unknown): boolean =>
  cause instanceof RequestError && cause.code === AUTH_REQUIRED;

const AUTH_REQUIRED = -32000;

export const missingOf = (cause: unknown): boolean =>
  cause instanceof RequestError && cause.code === RESOURCE_NOT_FOUND;

const RESOURCE_NOT_FOUND = -32002;

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

const INTERNAL_ERROR = -32603;

const REFUSAL_DATA_CAP = 2 * 1024;

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
    catch: (cause) =>
      new AgentGone({
        gone: "unreachable",
        why: `\`${method}\` failed: ${reasonOf(cause)}`,
      }),
  });

const methodsIn = (
  response: InitializeResponse,
  command: string,
  baseArgs: ReadonlyArray<string>,
  terminalAuth: Leg["terminalAuth"],
): ReadonlyArray<Offered> => {
  const offered: Array<Offered> = [];
  for (const method of response.authMethods ?? []) {
    if (method.name === "") continue;
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

const completionIdOf = (params: unknown): string | null => {
  if (typeof params !== "object" || params === null) return null;
  if (!("elicitationId" in params)) return null;
  const id = params.elicitationId;
  return typeof id === "string" && id !== "" ? id : null;
};

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

const progressOf = (
  content: ReadonlyArray<ToolCallContent> | null | undefined,
): string | undefined => {
  if (content == null || content.length === 0) return undefined;
  const lines = content
    .map((block) => (block.type === "content" ? textOf(block.content) : ""))
    .filter((line) => line !== "");
  return lines.length === 0 ? undefined : lines.join("\n");
};

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
 * GENERIC over just the field it reads, so the stored and the wire row — which
 * differ in everything but the stamp — sort by the one rule.
 */
export const newestFirst = <R extends { readonly updatedAt: string | null }>(
  a: R,
  b: R,
): number => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

export const adopt = (
  remembered: string | null,
  stored: ReadonlyArray<Stored>,
): Stored | undefined =>
  stored.find((entry) => entry.id === remembered) ?? stored[0];

export const mcpServersOf = (
  handed: ReadonlyArray<Handed>,
  stdio: ReadonlyArray<ProbedServer>,
): ReadonlyArray<McpServer> => [
  ...handed.map((one) =>
    one.kind === "http"
      ? {
          type: "http" as const,
          name: one.name,
          url: one.url,
          headers: pairs(one.headers),
        }
      : {
          name: one.name,
          command: one.command,
          args: [...one.args],
          env: pairs(one.env),
        },
  ),
  ...stdio.map((one) => ({
    name: one.name,
    command: one.command,
    args: [...one.args],
    env: pairs(one.env),
  })),
];

const pairs = (
  of: Readonly<Record<string, string>>,
): Array<{ name: string; value: string }> =>
  Object.entries(of).map(([name, value]) => ({ name, value }));

const isJson = Schema.is(Schema.Json);

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
