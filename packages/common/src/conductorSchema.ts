import {
  agentRowFields,
  askRowFields,
  AskAnswer,
  AskChoice,
  AskField,
  AskLink,
  AuthAccount,
  AuthStatus,
  Command,
  Delivery,
  FileDiff,
  Model,
  noticeRowFields,
  Phase,
  PlanStep,
  rowHead,
  Saying,
  Server,
  Setting,
  SigningIn,
  SignInReason as SignInReasonSchema,
  toolRowFields,
  Usage,
  userRowFields,
  Watching,
  YES_NO,
} from "@kolu/acp/wire";
import { formatBytes, MIB } from "@kolu/byte-units";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { AnsweredFromFaceSchema, TypedAnswerSchema } from "kolu-work";
import { Effect, Schema } from "effect";

export {
  AskAnswer,
  AskChoice,
  AskField,
  AskLink,
  AuthAccount,
  AuthStatus,
  FileDiff,
  Usage,
  YES_NO,
};

/** WHAT A MESSAGE WAS ABOUT — a terminal, or a piece of work — as the
 *  composer was armed with it when it was sent, resolved at that moment. */
export const ConductorTerminalMentionSchema = Schema.Struct({
  kind: Schema.Literal("terminal"),
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
export type ConductorTerminalMention =
  typeof ConductorTerminalMentionSchema.Type;

export const ConductorWorkMentionSchema = Schema.Struct({
  kind: Schema.Literal("work"),
  /** The id the work is filed under. */
  work: Schema.NonEmptyString,
  /** Its title when the message was sent. */
  title: Schema.String,
});
export type ConductorWorkMention = typeof ConductorWorkMentionSchema.Type;

export const ConductorMentionSchema = Schema.Union([
  ConductorTerminalMentionSchema,
  ConductorWorkMentionSchema,
]);
export type ConductorMention = typeof ConductorMentionSchema.Type;

/** A FILE THAT CAME WITH A MESSAGE — an image pasted into the composer, a
 *  log dropped onto the pane.
 *
 *  IT CARRIES NO BYTES, and that is the whole shape. The file is uploaded
 *  first, in frame-sized pieces, by {@link ConductorAttachInputSchema};
 *  what rides the prompt and the row afterwards is a REFERENCE to what
 *  kolu-server wrote.
 *
 *  `bytes` is PADI'S number — what it actually wrote, measured from the file
 *  — never the sender's claim about it. */
export const ConductorAttachmentSchema = Schema.Struct({
  /** Stable within the prompt that carried it, and also the FILENAME under
   *  the attachments directory — so it is a plain name or it is refused; see
   *  kolu-server's `SAFE_ATTACHMENT_ID`. */
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  bytes: Schema.Int,
  /** Absolute, under `<stateRoot>/conductor/attachments/`. The agent is
   *  handed this path and the harness reads the bytes off it. */
  path: Schema.String,
});
export type ConductorAttachment = typeof ConductorAttachmentSchema.Type;

/** How big ONE attachment may be, and how big a single prompt's worth may be
 *  together. */
export const ATTACHMENT_BYTE_CAP = 10 * MIB;
export const PROMPT_ATTACHMENT_BYTE_CAP = 20 * MIB;

export const attachmentTooBig = (name: string, bytes: number): string =>
  `“${name}” is ${formatBytes(bytes)}, and one attachment may be at most ${formatBytes(ATTACHMENT_BYTE_CAP)}.`;

export const promptAttachmentsTooBig = (bytes: number): string =>
  `These attachments come to ${formatBytes(bytes)}, and one message may carry at most ${formatBytes(PROMPT_ATTACHMENT_BYTE_CAP)}. Send them across more than one message.`;

export const attachmentGone = (name: string): string =>
  `“${name}” is no longer on this host, so the message was not sent. Attach it again.`;

export const ConductorSignInReasonSchema = SignInReasonSchema;
export type ConductorSignInReason = typeof ConductorSignInReasonSchema.Type;

/** What a person typed. Never markdown — it is quoted, not rendered. */
export const ConductorUserRowSchema = Schema.Struct({
  ...userRowFields,
  mentions: Schema.optionalKey(Schema.Array(ConductorMentionSchema)),
  signIn: Schema.optionalKey(ConductorSignInReasonSchema),
  attachments: Schema.Array(ConductorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

export const ConductorAgentRowSchema = Schema.Struct({
  ...agentRowFields,
});

/** The agent's execution plan. Each `plan` update REPLACES the whole thing, so
 *  this row is upserted at one key for the life of the session and an empty
 *  update removes it. */
export const ConductorPlanRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("plan"),
  steps: Schema.Array(PlanStep),
});

const CALL_SUBJECT = {
  terminalId: Schema.NullOr(TerminalIdSchema),
  host: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
};

export const ConductorKoluCallSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    ...CALL_SUBJECT,
    cwd: Schema.NullOr(Schema.String),
    agent: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("sendInput"),
    ...CALL_SUBJECT,
    text: Schema.NullOr(Schema.String),
    key: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("settle"),
    ...CALL_SUBJECT,
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
    kind: Schema.Literal("say"),
    ...CALL_SUBJECT,
    text: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
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

export const ConductorToolRowSchema = Schema.Struct({
  ...toolRowFields,
  server: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  asksThroughForm: Schema.optionalKey(Schema.Boolean),
  kolu: Schema.optionalKey(ConductorKoluCallSchema),
});

export const ConductorAskRowSchema = Schema.Struct({
  ...askRowFields,
});

export const ConductorWorkAnswerSchema = Schema.Struct({
  key: Schema.String,
  values: Schema.NonEmptyArray(Schema.String),
});
export type ConductorWorkAnswer = typeof ConductorWorkAnswerSchema.Type;

export const ConductorWorkAskStandingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("open") }),
  Schema.Struct({
    kind: Schema.Literal("part"),
    answers: Schema.NonEmptyArray(ConductorWorkAnswerSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("answered"),
    answers: Schema.NonEmptyArray(ConductorWorkAnswerSchema),
  }),
  Schema.Struct({ kind: Schema.Literal("declined") }),
  Schema.Struct({ kind: Schema.Literal("withdrawn") }),
]);
export type ConductorWorkAskStanding =
  typeof ConductorWorkAskStandingSchema.Type;

export const ConductorWorkAskSchema = Schema.Struct({
  fields: Schema.Array(AskField),
  standing: ConductorWorkAskStandingSchema,
});
export type ConductorWorkAsk = typeof ConductorWorkAskSchema.Type;

export const ConductorWorkAskRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("work-ask"),
  text: Schema.String,
  ask: ConductorWorkAskSchema,
  parent: Schema.optionalKey(Schema.String),
  work: Schema.String,
});

export const ConductorNoticeRowSchema = Schema.Struct({
  ...noticeRowFields,
});

export const ConductorDividerRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("divider"),
  text: Schema.String,
});

const SHARED_LEVELS = ["stopped", "asking", "gone", "asleep"] as const;

const CONCLUDED_LEVELS = ["ready", "ended", "exited"] as const;

const HANDOVER_LEVELS = ["taken-over", "handed-back"] as const;

const READ_OFF_HOST_LEVELS = ["working", "shell", "starting", "fresh"] as const;

export type ConcludedLevel = (typeof CONCLUDED_LEVELS)[number];

/** HOW A WATCHED TERMINAL STANDS when kolu wakes the Conductor about it.
 *
 *  - `stopped` — the agent's turn ended and its output went quiet (padi's
 *    `finishedIds`).
 *  - `asking` — it is asking a person something (`awaitingIds`).
 *  - `gone` — the terminal left its host's roster while that host was
 *    answering.
 *  - `ready` — the agent in it has COME UP and nothing has been said to it
 *    yet.
 *  - `asleep` — the terminal an agent was seen in was put to sleep, so that
 *    agent is gone with it.
 *  - `ended` — a terminal the Conductor created WITH a command: the command
 *    ran and the terminal is back at its shell prompt with no agent ever
 *    seen in it.
 *  - `exited` — an agent WAS seen in this terminal, and now its program
 *    has left the foreground and the terminal is back at its shell prompt.
 *  - `taken-over` / `handed-back` — the PERSON took the terminal off the
 *    Conductor, or gave it back. */
export const ConductorWakeLevelSchema = Schema.Literals([
  ...SHARED_LEVELS,
  ...CONCLUDED_LEVELS,
  ...HANDOVER_LEVELS,
]);
export type ConductorWakeLevel = typeof ConductorWakeLevelSchema.Type;

/** WHAT A WATCHED TERMINAL IS DOING, as the watch READS it off its host: the
 *  four shared levels, plus the two readings that never ring on their own —
 *  `working` (an agent visibly moving) and `shell` (a prompt with nothing in
 *  front of it) — plus the two PRESENCE readings: an agent program is in the
 *  foreground and its screen is still being drawn (`starting`), or it has
 *  settled and nothing has ever been said to it (`fresh`). */
export const ConductorReadingLevelSchema = Schema.Literals([
  ...SHARED_LEVELS,
  ...READ_OFF_HOST_LEVELS,
]);
export type ConductorReadingLevel = typeof ConductorReadingLevelSchema.Type;

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
  name: Schema.String,
  /** The agent kolu detected in it (`claude-code`, `codex`, …), or EMPTY for
   *  a terminal no agent was ever seen in. */
  agent: Schema.String,
  level: ConductorWakeLevelSchema,
  /** When kolu saw it enter this level. */
  at: Schema.String,
});
export type ConductorWakeEvent = typeof ConductorWakeEventSchema.Type;

export const ConductorWakeRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("wake"),
  from: Schema.String,
  events: Schema.Array(ConductorWakeEventSchema),
  text: Schema.String,
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(Delivery),
});
export type ConductorWakeRow = typeof ConductorWakeRowSchema.Type;

export const ConductorRowSchema = Schema.Union([
  ConductorUserRowSchema,
  ConductorAgentRowSchema,
  ConductorPlanRowSchema,
  ConductorToolRowSchema,
  ConductorAskRowSchema,
  ConductorWorkAskRowSchema,
  ConductorNoticeRowSchema,
  ConductorDividerRowSchema,
  ConductorWakeRowSchema,
]);
export type ConductorRow = typeof ConductorRowSchema.Type;
export type ConductorToolRow = typeof ConductorToolRowSchema.Type;
export type ConductorUserRow = typeof ConductorUserRowSchema.Type;
export type ConductorAskRow = typeof ConductorAskRowSchema.Type;
export type ConductorWorkAskRow = typeof ConductorWorkAskRowSchema.Type;

export const appendedText = (
  current: string,
  at: number,
  text: string,
): string => current.slice(0, Math.min(at, current.length)) + text;

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
    appends: Schema.Array(Saying),
  }),
]);
export type ConductorFrame = typeof ConductorFrameSchema.Type;

export const ConductorInstallSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("installed") }),
  Schema.Struct({
    kind: Schema.Literal("absent"),
    name: Schema.String,
    where: Schema.NullOr(Schema.String),
    why: Schema.String,
  }),
]);

export const ConductorStoreKeySchema = Schema.Literals([
  "conductor",
  "works",
  "members",
  "transcript",
]);
export type ConductorStoreKey = typeof ConductorStoreKeySchema.Type;

export const ConductorUnreadableSchema = Schema.Struct({
  key: ConductorStoreKeySchema,
  /** The file the unreadable value is in — `config.json` for the three keys,
   *  the transcript's own file for the fourth. */
  path: Schema.String,
  /** WHERE THE UNREADABLE VALUE WOULD BE KEPT if a person chooses to start
   *  that record empty — the exact path `recoverStore { how: "empty" }`
   *  writes, so the confirm quotes it instead of guessing at it. */
  keepsAt: Schema.String,
  inBackups: Schema.Boolean,
  /** WHAT IT TRIPPED ON, verbatim (a schema path, a version stamp, a JSON
   *  parse error). */
  detail: Schema.String,
});
export type ConductorUnreadable = typeof ConductorUnreadableSchema.Type;

export const ConductorStateSchema = Schema.Struct({
  install: ConductorInstallSchema,
  phase: Phase,
  agentName: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  /** `$HOME` of the machine kolu-server runs on: the directory the
   *  conversation works in. */
  cwd: Schema.String,
  model: Schema.NullOr(Model),
  /** The agent's own number, newest wins. `null` means the agent reported
   *  nothing, which is different from a conversation that has spent nothing
   *  (`{used: 0, size: 200000}`). */
  usage: Schema.NullOr(Usage),
  options: Schema.Array(Setting),
  commands: Schema.Array(Command),
  servers: Schema.Array(Server),
  watching: Schema.Array(Watching),
  /** THE CONVERSATION'S OWN QUESTIONS still waiting on a human, as ask ids —
   *  the agent's elicitations, which belong to no piece of work. */
  openAsks: Schema.Array(Schema.String),
  /** THE QUESTIONS KOLU PUT ABOUT A PIECE OF WORK that are still open, as ask
   *  ids — derived by the server from the works' decisions, so nothing stores
   *  them twice. */
  workAsks: Schema.Array(Schema.String),
  /** Every terminal this conductor has created or sent input to, as FLEET
   *  REFS (`<encodedHostKey>/<terminalId>`) — one conversation spans every
   *  host, so a bare id here would name two terminals on a two-host fleet. */
  fleet: Schema.Array(Schema.String),
  signIn: Schema.NullOr(SigningIn),
  /** WHO the agent process is signed in as, as the agent itself reports it
   *  (`_auth/status_update`). CONNECTION-scoped, not session-scoped: it
   *  belongs to the subprocess, so it survives a `newSession`.
   *
   *  SILENCE IS NOT LOGGED OUT. `null` means the agent said nothing — the
   *  header draws no account chip at all; a KNOWN logged-out state arrives as
   *  a payload of its own (`kind: "none"`) and the chip says so. */
  identity: Schema.NullOr(AuthStatus),
  /** WHICH REMEMBERED RECORD kolu could not read, when that is why there is
   *  no conversation — `null` whenever the records read. */
  unreadable: Schema.NullOr(ConductorUnreadableSchema),
  /** A conversation the agent would not OPEN, in the agent's own words. */
  refusal: Schema.NullOr(Schema.String),
  /** Whether a message may be STEERED into the turn that is running
   *  (Alt+Enter). */
  steers: Schema.Boolean,
  busySince: Schema.NullOr(Schema.String),
  /** The member terminals whose news is HELD because a turn is running — one
   *  per terminal, in the order the first of each rang. */
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
  workAsks: [],
  fleet: [],
  signIn: null,
  identity: null,
  refusal: null,
  unreadable: null,
  steers: false,
  busySince: null,
  held: [],
};

export const ConductorPromptInputSchema = Schema.Struct({
  text: Schema.String,
  mentions: Schema.Array(ConductorMentionSchema),
  attachments: Schema.Array(ConductorAttachmentSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  /** STEER rather than queue: put the words INTO the turn that is running
   *  (Alt+Enter). Honoured only while a turn runs and `steers` holds; a steer
   *  the agent did not take — the turn ended under it — goes out as a plain
   *  prompt, so the words are never lost. */
  steer: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
});

export const ConductorPromptOutputSchema = Schema.Struct({
  rowId: Schema.String,
});

/** ONE PIECE of a file on its way up — the chunked upload that keeps base64
 *  off the prompt frame.
 *
 *  The first call for an id omits `appendTo` and CREATES the file; each later
 *  one passes back the `path` it was handed and APPENDS. */
export const ConductorAttachInputSchema = Schema.Struct({
  /** The attachment id, which is also the filename kolu-server writes under —
   *  so it must be a plain name, and `..` is refused rather than repaired. */
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  /** This chunk's bytes, base64. Boundaries are 4-character-aligned so each
   *  chunk decodes on its own (see `chunkBase64`). */
  data: Schema.String,
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

export const ConductorAnswerWorkInputSchema = Schema.Struct({
  work: Schema.String,
  ask: Schema.String,
  /** Per decision id: the options picked, and/or the words typed — a bare
   *  string is the one-value spelling of the same thing — or, for one of
   *  kolu's own questions, `{ typed }`: the one answer the person TYPED,
   *  which the record keeps as typed and never judges as a pick. */
  answers: Schema.NullOr(
    Schema.Record(
      Schema.String,
      Schema.Union([
        Schema.Array(Schema.String),
        Schema.String,
        TypedAnswerSchema,
      ]),
    ),
  ),
  from: AnsweredFromFaceSchema,
});

export const ConductorAnswerWorkOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("answered") }),
  Schema.Struct({
    kind: Schema.Literal("part"),
    /** The decisions of that ask still waiting on them, by decision id. */
    open: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("declined") }),
  Schema.Struct({ kind: Schema.Literal("nothing-open") }),
]);
export type ConductorAnswerWorkOutcome =
  typeof ConductorAnswerWorkOutcomeSchema.Type;

export const ConductorAnswerWorkOutputSchema = Schema.Struct({
  outcome: ConductorAnswerWorkOutcomeSchema,
});

export const ConductorSignInInputSchema = Schema.Struct({
  method: Schema.String,
});

export const ConductorRestartAfterSignInSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("not-due") }),
  Schema.Struct({ kind: Schema.Literal("restarted") }),
  Schema.Struct({
    kind: Schema.Literal("did-not-restart"),
    why: Schema.String,
  }),
]);
export type ConductorRestartAfterSignIn =
  typeof ConductorRestartAfterSignInSchema.Type;

export const ConductorSignInOutputSchema = Schema.Struct({
  outcome: Schema.Literals(["signed-in", "failed", "cancelled", "attached"]),
  restart: ConductorRestartAfterSignInSchema,
});
export type ConductorSignInResult = typeof ConductorSignInOutputSchema.Type;

export const ConductorSetOptionInputSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.String,
});

export const ConductorTextInputSchema = Schema.Struct({
  text: Schema.String,
});

/** One terminal, by the `<host>/<id>` ref every face names it with. */
export const ConductorTerminalInputSchema = Schema.Struct({
  terminal: Schema.String,
});

export const ConductorWorkInputSchema = Schema.Struct({
  work: Schema.String,
});

/** THE TWO THINGS KOLU CAN DO ABOUT A RECORD IT CANNOT READ, as one input.
 *
 *  `backup` walks the state-backup ring newest first and takes the newest
 *  snapshot whose whole store decodes through the real migration ladder.
 *  `empty` moves the unreadable value aside into a file of its own beside
 *  `config.json` and starts that record empty. */
export const ConductorRecoverInputSchema = Schema.Struct({
  key: ConductorStoreKeySchema,
  how: Schema.Literals(["backup", "empty"]),
});

export const ConductorRecoverOutputSchema = Schema.Struct({
  /** WHAT KOLU JUST DID, in the same plain words the refusal was in — which
   *  snapshot it took and what came back, or where the unreadable value is
   *  now. The panel shows it; nothing parses it. */
  said: Schema.String,
});

export const ConductorEmptySchema = Schema.Struct({});
