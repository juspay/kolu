/**
 * THE ORCHESTRATOR'S WIRE VOCABULARY — one conversation over every host, as data.
 *
 * kolu-server holds ONE ACP conversation (the "Orchestrator"): a Claude session
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
 * its UUID brand and `host` rides beside it — so a card can switch to the
 * host before it focuses the tile; only `OrchestratorState.fleet`, which is
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
 *  THE TWO HALVES OF THE IDENTITY ARE SEPARATE. `terminalId` stays the branded
 *  UUID a padi mints and `host` is the encoded host key it lives on; the
 *  server joins them into the `host/id` the agent is told. Re-typing
 *  `terminalId` to a ref string would unbrand every persisted user row for a
 *  fact that is only ever needed joined at one seam. */
export const OrchestratorMentionSchema = Schema.Struct({
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
export type OrchestratorMention = typeof OrchestratorMentionSchema.Type;

/** What became of a message's DELIVERY, when it did not simply go.
 *
 *  Two values because there are exactly two things this end can honestly know.
 *  `refused` — the agent said no, or a cancel beat the prompt onto the wire;
 *  nothing took it, so *send again* sends it for the FIRST time. `unanswered` —
 *  it went out and nothing came back; an agent that took it and then went
 *  silent looks identical to one that never took it, so no retry is offered. */
export const OrchestratorDeliverySchema = Schema.Literals([
  "refused",
  "unanswered",
]);

/** A FILE THAT CAME WITH A MESSAGE — an image pasted into the composer, a
 *  log dropped onto the pane.
 *
 *  IT CARRIES NO BYTES, and that is the whole shape. The file is uploaded
 *  first, in frame-sized pieces, by {@link OrchestratorAttachInputSchema};
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
export const OrchestratorAttachmentSchema = Schema.Struct({
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
  /** Absolute, under `<stateRoot>/orchestrator/attachments/`. The agent is
   *  handed this path and the harness reads the bytes off it. */
  path: Schema.String,
});
export type OrchestratorAttachment = typeof OrchestratorAttachmentSchema.Type;

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
export const OrchestratorUserRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("user"),
  text: Schema.String,
  mentions: Schema.optionalKey(Schema.Array(OrchestratorMentionSchema)),
  /** At the agent, next in line — this end sent a prompt while a turn of its
   *  own was still in flight. Absent once the agent takes it up; absent rather
   *  than `false`, because the writer only ever writes `true`. */
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(OrchestratorDeliverySchema),
  /** ...and why, on the one refusal with something to do about it: nobody is
   *  signed in. The panel offers the sign-in row rather than a bare retry. */
  auth: Schema.optionalKey(Schema.Literal(true)),
  /** What rode along with the words. A DECODING DEFAULT rather than an
   *  optional key, because this row is read back off `config.json` as well as
   *  off the wire: a transcript persisted before attachments existed has no
   *  such key, and the alternative to backfilling `[]` is a state-root that
   *  no longer decodes. The decoded row always carries the array, so no
   *  reader needs a second spelling for "none". */
  attachments: Schema.Array(OrchestratorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

/** The agent's prose, accumulated. Rendered as markdown. */
export const OrchestratorAgentRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("agent"),
  text: Schema.String,
  /** Absent rather than `false`: the writer only ever writes `true`, and a
   *  settled row carries no claim about a stream that has ended. */
  streaming: Schema.optionalKey(Schema.Literal(true)),
});

export const OrchestratorPlanStepSchema = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
  priority: Schema.NullOr(Schema.String),
});

/** The agent's execution plan. Each `plan` update REPLACES the whole thing, so
 *  this row is upserted at one key for the life of the session and an empty
 *  update removes it. */
export const OrchestratorPlanRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("plan"),
  steps: Schema.Array(OrchestratorPlanStepSchema),
});

export const OrchestratorToolStatusSchema = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

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
 */
export const OrchestratorKoluCallSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    terminalId: Schema.NullOr(TerminalIdSchema),
    host: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    cwd: Schema.NullOr(Schema.String),
    agent: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("sendInput"),
    terminalId: Schema.NullOr(TerminalIdSchema),
    host: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    /** Exactly one of the two is present, as the tool itself requires. */
    text: Schema.NullOr(Schema.String),
    key: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    /** `wait_outputSettled`, `wait_agentState`, `watch_next` — the three ways
     *  of waiting, which draw the same card: who, what state, how long, and
     *  the screen tail folded underneath. */
    kind: Schema.Literal("settle"),
    terminalId: Schema.NullOr(TerminalIdSchema),
    host: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    state: Schema.NullOr(Schema.String),
    elapsedMs: Schema.NullOr(Schema.Int),
    screenTail: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("screen"),
    terminalId: Schema.NullOr(TerminalIdSchema),
    host: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    snapshot: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("kill"),
    terminalId: Schema.NullOr(TerminalIdSchema),
    host: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
  }),
]);
export type OrchestratorKoluCall = typeof OrchestratorKoluCallSchema.Type;

/** A background task the agent armed — a monitor, a `run_in_background` shell,
 *  an async subagent. It reports its launch and then LIVES, so its row stays
 *  live past the turn that made it and its death lands as a notice at the
 *  bottom of the transcript in the harness's own word. */
export const OrchestratorArmedSchema = Schema.Struct({
  task: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The harness's own ending word — `completed`, `failed`, `killed`,
   *  `stopped`. A monitor you stopped did not fail. */
  ended: Schema.NullOr(Schema.String),
  report: Schema.NullOr(Schema.String),
});

/** A subagent this call sent out: which kind, and what it was told to do. */
export const OrchestratorSpawnedSchema = Schema.Struct({
  kind: Schema.NullOr(Schema.String),
  said: Schema.NullOr(Schema.String),
});

export const OrchestratorToolRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("tool"),
  /** The agent's own title for the call. */
  text: Schema.String,
  status: OrchestratorToolStatusSchema,
  /** Which MCP server and tool, when the call could be positively named. */
  server: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  /** Folded JSON of the call's input and answer — the generic card's body. */
  detail: Schema.optionalKey(Schema.String),
  /** Live incremental content while the call runs. */
  progress: Schema.optionalKey(Schema.String),
  diffs: Schema.optionalKey(Schema.Array(FileDiff)),
  locations: Schema.optionalKey(Schema.Array(Schema.String)),
  kolu: Schema.optionalKey(OrchestratorKoluCallSchema),
  armed: Schema.optionalKey(OrchestratorArmedSchema),
  spawned: Schema.optionalKey(OrchestratorSpawnedSchema),
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

export const OrchestratorAskSchema = Schema.Struct({
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
export const OrchestratorAskRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("ask"),
  text: Schema.String,
  ask: OrchestratorAskSchema,
  parent: Schema.optionalKey(Schema.String),
});

/** The conversation reporting on itself: the agent died, a turn was cancelled,
 *  a session was loaded, a turn said nothing, a background task ended. */
export const OrchestratorNoticeRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("notice"),
  text: Schema.String,
});

/** `— new session —`. Drawn as a rule, not a sentence. */
export const OrchestratorDividerRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("divider"),
  text: Schema.String,
});

export const OrchestratorRowSchema = Schema.Union([
  OrchestratorUserRowSchema,
  OrchestratorAgentRowSchema,
  OrchestratorPlanRowSchema,
  OrchestratorToolRowSchema,
  OrchestratorAskRowSchema,
  OrchestratorNoticeRowSchema,
  OrchestratorDividerRowSchema,
]);
export type OrchestratorRow = typeof OrchestratorRowSchema.Type;
export type OrchestratorToolRow = typeof OrchestratorToolRowSchema.Type;
export type OrchestratorUserRow = typeof OrchestratorUserRowSchema.Type;
export type OrchestratorAskRow = typeof OrchestratorAskRowSchema.Type;

/** A PIECE of streaming prose appended to a row — never the text so far, so a
 *  turn that runs for a minute does not re-send its own paragraph per tick. */
export const OrchestratorSayingSchema = Schema.Struct({
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
export const OrchestratorFrameSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    seq: Schema.Int,
    rows: Schema.Array(OrchestratorRowSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("delta"),
    seq: Schema.Int,
    upserts: Schema.Array(OrchestratorRowSchema),
    removes: Schema.Array(Schema.String),
    appends: Schema.Array(OrchestratorSayingSchema),
  }),
]);
export type OrchestratorFrame = typeof OrchestratorFrameSchema.Type;

// ── The cell ──────────────────────────────────────────────────────────────

/**
 * WHETHER THERE IS AN ORCHESTRATOR HERE AT ALL.
 *
 * The ACP adapter is baked into kolu's closure, so `absent` is not a
 * degradation anything works around: the panel shows the sentence whoever
 * found out wrote, and there is no fallback path. `why` is a WHOLE SENTENCE
 * and nothing composes around it.
 */
export const OrchestratorInstallSchema = Schema.Union([
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
export const OrchestratorPhaseSchema = Schema.Literals([
  "offline",
  "starting",
  "idle",
  "working",
  "asking",
]);
export type OrchestratorPhase = typeof OrchestratorPhaseSchema.Type;

/** The model the conversation is on, named the way the agent names it. A
 *  `window` of `null` is a refusal rather than a failure: the running model
 *  does not always state its context window, and naming one five times the
 *  real size in the line you would read to decide whether to `/compact` is
 *  worse than naming nothing. */
export const OrchestratorModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  window: Schema.NullOr(Schema.Int),
});

/** One adapter-advertised session setting — reasoning effort, permission mode,
 *  a boolean such as fast mode. The control uses the ADAPTER'S own name and
 *  values; kolu composes neither. */
export const OrchestratorOptionSchema = Schema.Struct({
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
export const OrchestratorCommandSchema = Schema.Struct({
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
 *  (`OrchestratorUnavailable`), because an orchestrator that cannot reach the
 *  fleet is not a degraded orchestrator, it is a chat window. So no row can
 *  ever reach that standing, and a value nothing can mint is a case the panel
 *  would be pretending to have.
 */
export const OrchestratorServerSchema = Schema.Struct({
  name: Schema.String,
  standing: Schema.Literals(["connected", "handed", "unattached"]),
  /** The agent's own sentence about this server, carried verbatim. */
  said: Schema.NullOr(Schema.String),
  where: Schema.NullOr(Schema.String),
});

/** Something still out when the turn that started it has ended — a background
 *  task, or a subagent. Drawn on the strip above the scroll, because the row
 *  itself may be an hour of scrollback away. */
export const OrchestratorWatchingSchema = Schema.Struct({
  row: Schema.String,
  kind: Schema.Literals(["agent", "task"]),
  name: Schema.String,
  since: Schema.String,
});

export const OrchestratorAuthMethodSchema = Schema.Struct({
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
export const OrchestratorSignInSchema = Schema.Struct({
  /** The agent's own refusal, in its own words. */
  why: Schema.String,
  methods: Schema.Array(OrchestratorAuthMethodSchema),
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

export const OrchestratorStateSchema = Schema.Struct({
  install: OrchestratorInstallSchema,
  phase: OrchestratorPhaseSchema,
  /** What the agent is called — "Claude Code". The panel never spells it. */
  agentName: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  /** `$HOME` of the machine kolu-server runs on: the directory the
   *  conversation works in. */
  cwd: Schema.String,
  model: Schema.NullOr(OrchestratorModelSchema),
  /** The agent's own number, newest wins. `null` means the agent reported
   *  nothing, which is different from a conversation that has spent nothing
   *  (`{used: 0, size: 200000}`). */
  usage: Schema.NullOr(Usage),
  options: Schema.Array(OrchestratorOptionSchema),
  commands: Schema.Array(OrchestratorCommandSchema),
  servers: Schema.Array(OrchestratorServerSchema),
  watching: Schema.Array(OrchestratorWatchingSchema),
  /** The ids of the ask rows still waiting on a human. The violet badge is
   *  this list's length — no separate count on the wire, because a count that
   *  can disagree is a second source of truth. */
  openAsks: Schema.Array(Schema.String),
  /** Every terminal this orchestrator has created or sent input to, as FLEET
   *  REFS (`<encodedHostKey>/<terminalId>`) — one conversation spans every
   *  host, so a bare id here would name two terminals on a two-host fleet.
   *  Live state for each is read from that host's `terminals` collection,
   *  never remembered here — this is membership, not a mirror. */
  fleet: Schema.Array(Schema.String),
  signIn: Schema.NullOr(OrchestratorSignInSchema),
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
});
export type OrchestratorState = typeof OrchestratorStateSchema.Type;

export const DEFAULT_ORCHESTRATOR_STATE: OrchestratorState = {
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
};

// ── Procedure I/O ─────────────────────────────────────────────────────────

export const OrchestratorPromptInputSchema = Schema.Struct({
  text: Schema.String,
  mentions: Schema.Array(OrchestratorMentionSchema),
  /** The files that ride with the words — NAMES, not bytes. Each was already
   *  uploaded by `orchestrator.attach`, so what kolu-server does here is look
   *  each one up under its own attachments directory, measure it, and hand the
   *  agent a path. A decoding default so a browser served by an earlier
   *  build, which omits the key entirely, still sends a prompt rather than
   *  being refused by the decoder for having nothing to attach. */
  attachments: Schema.Array(OrchestratorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

export const OrchestratorPromptOutputSchema = Schema.Struct({
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
export const OrchestratorAttachInputSchema = Schema.Struct({
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

export const OrchestratorAttachOutputSchema = Schema.Struct({
  /** Where the bytes landed — handed straight back as the next chunk's
   *  `appendTo`, and the `path` the finished attachment carries. */
  path: Schema.String,
  /** The file's size on disk AFTER this chunk, measured rather than summed
   *  from what the sender said it was sending. */
  bytes: Schema.Int,
});

export const OrchestratorAnswerInputSchema = Schema.Struct({
  askId: Schema.String,
  /** `null` DECLINES — the agent is told you would not say, never handed a
   *  choice you did not make. */
  answers: Schema.NullOr(Schema.Array(AskAnswer)),
});

export const OrchestratorAnswerOutputSchema = Schema.Struct({
  /** `false` when somebody else already answered it — a reported state in a
   *  two-tab world, not a fault. */
  settled: Schema.Boolean,
});

export const OrchestratorSignInInputSchema = Schema.Struct({
  method: Schema.String,
});

export const OrchestratorSignInOutputSchema = Schema.Struct({
  outcome: Schema.Literals(["signed-in", "failed", "cancelled", "attached"]),
});

export const OrchestratorSetOptionInputSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.String,
});

export const OrchestratorTextInputSchema = Schema.Struct({
  text: Schema.String,
});

export const OrchestratorEmptySchema = Schema.Struct({});
