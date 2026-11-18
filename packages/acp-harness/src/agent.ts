/**
 * THE AGENT HALF: one subprocess, one connection, and nothing of kolu's.
 *
 * This half owns the process, the handshake, the reading of every message
 * the agent sends, which session the agent is in, and the sign-in. It says
 * what the agent SAID upward in the closed vocabulary `./events.ts`
 * declares — one callback, one union — and the conversation half
 * (`./conversation.ts`) asks of it through the verbs {@link Agent} offers;
 * the conversation's own requests (`session/new`, `session/prompt`, …) go
 * out through {@link Agent.request}. Nothing in here knows what a conductor
 * row, a fleet ref or a cell is.
 *
 * WHY THE SPLIT IS A SEAM RATHER THAN A TIDY-UP. The same client runs in two
 * products ([olai](https://github.com/juspay/olai) is the other one), and the
 * half worth sharing is exactly this. The half that is not is what each
 * product DRAWS — and a file that imported `kolu-common` could not be handed
 * over without the rows it would drag along. `src/seam.test.ts` holds that
 * fence.
 */

import {
  client as acpClient,
  type ClientConnection,
  CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  methods,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  AUTH_STATUS_METHOD,
  diffsOf,
  type Form,
  identityIn,
  usageIn,
} from "@kolu/acp";

import type { Adapter, Leg, RawMessages } from "@kolu/acp/engine";
import type { AskLink, SignInReason } from "@kolu/acp/wire";
import { type Child, childEnvOf, start as startChild } from "@kolu/child";

import type { Calls } from "./calls.ts";
import type { AgentEvent, SignInCause } from "./events.ts";
import {
  completionIdOf,
  detailOf,
  fromElsewhere,
  goneOf,
  locationsOf,
  messageOf,
  methodsIn,
  type Offered,
  progressOf,
  saidOf,
  signInOf,
  textOf,
} from "./payloads.ts";
import { streamOver } from "./pipes.ts";
import type { Questions } from "./questions.ts";

/**
 * NOTHING WAS ASKED OF ANYTHING, or nothing came back. `why` is a whole
 * sentence and nothing composes around it.
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
 *  one path where an answer never reaches the wire. */
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

/** The sign-in row this half composes — the same shape the event carries, so
 *  the panel's own row schema is the conversation's business. */
export interface SignInRow {
  readonly cause: SignInCause;
  readonly methods: ReadonlyArray<unknown>;
  readonly attempt: {
    readonly method: string;
    readonly state: "running" | "succeeded" | "failed";
    readonly output: string;
    readonly link: AskLink | null;
  } | null;
}

/** What a sign-in ended as. */
export type SignedIn = "signed-in" | "failed" | "cancelled" | "attached";

const PROTOCOL = 1;
/** Boot is a few small round trips against a process that just started. Only it
 *  gets a deadline — a turn is a person waiting on a language model. */
const BOOT_TIMEOUT = 30_000;
/** How long the agent gets to END the conversation being left
 *  ({@link Agent.release}). Bounded and its own: a close is a
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
/**
 * THE KINDS THAT RE-TELL WHAT WAS SAID — the only frames a replay is dropped
 * on the floor for.
 *
 * `session/load` sends two unlike things down one stream before it answers:
 * the conversation's HISTORY, which the caller already holds in a richer form,
 * and news about the session AS IT IS NOW — which commands it offers, which
 * settings it is on, how full its context is. Dropping the whole stream drops
 * the second with the first, and the conversation's `leaving` has just reset
 * exactly those fields: a resumed conversation would spend the rest of its
 * life with no `/` completion and no context meter, which is the opposite of
 * what the fence is for. So the partition is BY KIND and it is written here,
 * named, rather than inline — a kind this client learns to draw later is then
 * added to a list somebody can read, instead of quietly arriving as news
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

/** The one MCP server shape the agent half passes on, said again so that this
 *  file names no product. */
export type HandedServer =
  | {
      readonly kind: "stdio";
      readonly name: string;
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

/** What the agent half is given: the caller's own facts, the two registries
 *  the two halves share, and the one way it reports. */
export interface AgentOptions {
  readonly leg: Leg;
  readonly adapter: Adapter;
  readonly cwd: string;
  readonly configDir: string;
  readonly mcpServers: ReadonlyArray<HandedServer>;
  readonly log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
  /** The tools and the questions — created by the caller because both sides
   *  read them: a question is announced here and answered from there. */
  readonly calls: Calls;
  readonly questions: Questions;
  /** Every fact worth saying, in the closed union `./events.ts` declares. */
  readonly onEvent: (event: AgentEvent) => void;
}

/** The agent, as the conversation uses it. */
export interface Agent {
  /** `initialize`, and the readings its answer carries — the first round trip
   *  a caller makes, inside the same `try` that stops the process on failure. */
  readonly handshake: () => Promise<void>;
  readonly request: (
    method: string,
    params: unknown,
    timeout?: number | null,
  ) => Promise<unknown>;
  readonly notify: (method: string, params: unknown) => Promise<void>;
  readonly stderrSince: (from: number) => string;
  readonly stderrMark: () => number;
  readonly alive: () => boolean;
  /** The conversation this agent is in now — or `null` while none is. The
   *  ONE record of it: the conversation half reads it here. */
  readonly session: () => string | null;
  /** Enter a conversation: frames about it are let through from now on. */
  readonly enter: (id: string) => void;
  /** Leave it: the questions go back unanswered, and the session is named as
   *  left so its late frames are recognised after the next one opens. */
  readonly leave: () => void;
  /** A frame naming `sessionId` is about a conversation this agent is not in
   *  — one it left, or one that is not the current one. A frame that names no
   *  session is about none, and is let through. */
  readonly elsewhere: (sessionId: unknown) => boolean;
  /** A visit WITHDRAWN before it was entered: its late frames are fenced
   *  exactly like those of a session that was left. */
  readonly fence: (sessionId: string) => void;
  /** A question row that a page completes: held under the agent's own
   *  elicitation id, which is the only name `elicitation/complete` says. */
  readonly awaitLink: (elicitationId: string, question: string) => void;
  readonly release: (sessionId: string | null) => Promise<void>;
  readonly signIn: (method: string) => Promise<SignedIn>;
  readonly askSignIn: () => void;
  readonly signInOffer: (why: string) => void;
  readonly signInWithdrawn: () => void;
  readonly signInInput: (text: string) => Promise<void>;
  readonly signInCancel: () => Promise<boolean>;
  readonly stop: () => Promise<void>;
  /** A conversation is being RE-OPENED: the frames that follow are its history,
   *  which the caller already holds. `end` answers how many were dropped. */
  readonly beginReplay: (id: string) => void;
  readonly endReplay: () => number;
  /** The page a device-code sign-in sent somebody to, once the agent sends it. */
  readonly attachLink: (
    params: CreateElicitationRequest,
    form: Form,
  ) => Promise<CreateElicitationResponse>;
}

/**
 * Spawn the agent and wire its connection. Nothing is asked of it yet: the
 * caller holds the returned agent first, so the `try` around
 * {@link Agent.handshake} and the open can stop the process when either
 * fails.
 */
export const startAgent = (options: AgentOptions): Agent => {
  const { leg, adapter, log, cwd, configDir, mcpServers, calls, questions } =
    options;
  const onEvent = options.onEvent;

  // ── the state this agent is ──────────────────────────────────────────
  let live: { child: Child; connection: ClientConnection } | null = null;
  let activeSession: string | null = null;
  /** Sessions this harness has LEFT, still named so a leftover notification
   *  about one can be recognised after `activeSession` has gone null. */
  const closed = new Set<string>();
  let replaying = false;
  let replayed = 0;
  let stopped = false;
  let stderrBuf = "";
  let stderrWritten = 0;
  /** The MCP servers this conversation was handed, by name. */
  const given = mcpServers.map((server) => server.name);
  /** The URL elicitations this conversation is waiting on, by the agent's own
   *  id. */
  const waitingLinks = new Map<string, string>();

  const signing = (() => {
    let onOffer: ReadonlyArray<Offered> = [];
    let said: string | null = null;
    let attempt: Attempt | null = null;
    let cause: SignInCause | null = null;

    /** Where this host keeps the signature, in every sentence that names it. */
    const storedAt = `the signature is read from ${configDir}`;

    /**
     * ... AND WHAT A SIGN-IN WITH NOTHING TO PRESS HAS TO SAY FOR ITSELF.
     *
     * An agent that will not work and advertises no way to fix it is a dead
     * end, and the only useful thing left is the whole of what was asked and
     * what came back: which adapter was spawned, what it calls itself, what
     * kolu asked for in the handshake, and the store it reads.
     */
    const nothingOffered = (): string =>
      `${said ?? "the agent"} offered no way to sign in: kolu's handshake` +
      ' asked for terminal auth (`auth.terminal` and `_meta["terminal-auth"]`)' +
      " and the reply carried no `authMethods`. The adapter is" +
      ` \`${adapter.command}\`, and ${storedAt}`;

    /** What a person is told when THEY ask to sign in. */
    const askedFor = (): SignInCause => ({
      kind: "person",
      said: `${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
    });

    /** THE ROW, composed: or `null` when there is nothing to draw. */
    const row = (): SignInRow | null =>
      cause === null && attempt === null
        ? null
        : {
            cause: cause ?? askedFor(),
            methods: onOffer.map((one) => one.method),
            attempt:
              attempt === null
                ? null
                : {
                    method: attempt.method,
                    state: attempt.state,
                    output: attempt.output,
                    link:
                      attempt.link === null ? null : { ...attempt.link.url },
                  },
          };

    const drawn = (): void => {
      onEvent({ _tag: "signIn", row: row() });
    };

    return {
      /** THE AGENT'S OWN ACCOUNT puts the offer up, unless an attempt is
       *  already running: that row belongs to the attempt. */
      offer: (why: string): void => {
        if (attempt !== null) return;
        cause = {
          kind: "agent",
          why: `${why} — ${onOffer.length === 0 ? nothingOffered() : storedAt}.`,
        };
        drawn();
      },
      /** A PERSON asks, signed in or not. An offer already on screen — the
       *  agent's own, or a running attempt — is left exactly as it is. */
      ask: (): void => {
        if (stopped || row() !== null) return;
        cause = askedFor();
        drawn();
      },
      /** The handshake's methods, and what the agent calls itself. */
      offered: (methods: ReadonlyArray<Offered>, agentSaid: string | null) => {
        onOffer = methods;
        said = agentSaid;
      },
      sayAttempt: (): void => {
        // A WITHDRAWN ATTEMPT IS NOT DRAWN: the runner goes on finishing the
        // process it started after the slot was given up, and the row a cancel
        // took away must not come back behind it.
        if (attempt?.stopping === true) return;
        drawn();
      },
      clearAttempt: (): void => {
        if (row() === null) return;
        // the offer stands; only the attempt comes down.
        attempt = null;
        drawn();
      },
      /** ... AND THE WHOLE OFFER, once a sign-in SUCCEEDED. Exit 0 is the whole
       *  of "it worked" for every one of these CLIs, and a chooser left
       *  standing over an agent somebody has just signed into is a row that
       *  invites a second login. NOT merged into `clearAttempt`: a CANCELLED
       *  attempt must leave the methods on screen, which is the same call and
       *  the opposite answer. */
      signedIn: (): void => {
        cause = null;
        attempt = null;
        drawn();
      },
      /** THE OFFER COMES DOWN, whoever put it up, unless an attempt is
       *  running: an agent that now names an account has answered the question
       *  the row was asking, whether the agent or a person asked it. */
      withdraw: (): void => {
        if (attempt !== null || cause === null) return;
        cause = null;
        drawn();
      },
      /** The row a panel draws, or `null`. */
      row,
      /** The attempt in flight, for the two handlers that fill or read it. */
      inFlight: (): Attempt | null => attempt,
      /** The methods on offer — what a press is checked against. */
      methods: (): ReadonlyArray<Offered> => onOffer,
      /** The claim, taken and given up by `run`. */
      claim: (next: Attempt | null): void => {
        attempt = next;
      },
    };
  })();

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

  /** One rejection, read twice: whether the AGENT answered it, and whether
   *  signing in could fix it. */
  const refusalOf = (method: string, cause: unknown): Error => {
    const why = `\`${method}\` failed: ${saidOf(cause)}`;
    if (goneOf(cause) === "refused") {
      return new HarnessRefused(why, signInOf(cause, leg));
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

  /** THE PAGE A SIGN-IN IS WAITING ON — a URL elicitation with no session to
   *  put it in. The promise this returns is what the agent is blocked on for
   *  the whole of a device-code sign-in, so it is deliberately not answered
   *  here: the completion notification accepts it when the agent says the page
   *  is done, and {@link signInCancel} declines it when somebody gives up. */
  const attachLink = async (
    params: CreateElicitationRequest,
    form: Form,
  ): Promise<CreateElicitationResponse> => {
    const running = signing.inFlight();
    // A CANCEL ALREADY ASKED FOR THIS ONE'S END, so the page is answered away
    // rather than drawn: the row the cancel took down must not come back
    // because the agent got as far as sending its card.
    if (running?.stopping) return { action: "decline" };
    const link = form.link;
    if (running === null || running.write !== null || link === null) {
      onEvent({
        _tag: "undrawable",
        why: "the agent sent a link for something that is not a sign-in",
      });
      return { action: "decline" };
    }
    const { promise, resolve } =
      Promise.withResolvers<CreateElicitationResponse>();
    running.link = {
      elicitationId: CreateElicitationRequest.isUrl(params)
        ? params.elicitationId
        : null,
      answer: (action: "accept" | "decline") =>
        resolve(
          action === "accept"
            ? { action: "accept", content: {} }
            : { action: "decline" },
        ),
      url: link,
      message: form.message,
    };
    signing.sayAttempt();
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
    const running = signing.inFlight();
    if (running === null || running.stopping) return;
    if (running.link === null || running.link.elicitationId !== id) return;
    running.link.answer("accept");
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
        onEvent({ _tag: "said", text });
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
          onEvent({ _tag: "taskNotification", onto: notification.onto });
          return;
        }
        // A LIVE user chunk is kolu's own message coming back: the row for it
        // was minted when somebody pressed send, and drawing the echo would
        // double every message in the conversation. A THINKING chunk is
        // dropped in the `default` arm below, as it always was.
        return;
      }
      // Announce and update are ONE event: the protocol distinguishes them by
      // which fields it guarantees, and a consumer keyed by call id does the
      // same thing with either.
      case "tool_call":
      case "tool_call_update": {
        onEvent(readTool(update));
        return;
      }
      // `status` is copied, not narrowed like a tool call's `statusOf`: the
      // SDK parses every `session/update` before this sees it, and a plan
      // entry whose status is outside its three-word union is SKIPPED there
      // (`vecSkipError(zPlanEntry)`), and a wider SDK union stops compiling
      // here — the row's own `Literals` are the same three words.
      case "plan":
        onEvent({
          _tag: "plan",
          steps: update.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
            priority: entry.priority ?? null,
          })),
        });
        return;
      case "available_commands_update":
        onEvent({
          _tag: "commands",
          commands: update.availableCommands.map((command) => ({
            name: command.name,
            description: command.description ?? null,
          })),
        });
        return;
      case "config_option_update":
        onEvent({ _tag: "settings", config: update.configOptions });
        return;
      case "usage_update": {
        // How full the context is — the one thing a person needs to decide
        // whether to compact. Several a turn: the agent revises `used` as it
        // goes and may revise `size` too, so the newest wins.
        const read = usageIn(update);
        if (read !== null) onEvent({ _tag: "usage", usage: read });
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

  /** A tool frame, read into the door's own words: everything this side knows
   *  about the call, and nothing of what kolu DRAWS of it. */
  const readTool = (update: {
    readonly toolCallId: string;
    readonly title?: string | null;
    readonly status?: string | null;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<unknown> | null;
    readonly locations?: ReadonlyArray<unknown> | null;
    readonly _meta?: { readonly [key: string]: unknown } | null | undefined;
  }): AgentEvent => {
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
    const armed = leg.backgroundTask(update._meta);
    // WHETHER THIS CALL'S QUESTION REACHES THE PERSON AS A FORM. The ask row
    // carries that question already — its options, its answer, its heading —
    // so a panel that drew the call as well would say the same words twice,
    // the second time as grey machinery immediately above the thing asking
    // them. WHICH call that is, is one agent's own spelling of its own
    // built-in, so the leg answers it and the ROW carries the answer: a name
    // on the wire would put that spelling in every reader downstream of here.
    const named = calls.about(update.toolCallId).name;
    const asksThroughForm =
      named !== undefined && leg.asksThroughForm?.(named) === true
        ? true
        : undefined;
    return {
      _tag: "tool",
      id: update.toolCallId,
      title: update.title ?? undefined,
      status: statusOf(update.status),
      detail: detailOf(update.rawInput, update.rawOutput),
      asked: detailOf(update.rawInput, undefined),
      progress: progressOf(update.content as Parameters<typeof progressOf>[0]),
      diffs: diffsOf(update.content as Parameters<typeof diffsOf>[0], cwd),
      locations: locationsOf(
        update.locations as Parameters<typeof locationsOf>[0],
        cwd,
      ),
      rawInput: update.rawInput,
      answer,
      mcp: call === null ? null : { server: call.server, tool: call.tool },
      asksThroughForm,
      // WHO made the call, out of the same `_meta` the name came from: a
      // subagent's frames arrive on this one feed with nothing in the
      // protocol to tell them apart.
      parent: leg.parentToolUse(update._meta) ?? undefined,
      // ... and, the other way round, whether this call SENT an agent out.
      // The leg answers structurally — absent where it knows nothing — and
      // the row says `null` for the same, because a row is a value on a wire
      // and `undefined` is not one of its words.
      spawned: leg.spawned(update._meta, update.rawInput) ?? undefined,
      // ... and whether it ARMED a background task, which is the one kind of
      // call that goes on happening after this frame and after the turn.
      armed: armed ?? undefined,
      provisional: leg.provisionalTitle?.(update),
    };
  };

  const childEnv = (
    extra?: Readonly<Record<string, string>>,
  ): NodeJS.ProcessEnv =>
    childEnvOf(process.env, { ...adapter.env, ...extra }, adapter.unset);

  const child = startChild(adapter.command, adapter.args, {
    cwd,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    processGroup: true,
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
    if (id !== null) onEvent({ _tag: "model", id });
    const reports = raw.serversIn(params);
    if (reports !== null) onEvent({ _tag: "servers", reports });
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
        onEvent({ _tag: "identity", status: next });
      },
    )
    .onRequest(
      methods.client.session.requestPermission,
      (context) =>
        new Promise<RequestPermissionResponse>((resolve, reject) => {
          onEvent({
            _tag: "permission",
            params: context.params,
            signal: context.signal,
            settle: resolve,
            fail: reject,
          });
        }),
    )
    .onRequest(
      methods.client.elicitation.create,
      (context) =>
        new Promise<CreateElicitationResponse>((resolve, reject) => {
          onEvent({
            _tag: "elicitation",
            params: context.params,
            signal: context.signal,
            settle: resolve,
            fail: reject,
          });
        }),
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
    // No process, so no agent: the handle goes before the door is told, which
    // is what makes `alive()` false by the time a reader asks.
    live = null;
    onEvent({ _tag: "gone", code: code ?? null, signal: signal ?? null });
  });

  /** The spawn's own failure — an exec that failed after `spawn` returned —
   *  as the refusal the handshake races against. */
  const failedToStart = child.unstartable.then((why) => {
    throw new HarnessUnavailable(
      `could not start the agent \`${adapter.command}\`: ${why}`,
    );
  });

  // ── opening the conversation ─────────────────────────────────────────
  const doSignIn = async (method: string): Promise<SignedIn> => {
    if (stopped) throw new HarnessUnavailable("the harness is shutting down");
    const running = signing.inFlight();
    if (running !== null) {
      // ONE ATTEMPT PER AGENT: the same method ATTACHES to the row already
      // being drawn, and a different one is refused — two sign-ins at once is
      // two processes writing the same credential store.
      if (running.method === method) return "attached";
      throw new HarnessRefused(
        `a sign-in is already running (${running.label})`,
        "no",
      );
    }
    const found = signing.methods().find((one) => one.method.id === method);
    if (found === undefined) {
      throw new HarnessRefused(
        `\`${method}\` is not a sign-in this agent offers`,
        "no",
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
    signing.claim(claim);
    let ended: SignedIn;
    try {
      ended =
        found.run === null
          ? await runAgentSignIn(claim, found)
          : await runTerminalSignIn(claim, found.run);
    } finally {
      signing.claim(null);
    }
    // A CANCEL IS DECIDED ONCE, here, by the one place that owns the slot a
    // cancel withdraws. A runner crosses five awaits and a person can press
    // the button at any of them; re-pairing the ending with its clean-up at
    // each boundary was five chances to pair them wrong.
    //
    // A CANCEL THAT LOST THE RACE IS NOT AN ENDING. The login command exited
    // 0, which means the credential store has already been written: calling
    // that `cancelled` tells the caller there is nothing to restart for, and
    // the running agent then keeps the signature it started with for ever
    // while the store holds a different one. The row comes down either way —
    // the person asked for that — but the ANSWER is what happened.
    if (claim.stopping && ended !== "signed-in") {
      signing.clearAttempt();
      ended = "cancelled";
    }
    // NOTHING IS RE-ENTERED HERE. A signature only reaches the agent through a
    // fresh `initialize`, so the conversation somebody signed into is opened
    // by the restart the CALLER runs — with the session that was live when
    // the button was pressed. This end used to open one too, out of a
    // `resume` frozen at boot, which put a person back in the conversation
    // they had left (or silently into a fresh one) before the restart then
    // latched whatever that produced.
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
        cwd: cwd,
        env: childEnv({ BROWSER: "true", ...run.env }),
        stdio: ["pipe", "pipe", "pipe"],
        processGroup: true,
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
      signing.sayAttempt();
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
    signing.sayAttempt();
    const close = await process_.closed;
    if (process_.failed() !== undefined) {
      claim.state = "failed";
      claim.output = `${claim.output}${process_.failed() ?? ""}\n`.slice(
        -SIGN_IN_CAP,
      );
      signing.sayAttempt();
      return "failed";
    }
    if (close.code === 0) {
      claim.state = "succeeded";
      signing.sayAttempt();
      signing.signedIn();
      return "signed-in";
    }
    claim.state = "failed";
    signing.sayAttempt();
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
    signing.sayAttempt();
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
      signing.sayAttempt();
      return "failed";
    }
    claim.state = "succeeded";
    signing.sayAttempt();
    signing.signedIn();
    return "signed-in";
  };

  /** One line for the process a sign-in is running. The newline is added HERE:
   *  what a person types is a code, and every one of these CLIs reads it by
   *  line — the same kind of protocol fact as everything else this file owns. */
  const signInInput = async (text: string): Promise<void> => {
    const write = signing.inFlight()?.write ?? null;
    if (write === null) {
      throw new HarnessRefused(
        "no sign-in is waiting for a line to be typed into it",
        "no",
      );
    }
    write(`${text}\n`);
  };

  /** ... and stopping it — or, for a row a PERSON asked for, closing it: a
   *  sign-in somebody asked for and then thought better of leaves everything
   *  as it was. The agent's own offer stays, with its methods, because the
   *  refusal behind it still stands. The boolean is whether there was
   *  anything to stop: a cancel with nothing behind it is a stale tab, not a
   *  failure. */
  const signInCancel = async (): Promise<boolean> => {
    const running = signing.inFlight();
    if (running !== null) {
      // Set BEFORE the stop, because the runner reads it on its way out:
      // which of the two endings this is depends on whether a PERSON asked,
      // and this is the only moment that is known.
      running.stopping = true;
      await running.stop();
    }
    if (signing.row()?.cause.kind === "person") {
      signing.signedIn();
      return true;
    }
    if (running === null) return false;
    signing.clearAttempt();
    return true;
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
   * process: one `session/new`, one `claude`, for ever. A production padi
   * was found holding five, at ~35% CPU each.
   *
   * The conversation calls it BEFORE the next open, so a host never carries
   * two agent CLIs for one panel, and an open that fails does not leave the
   * old conversation running with nothing able to reach it.
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

  // ── leaving, and stopping ────────────────────────────────────────────

  /**
   * The conversation is over — replaced, reloaded, or dead. Everything keyed
   * to it goes. {@link closed} is named FIRST, while `activeSession` is still
   * the one being left: nulling it first is what turns the leftover fence off
   * for the whole of the next open.
   */
  const leave = (): void => {
    if (activeSession !== null) closed.add(activeSession);
    waitingLinks.clear();
    questions.withdrawAll();
    calls.forget();
    activeSession = null;
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    const at = live;
    live = null;
    const running = signing.inFlight();
    if (running !== null) running.stopping = true;
    leave();
    at?.connection.close();
    await Promise.all([at?.child.stop(), running?.stop()]);
    signing.claim(null);
  };

  // ── the handshake ────────────────────────────────────────────────────

  /**
   * `initialize`, and what the answer says about the agent.
   *
   * `fs` capabilities are FALSE in both directions on purpose: the conductor
   * is not an editor, and an agent that could write a file whole would be
   * routing around the terminals it is supposed to be driving.
   * `elicitation.form` is TRUE and is what makes any of the asking happen at
   * all — without it the pinned Claude adapter puts `AskUserQuestion` in
   * `disallowedTools`, so the agent cannot ask a structured question and has
   * to guess. `elicitation.url` is TRUE because without it the adapters
   * withhold their device-code sign-in entirely, and `auth.terminal` (plus the
   * `_meta["terminal-auth"]` corner the pinned Claude adapter reads) is what
   * makes an agent offer a sign-in a CLIENT can run: with it, the adapter
   * hands over a command that prints a URL and reads a code; without it, the
   * same adapter offers only a full-screen TUI this panel cannot draw.
   */
  const handshake = async (): Promise<void> => {
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
    signing.offered(
      methodsIn(initialized, adapter.command, adapter.args),
      initialized.agentInfo === undefined || initialized.agentInfo === null
        ? null
        : `${initialized.agentInfo.name} ${initialized.agentInfo.version}`,
    );
    // WHAT THIS AGENT TAKES MID-TURN, read ONCE, here. Both are claims the
    // agent makes about itself at the handshake, and both are read POSITIVELY:
    // an agent that says nothing is offered no interruption and promises no
    // queue, which is the direction either is safe to lose in.
    onEvent({
      _tag: "advertised",
      steers: leg.steering?.advertised(initialized) ?? false,
      queues: leg.queues(initialized),
    });
    const takes = initialized.agentCapabilities?.promptCapabilities;
    onEvent({
      _tag: "carries",
      image: takes?.image === true,
      embeddedContext: takes?.embeddedContext === true,
    });
  };

  return {
    handshake,
    request,
    notify,
    stderrSince,
    stderrMark: () => stderrWritten,
    alive: () => live !== null && !stopped,
    session: () => activeSession,
    enter: (id: string) => {
      activeSession = id;
      closed.delete(id);
    },
    leave,
    elsewhere: (sessionId) => fromElsewhere(sessionId, activeSession, closed),
    fence: (sessionId) => {
      closed.add(sessionId);
    },
    awaitLink: (elicitationId, question) => {
      waitingLinks.set(elicitationId, question);
    },
    release,
    signIn: doSignIn,
    askSignIn: () => signing.ask(),
    signInOffer: (why: string) => signing.offer(why),
    signInWithdrawn: () => signing.withdraw(),
    signInInput,
    signInCancel,
    stop,
    beginReplay: (id: string) => {
      closed.delete(id);
      replaying = true;
      replayed = 0;
    },
    endReplay: () => {
      replaying = false;
      return replayed;
    },
    attachLink,
  };
};
