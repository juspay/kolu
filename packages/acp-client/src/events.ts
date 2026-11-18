/**
 * The whole vocabulary of what an agent tells us, and the only way anything
 * leaves {@link ./agent.ts}.
 *
 * It is a closed union rather than the protocol's own payloads, and that is the
 * seam: nothing above this file spells `session/update`, reads a `ContentBlock`
 * or knows which `configOptions` entry the model is. A consumer that needs
 * something not in here needs a new member, not a look at the wire — which is
 * what keeps the ACP version in one file and the conversation in another.
 *
 * The list is the racket bridge's, member for member, because the panel it
 * feeds is the racket panel's behaviour (https://github.com/juspay/oss.olai/blob/main/projects/olai/brainstorming/acp.md, round two).
 * A turn's END is deliberately not here: `prompt` returns its stop reason, and
 * the caller that asked is the one waiting.
 */

import type {
  SessionSetting,
  PlanStep,
  TerminalView,
  Armed,
  AuthMethod,
  ChatServer,
  SignIn,
  Spawned,
  Json,
} from "./shapes.ts";
import type {
  AskField,
  AskLink,
  AskOutcome,
  AuthStatus,
  FileDiff,
  ToolStatus,
  Usage,
} from "@kolu/acp/wire";
/** A slash command the agent offers. */
export interface Command {
  readonly name: string;
  readonly description: string;
}

/**
 * One of the agent's stored conversations for the served directory.
 *
 * `messageCount` and `supersededBy` come from the adapter's OWN corner of the
 * answer (`_meta.claudeCode` on the pinned Claude Code adapter —
 * `packages/plugins/claude/acp/patches/session-list-info.patch`, the lane in
 * `olai-plugin-claude`'s `leg.ts`'s `listedIn`), so they are facts that exist only
 * where an adapter chooses to volunteer them. `null` — the reading's losing
 * direction — is what the request's absence produces, and the picker's answer
 * for it is to draw nothing rather than a zero or a guessed pair.
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
      readonly settings: ReadonlyArray<SessionSetting>;
    }
  | { readonly _tag: "plan"; readonly entries: ReadonlyArray<PlanStep> }
  /** The agent's prose, one chunk as it arrived. */
  | { readonly _tag: "said"; readonly text: string }
  /** What a PERSON said, ONE CHUNK as it arrived — the same unit `said`
   *  carries, because it is the same unit the wire carries. Only a REPLAY
   *  brings these: live, we already know what was sent, because we sent it,
   *  and we have the whole of it before any of it is on the wire.
   *
   *  Saying "a chunk" is not pedantry here; it is the line that was missing.
   *  This used to read "a user message", and the consumer wrote a ROW per
   *  event on the strength of it — so a replayed message came back as one
   *  bubble per piece the agent had kept it in. */
  | { readonly _tag: "userSaid"; readonly text: string }
  /**
   * A tool call, as we last heard of it — announced or moved.
   *
   * ONE member rather than the announce/update pair the protocol has, because
   * a consumer does the same thing with both: the transcript is keyed by
   * `id`, so a second report of a call is the same row with new fields. Two
   * events would be two arms of every switch that never differ, which is a
   * distinction the wire makes and the conversation does not.
   *
   * `undefined` is "unchanged", not "cleared" — the protocol's own rule for
   * an update, and the reason an announcement is expressible here at all.
   */
  | {
      readonly _tag: "tool";
      readonly id: string;
      readonly title: string | undefined;
      /** WHAT THE CALL IS DOING, in the surface's own four words rather than a
       *  fifth spelling of them. It used to be spelled out here, which made three
       *  lists of one vocabulary — the SDK's `ToolCallStatus`, this, and the
       *  wire's — and the seam in {@link ./agent.ts} is where a fifth ACP status
       *  now has to be met rather than cast past. `undefined` is "unchanged". */
      readonly status: ToolStatus | undefined;
      readonly detail: string | undefined;
      /** What the call has to SAY while it runs, out of the protocol's content
       *  blocks. Its own field rather than more `detail` because the two answer
       *  different questions — what was asked for, and what is happening. */
      readonly progress: string | undefined;
      /** The files it REWROTE, structured — path, what was there, what is there
       *  now (`@kolu/acp`'s `diffsOf`). Its own field rather than a line of
       *  `progress`, because a change flattened into a sentence is a change a
       *  panel can no longer draw. */
      readonly diffs: ReadonlyArray<FileDiff> | undefined;
      /** Display name, owner and opaque JSON reply for the owning plugin’s face. */
      readonly called: string | undefined;
      readonly row: string | undefined;
      readonly reply: Json | undefined;
      /** Where it is working: the follow-along file locations. */
      readonly locations: ReadonlyArray<string> | undefined;
      /**
       * WHO made it: the `Agent` call this one was made inside, by that call's
       * own id — or `undefined` for a call the main agent made itself.
       *
       * The protocol has no such field, and that is the whole reason this one
       * exists: a subagent's calls arrive on the same flat feed as everything
       * else, so without it a turn that spawned three agents is drawn as one
       * agent doing everything, and the reader cannot tell that the other three
       * were ever there (`@kolu/acp/engine`'s `Leg`'s `parentToolUse`).
       *
       * `undefined` reads as "unchanged" here like every field beside it, which
       * costs nothing: a call is made where it is made, so nothing ever needs
       * saying twice and nothing ever needs taking back.
       */
      readonly parent: string | undefined;
      /**
       * ... and, the other way round, that this call SENT one out
       * (`@kolu/acp/engine`'s `Leg`'s `spawned`).
       *
       * The two are not one field with two directions: `parent` is answered by
       * frames a subagent produced, so it says nothing at all until the subagent
       * has produced one — and a spawned agent that is still reading its
       * instructions has produced none. This is answered by the spawn's own
       * frame, which arrives when the agent is sent out.
       *
       * `undefined` is "unchanged" like everything beside it, and it is load
       * bearing here: most of what follows a spawn — its heartbeats, its
       * completion — says nothing about being one, and a row that read that
       * silence as "not a spawn now" would lose the face at the moment the
       * agent came back.
       */
      readonly spawned: Spawned | undefined;
      /**
       * ... and that it ARMED A BACKGROUND TASK — a monitor, a background shell,
       * an agent sent out to run past this turn (`@kolu/acp/engine`'s `Leg`'s
       * `backgroundTask`).
       *
       * The third thing a call can leave behind and the only one that goes on
       * happening: the tool answers at the moment the task starts, so without
       * this the frame that says "running" and the frame that says "finished" are
       * the same frame, and everything the harness says afterwards has no row to
       * land on.
       *
       * `undefined` is "unchanged" like everything beside it, and it is load
       * bearing in both directions: the frame that ARMS the call says nothing
       * about an ending, and the frame that ENDS it need not repeat the
       * description it was armed with.
       */
      readonly armed: Armed | undefined;
      /**
       * ... and that the TITLE on this frame is a placeholder rather than the
       * call's name (`@kolu/acp/engine`'s `Leg`'s `provisionalTitle`).
       *
       * `undefined` reads as "not provisional" rather than "unchanged", which is
       * the one place here that departs from every field beside it — and it has
       * to: the claim is scoped to the title THIS frame carried, so carrying it
       * forward would make a name that was refined once refinable forever.
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
       * fields at all — ACP's URL mode ({@link @kolu/acp}'s `urlOf`). The message
       * above is the same message the card shows, so what this adds is the two
       * facts a link is: the place, and which machine it is
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
       * The same field a `tool` event carries and answered the same way, because
       * it is the same question about a different frame. It has to be here for
       * the reason it has to be there: a subagent's question reaches olai on the
       * one feed everything else does, so a form drawn without it is drawn in
       * the main agent's voice — and a permission form is the one row where
       * being wrong about who is asking changes what a person decides.
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
   * WHAT THIS AGENT SAID IT CAN DO, once per handshake — the two facts about a
   * running agent the panel cannot work out for itself.
   *
   * Not `initialize`'s payload and deliberately not near it: what crosses is
   * two booleans a leg read (`@kolu/acp/engine`'s `Leg`), so nothing above this
   * file learns that agents advertise anything, let alone where.
   *
   * ONCE PER AGENT rather than per session, because that is when it is said:
   * the handshake happens when a subprocess starts, and every conversation that
   * subprocess then holds is with the same agent. It arrives AFTER the panel
   * has been told which agent it is talking to and before that agent's first
   * turn — so a panel between the two makes no promise and offers no
   * interruption, which is what a panel that has not been told yet honestly
   * has.
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
       *
       * Here rather than in {@link signIn}'s event, because it is the same kind
       * of fact as the two above: something the agent said about itself at the
       * handshake, true for the life of the process, and read by the composer
       * before anybody has asked for anything. Empty for an agent with nothing to
       * offer, which is most of them.
       */
      readonly methods: ReadonlyArray<AuthMethod>;
    }
  /**
   * The MCP servers this conversation has, and how each one stands — the whole
   * roster, healthy rows included ({@link ./servers.ts}).
   *
   * Emitted once per session opened, BEFORE the session it belongs to, because
   * the set is decided while the session is being asked for: what is handed to
   * `session/new` is the same list this is read off. Replaced rather than
   * merged, for the same reason `commands` is — the answer is a property of one
   * conversation, and a padi started since the last one shows up as a healthy
   * row rather than as a failure that has to be found and removed.
   *
   * ... and AGAIN whenever the agent says something new about them. #140's
   * version of this event fired once per session because olai's own probe was
   * the only source there was: ACP's `session/new` answers with a session id
   * and says nothing per server. One agent does say — the Claude Code adapter
   * forwards a status per server on its CLI's `system`/`init`
   * (`olai-plugin-claude`'s `leg.ts`) — and that arrives per turn, after the session
   * is open. So this is no longer a fact settled at session open; it is one
   * that can be refined by whoever knows better, and only ever by them
   * ({@link ./servers.ts}'s `movedBy`).
   */
  /**
   * A SIGN-IN, as it stands — the whole value, replaced rather than merged,
   * and `null` when there is none ({@link SignIn}).
   *
   * ONE EVENT FOR THE WHOLE THING, so there is one place a sign-in can be and
   * no path that moves the wire without moving the row. It is not a per-chunk
   * stream like `saying` is: what a terminal method prints is short, bounded,
   * and read as a whole — a URL, a prompt, a refusal — and the panel draws it
   * exactly as it stands, so the whole value is the honest unit.
   *
   * The PANEL also writes this member of its own state, and the split is worth
   * naming: the CHOOSER is a panel's (somebody pressed `/login`, or an agent
   * refused something for want of a signature), and an ATTEMPT is the agent's —
   * it is the one holding the process, and it is what says when the attempt is
   * over.
   */
  | { readonly _tag: "signIn"; readonly signIn: SignIn | null }
  | { readonly _tag: "servers"; readonly servers: ReadonlyArray<ChatServer> }
  /**
   * WHO THE AGENT PROCESS IS SIGNED IN AS, as the agent itself last said — or
   * `null` when nobody is reporting, which is a different thing from a known
   * logged-out state ({@link AuthStatus}'s `kind: "none"`).
   *
   * A FACT ABOUT THE PROCESS, not about the session: the notification is
   * connection-scoped and arrives at the handshake, at each session opened, and
   * mid-turn when the agent re-reads its own identity at the start of a prompt.
   * So it is emitted without the session fence every other frame goes through
   * — there is no session to be "elsewhere" from — and it outlives a
   * conversation, because reopening one is the same subprocess and both
   * adapters suppress an unchanged report. It is cleared (`null`) when the
   * process ends.
   *
   * SILENCE IS NOT AN ANSWER. An agent that never advertises
   * (`agentCapabilities._meta.authStatus`) and never pushes leaves this `null`
   * for the life of the panel, and the header draws no chip at all; the
   * protocol extension is engine-agnostic, so an engine that starts reporting
   * gets the chip with nothing here changed.
   */
  | { readonly _tag: "identity"; readonly identity: AuthStatus | null }
  /** The model this session runs, labelled the way the agent labels its own. */
  | { readonly _tag: "model"; readonly name: string | null }
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
   *
   * ONE READER AND ONE USE ({@link ./chat.ts}'s `refusedOpen`): what a refused
   * open says it was about, and — off the same id — which node agent that
   * conversation belongs to. Both used to be unaskable at the moment they were
   * needed. A conversation is not ENTERED until the agent has agreed to it
   * ({@link ./agent.ts}'s `load` argues why), so at a refusal the module is in
   * no conversation and the panel had nothing to name: the face said only that
   * *a* conversation could not be opened, and the header — which draws a node
   * agent's own way out of exactly this, its *fresh session* — did not know
   * there was a node. The two rules were each right and closed on a person
   * together: *try again* asked for the same lost conversation for ever.
   *
   * SAID BY THE VERB rather than passed beside it, which is what makes the two
   * open paths one story: a picker's load names the id it was given, and a BOOT
   * — which adopts its own and is reached by no click — names the one it
   * adopted, through the same line.
   */
  | { readonly _tag: "opening"; readonly id: string | null }
  /** The agent named the conversation. */
  | { readonly _tag: "sessionTitled"; readonly title: string }
  /**
   * ... and the conversation it named is gone: we are between sessions.
   *
   * WHY it is over decides what happens to the transcript, so it is carried
   * rather than inferred. A NEW conversation clears the old transcript. A
   * REFUSED open withdraws its provisional replay and settings. A
   * LOAD is about to replay a different conversation over it, so the replay
   * clears. A DEAD agent leaves everything where it is and says so.
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
