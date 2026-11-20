import type {
  Armed,
  AskField,
  AskLink,
  AskOutcome,
  AuthMethod,
  AuthStatus,
  Command,
  FileDiff,
  PlanStep,
  Server,
  Setting,
  SignIn,
  Spawned,
  TerminalView,
  ToolStatus,
  Usage,
} from "@kolu/acp/wire";
import type { Schema } from "effect";

/**
 * One of the agent's stored conversations for the served directory.
 *
 * `messageCount` and `supersededBy` come from the adapter's OWN corner of the
 * answer (`_meta.claudeCode` on the pinned Claude Code adapter), so they are
 * facts that exist only where an adapter chooses to volunteer them. `null` is
 * what the request's absence produces, and the picker's answer for it is to
 * draw nothing rather than a zero or a guessed pair.
 */
export interface Stored {
  readonly id: string;
  readonly title: string | null;
  readonly updatedAt: string | null;
  readonly messageCount: number | null;
  readonly supersededBy: string | null;
}

export type AgentEvent =
  | {
      readonly _tag: "toolTerminals";
      readonly id: string;
      readonly terminals: readonly TerminalView[];
    }
  | {
      readonly _tag: "settings";
      readonly settings: ReadonlyArray<Setting>;
    }
  | { readonly _tag: "plan"; readonly entries: ReadonlyArray<PlanStep> }
  /** The agent's prose, one chunk as it arrived. */
  | { readonly _tag: "said"; readonly text: string }
  /** What a PERSON said, ONE CHUNK as it arrived — the same unit `said`
   *  carries, because it is the same unit the wire carries. Only a REPLAY
   *  brings these: live, we already know what was sent, because we sent it,
   *  and we have the whole of it before any of it is on the wire. */
  | { readonly _tag: "userSaid"; readonly text: string }
  /**
   * A tool call, as we last heard of it — announced or moved. ONE member
   * rather than the announce/update pair the protocol has: the transcript is
   * keyed by `id`, so a second report of a call is the same row with new
   * fields.
   *
   * `undefined` is "unchanged", not "cleared" — the protocol's own rule for
   * an update, and the reason an announcement is expressible here at all.
   */
  | {
      readonly _tag: "tool";
      readonly id: string;
      readonly title: string | undefined;
      /** WHAT THE CALL IS DOING, in the surface's own four words.
       *  `undefined` is "unchanged". */
      readonly status: ToolStatus | undefined;
      readonly detail: string | undefined;
      /** ... and the call's ARGUMENTS ALONE, folded the same way. */
      readonly asked: string | undefined;
      /** What the call has to SAY while it runs, out of the protocol's content
       *  blocks. */
      readonly progress: string | undefined;
      /** THE CALL'S OWN INPUT, verbatim, and the agent's answer as the leg read
       *  it (`@kolu/acp/engine`'s `Leg`'s `replyIn`, falling back to the frame's
       *  own `rawOutput`). Raw, and BOTH halves arrive across frames: the
       *  arming frame carries the input and the settling frame the answer. */
      readonly rawInput: unknown;
      readonly answer: unknown;
      /** Which server and tool this frame's call named, where the leg
       *  positively recognised it as one of the servers THIS conversation was
       *  handed. Several, because one frame can be several calls on a wire that
       *  dispatches every MCP tool through one builtin; empty for a call nothing
       *  recognised. */
      readonly mcp: ReadonlyArray<{
        readonly server: string;
        readonly tool: string;
      }>;
      /** Whether this call's question reaches a person as a FORM rather than as
       *  a card — one agent's own spelling of its own built-in
       *  (`@kolu/acp/engine`'s `Leg`'s `asksThroughForm`). `undefined` is
       *  "unchanged", like every field beside it. */
      readonly asksThroughForm: boolean | undefined;
      /** The files it REWROTE, structured — path, what was there, what is there
       *  now (`@kolu/acp`'s `diffsOf`). */
      readonly diffs: ReadonlyArray<FileDiff> | undefined;
      /** Display name, owner and opaque JSON reply for the owning plugin's face. */
      readonly called: string | undefined;
      readonly row: string | undefined;
      readonly reply: typeof Schema.Json.Type | undefined;
      /** Where it is working: the follow-along file locations. */
      readonly locations: ReadonlyArray<string> | undefined;
      /**
       * WHO made it: the `Agent` call this one was made inside, by that call's
       * own id — or `undefined` for a call the main agent made itself
       * (`@kolu/acp/engine`'s `Leg`'s `parentToolUse`).
       *
       * `undefined` reads as "unchanged" here like every field beside it.
       */
      readonly parent: string | undefined;
      /**
       * ... and, the other way round, that this call SENT one out
       * (`@kolu/acp/engine`'s `Leg`'s `spawned`). Answered by the spawn's own
       * frame, which arrives when the agent is sent out.
       *
       * `undefined` is "unchanged" like everything beside it.
       */
      readonly spawned: Spawned | undefined;
      /**
       * ... and that it ARMED A BACKGROUND TASK — a monitor, a background
       * shell, an agent sent out to run past this turn
       * (`@kolu/acp/engine`'s `Leg`'s `backgroundTask`).
       *
       * `undefined` is "unchanged" like everything beside it.
       */
      readonly armed: Armed | undefined;
      /**
       * ... and that the TITLE on this frame is a placeholder rather than the
       * call's name (`@kolu/acp/engine`'s `Leg`'s `provisionalTitle`).
       *
       * `undefined` reads as "not provisional" rather than "unchanged", which
       * is the one place here that departs from every field beside it: the
       * claim is scoped to the title THIS frame carried.
       */
      readonly provisional: boolean | undefined;
    }
  /**
   * The agent asked a person something, and the turn is stopped until it is
   * answered.
   *
   * `id` is minted by {@link ./agent.ts} and is what an answer comes back
   * naming — the protocol's own correlation is a JSON-RPC request id, which is
   * a fact about the wire and not something a browser may hold.
   */
  | {
      readonly _tag: "asked";
      readonly id: string;
      /** What the agent said it needs. */
      readonly message: string;
      readonly fields: ReadonlyArray<AskField>;
      /**
       * WHERE THE QUESTION SENDS THEM, for the one elicitation that asks for no
       * fields at all — ACP's URL mode ({@link @kolu/acp}'s `urlOf`). What this
       * adds is the two facts a link is: the place, and which machine it is
       * (`@kolu/acp/wire`'s `AskLink`).
       *
       * `null` for every question that is a thing to fill in, which is nearly all
       * of them — a permission request among them, since picking an option is an
       * answer and going somewhere is not.
       */
      readonly link: AskLink | null;
      /**
       * WHICH agent is asking: the `Agent` call the question came out of, by
       * that call's own id — or `undefined` for one the main agent asked itself.
       *
       * Unlike its sibling this is never "unchanged": a question is asked once,
       * by one agent, and the row is written from this event alone.
       */
      readonly parent: string | undefined;
    }
  /** ... and it stopped waiting: somebody answered it, somebody dismissed it,
   *  or the agent took it back. */
  | {
      readonly _tag: "askSettled";
      readonly id: string;
      readonly outcome: AskOutcome;
    }
  /** The whole slash-command list, replaced rather than merged. */
  | { readonly _tag: "commands"; readonly commands: ReadonlyArray<Command> }
  /**
   * WHAT THIS AGENT SAID IT CAN DO, once per handshake — the facts about a
   * running agent the panel cannot work out for itself.
   *
   * ONCE PER AGENT rather than per session, because that is when it is said:
   * the handshake happens when a subprocess starts, and every conversation that
   * subprocess then holds is with the same agent. It arrives AFTER the panel
   * has been told which agent it is talking to and before that agent's first
   * turn.
   */
  | {
      readonly _tag: "advertised";
      /** It takes a message INTO the turn it is running, if asked on purpose.
       *  What the composer draws its one interrupting control from. */
      readonly steers: boolean;
      /** It HOLDS a message sent while it is busy and runs it when the turn is
       *  over. What lets the composer promise a person their words will be got
       *  to, on the agent's own word. */
      readonly queues: boolean;
      /**
       * ... AND HOW TO SIGN IN, if it offers a way — the handshake's
       * `authMethods`, read into what a button needs ({@link AuthMethod}).
       * Empty for an agent with nothing to offer, which is most of them.
       */
      readonly methods: ReadonlyArray<AuthMethod>;
      /**
       * ... AND WHAT IT TAKES IN A MESSAGE, beyond the text every agent takes
       * (`promptCapabilities`).
       *
       * ACP makes an image block and an embedded resource OPT-IN at the AGENT's
       * end: an adapter that never advertised `image` is one an image is not
       * legal to send to, and sending one anyway is a turn that fails somewhere
       * inside the agent with a sentence nobody wrote for a person. So a caller
       * that lets somebody attach a file refuses it HERE, naming the capability,
       * and both are FALSE for an agent that advertised neither.
       */
      readonly image: boolean;
      readonly embeddedContext: boolean;
      /** ... AND WHAT IT CALLS ITSELF — `agentInfo` as the one phrase it gives
       *  (`name` and `version`), or `null` for an agent that gave none. */
      readonly agent: string | null;
    }
  /**
   * A SIGN-IN, as it stands — the whole value, replaced rather than merged,
   * and `null` when there is none ({@link SignIn}). ONE EVENT FOR THE WHOLE
   * THING rather than a per-chunk stream: what a terminal method prints is
   * short, bounded, and read as a whole.
   */
  | { readonly _tag: "signIn"; readonly signIn: SignIn | null }
  /**
   * The MCP servers this conversation has, and how each one stands — the whole
   * roster, healthy rows included ({@link ./servers.ts}).
   *
   * Emitted once per session opened, BEFORE the session it belongs to, because
   * the set is decided while the session is being asked for: what is handed to
   * `session/new` is the same list this is read off. Replaced rather than
   * merged, for the same reason `commands` is — the answer is a property of one
   * conversation.
   *
   * ... and AGAIN whenever the agent says something new about them, and only
   * ever by whoever knows better ({@link ./servers.ts}'s `movedBy`).
   */
  | { readonly _tag: "servers"; readonly servers: ReadonlyArray<Server> }
  /**
   * WHO THE AGENT PROCESS IS SIGNED IN AS, as the agent itself last said — or
   * `null` when nobody is reporting, which is a different thing from a known
   * logged-out state ({@link AuthStatus}'s `kind: "none"`).
   *
   * A FACT ABOUT THE PROCESS, not about the session: the notification is
   * connection-scoped and arrives at the handshake, at each session opened, and
   * mid-turn when the agent re-reads its own identity at the start of a prompt.
   * So it is emitted without the session fence every other frame goes through,
   * and it outlives a conversation. It is cleared (`null`) when the process
   * ends.
   *
   * SILENCE IS NOT AN ANSWER. An agent that never advertises
   * (`agentCapabilities._meta.authStatus`) and never pushes leaves this `null`
   * for the life of the panel, and the header draws no chip at all.
   */
  | { readonly _tag: "identity"; readonly identity: AuthStatus | null }
  /** The model this session runs: the id whichever source named it last, and
   *  the label the agent's own picker gives that id — the id because a reading
   *  of a model that needs more than a name (its context window, out of the
   *  picker's rows) has nothing else to ask with, and the raw id where the
   *  picker offers no row for it. `null` on both when no source has named one. */
  | {
      readonly _tag: "model";
      readonly id: string | null;
      readonly name: string | null;
    }
  | {
      readonly _tag: "models";
      readonly choices: ReadonlyArray<{
        readonly value: string;
        readonly name: string;
      }>;
    }
  /** How full this conversation's context is, as the agent last reported it.
   *  Arrives several times a turn — the agent revises both halves as it goes —
   *  and the panel holds the newest. */
  | { readonly _tag: "usage"; readonly usage: Usage }
  /** Which stored conversation this now is. `title` is `null` until the agent
   *  has written one. */
  | {
      readonly _tag: "session";
      readonly id: string;
      readonly title: string | null;
    }
  /**
   * AN OPEN IS UNDER WAY, and this is the conversation it is FOR — said BEFORE
   * the request goes out, so a refusal has a subject.
   *
   * `null` for an open that picks its own, which is a fresh conversation: it
   * belongs to nobody until it exists.
   */
  | { readonly _tag: "opening"; readonly id: string | null }
  /** The agent named the conversation. */
  | { readonly _tag: "sessionTitled"; readonly title: string }
  /**
   * ... and the conversation it named is gone: we are between sessions.
   *
   * WHY it is over decides what happens to the transcript, so it is carried
   * rather than inferred. A NEW conversation clears the old transcript. A
   * REFUSED open withdraws its provisional replay and settings. A LOAD is about
   * to replay a different conversation over it, so the replay clears. A DEAD
   * agent leaves everything where it is and says so.
   */
  | {
      readonly _tag: "sessionOver";
      readonly why: "new" | "load" | "gone" | "refused";
    }
  /** A `session/load` is about to replay a conversation. Everything until
   *  {@link replayEnded} is history, not news. */
  | { readonly _tag: "replayStarted" }
  | { readonly _tag: "replayEnded" }
  /** The subprocess ended and nothing asked it to. */
  | { readonly _tag: "gone"; readonly why: string }
  /** Something failed where no caller was waiting — a boot, a refused mode.
   *  Already logged: this is the sentence a person reads. */
  | { readonly _tag: "trouble"; readonly message: string };
