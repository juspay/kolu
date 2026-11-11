/**
 * WHAT AN AGENT MEANS by what it sends — as one interface, with one
 * implementation per agent kolu knows how to talk to.
 *
 * The protocol proper is read where it is spoken (`@kolu/acp-harness`'s `agent.ts`,
 * and the rest of this package). What is read HERE is everything that is only
 * true of ONE agent: a `_meta` extension one adapter writes, a tool-naming
 * convention one CLI uses, a permission mode one of them has and the other
 * refuses, a steering method that exists on one wire and not the other. Before
 * there were two agents this was a file called `interpret.ts` and the bets were
 * simply the Claude Code adapter's; that file is `@kolu/claude-code`'s `leg.ts`
 * now, meaning unchanged, and it answers to this shape instead of being it.
 *
 * ## WHY IT IS IN THIS PACKAGE, one floor under everybody
 *
 * A leg is written by a PLUGIN — one per engine, each in its own directory,
 * with its own release clock — and it is read by `@kolu/acp-harness`, which is a
 * general package a plugin may not import and which may not import a plugin.
 * The shape both ends spell has to live under both of them, and this is the
 * package that is under both: it is the PROTOCOL, and a leg is a reading of one
 * agent's spelling of the protocol. `@kolu/acp` stays a general package for
 * exactly that reason — the protocol is the language, not an integration — and
 * this module is the part of the language that says *how this speaker says it*.
 *
 * THE RULE THAT SURVIVES THE SPLIT, and the one a reviewer should check every
 * new leg against: **every bet is safe to lose in one direction only, and that
 * is the direction it loses in.** An agent that says none of this matches
 * nothing, and what happens then is that a person is asked. **Nothing is ever
 * approved by failing to recognise it.** A leg that answered a tool name it had
 * not positively recognised, or an allow-option for a tool it could not name,
 * would be approving somebody's permissions on their behalf — which is the one
 * failure in this package that is not recoverable by pressing something.
 *
 * EVERY MEMBER IS A PURE FUNCTION OR A CONSTANT, for the reason the old file
 * gave: the rule that stops this panel approving its own permissions is a
 * function with unit tests rather than a branch reachable only by starting a
 * subprocess and talking it into asking.
 *
 * WHAT IS NOT HERE is anything the PROTOCOL carries for everybody — a content
 * block, a usage report, a diff — which is `@kolu/acp`'s, and anything a leg
 * would have to KNOW ABOUT A CONVERSATION to answer, which is the caller's.
 * Which side of the boundary a new reader belongs on is not which payload it
 * reads but WHO has to have sent it.
 */

import type { PermissionOption } from "@agentclientprotocol/sdk";
import type { Duration } from "effect";

/** A `_meta`, as every reader here takes one: an object of unknown fields, or
 *  nothing at all. Spelled once because five signatures below take it. */
export type Meta = { readonly [key: string]: unknown } | null | undefined;

/**
 * How a message reaches a turn that is ALREADY RUNNING — the INTERRUPTING
 * gesture, for an agent that has a way, or `null` for one that has none.
 *
 * NOT WHAT AN ORDINARY SEND DOES, and that is the change `compact-lost-to-steer`
 * made: every send is a plain `session/prompt`, idle or busy, and the agent
 * holds a busy one behind the turn it is working on. This is the extra gesture
 * on top of that — the one a person reaches for on purpose, because they want
 * the turn in flight to hear them rather than the next one.
 *
 * `null` is not a degradation kolu hides. An agent without steering has one
 * way to be sent to, which is the way every agent is sent to; the composer
 * simply offers nobody a button that would do nothing
 * (the orchestrator's composer).
 */
export interface Steering {
  /** The method that carries it. An EXTENSION on every wire that has one,
   *  hence the leading underscore. */
  readonly method: string;
  /** The request's own `_meta`, or `undefined` for a wire that wants none. */
  readonly meta: unknown;
  /** How long it may go unanswered before the words go back to the person who
   *  typed them. Its warrant is a claim about this extension rather than about
   *  a pipe, which is why it is a property of the leg. */
  readonly timeout: Duration.Input;
  /** Whether the answer says the message went INTO the running turn. Read
   *  POSITIVELY: anything unrecognised is NOT taken, which sends the message
   *  again as an ordinary prompt. The worst case of that is a message the agent
   *  hears twice; the worst case of reading an unknown outcome as taken is a
   *  message nobody has. */
  readonly taken: (answered: unknown) => boolean;
  /**
   * Whether THIS agent said, at `initialize`, that it has this — over the whole
   * handshake response, since an advertisement can sit anywhere in it.
   *
   * READ TO DECIDE WHETHER TO OFFER A GESTURE, and never to predict what a
   * request will do. Those are different questions and only one of them can be
   * answered before the fact: a control has to be drawn or not drawn before
   * anybody presses it, and the only honest input to that is what the agent
   * said about itself. What a steer actually DID is still the request's own
   * answer, and a refusal still reaches a person as their words back
   * (`@kolu/acp-harness`'s `agent.ts`) — so nothing here is approved by an advertisement,
   * which is this file's rule read the one way it survives.
   *
   * A leg with a steering method whose agent says nothing gets NO GESTURE: the
   * panel would be showing a person a button for an extension that agent never
   * claimed, and the default send reaches it either way.
   */
  readonly advertised: (initialized: unknown) => boolean;
}

/** What a session's opening call asks the agent to forward, and where the
 *  answer arrives — for an agent that has such a channel, and `null` for one
 *  that does not. */
export interface RawMessages {
  /** The `_meta` to send with `session/new` and `session/load`. */
  readonly openMeta: { readonly [key: string]: unknown };
  /** The notification the agent forwards under. */
  readonly method: string;
  /** The model a turn is RUNNING on, out of one of those messages, or `null`
   *  for a message that says nothing about one. */
  readonly modelIn: (params: unknown) => string | null;
  /**
   * What the agent says about ITS OWN CONNECTIONS to the MCP servers of this
   * conversation, out of one of those messages — or `null` for a message that
   * says nothing about them, which is nearly all of them.
   *
   * THE ONE FACT THE PROTOCOL HAS NO PLACE FOR, which is why it is worth
   * reading off an agent's private channel at all. `session/new` takes a list
   * of servers and answers with a session id: whether the agent reached any of
   * them is never on the wire, and #140 could only ever report the failures
   * kolu's own probe found before handing anything over. An agent that
   * volunteers the other half is one whose panel can stop guessing.
   *
   * `null` — including on an agent that forwards messages but says nothing per
   * server — leaves every row where kolu put it, which is an honest "handed
   * over; nobody has said what became of it" rather than a claim in either
   * direction (`@kolu/acp-harness`'s `servers.ts`).
   */
  readonly serversIn: (params: unknown) => ReadonlyArray<Reported> | null;
}

/** A tool frame as needed for display; programmatic names take precedence. */
export interface MCPFrame {
  readonly title?: string | null | undefined;
  readonly rawInput?: unknown;
  readonly _meta?: Meta;
  readonly name?: string | null | undefined;
}

/** Display only; allowedWithoutAsking remains the approval rule. */
export const mcpCallBy =
  (spelling: (server: string) => string): Leg["mcpCall"] =>
  (frame, servers) => {
    const name = frame.name ?? frame.title;
    if (name == null) return null;
    for (const server of servers) {
      const prefix = spelling(server);
      if (name.startsWith(prefix) && name.length > prefix.length)
        return { server, tool: name.slice(prefix.length) };
    }
    return null;
  };

/**
 * The auto-allow rule, in one place, over the one thing that differs.
 *
 * POSITIVE RECOGNITION and nothing else: the tool is named, the name belongs to
 * one of the MCP servers WE handed this session, and the request offers an
 * allow-flavoured option — or a person is asked. What differs between agents is
 * only the SPELLING each gives the tools an MCP server contributes
 * (`mcp__<server>__<tool>` on one wire, `<server>_<tool>` on the other), so the
 * spelling is the argument and the rule is written once. Written twice, the one
 * rule this package declares un-widenable would have to be tightened twice —
 * and could silently be tightened once.
 *
 * ALLOW-FLAVOURED, NEVER FIRST, and that is the half that has to be shared:
 * opencode's options are allow-first (`allow_once`, `allow_always`,
 * `reject_once`) where the Claude adapter's ordinary list leads with the
 * refusal, so a client that took "the first option" would deny every one of
 * kolu's own tools on one wire and approve somebody's plan-mode exit on the
 * other. One rule, read off the option's own `kind`, is right on both.
 *
 * @param spelling what this agent calls the tools of the server named
 */
export const allowingOurs =
  (spelling: (server: string) => string): Leg["allowedWithoutAsking"] =>
  (tool, given, options) => {
    const ours =
      tool !== null &&
      given.some((server) => tool.startsWith(spelling(server)));
    if (!ours) return null;
    return (
      options.find((option) => option.kind.startsWith("allow"))?.optionId ??
      null
    );
  };

/** What a leg says about a call that SPAWNED an agent — structural rather than
 *  `@kolu/surface`'s `Spawned`, which is what the caller assigns it to:
 *  everything here is a pure function over a payload and none of them knows
 *  what a transcript is. */
export interface Spawn {
  readonly kind?: string;
  readonly said?: string;
}

/**
 * A harness-injected task-notification turn — not a person speaking.
 *
 * Claude Code stamps these `origin.kind: "task-notification"` and wraps the
 * subagent's report in `<task-notification>` XML. Either half is enough to
 * recognise one: the origin is the discriminator the session stream carries,
 * and the XML is what actually arrives on ACP when the adapter forwards the
 * injected user message. An agent that has no such turns answers `null`.
 *
 * THREE STATES, not two fields that happen to be empty. `null` from the
 * reader is a person speaking. `{ onto: null }` is still a notification —
 * it must not become a user bubble — but it named no spawning call or no
 * task, so it has no row to file the report under. `{ onto: { … } }` is
 * the one that files. Empty strings for the two ids would have been two
 * jobs whose combinations include a half-filed report.
 */
export type TaskNotice =
  | {
      readonly onto: {
        readonly toolUseId: string;
        readonly task: string;
        readonly report: string;
      };
    }
  | { readonly onto: null };

/**
 * ... and what it says about the BACKGROUND TASK a call armed — a monitor, a
 * background shell, an agent sent out to outlive this turn. Structural for
 * {@link Spawn}'s reason.
 *
 * `task` is the only field that is always there, because it is the only one
 * every frame about a task carries: the harness says everything else under
 * that id. The others are said by whichever frame knows them — the frame
 * that ARMS the call names the description it was armed with, the frame that
 * SETTLES it names how it ended, the task-notification that follows names
 * the report — so a leg answers about the frame in front of it and never
 * accumulates. Holding a row together across frames is
 * `@kolu/acp-harness`'s `transcript.ts`'s job and nobody else's.
 */
export interface Background {
  readonly task: string;
  readonly description?: string;
  readonly ended?: string;
  readonly report?: string;
}

/**
 * What one agent's answer to `session/list` says BEYOND the protocol's own
 * four fields, off an entry's own `_meta` corner: how many messages the
 * conversation holds, and which stored conversation was cleared to make it
 * (the picker's "superseded by" line).
 *
 * A corner that carries ONE of the two reads for both: the absent half is
 * `null`, because the reader returning no facts at all is one answer (the
 * agent's list has no corner) and a row that drew only the count is the
 * other. Both are the losing direction this can afford: the picker's row
 * says nothing for them.
 */
export interface ListedFacts {
  readonly messageCount: number | null;
  readonly supersededBy: string | null;
}

/**
 * What a leg says an agent reported about one of ITS OWN connections to an MCP
 * server.
 *
 * Here beside {@link Spawn} and for its reason: this is a payload reading, and
 * what `@kolu/acp-harness`'s `servers.ts` then makes of it — a roster row, a standing, a
 * sentence — is a fact about a conversation that no leg may know. Declared the
 * other way round, the file that is only allowed to be wrong about one agent
 * would have been importing the panel's own vocabulary.
 *
 * TWO FIELDS RATHER THAN THE STATUS ALONE, and the split is this interface's
 * whole point. WHICH WORD MEANS YES is true of one agent — the Claude Code
 * CLI spells it `connected` — so the leg answers it, exactly as it answers
 * which prefix names an MCP server's tools. Read one layer up instead, that
 * one CLI's vocabulary would be the leg-neutral roster's, and the second agent
 * to report per-server status would have to spell its own words the first
 * one's way or make the roster grow a branch per leg.
 *
 * POSITIVE RECOGNITION, the rule this file exists to keep: `attached` is true
 * only where the agent said the word its leg knows, and every other word — a
 * failure, a `needs-auth`, a word no version has sent yet — is false. The
 * losing direction is a working server drawn as one nobody confirmed; a tick
 * over tools that are not there is the direction no leg may fail in.
 */
export interface Reported {
  readonly name: string;
  /** Whether the AGENT says it has this server. */
  readonly attached: boolean;
  /**
   * ... and its own word for it, whatever that was.
   *
   * Carried verbatim, for the sentence a person reads when the answer is no:
   * the CLI's status is an open set (`failed`, `needs-auth`, `pending`,
   * `disabled` today) that grows on somebody else's release schedule, and a
   * reader can act on `needs-auth` — sign the server in — quite differently
   * from `failed`. Flattened into a category of ours, both become "it did not
   * work", which is the log line this whole feature exists to stop showing.
   */
  readonly said: string;
}

/**
 * One agent's answers.
 *
 * A leg is DATA about how to read a wire, not a strategy that acts: nothing
 * here spawns, sends or remembers. {@link ./engine.ts} is how one plugin hands
 * one over, `@kolu/acp-harness`'s `agents/roster.ts` says which of them this machine
 * can start, and its `agent.ts` does the talking.
 */
export interface Leg {
  /** Adapter prefix before an MCP tool name, or null when carried structurally. */
  readonly spelling: ((server: string) => string) | null;
  /** DISPLAY ONLY. Match a call against servers handed to this session;
   * allowedWithoutAsking remains the only approval rule. */
  readonly mcpCall: (
    frame: MCPFrame,
    servers: ReadonlyArray<string>,
  ) => { server: string; tool: string } | null;
  /** The adapter's structured reply; absent for prose or another output shape. */
  readonly replyIn: (rawOutput: unknown) => Record<string, unknown> | undefined;
  /** Native child-session and AIR async-task lifecycle streams. Opt in only
   * where the adapter implements these versioned extensions. */
  readonly nativeActivity?: boolean;
  /** Connection reports carried by ordinary session updates, where an adapter
   * exposes them. Display only: this must never grant tool permissions. */
  readonly serversInUpdate?: (
    update: unknown,
  ) => ReadonlyArray<Reported> | null;
  /** Advertise/read the terminal-output metadata extension. */
  readonly terminalOutput?: boolean;
  /**
   * Whether the title THIS frame carries is a PLACEHOLDER the adapter has not
   * refined yet — absent for an agent that names a call once and means it.
   *
   * ONE ADAPTER'S SHAPE, which is why it is a leg's answer rather than a rule
   * in the panel: the pinned Claude Code adapter announces a tool call the
   * moment the model starts emitting its arguments, so the frame carries
   * `rawInput: {}` and a title derived from nothing — a Bash call arrives as
   * the bare word "Terminal". The refining `tool_call_update` carries the real
   * one.
   *
   * WHAT IT CHANGES is the once-only naming rule and nothing else
   * (`@kolu/acp-harness`'s `transcript.ts`): a provisional title is SHOWN — a
   * nameless row while the arguments stream is worse — but it does not ANSWER
   * what the row is called, so the next titled frame names it and the rule
   * resumes. An agent that answers nothing keeps a name picked at its first
   * titled frame, which is deliberate for the adapters that rewrite a title
   * mid-call.
   *
   * Takes the whole update because the fact lives across two of its fields,
   * and a leg reading either alone would be answering a different question.
   */
  readonly provisionalTitle?: (update: unknown) => boolean;
  /**
   * The PROGRAMMATIC name of the tool, out of what a FRAME said — or `null`
   * when this agent says it somewhere else, or not at all.
   *
   * The question the fail-safe rule turns on, and the reason it is answered per
   * agent: `session/request_permission` describes the call it is about with a
   * DISPLAY title, and "which tool is this" is what the answer depends on. An
   * agent that answers neither this nor {@link Leg.toolNameOf} leaves every call
   * unnamed, and a call nobody named is a call a person is asked about.
   */
  readonly toolNameIn: (meta: Meta) => string | null;

  /**
   * ... and out of the CALL ID, for a wire that puts it there.
   *
   * TWO READERS RATHER THAN ONE over both, and the split is not cosmetic: what
   * a frame said has to be REMEMBERED, because the frame is gone by the time a
   * permission request asks about its call ({@link ../calls.ts}), and what the
   * ID says never does — the id is the key that question arrives under. Asked
   * as one function over both, an agent that names its tools in the id made
   * every frame of every call look like news, and the registry that exists to
   * hold the rare thing wrote and held one entry per call for the life of a
   * session.
   */
  readonly toolNameOf: (toolCallId: string) => string | null;

  /**
   * The option a permission request is answered with WITHOUT asking a person,
   * or `null` when it is a person's to answer.
   *
   * POSITIVE RECOGNITION, in every leg: the tool is named, the name is one of
   * the servers WE handed this session, and the request offers an
   * allow-flavoured option — or nothing is bypassed. What differs between legs
   * is only the SPELLING an agent gives the tools an MCP server contributes,
   * and a leg that matched more loosely than its agent's spelling would be
   * widening the one rule in this package that must not widen.
   *
   * @param tool the programmatic name of the tool, or `null` when nothing named
   *   it — a name we do not know is answered by ASKING
   * @param given the MCP servers this conversation was handed, by name
   * @param options the request's own options, in the agent's own order
   */
  readonly allowedWithoutAsking: (
    tool: string | null,
    given: ReadonlyArray<string>,
    options: ReadonlyArray<PermissionOption>,
  ) => string | null;

  /** The `Agent`/`Task` call a frame's own call was made INSIDE, or `null` for
   *  a call the main agent made itself. An agent that carries no attribution
   *  answers `null` for everything, and its fan-outs render flat — the losing
   *  direction this can afford. */
  readonly parentToolUse: (meta: Meta) => string | null;

  /** What this frame says about an agent this call STARTED, or `null` for a
   *  frame that says nothing about one — which is nearly all of them. */
  readonly spawned: (meta: Meta, input: unknown) => Spawn | null;

  /** ... and what it says about a BACKGROUND TASK this call armed, or `null`
   *  for a frame that says nothing about one — see {@link Background}. An agent
   *  whose wire carries no such fact answers `null` for everything, and its
   *  background work is drawn as it always was: a call that completed at the
   *  moment it started. */
  readonly backgroundTask: (meta: Meta) => Background | null;

  /**
   * Whether this chunk of a user message is a TASK-NOTIFICATION rather than
   * a person speaking — see {@link TaskNotice}.
   *
   * `null` is the losing direction this can afford: an unrecognised payload
   * is drawn as a user bubble, which is what the panel used to do with every
   * one of these. A false positive would swallow a message somebody typed.
   */
  readonly taskNotification: (text: string, meta: Meta) => TaskNotice | null;

  /**
   * The two facts a `session/list` entry carries about ITS conversation, off
   * the entry's `_meta` — see {@link ListedFacts}. An agent whose answer
   * carries no `_meta` corner answers `null` for everything, and its rows say
   * nothing.
   */
  readonly listedIn: (meta: Meta) => ListedFacts | null;

  /**
   * The text a session's OPEN says will ALSO arrive as one ordinary
   * `agent_message_chunk`, verbatim — or `null`.
   *
   * A reading of the open's RESPONSE (the `session/new` or `session/load`
   * answer), not of a frame. One adapter targets an editor with a startup
   * banner — a version number, an update nag — delivers it in the response's
   * own `_meta` for clients that draw such things, and then emits it into the
   * session as utterance so that clients that do not still show it. This panel
   * is the second kind, and drawing the double is not harmless where it looks
   * it: it is not conversation but arrives wearing conversation's clothes, and
   * a first turn that produced NOTHING but that banner is a turn the silence
   * notice may not be told was silent (`@kolu/acp-harness`'s `agent.ts`'s silence arm counts
   * every chunk that reaches it).
   *
   * So the caller drops the FIRST agent chunk equal to this text, once, and
   * arms the filter when the open is read rather than when the chunk lands —
   * the answer is awaited before the notification it precedes can be pulled
   * (one stream, responses first). Exact equality and nothing else: the string
   * is the adapter's own publishing of the very chunk it is about to send, and
   * a fuzzier match would be guessing at utterance. An agent whose open says
   * nothing here answers `null` and nothing is ever dropped — the losing
   * direction this can afford, which is also what a banner streamed in pieces
   * rather than sent as the one chunk it is today would fall back to.
   */
  readonly prologueIn: (opened: unknown) => string | null;

  /** The permission mode requested for every new or loaded session, or `null`
   *  to leave the adapter default unchanged (not configuration inheritance).
   *  Refusal behavior is declared separately by `bypassModeRequired`. */
  readonly bypassMode: string | null;

  /** Require successful mode selection before activating a session. Otherwise
   *  report a refusal and keep the adapter default and permission backstop.
   *  Omission preserves the nonfatal behavior of existing integrations. */
  readonly bypassModeRequired?: boolean;

  /** How a message reaches the turn ALREADY RUNNING, on purpose — or `null`
   *  for an agent with no such gesture. Never how an ordinary send is
   *  delivered, which is a plain prompt on every wire — see {@link Steering}. */
  readonly steering: Steering | null;

  /**
   * Whether this agent said, at `initialize`, that it HOLDS a prompt sent
   * while it is busy — behind the turn it is working on, to be run when that
   * turn is over.
   *
   * The bit the whole default rests on. Core ACP neither defines nor forbids a
   * mid-turn `session/prompt`, so "what happens if I send one now" is a fact
   * about the agent rather than about the protocol — which is what makes it
   * one of these rather than something `@kolu/acp-harness`'s `agent.ts` could work out.
   *
   * TAKES THE HANDSHAKE because one leg has an ADVERTISEMENT to read (the
   * pinned Claude Code adapter says `promptQueueing` in `agentCapabilities`)
   * and the other has a verified fact of its own (opencode answers one prompt
   * at a time, in order, 1.17.9). Both are the same kind of claim — this agent
   * holds what you send while it is busy — and a leg answers it however it
   * honestly can, which is this file's whole arrangement.
   *
   * WHAT IT DOES NOT GATE is the send. Every send is a plain prompt whatever
   * this says, because there is nothing else to do with a message somebody
   * typed and no client-side queue to put it in — that queue is exactly what
   * #194 deleted, for reasons that have not stopped being true. What it gates
   * is what the composer may PROMISE, before anybody presses anything: that a
   * message sent now waits its turn and is got to.
   *
   * The ROW's own *queued* mark is not this. That one is kolu's fact — this
   * message went out while a turn of ours was still running and nothing has
   * started on it — and it is drawn whoever the agent is.
   */
  readonly queues: (initialized: unknown) => boolean;

  /** The agent's own forwarded messages, or `null` for an agent that forwards
   *  none — see {@link RawMessages}. */
  readonly rawMessages: RawMessages | null;

  /** How to read this agent's MODEL PICKER, or `null` for one that has none —
   *  see {@link ModelReading}. */
  readonly models: ModelReading | null;
}

/**
 * HOW TO READ ONE AGENT'S MODEL PICKER — the two bets that used to sit in a
 * leg-neutral file with a paragraph apologising for them.
 *
 * ACP carries a session's settings as `configOptions`, a list of selects the
 * client may read and set, and every agent kolu talks to puts the model in one
 * of them. The MACHINERY of that — finding the entry, reading its labels,
 * asking for a value back — is the protocol's and stays in `@kolu/acp-harness`. What is
 * here is the part that is one adapter's spelling:
 *
 *   - **which entry is the model.** `SessionConfigId` is a free-form string and
 *     its one reserved hint (`category: "model"`) is documented as UX-only, so
 *     `"model"` is a BET. It is one every agent kolu ships happens to pay off,
 *     and an agent that spells its picker differently says so here and loses
 *     nothing but the model name in the header.
 *   - **what the picker's rows are called.** A picker offers ALIASES
 *     (`sonnet`, `opus[1m]`) where the live id an agent reports is the concrete
 *     API id (`claude-sonnet-5`), and bridging those two vocabularies is one
 *     CLI's arithmetic. An agent whose picker values ARE the ids it reports
 *     matches exactly and needs none of it, which is what {@link namedExactly}
 *     is.
 *
 * Both used to live in `agents/models.ts` under a note saying that keeping them
 * there was "the smaller lie" because a per-leg copy would be one rule written
 * twice. That was true while the legs were three files in one directory; it is
 * not true now that each is a plugin with its own release clock, and the lie
 * costs more than the copy: one CLI's alias table sat in the path every OTHER
 * agent's model name was read through.
 */
export interface ModelReading {
  /** WHICH `configOptions` entry is the model — read to find the picker, and
   *  written to as the `configId` of a `session/set_config_option` that moves
   *  it, so it is spelled once for both. */
  readonly config: string;
  /**
   * What the agent calls the model with this id, out of its OWN picker's
   * labels — or `null` when no row answers and the caller should say the id
   * raw.
   *
   * EXACT COMPARISONS ONLY, however many it makes, and every tier that could
   * answer twice answers `null` instead: what is decided here is a word on a
   * screen, and the raw id is the truthful thing to say about a question
   * nobody answered.
   */
  readonly nameIn: (
    labels: ReadonlyMap<string, string>,
    id: string,
  ) => string | null;
}

/** THE READING FOR AN AGENT WHOSE PICKER VALUES ARE THE IDS IT REPORTS: the
 *  label under that exact value, or nothing.
 *
 *  Written here rather than three times, because it is the DEFAULT rather than
 *  one agent's bet — a leg reaches for an arithmetic of its own only where its
 *  adapter's picker and its adapter's reports are two vocabularies. */
export const namedExactly = (
  labels: ReadonlyMap<string, string>,
  id: string,
): string | null => labels.get(id) ?? null;
