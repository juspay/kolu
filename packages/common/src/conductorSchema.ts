/**
 * THE CONDUCTOR'S WIRE VOCABULARY — one conversation over every host, as data.
 *
 * kolu-server holds ONE ACP conversation (the "Conductor"): a Claude session
 * whose hands are kolu's own MCP face lifted over the host map, which creates,
 * briefs, watches and answers the agents in the terminals of every host kolu
 * knows. What that conversation IS — its phase, its model, its transcript rows
 * — travels `koluSurface` to every reader, and this module is where those
 * shapes are declared.
 *
 * WHY HERE. `kolu-common` is the shared browser-safe half of kolu-server's
 * contract, and kolu-server is what hosts the conversation, so the shapes a
 * browser draws of it belong beside `koluSurface`. The protocol's own
 * vocabulary — the ask fields, the file diff, the usage pair — is NOT
 * re-declared: it is imported from `@kolu/acp/wire`, because the package that
 * speaks the foreign thing owns its words, and a second declaration of
 * `AskField` is a second thing to keep in step. That import is the one reason
 * this file names ACP at all; nothing here reads a protocol payload (that is
 * `@kolu/acp-harness`'s job) and nothing here touches `node:`.
 *
 * A TERMINAL IS NAMED `host/id`. One conversation reaches every host, so a
 * bare terminal id is ambiguous on this wire: a FLEET REF is the encoded host
 * key, a `/`, and the terminal id (`@kolu/kolu-mcp`'s `fleetTerminalRef`,
 * parsed at the LAST `/` because a remote target may contain one). The rows
 * that name a terminal carry the two halves SEPARATELY — `terminalId` keeps
 * its UUID check and `host` rides beside it — so a card can switch to the
 * host before it focuses the tile; only `ConductorState.fleet`, which is
 * pure membership, carries the joined ref.
 *
 * WHAT A ROW IS. A transcript row is keyed and UPSERTED, never appended twice:
 * a tool call arrives as `pending` and is refined by later frames, so the panel
 * updates one card instead of growing a column of five. `seq` is explicit so a
 * reader never has to depend on key order after a reconnect replays a snapshot.
 */

import {
  AskAnswer,
  AskField,
  AskLink,
  AuthAccount,
  AuthStatus,
  FileDiff,
  Usage,
  YES_NO,
} from "@kolu/acp/wire";
import { formatBytes, MIB } from "@kolu/byte-units";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

/** `YES_NO` is a VALUE, not a schema, and it is the one piece of this
 *  vocabulary both ends must spell identically: a boolean answer travels as
 *  the string `"true"` or `"false"`, and a panel that invented its own
 *  spelling would send the agent an answer it refuses. It rides here with the
 *  schemas so a consumer that has the contract has the agreement too — a
 *  browser never needs `@kolu/acp` itself. */
export {
  AskAnswer,
  AskField,
  AskLink,
  AuthAccount,
  AuthStatus,
  FileDiff,
  Usage,
  YES_NO,
};

// ── The rows ──────────────────────────────────────────────────────────────

/** Stable within a session, so a frame refines a row rather than duplicating
 *  it; `seq` is the conversation order the panel draws in; `since` is when the
 *  row was minted, stamped once by the writer so every reader's clock agrees. */
const rowHead = {
  id: Schema.String,
  seq: Schema.Int,
  since: Schema.String,
};

/** A terminal the message was ABOUT — what the composer was armed with when it
 *  was sent, resolved against the fleet at that moment.
 *
 *  A row of the conversation rather than a fact the browser keeps: what was
 *  sent is what kolu-server put here, so a reload still says which terminal
 *  the question was about, and the prompt that reached the agent carried
 *  exactly these fields as its structured reference block.
 *
 *  THE TWO HALVES OF THE IDENTITY ARE SEPARATE. `terminalId` stays the
 *  UUID-checked id a padi mints and `host` is the encoded host key it lives
 *  on; the server joins them into the `host/id` the agent is told. Re-typing
 *  `terminalId` to a ref string would drop the UUID check from every persisted
 *  user row for a fact that is only ever needed joined at one seam. */
export const ConductorMentionSchema = Schema.Struct({
  terminalId: TerminalIdSchema,
  /** Which host the terminal is on, encoded (`local` / `remote:<target>`) —
   *  the half that makes the id unambiguous on a fleet-wide wire. */
  host: Schema.String,
  /** The terminal's own name at send time — the word the human typed after
   *  `@`, kept verbatim so the chip and the prompt say the same thing. */
  name: Schema.String,
  intent: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
});
export type ConductorMention = typeof ConductorMentionSchema.Type;

/** What became of a message's DELIVERY, when it did not simply go.
 *
 *  Two values because there are exactly two things this end can honestly know.
 *  `refused` — the agent said no, or a cancel beat the prompt onto the wire;
 *  nothing took it, so *send again* sends it for the FIRST time. `unanswered` —
 *  it went out and nothing came back; an agent that took it and then went
 *  silent looks identical to one that never took it, so no retry is offered. */
export const ConductorDeliverySchema = Schema.Literals([
  "refused",
  "unanswered",
]);

/** A FILE THAT CAME WITH A MESSAGE — an image pasted into the composer, a
 *  log dropped onto the pane.
 *
 *  IT CARRIES NO BYTES, and that is the whole shape. The file is uploaded
 *  first, in frame-sized pieces, by {@link ConductorAttachInputSchema};
 *  what rides the prompt and the row afterwards is a REFERENCE to what
 *  kolu-server wrote. Base64 on the prompt frame is what this shape exists to
 *  prevent: a policy-legal 12 MiB of attachments is ~16.4 MiB encoded, the
 *  RPC decoder does not fail an oversized frame but CLOSES THE SOCKET with
 *  1009, and that takes every subscription in the tab with it — the incident,
 *  and the chunked answer to it, are written up at the top of
 *  `packages/client/src/terminal/pasteDelivery.ts`.
 *
 *  ONE SHAPE FOR EVERY LIFE, which is the second thing it buys. A row minted
 *  this session and a row restored from disk after a kolu-server restart are the
 *  same value, so "send again" on an hour-old message reads the same file the
 *  first send did. The thumbnail is the only thing that does not survive, and
 *  it was never on this wire: the browser keeps its own picture for the rows
 *  it minted, and every other reader draws the name and the size.
 *
 *  `bytes` is PADI'S number — what it actually wrote, measured from the file
 *  — never the sender's claim about it. */
export const ConductorAttachmentSchema = Schema.Struct({
  /** Stable within the prompt that carried it, and also the FILENAME under
   *  the attachments directory — so it is a plain name or it is refused; see
   *  kolu-server's `SAFE_ATTACHMENT_ID`. */
  id: Schema.String,
  /** What the person called it — a filename, or a minted one for a paste. */
  name: Schema.String,
  mimeType: Schema.String,
  /** Size on disk, as kolu-server measured it; the chip draws it and the per-prompt
   *  cap refuses on it. */
  bytes: Schema.Int,
  /** Absolute, under `<stateRoot>/conductor/attachments/`. The agent is
   *  handed this path and the harness reads the bytes off it. */
  path: Schema.String,
});
export type ConductorAttachment = typeof ConductorAttachmentSchema.Type;

/** How big ONE attachment may be, and how big a single prompt's worth may be
 *  together.
 *
 *  Two numbers rather than one because they refuse different mistakes: a
 *  screenshot of a 5K display is one file worth refusing on its own, and
 *  thirty small ones are a prompt worth refusing as a whole. The bytes land
 *  in kolu-server's state root, so the ceiling is the server's, not the browser's —
 *  which is why the numbers live on the contract both ends read rather than
 *  in either one. They are POLICY caps on a file, deliberately unrelated to
 *  the wire's frame cap: the upload is chunked, so how big an attachment may
 *  be and how much of it fits in one frame are independent numbers.
 *
 *  The agent is never told about a file that was refused. A silent drop would
 *  leave a person watching a conversation answer a question about an image it
 *  was never shown. */
export const ATTACHMENT_BYTE_CAP = 10 * MIB;
export const PROMPT_ATTACHMENT_BYTE_CAP = 20 * MIB;

/** The two refusals, spelled ONCE. The composer refuses before it sends and
 *  kolu-server refuses what reaches it anyway, and a person who sees both must not
 *  be reading two different rules. */
export const attachmentTooBig = (name: string, bytes: number): string =>
  `“${name}” is ${formatBytes(bytes)}, and one attachment may be at most ${formatBytes(ATTACHMENT_BYTE_CAP)}.`;

export const promptAttachmentsTooBig = (bytes: number): string =>
  `These attachments come to ${formatBytes(bytes)}, and one message may carry at most ${formatBytes(PROMPT_ATTACHMENT_BYTE_CAP)}. Send them across more than one message.`;

/** What a prompt naming a file kolu-server no longer holds is told. Reachable:
 *  an upload abandoned long enough to be swept, or a composer left open across
 *  a kolu-server restart. Said rather than silently dropped — a message that arrived
 *  without the screenshot it was about is worse than one that did not go. */
export const attachmentGone = (name: string): string =>
  `“${name}” is no longer on this host, so the message was not sent. Attach it again.`;

/** What a person typed. Never markdown — it is quoted, not rendered. */
export const ConductorUserRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("user"),
  text: Schema.String,
  mentions: Schema.optionalKey(Schema.Array(ConductorMentionSchema)),
  /** At the agent, next in line — this end sent a prompt while a turn of its
   *  own was still in flight. Absent once the agent takes it up; absent rather
   *  than `false`, because the writer only ever writes `true`. */
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(ConductorDeliverySchema),
  /** ...and why, on the one refusal with something to do about it: nobody is
   *  signed in. The panel offers the sign-in row rather than a bare retry. */
  auth: Schema.optionalKey(Schema.Literal(true)),
  /** What rode along with the words. A DECODING DEFAULT rather than an
   *  optional key, because this row is read back off `config.json` as well as
   *  off the wire: a transcript persisted before attachments existed has no
   *  such key, and the alternative to backfilling `[]` is a state-root that
   *  no longer decodes. The decoded row always carries the array, so no
   *  reader needs a second spelling for "none". */
  attachments: Schema.Array(ConductorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

/** The agent's prose, accumulated. Rendered as markdown. */
export const ConductorAgentRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("agent"),
  text: Schema.String,
  /** Absent rather than `false`: the writer only ever writes `true`, and a
   *  settled row carries no claim about a stream that has ended. */
  streaming: Schema.optionalKey(Schema.Literal(true)),
});

export const ConductorPlanStepSchema = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
  priority: Schema.NullOr(Schema.String),
});

/** The agent's execution plan. Each `plan` update REPLACES the whole thing, so
 *  this row is upserted at one key for the life of the session and an empty
 *  update removes it. */
export const ConductorPlanRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("plan"),
  steps: Schema.Array(ConductorPlanStepSchema),
});

export const ConductorToolStatusSchema = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

/** WHO the call is about — the one trio every arm carries, hoisted so a sixth
 *  reading cannot spell it a sixth time. `terminalId` and `host` are nullable
 *  TOGETHER, which is the rule the union below states; `name` is the
 *  terminal's own name and may be known without them (a create still in
 *  flight). Spread first in each arm, in this order, because the emitted
 *  field order is the wire's. */
const CALL_SUBJECT = {
  terminalId: Schema.NullOr(TerminalIdSchema),
  host: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
};

/**
 * THE KOLU READING of a tool call — the structured half the kolu-aware cards
 * draw from.
 *
 * A generic card can always be drawn from `text` + `detail`; this is what lets
 * a `lifecycle_create` card say *fix-parser · kolu/.worktrees/fix-parser ·
 * claude* with an "open tile" that actually opens one. It is minted by the
 * harness ONLY for a call it positively recognises as belonging to the `kolu`
 * MCP server we handed the session — a tool it cannot name gets no reading and
 * the generic card, which is the direction this is safe to fail in.
 *
 * EVERY ARM CARRIES `host` BESIDE `terminalId`, split out of the `host/id` the
 * fleet face spoke, because the two are used for different things: the host
 * decides which canvas the card's "open tile" switches to, the id decides
 * which tile it then focuses. Both are nullable together — a call the harness
 * read but whose ref it could not resolve says so rather than guessing a host.
 *
 * `terminalId` IS CHECKED HERE, not by the type: `TerminalIdSchema` is a UUID
 * check applied when the row is encoded, and TypeScript accepts any string in
 * its place. A row holding one that fails it does not encode — on the wire or
 * back off `config.json` — so the harness only ever writes an id that passed
 * `isTerminalId` first; a ref whose id half is anything else (a `watch_next`
 * subscription's name, a half-written argument) is read as no terminal.
 */
export const ConductorKoluCallSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    ...CALL_SUBJECT,
    /** Where it opened: the `cwd` asked for, or the worktree cut for it. */
    cwd: Schema.NullOr(Schema.String),
    /** The command the create typed at the first prompt (its `run`) —
     *  `claude`, typically, which is what names the agent it started. */
    agent: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("sendInput"),
    ...CALL_SUBJECT,
    /** Exactly one of the two is present, as the tool itself requires. */
    text: Schema.NullOr(Schema.String),
    key: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    /** `wait_outputSettled`, `wait_agentState`, `watch_next` — the three ways
     *  of waiting, which draw the same card: who, what state, how long, and
     *  the screen tail folded underneath. A `watch_next` card is about a
     *  terminal only when every event it drained was about that one. */
    kind: Schema.Literal("settle"),
    ...CALL_SUBJECT,
    /** What it stopped on: what fired, the agent state it was caught in, or
     *  the latest event's word — else the wait's own `result` (`timeout`). */
    state: Schema.NullOr(Schema.String),
    elapsedMs: Schema.NullOr(Schema.Int),
    screenTail: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("screen"),
    ...CALL_SUBJECT,
    snapshot: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    /** `agent_say` — words put to the agent in a terminal, NOW, with kolu
     *  doing the keystrokes that agent needs (idle or working). */
    kind: Schema.Literal("say"),
    ...CALL_SUBJECT,
    text: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    /** `watch_terminal` / `unwatch_terminal` — the Conductor adding a terminal
     *  to the list kolu wakes it about, or taking one off. */
    kind: Schema.Literal("watch"),
    ...CALL_SUBJECT,
    watching: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("kill"),
    ...CALL_SUBJECT,
  }),
]);
export type ConductorKoluCall = typeof ConductorKoluCallSchema.Type;

/** A background task the agent armed — a monitor, a `run_in_background` shell,
 *  an async subagent. It reports its launch and then LIVES, so its row stays
 *  live past the turn that made it and its death lands as a notice at the
 *  bottom of the transcript in the harness's own word. */
export const ConductorArmedSchema = Schema.Struct({
  task: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The harness's own ending word — `completed`, `failed`, `killed`,
   *  `stopped`. A monitor you stopped did not fail. */
  ended: Schema.NullOr(Schema.String),
  report: Schema.NullOr(Schema.String),
});

/** A subagent this call sent out: which kind, and what it was told to do. */
export const ConductorSpawnedSchema = Schema.Struct({
  kind: Schema.NullOr(Schema.String),
  said: Schema.NullOr(Schema.String),
});

export const ConductorToolRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("tool"),
  /** The agent's own title for the call. */
  text: Schema.String,
  status: ConductorToolStatusSchema,
  /** Which MCP server and tool, when the call could be positively named. */
  server: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  /** Folded JSON of the call's input and answer — the generic card's body. */
  detail: Schema.optionalKey(Schema.String),
  /** Live incremental content while the call runs. */
  progress: Schema.optionalKey(Schema.String),
  diffs: Schema.optionalKey(Schema.Array(FileDiff)),
  locations: Schema.optionalKey(Schema.Array(Schema.String)),
  kolu: Schema.optionalKey(ConductorKoluCallSchema),
  armed: Schema.optionalKey(ConductorArmedSchema),
  spawned: Schema.optionalKey(ConductorSpawnedSchema),
  /** The row of the subagent call this one was made INSIDE, by that row's own
   *  key — what makes a turn with several agents in it readable. */
  parent: Schema.optionalKey(Schema.String),
  /** Its turn ended and it never reported back. Background tasks are the one
   *  call kind exempt: they are SUPPOSED to outlive their turn. */
  stranded: Schema.optionalKey(Schema.Literal(true)),
  /** When the call started running, so a reader's clock and a reloaded tab's
   *  agree on "· 47s" rather than each starting its own stopwatch. */
  startedAt: Schema.optionalKey(Schema.String),
});

export const ConductorAskSchema = Schema.Struct({
  fields: Schema.Array(AskField),
  link: Schema.NullOr(AskLink),
  /** `null` while it waits. A question NEVER times out. */
  outcome: Schema.NullOr(
    Schema.Struct({
      how: Schema.Literals(["answered", "declined", "withdrawn"]),
      answers: Schema.Array(AskAnswer),
    }),
  ),
});

/** The agent asking a PERSON something — a permission request it was not
 *  allowed to answer for itself, an `AskUserQuestion` form, a URL to visit. */
export const ConductorAskRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("ask"),
  text: Schema.String,
  ask: ConductorAskSchema,
  parent: Schema.optionalKey(Schema.String),
});

/** The conversation reporting on itself: the agent died, a turn was cancelled,
 *  a session was loaded, a turn said nothing, a background task ended. */
export const ConductorNoticeRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("notice"),
  text: Schema.String,
});

/** `— new session —`. Drawn as a rule, not a sentence. */
export const ConductorDividerRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("divider"),
  text: Schema.String,
});

/** HOW A WATCHED TERMINAL STANDS when kolu wakes the Conductor about it.
 *
 *  Six values, and every one of them is a thing the Conductor can DO
 *  something about:
 *
 *  - `stopped` — the agent's turn ended and its output went quiet (padi's
 *    `finishedIds`).
 *  - `asking` — it is asking a person something (`awaitingIds`).
 *  - `gone` — the terminal left its host's roster while that host was
 *    answering.
 *  - `ready` — the agent in it has COME UP and nothing has been said to it
 *    yet. It rings INSTEAD of `stopped` the first time a never-spoken-to
 *    agent is idle, because a fresh agent sitting at its prompt is not a
 *    turn that ended: it is one that has not been given.
 *  - `asleep` — the terminal an agent was seen in was put to sleep, so that
 *    agent is gone with it. The entry stays watched: waking the terminal
 *    brings it back to the ordinary levels.
 *  - `ended` — a terminal the Conductor created WITH a command: the command
 *    ran and the terminal is back at its shell prompt with no agent ever
 *    seen in it. What kolu has to decide this is padi's foreground process
 *    and its agent detection, and NO exit status — so a command that fails
 *    before any non-shell foreground is sampled (`omp: command not found`,
 *    answered by the shell itself) does not ring at all.
 *
 *  Nothing else rings: an agent that is working, a plain shell nobody
 *  created with a command, a host that is merely not answering. */
export const ConductorWakeLevelSchema = Schema.Literals([
  "stopped",
  "asking",
  "gone",
  "ready",
  "asleep",
  "ended",
]);
export type ConductorWakeLevel = typeof ConductorWakeLevelSchema.Type;

/** One terminal's part of a wake — what a person sees when the line opens and
 *  what the agent's account is composed from. The ref is joined
 *  (`host/id`) because that is the name the agent acts on; `host` and
 *  `terminalId` ride beside it so a card can switch host before it focuses
 *  the tile, the rule {@link ConductorMentionSchema} states. */
export const ConductorWakeEventSchema = Schema.Struct({
  ref: Schema.String,
  host: Schema.String,
  terminalId: TerminalIdSchema,
  /** What a person calls the host — its hostname, or its ssh target. */
  hostName: Schema.String,
  /** The terminal's own name, as kolu last read it. */
  name: Schema.String,
  /** The agent kolu detected in it (`claude-code`, `codex`, …), or EMPTY for
   *  a terminal no agent was ever seen in — which is `ended` and nothing
   *  else: every other level is about an agent, so every other level names
   *  one. A reader draws the terminal alone rather than inventing a word for
   *  an agent that never existed. */
  agent: Schema.String,
  level: ConductorWakeLevelSchema,
  /** When kolu saw it enter this level. */
  at: Schema.String,
});
export type ConductorWakeEvent = typeof ConductorWakeEventSchema.Type;

/** A MACHINE'S LINE — kolu itself starting a Conductor turn, because a
 *  watched terminal's agent came up, stopped, asked, slept or died
 *  ({@link ConductorWakeLevelSchema}).
 *
 *  In the lane a prompt goes out on (it IS a prompt, to the agent), but never
 *  the human's bubble: it is drawn full width on the left, one line that
 *  opens for the rest, saying who speaks and when. `text` is exactly what the
 *  agent was handed — the whole account, opening with who wrote it, because a
 *  resumed conversation is rebuilt from the agent's own store, which carries
 *  the words and not this row's mark. No *send again*: what it says is how
 *  something STOOD when it rang, and the thing that rang rings again.
 *
 *  `queued` and `delivery` are the user row's own two facts, because a turn
 *  kolu started is a turn like any other — it can wait behind one, be
 *  refused, or go unanswered. */
export const ConductorWakeRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("wake"),
  /** Who speaks — `kolu`. */
  from: Schema.String,
  /** Every terminal this turn is about, one each, in the order they rang. */
  events: Schema.Array(ConductorWakeEventSchema),
  text: Schema.String,
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(ConductorDeliverySchema),
});
export type ConductorWakeRow = typeof ConductorWakeRowSchema.Type;

export const ConductorRowSchema = Schema.Union([
  ConductorUserRowSchema,
  ConductorAgentRowSchema,
  ConductorPlanRowSchema,
  ConductorToolRowSchema,
  ConductorAskRowSchema,
  ConductorNoticeRowSchema,
  ConductorDividerRowSchema,
  ConductorWakeRowSchema,
]);
export type ConductorRow = typeof ConductorRowSchema.Type;
export type ConductorToolRow = typeof ConductorToolRowSchema.Type;
export type ConductorUserRow = typeof ConductorUserRowSchema.Type;
export type ConductorAskRow = typeof ConductorAskRowSchema.Type;

/** A PIECE of streaming prose appended to a row — never the text so far, so a
 *  turn that runs for a minute does not re-send its own paragraph per tick. */
export const ConductorSayingSchema = Schema.Struct({
  of: Schema.String,
  at: Schema.Int,
  text: Schema.String,
});

/** The OFFSET RULE, written once for both folds.
 *
 *  `at` is AUTHORITATIVE: a piece that was delivered twice starts at an offset
 *  the row already covers, and truncating to `at` before appending makes the
 *  re-send a no-op instead of a stutter. A piece that starts PAST the end — a
 *  frame went missing — is appended at the end rather than padded with invented
 *  characters; the next snapshot is what fixes that. Two readers doing this
 *  arithmetic two ways is two different transcripts, and one of them is the one
 *  kolu-server writes to disk. */
export const appendedText = (
  current: string,
  at: number,
  text: string,
): string => current.slice(0, Math.min(at, current.length)) + text;

/**
 * SNAPSHOT-THEN-DELTAS, explicitly discriminated.
 *
 * The framework's retry fence re-runs a dropped stream from the top, so the
 * first frame after a reconnect must be a full replacement a reducer can
 * assign over its accumulator. A reader that appended an implicit replay into
 * an already-populated map would double every row — which is exactly why the
 * discriminant is on the wire rather than agreed by convention.
 *
 * A delta is folded in ONE order, and both folds (the server's `applyRows`, the
 * client's `transcript.ts`) obey it: **removes, then upserts, then appends.**
 * The order is load-bearing in both directions. Removes first means a frame
 * that drops a row and re-upserts the same id is a REPLACEMENT rather than a
 * row deleted after it was rewritten; appends last means text that arrives in
 * the same frame as the row it belongs to lands on the row that frame just
 * put there, instead of on the row it replaced. Two readers folding the same
 * frame in two orders is two different transcripts, and the wire has nothing
 * in it that would ever reveal the disagreement.
 */
export const ConductorFrameSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    seq: Schema.Int,
    rows: Schema.Array(ConductorRowSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("delta"),
    seq: Schema.Int,
    upserts: Schema.Array(ConductorRowSchema),
    removes: Schema.Array(Schema.String),
    appends: Schema.Array(ConductorSayingSchema),
  }),
]);
export type ConductorFrame = typeof ConductorFrameSchema.Type;

// ── The cell ──────────────────────────────────────────────────────────────

/**
 * WHETHER THERE IS AN CONDUCTOR HERE AT ALL.
 *
 * The ACP adapter is baked into kolu's closure, so `absent` is not a
 * degradation anything works around: the panel shows the sentence whoever
 * found out wrote, and there is no fallback path. `why` is a WHOLE SENTENCE
 * and nothing composes around it.
 */
export const ConductorInstallSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("installed") }),
  Schema.Struct({
    kind: Schema.Literal("absent"),
    name: Schema.String,
    where: Schema.NullOr(Schema.String),
    why: Schema.String,
  }),
]);

/**
 * WHAT THE CONVERSATION IS DOING, in the one word the header chip paints.
 *
 * `asking` outranks `working`: a turn stopped on a form is blocked on a HUMAN,
 * and that is the state the violet badge counts. `starting` covers the whole
 * of the open — a subprocess, a handshake, and a replay — because the composer
 * is not locked during it and a person who typed needs to know where it went.
 */
export const ConductorPhaseSchema = Schema.Literals([
  "offline",
  "starting",
  "idle",
  "working",
  "asking",
]);
export type ConductorPhase = typeof ConductorPhaseSchema.Type;

/** The model the conversation is on, named the way the agent names it. A
 *  `window` of `null` is a refusal rather than a failure: the running model
 *  does not always state its context window, and naming one five times the
 *  real size in the line you would read to decide whether to `/compact` is
 *  worse than naming nothing. */
export const ConductorModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  window: Schema.NullOr(Schema.Int),
});

/** One adapter-advertised session setting — reasoning effort, permission mode,
 *  a boolean such as fast mode. The control uses the ADAPTER'S own name and
 *  values; kolu composes neither. */
export const ConductorOptionSchema = Schema.Struct({
  id: Schema.String,
  /**
   * WHICH CONTROL THIS ROW IS, decided by the harness that read the adapter
   * and never re-derived by the panel.
   *
   * `"model"` — the agent's model picker, the row whose id its leg names as
   * the model config. It is BOTH the header's reading and a control, which is
   * the distinction this field exists to keep: a panel that recognised the
   * model row only by consuming it into the header drew every section except
   * the one a person opened the popover for. Drawn first, because choosing a
   * model is the thing people come here to do.
   *
   * `"boolean"` — an on/off setting (fast mode). It arrives with NO choices,
   * so a panel that only knows how to draw a list of them renders a heading
   * with nothing under it; a toggle on one line is the whole control.
   *
   * `"choice"` — everything else: reasoning effort, permission mode. A list
   * of the adapter's own values, one of them current.
   */
  kind: Schema.Literals(["model", "choice", "boolean"]),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The confirmed value. A refused change leaves this where it was. */
  value: Schema.NullOr(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      value: Schema.String,
      label: Schema.String,
      /** The context window, for a model row. `null` everywhere else. */
      hint: Schema.NullOr(Schema.String),
    }),
  ),
});

/** A slash command the agent advertises. */
export const ConductorCommandSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});

/** Where one MCP server in this conversation stands.
 *
 *  Three standings and they are not interchangeable: `connected` is the
 *  AGENT'S own word, `handed` is what kolu gave over and the agent has not
 *  spoken about, and `unattached` quotes what the agent said instead. A server
 *  the agent names that kolu never handed adds NO row — the strip says "plus
 *  the agent's own" rather than inventing one.
 *
 *  THERE IS NO `missing`, and its absence is the fail-fast rule showing
 *  through. A fourth standing would mean "kolu's own MCP server could not be
 *  found, carry on without it" — but kolu-server refuses the whole
 *  conversation when the fleet MCP endpoint is not answering
 *  (`ConductorUnavailable`), because a conductor that cannot reach the
 *  fleet is not a degraded conductor, it is a chat window. So no row can
 *  ever reach that standing, and a value nothing can mint is a case the panel
 *  would be pretending to have.
 */
export const ConductorServerSchema = Schema.Struct({
  name: Schema.String,
  standing: Schema.Literals(["connected", "handed", "unattached"]),
  /** The agent's own sentence about this server, carried verbatim. */
  said: Schema.NullOr(Schema.String),
  where: Schema.NullOr(Schema.String),
});

/** Something still out when the turn that started it has ended — a background
 *  task, or a subagent. Drawn on the strip above the scroll, because the row
 *  itself may be an hour of scrollback away. */
export const ConductorWatchingSchema = Schema.Struct({
  row: Schema.String,
  kind: Schema.Literals(["agent", "task"]),
  name: Schema.String,
  since: Schema.String,
});

export const ConductorAuthMethodSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** Who RUNS it. `terminal` — the adapter handed over a command line and kolu
   *  spawns it, streaming its output into the row. `agent` — the agent runs it
   *  and kolu's part is a page to visit. */
  runs: Schema.Literals(["client", "agent"]),
});

/** One sign-in per agent: a second press on the same method ATTACHES to the
 *  attempt already running rather than starting a second process. */
export const ConductorSignInSchema = Schema.Struct({
  /** The agent's own refusal, in its own words. */
  why: Schema.String,
  methods: Schema.Array(ConductorAuthMethodSchema),
  attempt: Schema.NullOr(
    Schema.Struct({
      method: Schema.String,
      state: Schema.Literals(["running", "succeeded", "failed"]),
      /** The spawned command's output so far, capped — URLs in it are made
       *  clickable by the panel. */
      output: Schema.String,
      link: Schema.NullOr(AskLink),
    }),
  ),
});

export const ConductorStateSchema = Schema.Struct({
  install: ConductorInstallSchema,
  phase: ConductorPhaseSchema,
  /** What the agent is called — "Claude Code". The panel never spells it. */
  agentName: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  /** `$HOME` of the machine kolu-server runs on: the directory the
   *  conversation works in. */
  cwd: Schema.String,
  model: Schema.NullOr(ConductorModelSchema),
  /** The agent's own number, newest wins. `null` means the agent reported
   *  nothing, which is different from a conversation that has spent nothing
   *  (`{used: 0, size: 200000}`). */
  usage: Schema.NullOr(Usage),
  options: Schema.Array(ConductorOptionSchema),
  commands: Schema.Array(ConductorCommandSchema),
  servers: Schema.Array(ConductorServerSchema),
  watching: Schema.Array(ConductorWatchingSchema),
  /** The ids of the ask rows still waiting on a human. The violet badge is
   *  this list's length — no separate count on the wire, because a count that
   *  can disagree is a second source of truth. */
  openAsks: Schema.Array(Schema.String),
  /** Every terminal this conductor has created or sent input to, as FLEET
   *  REFS (`<encodedHostKey>/<terminalId>`) — one conversation spans every
   *  host, so a bare id here would name two terminals on a two-host fleet.
   *  Live state for each is read from that host's `terminals` collection,
   *  never remembered here — this is membership, not a mirror. */
  fleet: Schema.Array(Schema.String),
  signIn: Schema.NullOr(ConductorSignInSchema),
  /** WHO the agent process is signed in as, as the agent itself reports it
   *  (`_auth/status_update`). CONNECTION-scoped, not session-scoped: it
   *  belongs to the subprocess, so it survives a `newSession`.
   *
   *  SILENCE IS NOT LOGGED OUT. `null` means the agent said nothing — the
   *  header draws no account chip at all; a KNOWN logged-out state arrives as
   *  a payload of its own (`kind: "none"`) and the chip says so. */
  identity: Schema.NullOr(AuthStatus),
  /** A conversation the agent would not OPEN, in the agent's own words. There
   *  is no composer under this and the panel offers *try again*, which asks
   *  for the same thing that was refused. */
  refusal: Schema.NullOr(Schema.String),
  /** Whether a message may be STEERED into the turn that is running (Alt+Enter)
   *  — BOTH halves in one bit, so the composer derives nothing: the agent's leg
   *  advertised steering at the handshake, AND this conversation has never
   *  held a message behind a running turn. The second half is a guard around
   *  the pinned adapter's defect (a steer into a session that has ever queued
   *  never settles its turn), brought over from olai with its measurement;
   *  a new session gets it back. */
  steers: Schema.Boolean,
  /** When the turn in flight began, or `null` while nothing is running — so
   *  every reader's "working · 2m" counts from the same instant. */
  busySince: Schema.NullOr(Schema.String),
  /** The terminals kolu wakes the Conductor about, as FLEET REFS, in the
   *  order they were added. Membership only, like `fleet`: a terminal's name,
   *  agent and state are read from its host's `terminals` collection. Saved
   *  with the conversation. */
  watched: Schema.Array(Schema.String),
  /** THE PIECES OF WORK in flight: the watched terminals grouped by the
   *  top-level terminal their parent edges end at.
   *
   *  One group is one piece of work — a planner and the implementor it split
   *  off are one thing going on, not two — and the count of these is what the
   *  Conductor tab badges. DERIVED, by kolu's own watch (`kolu-conductor`'s
   *  `workOf`), from the readings the watcher already takes of every watched
   *  terminal's host: a browser cannot walk the parent edges of a terminal on
   *  a host it never opened, and a host that is AWAY has no edges to walk at
   *  all — only the server's remembered entries carry the last-known group
   *  across that.
   *
   *  Groups are in the order their first member joined the watch list, and so
   *  are the refs inside one. A watched terminal whose root is not known yet
   *  (nothing has read its host since it joined) is its own group. */
  work: Schema.Array(
    Schema.Struct({
      /** The fleet ref of the top-level terminal the group hangs off — the
       *  terminal itself, when it has no parent. */
      root: Schema.String,
      /** What that terminal was last called, or EMPTY when nothing is known:
       *  the same `intent ?? branch` rule every other watch reading uses. */
      name: Schema.String,
      /** The watched refs in this group, in watch order. */
      refs: Schema.Array(Schema.String),
      /** WHEN THIS PIECE OF WORK STARTED — the ISO time its FIRST terminal
       *  joined the watch list, which is the earliest `since` of the entries
       *  in it. kolu knows no other beginning: a waterfall is not declared
       *  anywhere, and the moment the conversation started watching is the
       *  moment it became work in flight. Saved with the entry, so the
       *  duration a panel counts from it survives a restart. */
      since: Schema.String,
    }),
  ),
  /** The watched terminals whose news is HELD because a turn is running — one
   *  per terminal, in the order the first of each rang. NEVER saved: a
   *  restart looks at every watched terminal again instead. The status line's
   *  "N waiting" is this list's length. */
  held: Schema.Array(Schema.String),
});
export type ConductorState = typeof ConductorStateSchema.Type;

export const DEFAULT_CONDUCTOR_STATE: ConductorState = {
  install: { kind: "installed" },
  phase: "offline",
  agentName: "Claude Code",
  sessionId: null,
  cwd: "",
  model: null,
  usage: null,
  options: [],
  commands: [],
  servers: [],
  watching: [],
  openAsks: [],
  fleet: [],
  signIn: null,
  identity: null,
  refusal: null,
  steers: false,
  busySince: null,
  watched: [],
  work: [],
  held: [],
};

// ── Procedure I/O ─────────────────────────────────────────────────────────

export const ConductorPromptInputSchema = Schema.Struct({
  text: Schema.String,
  mentions: Schema.Array(ConductorMentionSchema),
  /** The files that ride with the words — NAMES, not bytes. Each was already
   *  uploaded by `conductor.attach`, so what kolu-server does here is look
   *  each one up under its own attachments directory, measure it, and hand the
   *  agent a path. A decoding default so a browser served by an earlier
   *  build, which omits the key entirely, still sends a prompt rather than
   *  being refused by the decoder for having nothing to attach. */
  attachments: Schema.Array(ConductorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  /** STEER rather than queue: put the words INTO the turn that is running
   *  (Alt+Enter). Honoured only while a turn runs and `steers` holds; a steer
   *  the agent did not take — the turn ended under it — goes out as a plain
   *  prompt, so the words are never lost. A decoding default so an older
   *  browser's prompt is an ordinary one. */
  steer: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
});

export const ConductorPromptOutputSchema = Schema.Struct({
  /** The transcript row the words landed in, so the composer can follow its
   *  delivery without guessing which row is its own. */
  rowId: Schema.String,
});

/** ONE PIECE of a file on its way up — the chunked upload that keeps base64
 *  off the prompt frame.
 *
 *  The first call for an id omits `appendTo` and CREATES the file; each later
 *  one passes back the `path` it was handed and APPENDS. The sender cuts the
 *  base64 with `chunkBase64` and refuses ahead of the first call with
 *  `frameBytesFor` + `exceedsFrameLimit` (`@kolu/surface/frame-chunking`,
 *  `@kolu/surface/frame-limit`) — the same arithmetic a terminal paste rides,
 *  derived once and never twice.
 *
 *  STRICTLY SEQUENTIAL. kolu-server appends to one growing file, so two chunks
 *  of the same attachment in flight at once interleave and corrupt it silently;
 *  a sender awaits each call before making the next. */
export const ConductorAttachInputSchema = Schema.Struct({
  /** The attachment id, which is also the filename kolu-server writes under —
   *  so it must be a plain name, and `..` is refused rather than repaired. */
  id: Schema.String,
  /** What the person called it. Carried per chunk because it is what the
   *  refusals are said about, and a refusal naming an id is not a sentence. */
  name: Schema.String,
  mimeType: Schema.String,
  /** This chunk's bytes, base64. Boundaries are 4-character-aligned so each
   *  chunk decodes on its own (see `chunkBase64`). */
  data: Schema.String,
  /** Absent on the FIRST chunk: create the file. Present on every later one:
   *  the path the previous call returned. It is VALIDATED, not trusted — a
   *  path that resolves outside the attachments directory is a refusal, not a
   *  write, because a trusted continuation token turns an upload into an
   *  arbitrary-file append. */
  appendTo: Schema.optionalKey(Schema.String),
});

export const ConductorAttachOutputSchema = Schema.Struct({
  /** Where the bytes landed — handed straight back as the next chunk's
   *  `appendTo`, and the `path` the finished attachment carries. */
  path: Schema.String,
  /** The file's size on disk AFTER this chunk, measured rather than summed
   *  from what the sender said it was sending. */
  bytes: Schema.Int,
});

export const ConductorAnswerInputSchema = Schema.Struct({
  askId: Schema.String,
  /** `null` DECLINES — the agent is told you would not say, never handed a
   *  choice you did not make. */
  answers: Schema.NullOr(Schema.Array(AskAnswer)),
});

export const ConductorAnswerOutputSchema = Schema.Struct({
  /** `false` when somebody else already answered it — a reported state in a
   *  two-tab world, not a fault. */
  settled: Schema.Boolean,
});

export const ConductorSignInInputSchema = Schema.Struct({
  method: Schema.String,
});

export const ConductorSignInOutputSchema = Schema.Struct({
  outcome: Schema.Literals(["signed-in", "failed", "cancelled", "attached"]),
});

export const ConductorSetOptionInputSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.String,
});

export const ConductorTextInputSchema = Schema.Struct({
  text: Schema.String,
});

export const ConductorEmptySchema = Schema.Struct({});
