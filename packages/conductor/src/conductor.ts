/**
 * KOLU'S ONE CONVERSATION — the Conductor, hosted by kolu-server.
 *
 * kolu-server owns exactly one ACP conversation: it spawns the adapter, holds
 * the session, keeps the transcript, persists enough of it to come back, and
 * serves the whole of it as `koluSurface`'s `conductor` cell, the
 * `conductorTranscript` stream and the `conductor` procedures.
 *
 * ## Why kolu-server and not padi
 *
 * The conversation's hands are EVERY host's terminals. A supervisor that could
 * only see the box it happens to run on is not a supervisor of a fleet: it
 * would have to be started once per host, taught once per host, and watched
 * once per host, and no one of its copies could ever answer "which agent needs
 * me". kolu-server is the one process that already mirrors every padi over
 * ssh, so it is the only place a single conversation can reach all of them.
 * Its hands are the FLEET MCP FACE — kolu's own MCP expose map lifted over the
 * host map, served in-process on a loopback listener — and every terminal it
 * names is `host/id`.
 *
 * padi, in exchange, goes back to knowing only its own terminals.
 *
 * ## It starts when somebody looks
 *
 * The adapter is a real Claude subprocess, and a kolu nobody has opened should
 * not be running one. So the conversation is brought up by the first READER —
 * the first transcript subscription or the first procedure call — and then
 * kept for the process's life. That is not a lazy-init convenience: it is what
 * makes a server nobody is watching cost nothing, while a server somebody
 * actually opens has its conversation back (with `session/load`) before they
 * have finished reading the first screen.
 *
 * The REMEMBERED record is read on that same edge, not at construction. This
 * module is built by the first caller of `live.ts`, which may run before the
 * surface ctx exists (and never has a ctx at all in a unit test), so a read at
 * construction would be a crash in every test that assembles the surface.
 * Nothing is lost by waiting: the first reader is the first moment the record
 * can be shown to anybody.
 *
 * The persisted rows are served BEFORE the agent is up, which is why the
 * stream's first snapshot never waits on a handshake: a restart shows the
 * conversation you were in, and the live agent arrives underneath it.
 *
 * ## The restart fence
 *
 * Our rows are AUTHORITATIVE across a restart, and the agent's replay is not.
 * `session/load` replays the agent's own messages, but a kolu transcript is
 * more than that — the kolu-aware tool cards, the background-task lanes, the
 * notices this panel wrote about itself — so dropping what we hold in favour
 * of the replay would lose the richer half. What makes the two survivable side
 * by side is `resumedSeq`: the harness mints its ids and ordering numbers
 * STARTING AFTER the highest one we already hold, so a row the new process
 * emits can neither collide with a persisted id nor sort above a persisted
 * row.
 *
 * The ID that fence sits beside is the conversation the agent is in NOW, not
 * the one the file named at boot: a conversation moves on when somebody asks
 * for a new session, and when the agent refuses the remembered id because its
 * own store has never heard of it and the harness opens a fresh one in its
 * place. A replacement adapter handed the boot-time id would ask for a
 * conversation that is gone, or — worse — one the agent still has, which is a
 * panel quietly reverting to an older chat.
 *
 * And an id is only a conversation once something was said in it. The agent
 * mints the id at `session/new` and writes nothing until the first prompt, so
 * a session nobody spoke to comes back as a NEW one, silently — no divider, no
 * notice, because nothing was lost. A session that did have a turn and still
 * cannot be loaded keeps its divider and its notice: that is a real loss.
 * Which of the two a session is, is read off our own rows ({@link hadATurn}).
 *
 * ## Absent is absent
 *
 * The ACP adapter is baked into kolu's closure (`KOLU_ACP_AGENT`), so its
 * absence is a broken build rather than a configuration a person chose. There
 * is no fallback path and no knob: the cell carries the integration's own
 * sentence and every procedure refuses with it. The fleet MCP endpoint is
 * held to the same rule, and proved rather than trusted — see
 * {@link ConductorDeps.fleetMcp}.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";
import {
  CONDUCTOR_ENGINE as ENGINE,
  conductorConfigDir,
} from "kolu-agents/acp";
import type { NotHere } from "@kolu/acp/engine";
import {
  type Harness,
  type HarnessOptions,
  HarnessRefused,
  HarnessUnavailable,
  type HttpServer,
} from "@kolu/acp-harness";
import {
  appendedText,
  ATTACHMENT_BYTE_CAP,
  attachmentGone,
  attachmentTooBig,
  ConductorStateSchema,
  DEFAULT_CONDUCTOR_STATE,
  type ConductorAttachment,
  type ConductorFrame,
  type ConductorRow,
  type ConductorState,
  type ConductorReadingLevel,
  type ConductorWakeEvent,
  PROMPT_ATTACHMENT_BYTE_CAP,
  promptAttachmentsTooBig,
} from "kolu-common/conductor";
import {
  ConductorRefused,
  ConductorUnavailable,
} from "kolu-common/conductorErrors";
import type { CellStore } from "@kolu/surface/server";
import { Schema } from "effect";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  answerAsk,
  askQuestions,
  capFinished,
  deserted,
  driverOf,
  dropAsk,
  endWork,
  filesSeen,
  finished,
  handBack as handBackRecord,
  inProgress,
  joinWork,
  keepFailed,
  keepFiles,
  leaveWork,
  ON_GREEN,
  openAsks,
  openWork as openWorkRecord,
  prOf,
  type Question,
  recordEvent,
  takeOver as takeOverRecord,
  type SetupKey,
  type SetupReading,
  setupOf,
  type Work,
  type WorkEvent,
  WORK_MODES,
  type WorkRole,
} from "kolu-work";
import type { Logger } from "pino";
import { type Held, holding } from "./held.ts";
import {
  joinedMember,
  type MemberState,
  observed,
  restoredMember,
  spokenTo,
  type WatchJoin,
  type WatchObservation,
  type WatchPr,
} from "./members.ts";
import {
  persistedFrom,
  type MemberWatch,
  MemberWatchSchema,
  type PersistedConductor,
  type PersistedTranscript,
  type PersistedWorks,
  type StoredMember,
  type StoredWork,
  readPersistedConductor,
  readPersistedTranscript,
  readPersistedWorks,
  transcriptFrom,
} from "./persisted.ts";
import { teachingLines } from "./teaching.ts";
import {
  type WorkFiles,
  WorkRefusal,
  askForm,
  foreignSetupWords,
  missingSetup,
  pickedValues,
} from "./works.ts";
import { wakeText } from "./wakeText.ts";

/** What a reader of the transcript stream is handed, in order: one snapshot,
 *  then deltas, for as long as it is subscribed. */
export type ConductorFrameSink = (frame: ConductorFrame) => void;

export interface ConductorHost {
  /** The live cell value. Readable before the agent is up — it then says
   *  `offline` with the remembered session and fleet, which is the truth.
   *  Readable before the REMEMBERED record has been read too (it is read on
   *  the first reader's edge, see the module doc), which is what the cell's
   *  serve-time seed takes. */
  readonly state: () => ConductorState;
  /** Subscribe to the transcript. The sink is called SYNCHRONOUSLY with the
   *  snapshot before this returns, so a stream's first frame can never race
   *  the first delta. */
  readonly watch: (sink: ConductorFrameSink) => () => void;
  readonly prompt: (
    text: string,
    /** The terminals the message was ABOUT. `host` is the encoded host key
     *  and `terminalId` the id on that host; the harness joins them into the
     *  `host/id` the agent is told, which is the only name a fleet-wide
     *  conversation can act on. */
    mentions: ReadonlyArray<{
      terminalId: string;
      host: string;
      name: string;
      intent: string | null;
      cwd: string | null;
    }>,
    /** The files that came with the words, by NAME — each was uploaded ahead
     *  of this call by {@link ConductorHost.attach} and is already on disk
     *  under kolu-server's state root. What the harness is handed is the same
     *  shape with `bytes` and `path` re-read from the file; see
     *  {@link namedAttachments}. */
    attachments: ReadonlyArray<ConductorAttachment>,
    /** STEER rather than queue: put the words into the turn that is running.
     *  The harness decides whether that is possible and falls back to an
     *  ordinary prompt when it is not — this end only carries the ask. */
    steer: boolean,
  ) => Promise<{ rowId: string }>;
  /** EVERY PIECE OF WORK KOLU REMEMBERS, in the WIRE shape (no member watch
   *  bookkeeping): the works in progress oldest first — a card keeps its
   *  place — then the finished ones it still keeps, newest first.
   *
   *  Reads the remembered record if nobody has yet; it never starts the agent.
   *  A work OUTLIVES the conversation that opened it, so reading one must not
   *  be a reason to spawn an adapter. */
  readonly works: () => ReadonlyArray<Work>;
  /** ... and HOW EACH MEMBER TERMINAL STANDS right now, by fleet ref. Runtime
   *  only: a terminal nothing has read yet is ABSENT rather than carried at
   *  zero. */
  readonly readings: () => ReadonlyMap<
    string,
    { readonly level: ConductorReadingLevel; readonly since: string }
  >;
  /** THE WATCHER'S SCOPE — the active members of every work IN PROGRESS, as
   *  fleet refs. A terminal is watched if and only if it is one of these:
   *  membership is stated, so there is no second list to keep in step. */
  readonly memberRefs: () => ReadonlyArray<string>;
  /** ... and the same members with what kolu knows about each: which work,
   *  what part it plays, what the terminal was last called, the agent last
   *  seen in it and how it joined.
   *
   *  Beside `memberRefs` rather than replacing it because the two have
   *  different readers: the watcher scopes by REF and would throw the rest
   *  away, while the fleet face serves these to the Conductor itself — which
   *  otherwise has no way to answer "what am I running" after a restart
   *  except by guessing. */
  readonly membersDetail: () => ReadonlyArray<{
    readonly ref: string;
    readonly work: string;
    readonly role: WorkRole;
    readonly name: string;
    readonly agent: string | null;
    readonly joined: WatchJoin;
  }>;
  /**
   * OPEN A PIECE OF WORK — the one call where the Conductor states its intent.
   *
   * The work is created AT ONCE, with the human's request on its timeline, and
   * the setup questions go to the human as ONE ask linked to it. The answers
   * become decisions, and the host, the mode, the harness and model per role
   * and what to do on green are readings of those decisions — there is no
   * second copy of any of them.
   *
   * REFUSED, before anything exists, when the setup does not carry what the
   * mode it might run needs ({@link WorkRefusal}, `missing-setup`): a work
   * half set up is a planner launched on a model nobody chose.
   *
   * Resolves when the human has answered. A setup they DECLINE ends the work
   * `abandoned` and says so — nothing was created, and the Conductor is told
   * rather than left holding an id for a work nobody wanted.
   */
  readonly openWork: (intent: {
    readonly title: string;
    readonly repo: string;
    readonly branch: string;
    readonly setup: ReadonlyArray<{
      readonly key: SetupKey;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly given?: string | undefined;
    }>;
  }) => Promise<{
    readonly work: string;
    readonly setup: SetupReading;
    readonly declined: boolean;
  }>;
  /** A QUESTION ABOUT A WORK, put to the human as one ask the work knows about
   *  — so the answer is a decision kept with the work and the card can draw
   *  and answer the same row the chat does. */
  readonly askAboutWork: (
    work: string,
    questions: ReadonlyArray<{
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly multiple?: boolean | undefined;
    }>,
  ) => Promise<{
    readonly answers: ReadonlyArray<{
      readonly question: string;
      readonly picked: ReadonlyArray<string>;
      readonly text: string | null;
    }>;
    readonly declined: boolean;
  }>;
  /** A TERMINAL JOINS A WORK, in a role stated in the same call that created
   *  or adopted it. Refused for a work that is unknown or has ended: a member
   *  of nothing is a terminal nobody is watching.
   *
   *  Idempotent: a terminal already an active member keeps the role it was
   *  given first, and keeps what its watch already knows. */
  readonly joinWork: (
    work: string,
    ref: string,
    role: WorkRole,
    joined: WatchJoin,
  ) => void;
  /** ... and a member leaves — its part is done, or the human said so.
   *  Answers whether it was a member of anything. */
  readonly leaveWork: (ref: string) => boolean;
  /** THE PERSON TAKES THE KEYS to a member terminal the Conductor drives.
   *
   *  From here on that terminal is theirs to type into: every one of the
   *  browser's own input sites refuses while the driver is the Conductor, and
   *  the Conductor is WOKEN and told to keep its hands off this one until it
   *  is handed back. Refused ({@link WorkRefusal}) for a terminal that is not
   *  a member of a work kolu drives (`not-driven`) or is already in that
   *  state (`already-yours`).
   *
   *  It never goes through the agent: a person must be able to take over a
   *  terminal while the Conductor is down, signed out, or busy — the wake is
   *  held like any other news and goes out when there is somebody to tell. */
  readonly takeOver: (terminal: string) => void;
  /** ... and gives them back. Refused `not-driven`, or `already-conductors`
   *  when nobody had taken it over. */
  readonly handBack: (terminal: string) => void;
  /** EVERY WORK, REPLACED — a restored backup of the server's store.
   *
   *  The snapshot has already been decoded through the migration ladder, so
   *  what arrives is today's shape. The running Conductor reloads it rather
   *  than being restarted: the works are replaced wholesale, every question
   *  they had open is dropped (the conversations that asked them cannot
   *  answer any more), the readers are told, the file is written NOW, and the
   *  watcher re-scopes to the restored membership. */
  readonly restoreWorks: (works: PersistedWorks) => void;
  /** THE ONE THING THE CONDUCTOR WRITES ON A TIMELINE that kolu did not
   *  observe: a line of text. Nothing reads a note to decide anything. */
  readonly note: (work: string, text: string) => void;
  /** THE CONDUCTOR JUST SPOKE TO THE AGENT IN THIS TERMINAL — `agent_say`
   *  landed its keystrokes.
   *
   *  Whatever that terminal was about to say is withdrawn and its member
   *  re-baselines at the state it stands in (`./members.ts`'s `spokenTo`):
   *  a say answers as soon as the keys are pressed, so without this the
   *  Conductor is woken about the agent it has just briefed the instant its
   *  turn ends. A ref that is NOT a member is ignored — the fleet face calls
   *  this for every say, and most terminals belong to no work. */
  readonly saidTo: (ref: string) => void;
  /** THE CONDUCTOR JUST CLOSED THIS TERMINAL — `lifecycle_kill` answered.
   *
   *  A death it caused is not news to it: the member leaves its work SILENTLY
   *  and whatever that terminal was about to say goes with it — `gone`
   *  included, because padi publishes the removal BEFORE the kill answers, so
   *  the watcher can have seen the terminal go (recording the departure and
   *  holding a `gone` for the turn's end) by the time this is called. That is
   *  why it withdraws the held news whether or not the member is still here,
   *  and why it is a verb of its own rather than {@link
   *  ConductorHost.leaveWork}, which answers "was it a member" and touches
   *  nothing when it was not. A ref nobody was watching and nothing was held
   *  about is ignored. */
  readonly closedTerminal: (ref: string) => void;
  /**
   * WHAT THE WATCHER SAW, for refs on CONNECTED hosts only.
   *
   * One call per frame of the world rather than one per terminal, because
   * what the Conductor is owed is everything that moved at once: several
   * terminals that rang while a turn was running leave together, in one wake
   * ({@link ./held.ts}).
   *
   * A reading about a ref that is NOT a member is ignored rather than refused
   * — the watcher re-scopes asynchronously, and a frame in flight across a
   * departure is ordinary.
   */
  readonly observe: (seen: ReadonlyArray<WatchObservation>) => void;
  /** ONE CHUNK of a file on its way up, ahead of the prompt that names it.
   *
   *  The first call for an id creates the file, each later one passes back
   *  the `path` it was handed and appends to it — which is how a 12 MiB
   *  screenshot reaches this host without a single frame that scales with it.
   *  SEQUENTIAL per attachment: this appends to one growing file, so two
   *  chunks in flight at once interleave and corrupt it silently — which is
   *  also why it is synchronous rather than a promise. */
  readonly attach: (chunk: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    appendTo?: string;
  }) => { path: string; bytes: number };
  readonly cancel: () => Promise<void>;
  /** ANSWER A QUESTION ON SCREEN — an agent's elicitation, or one kolu asked
   *  about a work.
   *
   *  `from` says WHICH FACE answered: the work's card, or the chat. The two
   *  draw the same row and answer the same question, and the decision the
   *  work keeps records which one the human was looking at. */
  readonly answer: (
    askId: string,
    answers: ReadonlyArray<{
      key: string;
      values: ReadonlyArray<string>;
    }> | null,
    from: "card" | "chat",
  ) => Promise<boolean>;
  readonly signIn: (
    method: string,
  ) => Promise<"signed-in" | "failed" | "cancelled" | "attached">;
  readonly signInInput: (text: string) => Promise<void>;
  readonly signInCancel: () => Promise<boolean>;
  readonly setOption: (id: string, value: string) => Promise<void>;
  /** A NEW CONVERSATION OVER THE SAME TRANSCRIPT. The agent's memory is
   *  reset and the scroll above it stays, with the divider the harness mints
   *  saying where the break was. The one caller is *try again*, which asks
   *  for exactly what a refused bring-up refused. */
  readonly newSession: () => Promise<void>;
  /** THE WIPE — the header menu's `New session`, behind its one confirm.
   *
   *  A new conversation AND an empty one: the rows go, the record goes and
   *  the files the rows named go. WHAT STAYS IS THE WORK: a piece of work
   *  outlives the conversation that opened it, and a person pressing this has
   *  said they are done with the chat, not that they stopped caring about a
   *  waterfall in flight. What a work loses is the question it had open — the
   *  conversation that asked it is gone, so the decision is recorded as
   *  dropped rather than left waiting on nobody. No divider: a rule drawn
   *  across an empty transcript marks a break between nothing and nothing.
   *  The standing prompt is re-taught on the next turn by the path that
   *  always teaches it. */
  readonly clearSession: () => Promise<void>;
  /** Process-lifetime teardown: stop the child, write the record, drop the
   *  readers. AWAITED by kolu-server's shutdown, because the adapter is spawned
   *  `detached` — a teardown that only fired the stop would leave the adapter,
   *  its `claude` and its MCP client running after the server that owns them
   *  is gone. */
  readonly dispose: () => Promise<void>;
}

/** WHERE THE FLEET MCP FACE IS LISTENING, and the credential that opens it.
 *
 *  A loopback URL alone is not an address a conversation can be handed: every
 *  other process on this box can reach 127.0.0.1, so the listener is gated by
 *  a bearer token minted per process, and the two travel together or neither
 *  is useful. */
export interface FleetMcpEndpoint {
  readonly url: string;
  readonly token: string;
}

export interface ConductorDeps {
  readonly log: Logger;
  /** `$HOME` of the machine kolu-server runs on — the directory the
   *  conversation works in, and what makes a stored session findable when it
   *  is resumed. */
  readonly home: string;
  /** What this machine is CALLED. The standing prompt says "you are kolu's
   *  conductor, running on <this>", and a directory is not an answer to
   *  that: an agent told it runs on `/home/srid` has been told the one fact it
   *  cannot use when it reports where it did something. */
  readonly hostName: string;
  /** WHERE THE FLEET'S HANDS ARE — the in-process MCP endpoint and its token,
   *  or `null` while the listener is not up.
   *
   *  A THUNK, because the listener is started by the boot that owns it and
   *  this module may be constructed before that line runs; reading it per
   *  bring-up is what lets the first reader arrive in either order. The value
   *  is not merely NAMED when it is found: it is PROVED with a real request
   *  (see {@link provenFleetServer}), because this hand-over happens once
   *  inside `session/new` and an endpoint the agent cannot reach is marked
   *  failed for the life of the conversation. */
  readonly fleetMcp: () => FleetMcpEndpoint | null;
  /** PROVE that endpoint answers — a real request, no timer — returning the
   *  sentence that says why not, or `null` when it will serve this caller.
   *
   *  PUSHED IN, like `spawn`. The proof is one `initialize` routed by a
   *  session header and ended by a `DELETE`, and those spellings are the MCP
   *  SDK's: they move when it moves, and the host that OWNS that pin is the
   *  one that serves the door. This package speaks ACP and would otherwise
   *  grow an edge to a protocol it never talks. What arrives here is the
   *  answer, which is all a conversation needs to decide whether it has
   *  hands. */
  readonly proveFleetMcp: (
    at: FleetMcpEndpoint,
    log: Logger,
  ) => Promise<string | null>;
  /** Publish the live cell value. Pushed in rather than imported for the
   *  reason `spawn` is: this module owns the conversation, not the surface,
   *  and an import of the served ctx would be a cycle (`surface.ts` builds the
   *  cell that seeds itself from this host's first reading). */
  readonly publish: (state: ConductorState) => void;
  /** PUBLISH ONE PIECE OF WORK — the `works` collection's writer, pushed in
   *  for the same reason `publish` is. `null` REMOVES it (it fell off the
   *  history cap, or a restore replaced the set).
   *
   *  Per work rather than a view of all of them because a work grows an event
   *  every time an agent stops: a cell carrying every work would put all of
   *  them (and the twenty finished) on every browser's wire for one new line
   *  on one timeline. The host calls this only for what MOVED — works are
   *  immutable values, so an unchanged one keeps its reference. */
  readonly publishWork: (id: string, work: Work | null) => void;
  /** ... and HOW A MEMBER TERMINAL STANDS, by fleet ref — the other
   *  collection. `null` for a terminal that is no longer a member (there is
   *  nothing left to read). A terminal nobody has read yet is ABSENT rather
   *  than carried at zero: "nobody has looked at its host" and "it has stood
   *  this way for no time" are different facts. */
  readonly publishReading: (
    terminal: string,
    reading: {
      readonly level: ConductorReadingLevel;
      readonly since: string;
    } | null,
  ) => void;
  /** THE MEMBERSHIP MOVED — the one in-process event this host announces, for
   *  readers that follow the works themselves rather than the browser's
   *  frame. `membership` is true when the SET of member refs changed (a
   *  terminal joined, left or went away) and false when only what kolu knows
   *  about a member did (its name, the agent in it). The two are different
   *  jobs: the watcher re-scopes its per-host subscriptions on a membership
   *  change and must not tear them down because a terminal was renamed, while
   *  a reader of the ROWS needs both.
   *
   *  An event, pushed where the works are mutated, rather than something a
   *  consumer recovers by diffing published state: this host is the one thing
   *  that knows, and "did the membership move" reconstructed from a
   *  serialised frame is one more copy of the answer free to be wrong. */
  readonly membersMoved: (membership: boolean) => void;
  /** The conversation's own record — `config.json`'s `conductor` key. */
  readonly store: CellStore<PersistedConductor>;
  /** THE TRANSCRIPT, in its own file. Separate from `store` because the rows
   *  are what made the state file large and rewritten at an agent's output
   *  cadence; kolu-server implements it over
   *  `<stateDir>/conductor/transcript.json`. */
  readonly transcript: CellStore<PersistedTranscript>;
  /** THE WORKS — `config.json`'s `works` key. */
  readonly works: CellStore<PersistedWorks>;
  /** A WORK'S FILES, where they live: listed on the host the work is on, and
   *  copied into kolu when it ends ({@link WorkFiles}). */
  readonly workFiles: WorkFiles;
  /** The FILE behind `store` (and `works`), named in the refusal a corrupt
   *  record raises — the one thing a person holding a bad state-root can act
   *  on. */
  readonly storePath: () => string;
  /** ... and the FILE behind `transcript`, for the same refusal about it. */
  readonly transcriptPath: () => string;
  /** The DIRECTORY that file is in — where a prompt's attachments are written
   *  so the agent can be handed a path to read. A plain string rather than a
   *  thunk like the two above: those are resolved late (the endpoint is not
   *  known until the listener binds, the config path is derived per read),
   *  while the state root is the one thing this process was started with. */
  readonly stateRoot: string;
  /** How a conversation is STARTED — `startHarness`, pushed in at assembly.
   *
   *  This module owns the record, the readers and the refusals; it owns no
   *  part of running a subprocess, and an import of the one function that
   *  does would make the two inseparable. Pushed in the way the autosave gate
   *  takes its effects: one arrow, out of the composition root, so the
   *  bookkeeping here is exercised without an adapter on the machine. */
  readonly spawn: (options: HarnessOptions) => Promise<Harness>;
}

/** The sentence a kolu-server whose fleet listener is not up yet says. It is a
 *  real window — the conductor is reachable the instant the surface serves,
 *  and the listener binds a few lines later — so it is stated rather than
 *  papered over with a retry loop that would hide a boot that genuinely never
 *  got there. */
const NO_FLEET_MCP =
  "This kolu has not published its fleet MCP endpoint yet, so the conductor cannot tell its agent where the fleet's terminals are. Try again once the server has finished starting.";

/** How long a burst of transcript movement may go unwritten.
 *
 *  A streaming answer is one row and six hundred frames, and the record lives
 *  in `config.json` BESIDE the host map and the preferences — so a write per
 *  frame rewrote the whole of kolu's state at the agent's output cadence.
 *  Leading-edge: the first movement is durable immediately, and a burst then
 *  costs one write a second instead of six hundred. An order
 *  of magnitude above the session trace's 500 ms throttle on purpose — a
 *  transcript row is reconstructible from the agent's own replay in a way a
 *  terminal layout is not, so it is the cheaper thing to trail. */
const PERSIST_THROTTLE_MS = 1_000;

/** How long a teardown STANDS THERE for a bring-up that is still in flight.
 *
 *  The handle that can stop the child exists only once the whole open has
 *  landed, and an open that is a `session/load` may sit on the wire for the
 *  harness's own load deadline — so a teardown that awaited it outright would
 *  hang a drain, an upgrade or a SIGTERM over a conversation nobody is
 *  watching. The STOP itself is not bounded by this: it is issued on a
 *  continuation of that same promise, so a harness that lands late is stopped
 *  when it does. Five seconds because what this window actually covers — a
 *  `spawn`, an `initialize` and a session request — is sub-second work on any
 *  machine that is not already wedged. */
const STOP_IN_FLIGHT_MS = 5_000;

/** The sentence behind a thrown thing. The harness's two refusals and the two
 *  wire errors all carry a WHOLE SENTENCE in `why`, and that is the half a
 *  reader is shown; a plain `Error` has only its message. */
const sentenceOf = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "why" in err) {
    const { why } = err;
    if (typeof why === "string" && why !== "") return why;
  }
  return err instanceof Error ? err.message : String(err);
};

/** WHETHER THE CONVERSATION WE ARE IN HAS HAD A TURN — read off the rows since
 *  the last break, because those rows are the record of what kolu sent.
 *
 *  An id is not a conversation. The pinned adapter answers `session/new` with
 *  an id and writes nothing to its store until the first prompt, so a session
 *  nobody spoke to is one `session/load` cannot find — and asking anyway is a
 *  "could not be resumed" notice and a divider about a conversation that never
 *  was, minted again on every restart that comes before the first message.
 *  Such a session is OPENED AGAIN rather than resumed: nothing is lost, so
 *  nothing is said.
 *
 *  DERIVED rather than saved beside the id, because the rows already are the
 *  fact and are written in the same record as the id: a second field would be
 *  a copy that could disagree with the transcript under it, and a rung on the
 *  ladder to carry a value every existing record already implies.
 *
 *  A turn is a prompt that WENT — a person's line or a wake, unless it was
 *  `refused` (nothing took it) — OR anything only a turn produces: the
 *  agent's prose, a plan, a tool call, a question. The second half is not
 *  redundant: the record is capped from the OLD end (`persisted.ts`'s
 *  `ROW_CAP`), and a
 *  turn long enough to push its own prompt out must still count as one. */
const hadATurn = (rows: ReadonlyArray<ConductorRow>): boolean => {
  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at];
    switch (row?.kind) {
      case "divider":
        return false;
      case "user":
      case "wake":
        if (row.delivery !== "refused") return true;
        break;
      case "agent":
      case "plan":
      case "tool":
      case "ask":
        return true;
    }
  }
  return false;
};

/** Where a prompt's files land, under kolu-server's state root.
 *
 *  Beside `config.json` rather than inside it: an image is bytes, and bytes
 *  base64'd into the record would make every read of the state file — on
 *  every boot, for every reader — pay for a screenshot nobody is looking at.
 *  Its own directory under a `conductor/` corner so a person can see what
 *  the conversation is holding, and delete it, without a tool. */
const ATTACHMENTS_DIR = join("conductor", "attachments");

/** An id is the WHOLE filename, so it may be nothing but a filename. A
 *  browser that sent `../../id_rsa` would otherwise be choosing where this
 *  server writes; leading dots are out too, so neither `.` nor `..` can be
 *  spelled. Refused rather than sanitized — a name this end had to repair is
 *  a name the two ends no longer agree on. */
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How long a file nobody has sent yet is kept.
 *
 *  THE RULE a file lives by is the transcript row that names it, and an
 *  upload that has not been sent has no row — so the only thing keeping it is
 *  that somebody may still press Send. That hope has a lifetime: a composer
 *  left open across a meeting still sends, an image pasted and thought better
 *  of does not outlive the afternoon. Without it the chunked upload is a leak
 *  with a wider mouth than the one it replaced — a person can attach three
 *  files and never send any of them, and nothing would ever name them.
 *
 *  What makes the directory grow is also what cleans it: the sweep runs on
 *  every upload that CREATES a file, so a server nobody is pasting into holds
 *  whatever it holds, and one that is pasted into reaps as it goes.
 *
 *  Exported so the test drives the window rather than re-spelling it: a
 *  retention rule nobody can wind the clock past is a rule nobody has
 *  checked. */
export const UNSENT_ATTACHMENT_MS = 60 * 60 * 1_000;

export function startConductorHost(deps: ConductorDeps): ConductorHost {
  const {
    log,
    home,
    hostName,
    fleetMcp,
    proveFleetMcp,
    publish,
    publishWork,
    publishReading,
    membersMoved,
    store,
    transcript: transcriptStore,
    works: worksStore,
    workFiles,
    storePath,
    transcriptPath,
    stateRoot,
    spawn,
  } = deps;

  /** What the integration says about being seated here — the adapter it would
   *  spawn, or the whole sentence a machine without it is owed. Asked ONCE, at
   *  boot: `KOLU_ACP_AGENT` is baked, so it cannot change under a running
   *  server, and re-probing per call would be pretending it could. */
  const seating = ENGINE.at({
    env: process.env,
    cwd: home,
    found: () => null,
  });
  const absent: NotHere | null = "why" in seating ? seating : null;

  /** The three fields THIS SERVER is the author of — whether the adapter is
   *  seated on this machine, what the agent is called, and the directory this
   *  conversation is in — known here at boot from the engine and the home this
   *  process was started with. Folded back over every state the harness
   *  reports, so each has exactly ONE author. */
  const serverAuthored = {
    install:
      absent === null
        ? { kind: "installed" }
        : {
            kind: "absent",
            name: absent.name,
            where: absent.where,
            why: absent.why,
          },
    agentName: ENGINE.name,
    cwd: home,
  } satisfies Pick<ConductorState, "install" | "agentName" | "cwd">;

  let state: ConductorState = {
    ...DEFAULT_CONDUCTOR_STATE,
    ...serverAuthored,
  };

  // The transcript as a MAP, written in place. The frames that move it are
  // per-id (upsert / remove / append-to-one-row), so rebuilding an array per
  // frame would make a streaming answer quadratic in its own length. The array
  // is materialized only when somebody takes the whole of it — a snapshot for
  // a new reader, or a throttled write — and the sort lives there rather than
  // in the hot path.
  const byId = new Map<string, ConductorRow>();
  let rowsCache: ReadonlyArray<ConductorRow> | null = null;
  const rows = (): ReadonlyArray<ConductorRow> =>
    (rowsCache ??= [...byId.values()].sort((a, b) => a.seq - b.seq));

  /** THE WORDS A WORK WAS OPENED ON — the newest thing the human typed in
   *  this conversation, or "" when they have typed nothing.
   *
   *  Read off the transcript rather than taken from `work_open`, because the
   *  Conductor's version of the request is its SUMMARY of the words: what the
   *  timeline's first line must say is what the person actually asked for. */
  const newestRequest = (): string => {
    const said = rows();
    for (let at = said.length - 1; at >= 0; at -= 1) {
      const row = said[at];
      if (row?.kind === "user") return row.text;
    }
    return "";
  };

  let seq = 0;
  const sinks = new Set<ConductorFrameSink>();
  let harness: Harness | null = null;
  let starting: Promise<Harness> | null = null;
  let disposed = false;

  // What a restart starts from — read ONCE, on the first reader's edge. The
  // record is this module's to write from here on, and re-reading it would
  // make the file the authority over a live conversation that has moved past
  // it.
  let read = false;
  /** The session id the agent is asked to replay and the model a person CHOSE.
   *  Both stay at their empty value until the record has been read, and for a
   *  state-root with nothing to resume they stay there. */
  let resume: string | null = null;
  let chosenModel: string | null = null;

  /**
   * THE WORKS, in the order they were opened — and the news HELD for the
   * member terminals that rang while a turn was running.
   *
   * Two collections rather than one because they survive differently: the
   * works are saved (a restart looks at every member terminal again) and the
   * held news is memory only — what it describes is how something STOOD, and
   * a restart re-reads the world instead of replaying a queue about one that
   * has moved on.
   *
   * Insertion order IS the contract: a work sits where it was opened, so a
   * card keeps its place for as long as it is in progress.
   */
  const works = new Map<string, StoredWork>();
  const heldNews: Held<ConductorWakeEvent> = holding();

  /** THE LAST READING of each member terminal in THIS process, by ref, and
   *  whether its next reading baselines — the two fields of a member that are
   *  not written down (`./members.ts`). A member that leaves drops out of
   *  here: there is nothing left to read. */
  const runtime = new Map<string, Omit<MemberState, "watch">>();

  /** WHERE A QUESTION WAS ANSWERED FROM, by ask id — written by `answer()` on
   *  its way to the harness and read by the ask that was waiting on it. A map
   *  rather than a field because two works can have a question open at once,
   *  and an entry lives only for the round trip between the press and the
   *  settlement. */
  const answeredFrom = new Map<string, "card" | "chat">();

  /** The member terminals whose `.waterfall/` is being listed RIGHT NOW. One
   *  listing per terminal at a time: a burst of level changes must not pile up
   *  reads of one directory on a machine that is answering slowly. */
  const listing = new Set<string>();

  /** A flush in flight. One at a time, because the whole point of a flush is
   *  that everything waiting leaves in ONE turn — two of them racing would be
   *  two wakes for one boundary. */
  let flushing = false;
  /** THE FAILURE EPISODE a wake is in, as the sentence that was said about it
   *  — or `null` when the last wake went. One notice per episode: a flush
   *  that fails is retried on every edge that could make it work, and a row
   *  per attempt would bury the conversation under kolu's own apologies. */
  let wakeFailure: string | null = null;
  /** Something rang (or a turn ended) while a flush was already running. The
   *  dropped edge is re-run when that flush ends, so news that landed in the
   *  window does not wait for an edge that has already passed. */
  let missedEdge = false;

  /** THE LAST FRAME A READER WAS GIVEN, or `null` before the first one — what
   *  {@link publishState} compares against to answer "would anybody see
   *  anything different?". */
  let published: ConductorState | null = null;

  /** Two frames, and two members' watch bookkeeping, compared by WHAT THEY SAY
   *  rather than by identity — every publish rebuilds the arrays, so `===`
   *  answers "a new array was made", which is not the question. Derived from
   *  the SCHEMAS the values are declared by, so a field either one grows is
   *  compared without an edit here. */
  const sameFrame = Schema.toEquivalence(ConductorStateSchema);
  const sameWatch = Schema.toEquivalence(MemberWatchSchema);

  /** The state as a READER sees it: whatever the harness last said, plus the
   *  three fields this server authors and the one the WATCH owns. `held` is
   *  published from here rather than carried on the harness's state for the
   *  reason `install` is: each fact has exactly one author, and the
   *  conversation is not the author of kolu's watch. The works themselves are
   *  a cell of their own ({@link worksView}), because a work outlives the
   *  conversation that opened it.
   *
   *  AND THE GATE IS HERE, answering `true` when it published. A caller
   *  cannot decide "did anything visible move?" for itself without naming
   *  every field this function folds — which is a second, hand-written copy
   *  of the projection, and the moment the projection grows a fact that copy
   *  is silently wrong and the panel freezes. The frame that is about to go
   *  out is compared with the one that did. */
  const publishState = (): boolean => {
    state = { ...state, held: heldNews.refs() };
    if (published !== null && sameFrame(published, state)) return false;
    published = state;
    publish(state);
    return true;
  };

  // ── the works: read, moved, published, written ──────────────────────────

  const nowIso = (): string => new Date().toISOString();

  /** A `kolu-work` transition's answer, back as the STORED work.
   *
   *  Every transition in that package SPREADS the record it was given, so the
   *  members it hands back are the very objects that went in and the watch
   *  bookkeeping rides through untouched. The one exception is `joinWork`,
   *  which appends a member of the model's own shape — and that one call site
   *  gives the new member its watch itself. */
  const stored = (work: Work): StoredWork => work as StoredWork;

  /** The work as the WIRE carries it. A member's watch bookkeeping is this
   *  host's working memory: it moves several times per reading, nothing
   *  outside can act on one, and a reader handed it would be drawing
   *  conclusions from the watcher's scratch pad. */
  const bare = (work: StoredWork): Work => ({
    ...work,
    members: work.members.map(({ watch: _watch, ...rest }) => rest),
  });

  const everyWork = (): ReadonlyArray<StoredWork> => [...works.values()];

  /** The works a READER is given, in the order a card keeps: in progress
   *  oldest first, then the finished ones newest first. */
  const worksRead = (): ReadonlyArray<Work> =>
    [...inProgress(everyWork()), ...finished(everyWork())].map((one) =>
      bare(one as StoredWork),
    );

  /** How each member terminal stands, as a reader is told it. A terminal
   *  nothing has read yet is ABSENT rather than carried at zero — "nobody has
   *  looked at its host" and "it has stood this way for no time" are
   *  different facts. */
  const readingsRead = (): ReadonlyMap<
    string,
    { level: ConductorReadingLevel; since: string }
  > => {
    const seen = new Map<
      string,
      { level: ConductorReadingLevel; since: string }
    >();
    for (const [terminal, at] of runtime) {
      if (at.last === null) continue;
      seen.set(terminal, { level: at.last.level, since: at.last.since });
    }
    return seen;
  };

  /** WHAT HAS BEEN PUT ON THE WIRE, so only what MOVED goes out again.
   *
   *  A work is an immutable value: an untouched one keeps its reference, so
   *  identity answers "did this one move" without comparing a timeline event
   *  by event. A reading is a fresh pair every observation, so that one is
   *  compared by what it says. */
  const publishedWorks = new Map<string, StoredWork>();
  const publishedReadings = new Map<string, { level: string; since: string }>();

  /** WHAT MOVED, PUBLISHED — the works whose value changed (or went), and the
   *  readings that moved with them. One work per change rather than all of
   *  them: a work grows an event every time an agent stops, and the twenty
   *  finished ones have nothing to do with it. */
  const publishMoved = (): void => {
    for (const [id, work] of works) {
      if (publishedWorks.get(id) === work) continue;
      publishedWorks.set(id, work);
      publishWork(id, bare(work));
    }
    for (const id of [...publishedWorks.keys()]) {
      if (works.has(id)) continue;
      publishedWorks.delete(id);
      publishWork(id, null);
    }
    readingsChanged();
  };

  /** THE WORKS MOVED — every reader told, and the file owed a write. */
  const worksChanged = (): void => {
    publishMoved();
    schedule("works");
  };

  /** ... and the same for how the member terminals stand. Published beside
   *  the works rather than inside them because it moves on its own clock: a
   *  level change is not a change to the record. */
  const readingsChanged = (): void => {
    const seen = readingsRead();
    for (const [terminal, reading] of seen) {
      const was = publishedReadings.get(terminal);
      if (was?.level === reading.level && was.since === reading.since) continue;
      publishedReadings.set(terminal, reading);
      publishReading(terminal, reading);
    }
    for (const terminal of [...publishedReadings.keys()]) {
      if (seen.has(terminal)) continue;
      publishedReadings.delete(terminal);
      publishReading(terminal, null);
    }
  };

  /** The work a terminal is an ACTIVE member of, if it is one — and only ever
   *  a work IN PROGRESS. A finished work's members are history, and a reading
   *  that arrived late must not re-open one. */
  const memberAt = (
    ref: string,
  ): { work: StoredWork; member: StoredMember } | undefined => {
    for (const work of works.values()) {
      if (work.endedAt !== null) continue;
      const member = work.members.find(
        (one) => one.terminal === ref && one.leftAt === null,
      );
      if (member !== undefined) return { work, member };
    }
    return undefined;
  };

  /** The same work with one member's watch bookkeeping replaced. */
  const withWatch = (
    work: StoredWork,
    ref: string,
    watch: MemberWatch,
  ): StoredWork => ({
    ...work,
    members: work.members.map((one) =>
      one.terminal === ref && one.leftAt === null ? { ...one, watch } : one,
    ),
  });

  const append = (work: StoredWork, event: WorkEvent): StoredWork =>
    stored(recordEvent(work, event));

  /** A work that exists and has not ended, or the refusal that says which of
   *  the two it failed. Every verb the Conductor can call about a work goes
   *  through here, so "no such work" and "that one is over" are one sentence
   *  each rather than one per tool. */
  const openWorkAt = (id: string): StoredWork => {
    const work = works.get(id);
    if (work === undefined) {
      throw new WorkRefusal(
        "unknown-work",
        `There is no piece of work called ${JSON.stringify(id)} — read the \`works\` resource for the ones kolu is keeping, and open one with \`work_open\` if this is new.`,
      );
    }
    if (work.endedAt !== null) {
      throw new WorkRefusal(
        "work-ended",
        `«${work.title}» has ended (${work.outcome ?? "ended"}), so nothing more joins it, is asked about it or is noted on it. Open a new piece of work for what comes next.`,
      );
    }
    return work;
  };

  /** WRITE A WORK BACK — and close it out when this is the change that ended
   *  it.
   *
   *  Two endings are decided here rather than at each call site, because both
   *  are consequences of a change rather than things anybody asks for: a work
   *  whose every member has gone is ABANDONED, and a work that has just ended
   *  (however it ended) owes its files a copy and the history a cap. */
  const save = (work: StoredWork): void => {
    const before = works.get(work.id);
    const ended =
      work.endedAt === null && deserted(work)
        ? stored(endWork(work, { outcome: "abandoned", at: nowIso() }))
        : work;
    works.set(ended.id, ended);
    if (
      before !== undefined &&
      before.endedAt === null &&
      ended.endedAt !== null
    )
      void closeOut(ended.id);
  };

  /** A member leaves — its terminal was closed, released, or went away. The
   *  runtime reading goes with it: there is nothing left to read. */
  const leave = (
    work: StoredWork,
    ref: string,
    why: "closed" | "released" | "gone",
  ): StoredWork => {
    runtime.delete(ref);
    return stored(leaveWork(work, { terminal: ref, at: nowIso(), why }));
  };

  /** A MEMBER TERMINAL THE CONDUCTOR DRIVES, and who is driving it — or the
   *  refusal that says it is none. One sentence for every way a take over can
   *  be about the wrong terminal: it belongs to no work in progress, it has
   *  left, or its work is a `watch` (the person's own terminal, which kolu
   *  never types into) or has no mode decided yet. */
  const drivenMember = (
    ref: string,
  ): {
    work: StoredWork;
    member: StoredMember;
    driver: "conductor" | "you";
  } => {
    const found = memberAt(ref);
    const driver = found === undefined ? null : driverOf(found.work, ref);
    if (found === undefined || driver === null) {
      throw new WorkRefusal(
        "not-driven",
        `kolu's Conductor is not driving ${ref}, so there is nothing to take over or hand back — only an active member of a piece of work in progress that kolu runs (mode full or trivial) is driven.`,
      );
    }
    return { ...found, driver };
  };

  /** THE KEYS CHANGED HANDS — the event, the file, the readers, and the
   *  Conductor told.
   *
   *  The wake goes through the ordinary held-news path and NOT through
   *  `ask(agent)`: a person must be able to take a terminal over while the
   *  agent is down, signed out or mid-turn, so the news waits for somebody to
   *  tell exactly as a terminal's own news does. */
  const handover = (
    found: { work: StoredWork; member: StoredMember },
    ref: string,
    what: "taken-over" | "handed-back",
  ): void => {
    const at = nowIso();
    save(
      stored(
        what === "taken-over"
          ? takeOverRecord(found.work, ref, at)
          : handBackRecord(found.work, ref, at),
      ),
    );
    const split = splitFleetTerminalRef(ref);
    heldNews.hold(ref, {
      ref,
      host: split?.host ?? "",
      terminalId: split?.id ?? "",
      hostName: hostNames.get(split?.host ?? "") ?? split?.host ?? "",
      name: found.member.watch.name,
      agent: found.member.watch.agent ?? "",
      level: what,
      at,
    });
    publishState();
    worksChanged();
    // NOT on the throttle: who may type into a terminal is the one fact a
    // restart must not get wrong.
    writeNow("works");
    void flush();
  };

  /** WHAT A PERSON CALLS EACH HOST, as the watcher's readings say it — kept so
   *  a wake about a terminal nothing is being read from right now (a take
   *  over) can still say where it is. Empty until the first reading, and the
   *  encoded host key is the honest fallback. */
  const hostNames = new Map<string, string>();

  /** Whether what is waiting about a terminal is a HAND-OVER rather than an
   *  agent state. News about who may type into a terminal is not made untrue
   *  by the agent in it going back to work, so it is the one slot the
   *  `working` withdrawal above must leave alone. */
  const handoverHeld = (ref: string): boolean => {
    const held = heldNews.peek(ref);
    return held?.level === "taken-over" || held?.level === "handed-back";
  };

  /** WHERE A WORK'S FILES ARE — the first member whose record named a
   *  worktree, host and all.
   *
   *  Any member will do and the first is as good as the last: a work's members
   *  share a worktree by construction (the planner opens it, the implementor
   *  is a split in the same one), and a member whose terminal is long gone
   *  still remembers the path — which is the case this is written for, because
   *  a work usually ends after its terminals have. */
  const worktreeOf = (
    work: StoredWork,
  ): { host: string; worktree: string } | null => {
    for (const member of work.members) {
      const worktree = member.watch.worktree;
      const host = splitFleetTerminalRef(member.terminal)?.host;
      if (worktree !== null && host !== undefined) return { host, worktree };
    }
    return null;
  };

  /** A MEMBER'S `.waterfall/`, LISTED — and every path kolu has not seen
   *  before put on the timeline.
   *
   *  Off a level change rather than a timer: the moment an agent stops, asks
   *  or comes up is the moment its files have just changed, and a poll would
   *  be kolu reading a directory on every host for ever. A listing that FAILS
   *  is logged and nothing else — the next level change asks again, and a
   *  timeline that announced "could not list files" every few seconds would
   *  bury the events a person is reading it for. */
  const listFiles = (
    id: string,
    ref: string,
    at: { host: string; worktree: string },
  ): void => {
    if (listing.has(ref)) return;
    listing.add(ref);
    void workFiles
      .list(at)
      .then((paths) => {
        const work = works.get(id);
        if (work === undefined || work.endedAt !== null) return;
        const already = filesSeen(work);
        const stamp = nowIso();
        let next = work;
        for (const path of paths) {
          if (already.has(path)) continue;
          next = append(next, {
            at: stamp,
            by: "agent",
            kind: "file",
            terminal: ref,
            detail: path,
          });
        }
        if (next === work) return;
        save(next);
        worksChanged();
      })
      .catch((err: unknown) => {
        log.warn(
          { err, ref },
          "kolu-server: the conductor could not list a work's files",
        );
      })
      .finally(() => {
        listing.delete(ref);
      });
  };

  /** The check rollup, as an event and as the timeline's own reading of it —
   *  two tables rather than one `switch`, so "which event" and "what the
   *  timeline would then say" are read from the same row. */
  const CHECK_EVENT = {
    pending: "checks-running",
    pass: "checks-passed",
    fail: "checks-failed",
  } as const;
  const CHECK_READING = {
    pending: "running",
    pass: "passed",
    fail: "failed",
  } as const;

  /** THE PR, as the timeline learns it — compared against what the timeline
   *  ALREADY says (`prOf`) and never against the last reading.
   *
   *  That is what makes two members looking at one PR record it once, and a
   *  restart record nothing twice: the comparison is against the work, which
   *  survives both. A merge or a close ENDS the work here, because the PR is
   *  the one thing that says a piece of work is finished rather than merely
   *  quiet. */
  const prEvents = (
    work: StoredWork,
    ref: string,
    pr: WatchPr,
    at: string,
  ): StoredWork => {
    let next = work;
    const known = prOf(next);
    if (known === null || known.number !== pr.number) {
      next = append(next, {
        at,
        by: "agent",
        kind: "pr-opened",
        terminal: ref,
        detail: `#${pr.number} ${pr.title}`,
      });
    }
    if (pr.checks !== null && prOf(next)?.checks !== CHECK_READING[pr.checks]) {
      next = append(next, {
        at,
        by: "ci",
        kind: CHECK_EVENT[pr.checks],
        terminal: ref,
        detail: pr.checks === "fail" ? pr.failing.join(", ") : "",
      });
    }
    if (pr.state === "merged" && prOf(next)?.state !== "merged") {
      next = append(next, {
        at,
        by: "kolu",
        kind: "merged",
        terminal: ref,
        detail: `#${pr.number}`,
      });
      next = stored(endWork(next, { outcome: "merged", at }));
    }
    if (pr.state === "closed" && prOf(next)?.state !== "closed") {
      next = append(next, {
        at,
        by: "kolu",
        kind: "pr-closed",
        terminal: ref,
        detail: `#${pr.number}`,
      });
      next = stored(endWork(next, { outcome: "closed", at }));
    }
    return next;
  };

  /** WHAT A RING PUTS ON THE TIMELINE, beside waking the conversation.
   *
   *  The same word in both places wherever there is one: a reader of the card
   *  and the agent reading its wake are told the same thing happened. The two
   *  that differ say why below. */
  const ringEvent = (
    ref: string,
    level: ConductorWakeEvent["level"],
    at: string,
  ): WorkEvent | null => {
    switch (level) {
      case "ready":
      case "stopped":
      case "asking":
      case "exited":
        return { at, by: "agent", kind: level, terminal: ref, detail: "" };
      case "asleep":
        // Nothing an agent did: a person (or kolu) put the terminal away, and
        // the agent in it went with it.
        return { at, by: "kolu", kind: "asleep", terminal: ref, detail: "" };
      case "ended":
        // The command ran and gave the prompt back with NO agent ever in the
        // terminal — the agent the Conductor asked for never came up. For a
        // reader of the timeline that is the same ending as an exit, so it is
        // spelled as one, with the detail saying which kind it was. By kolu,
        // because there was no agent there to do it.
        return {
          at,
          by: "kolu",
          kind: "exited",
          terminal: ref,
          detail: "ended without an agent",
        };
      case "gone":
        // Not an event of its own: a terminal that went away LEFT the work,
        // and `leaveWork` writes that with its reason.
        return null;
      case "taken-over":
      case "handed-back":
        // Not a reading at all: a person took the keys, and the event for
        // that was written where it happened ({@link handover}). No reading
        // ever produces one of these.
        return null;
    }
  };

  /** THE WORK IS OVER — keep its files, then cap the history.
   *
   *  The files are gathered from both ends: what kolu SAW appear
   *  (`filesSeen`) and what is in `.waterfall/` right now, because a file
   *  written while nothing changed level was never observed and is still the
   *  plan somebody will want to read next month. A copy that fails is SAID on
   *  the timeline rather than swallowed — the files are the half of a work
   *  that outlives its worktree, and a person has to know they did not.
   *
   *  Then the cap: the twenty most recently finished works are kept and the
   *  rest are forgotten, kept files and all. Written immediately rather than
   *  on the throttle — an end and a cap are the two movements whose whole
   *  point is that what was there is gone. */
  const closeOut = async (id: string): Promise<void> => {
    const ending = works.get(id);
    if (ending === undefined || ending.endedAt === null) return;
    const at = worktreeOf(ending);
    const paths = new Set(filesSeen(ending));
    if (at !== null) {
      try {
        for (const path of await workFiles.list(at)) paths.add(path);
      } catch (err) {
        log.warn(
          { err, work: id },
          "kolu-server: the conductor could not list a finished work's files",
        );
      }
    }
    const ended = works.get(id);
    if (ended !== undefined && at !== null && paths.size > 0) {
      try {
        const kept = await workFiles.keep({
          ...at,
          work: id,
          paths: [...paths],
        });
        works.set(id, stored(keepFiles(ended, { files: kept, at: nowIso() })));
      } catch (err) {
        works.set(id, stored(keepFailed(ended, sentenceOf(err), nowIso())));
      }
    }
    for (const dropped of capFinished(everyWork()).dropped)
      works.delete(dropped.id);
    sweepFiles();
    worksChanged();
    writeNow("works");
  };

  /** THE KEPT FILES, RECONCILED TO THE WORKS — one rule, run wherever the set
   *  of works can shrink: a directory no stored work names is a directory
   *  nothing can ever read again (a work that fell off the cap, or one a
   *  restored backup never had). Doing it by reconciliation rather than by
   *  deleting what this process happened to drop is what makes a restore —
   *  which replaces the whole set at once — cost the same line. */
  const sweepFiles = (): void => {
    void workFiles.sweep([...works.keys()]).catch((err: unknown) => {
      log.warn(
        { err },
        "kolu-server: the conductor could not delete the files of works it no longer keeps",
      );
    });
  };

  /** PUT KOLU'S OWN QUESTIONS to the human, as ONE ask the work knows about —
   *  `work_open`'s setup and `work_ask`'s questions, through the same
   *  machinery an agent's elicitation rides.
   *
   *  The decisions are written when the ask id is MINTED, before anything can
   *  answer it: the row and the record name each other from the first instant,
   *  so a person answering from the card the moment it appears cannot land an
   *  answer on a work that does not know it was asked. */
  const putAsk = async (
    id: string,
    message: string,
    questions: ReadonlyArray<Question>,
  ): Promise<{ answered: boolean; ask: string }> => {
    const at = nowIso();
    let askId = "";
    const settled = await ask((agent) =>
      // A question the request already answered (`given`) is recorded with
      // the rest but never drawn: nobody is asked what they already said.
      agent.askPerson(
        askForm(
          message,
          questions.filter((one) => one.given === undefined),
        ),
        {
          work: id,
          known: (minted) => {
            askId = minted;
            const work = works.get(id);
            if (work === undefined) return;
            save(stored(askQuestions(work, { ask: minted, at, questions })));
            worksChanged();
          },
        },
      ),
    );
    const settledAt = nowIso();
    const from = answeredFrom.get(askId) ?? null;
    answeredFrom.delete(askId);
    const work = works.get(id);
    if (work !== undefined) {
      // WITHDRAWN is nobody's answer: the conversation that asked it went
      // away, so the decision is DROPPED rather than recorded as a refusal
      // the human never made.
      save(
        settled.outcome.how === "withdrawn"
          ? stored(dropAsk(work, askId, settledAt))
          : stored(
              answerAsk(work, {
                ask: askId,
                at: settledAt,
                from,
                values:
                  settled.outcome.how === "declined"
                    ? null
                    : new Map(
                        questions.map((one) => [
                          one.id,
                          pickedValues(settled.content, one.id),
                        ]),
                      ),
              }),
            ),
      );
      worksChanged();
    }
    return { answered: settled.outcome.how === "answered", ask: askId };
  };

  const remembered = (): void => {
    if (read) return;
    let record: PersistedConductor;
    let kept: PersistedWorks;
    let transcript: PersistedTranscript;
    try {
      record = readPersistedConductor(store, storePath());
      kept = readPersistedWorks(worksStore, storePath());
      transcript = readPersistedTranscript(transcriptStore, transcriptPath());
    } catch (err) {
      // This read happens on edges OUTSIDE `live()`'s refusal arm — a `watch`,
      // whose sink cannot be thrown at, and the first procedure call, before
      // there is a spawn to fail. Left to itself the schema's crash would
      // cross as an undeclared error while the cell still said `refusal:
      // null`: an idle-looking panel over a state-root nobody can read. Said
      // in the cell AND rethrown — the reader sees the sentence naming the
      // file, and the caller that CAN hear it still fails fast.
      sayRefusal(err);
      throw err;
    }
    // Marked read only once the records HAVE been read: a refusal that left
    // this set would be a crash the first reader saw and every later one
    // silently did not, which is the fail-fast stance inverted.
    read = true;
    // THE WORKS COME BACK WHATEVER HAPPENED TO THE CONVERSATION, which is the
    // whole point of their being a record of their own: a work outlives the
    // chat that opened it, and a kolu-server whose `$HOME` moved is still
    // running the waterfall it was running yesterday.
    for (const work of kept) {
      // A QUESTION THAT WAS STILL OPEN IS DROPPED, here, at the boot that
      // found it: the conversation holding that promise is gone, so nobody can
      // answer it any more and a decision left `null` would make the card say
      // a person is being waited on for ever.
      const at = nowIso();
      works.set(
        work.id,
        openAsks(work).reduce(
          (one, askId) => stored(dropAsk(one, askId, at)),
          work,
        ),
      );
      for (const member of work.members) {
        if (member.leftAt !== null) continue;
        runtime.set(member.terminal, restoredMember(member.watch));
      }
    }
    if (works.size > 0) {
      publishMoved();
      // A RESTORE IS THE MEMBERSHIP MOVING: it went from nothing to whatever
      // the file held, and the watcher has to scope itself to those hosts. It
      // reads the membership itself at boot too, but this edge is also reached
      // by the first procedure call of a process whose watcher has already
      // looked.
      membersMoved(true);
    }
    // A state-root whose `$HOME` moved cannot resume: a stored session id is
    // scoped to the directory it was opened in, and asking the agent for one
    // it cannot find is a refusal with nothing to do about it. Opening fresh
    // is the honest answer, and the rows AND the fleet go with the session —
    // a transcript claiming a conversation that is not coming back is a lie,
    // and so is a fleet strip naming the terminals of one.
    if (record.cwd === home) {
      resume = record.sessionId;
      // The agent re-asserts its own default over a resumed conversation, so a
      // choice kolu saw is the half that loses unless it is handed back.
      chosenModel = record.model;
      for (const row of transcript.rows) byId.set(row.id, row);
      rowsCache = null;
      state = { ...state, sessionId: record.sessionId, fleet: record.fleet };
      publishState();
    }
    // ... and the files go with them. This is the one edge where the set of
    // rows can SHRINK — the record was capped at {@link ROW_CAP}, or the home
    // moved and the whole transcript was let go — so it is the one edge where
    // a file can be left naming nothing. See {@link sweepAttachments}.
    sweepAttachments();
  };

  // ── a prompt's files ────────────────────────────────────────────────────

  const attachmentsDir = (): string => join(stateRoot, ATTACHMENTS_DIR);

  /** The uploads this server has taken that no row names YET — id to the
   *  moment the last chunk of it landed. An upload in progress is in here
   *  from its first chunk, which is what stops the sweep below from deleting
   *  a file out from under the chunk that is about to extend it. */
  const unsent = new Map<string, number>();

  /** Reconcile the attachment directory to the rows that still name a file,
   *  plus the uploads somebody may still send.
   *
   *  THE RULE: a file lives exactly as long as the transcript row it came in
   *  on. That ties four leaks shut at one seam — a record the row cap
   *  trimmed, a state-root whose home moved and let the whole transcript go,
   *  a server that died between writing the bytes and persisting the row that
   *  names them, and a prompt that was REFUSED after its files had been
   *  uploaded.
   *
   *  The one exception is an upload younger than {@link
   *  UNSENT_ATTACHMENT_MS}: it has no row because nobody has pressed Send
   *  yet, and deleting it would be this server reaping a file while a person
   *  is still typing the sentence it goes with.
   *
   *  It runs on the RESTORE (the moment rows are LOST), on every upload that
   *  creates a file (the moment the directory GROWS), after a prompt that was
   *  refused (the moment files stop being destined for a row), and on the
   *  WIPE ({@link clearSession}), which is the moment every row is lost at
   *  once. A `newSession` is none of those and must not be: the divider says
   *  the agent's memory was reset, not that the scroll above it was thrown
   *  away, and the rows above it still draw their chips. Rows otherwise only
   *  arrive; the only ones a frame REMOVES are the ones the harness upserts
   *  at a fixed key (the plan, a tool card), which carry no files.
   *
   *  BEFORE THE RECORD IS READ it does nothing at all: `byId` is empty until
   *  the restore, and a sweep judging a restored state-root against an empty
   *  transcript would delete every file the conversation is still drawing.
   *
   *  A sweep that cannot read its own directory is WARNED about rather than
   *  thrown from: what it would have cost is disk, and refusing to open the
   *  conversation over that would cost the conversation. */
  const sweepAttachments = (): void => {
    if (!read) return;
    const dir = attachmentsDir();
    if (!existsSync(dir)) return;
    const named = new Set<string>();
    for (const row of byId.values()) {
      if (row.kind !== "user") continue;
      for (const one of row.attachments) named.add(one.id);
    }
    const now = Date.now();
    try {
      for (const name of readdirSync(dir)) {
        if (named.has(name)) continue;
        const since = unsent.get(name);
        if (since !== undefined) {
          if (now - since < UNSENT_ATTACHMENT_MS) continue;
          unsent.delete(name);
        }
        rmSync(join(dir, name), { force: true });
      }
    } catch (err) {
      log.warn(
        { err, dir },
        "kolu-server: the conductor could not sweep its attachments",
      );
    }
  };

  /** Take ONE CHUNK of a file and put it on disk.
   *
   *  WHY THE BYTES ARRIVE IN PIECES AT ALL. A prompt carrying its own base64
   *  is one frame that scales with the file, and the RPC decoder does not
   *  fail an oversized frame — it closes the socket with 1009 and takes every
   *  subscription in the tab with it. The terminal's paste learned this in
   *  production (`packages/client/src/terminal/pasteDelivery.ts`), and this
   *  is the same shape: the sender cuts the base64 into frame-sized pieces,
   *  the first creates, each later one appends to the path it was handed.
   *
   *  The writes are SYNCHRONOUS on purpose. An append is only correct if
   *  nothing interleaves with it, and a sync write is the cheapest way to say
   *  that about a handler the surface may enter twice — the sender is
   *  sequential per attachment, and this is what happens when it is not.
   *
   *  `appendTo` comes from the wire, so it is VALIDATED rather than trusted:
   *  a continuation token that could name any path turns an upload into an
   *  arbitrary-file append. It must resolve inside this state-root's
   *  attachments directory and be this attachment's own file; `realpathSync`
   *  resolves symlinks BEFORE the comparison, so a link planted in the
   *  directory cannot point the append out of it. */
  const attachChunk = (chunk: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    appendTo?: string;
  }): { path: string; bytes: number } => {
    if (!SAFE_ATTACHMENT_ID.test(chunk.id)) {
      throw new ConductorRefused({
        why: `“${chunk.name}” came with the id ${JSON.stringify(chunk.id)}, which is not a name this server will write a file under.`,
        auth: false,
      });
    }
    mkdirSync(attachmentsDir(), { recursive: true });
    const dir = realpathSync(attachmentsDir());
    const body = Buffer.from(chunk.data, "base64");
    let path: string;
    if (chunk.appendTo === undefined) {
      // THE CREATE, and the moment the directory grows — so it is where the
      // reaping happens. The write TRUNCATES: a second upload under the same
      // id is a file being sent again, not a file being doubled.
      remembered();
      sweepAttachments();
      writeFileSync(join(dir, chunk.id), body, { mode: 0o600 });
      path = realpathSync(join(dir, chunk.id));
    } else {
      // An append is only ever a CONTINUATION. A missing target is a protocol
      // violation rather than a first chunk, and it is checked before
      // `realpathSync`, which would otherwise throw a bare ENOENT that reads
      // as a crash instead of a refusal.
      if (!existsSync(chunk.appendTo)) {
        throw new ConductorRefused({
          why: `“${chunk.name}” has no file to append to on this host, so the upload was refused. Start it again.`,
          auth: false,
        });
      }
      const real = realpathSync(chunk.appendTo);
      // `sep`-terminated prefix, so `/state/conductor/attachments` cannot
      // be matched by `/state/conductor/attachments-elsewhere`; and the
      // file must be this attachment's own, which is the id it was validated
      // under.
      if (!real.startsWith(dir + sep) || basename(real) !== chunk.id) {
        throw new ConductorRefused({
          why: `“${chunk.name}” tried to continue into ${JSON.stringify(chunk.appendTo)}, which is not this attachment's file under this host's attachments directory.`,
          auth: false,
        });
      }
      appendFileSync(real, body, { mode: 0o600 });
      path = real;
    }
    // Measured from the FILE, after the write: the cap is enforced on what
    // this server actually holds, never on a chunk count or on what the
    // sender said it was sending. Per chunk rather than at the end, because
    // an upload that is refused only once it is finished has already cost the
    // disk it was refused for.
    const bytes = statSync(path).size;
    unsent.set(chunk.id, Date.now());
    if (bytes > ATTACHMENT_BYTE_CAP) {
      // Dropped rather than left half-written: a file the cap refused must
      // not be one a prompt can still name.
      rmSync(path, { force: true });
      unsent.delete(chunk.id);
      throw new ConductorRefused({
        why: attachmentTooBig(chunk.name, bytes),
        auth: false,
      });
    }
    return { path, bytes };
  };

  /** The attachments a prompt NAMED, found on disk and measured.
   *
   *  Nothing is written here — the bytes arrived chunk by chunk through
   *  {@link attachChunk}, and what a prompt carries is a name. The `path` the
   *  caller sent is not read at all: the file is looked up by ID under this
   *  server's own directory, so a path from the wire cannot choose what the
   *  agent is handed, and `bytes` is re-read from the file so the chip, the
   *  cap and the thing on disk are three readings of one number.
   *
   *  The per-PROMPT cap lives here because this is the only place a message's
   *  attachments are seen together; the per-attachment cap is enforced where
   *  the bytes are written, which is the only place a growing file is seen at
   *  all. The composer refuses first because refusing early is kinder, but
   *  this is the end that has to live with the bytes, and a cap that only the
   *  sender enforces is not a cap. */
  const namedAttachments = (
    attachments: ReadonlyArray<ConductorAttachment>,
  ): ReadonlyArray<ConductorAttachment> => {
    if (attachments.length === 0) return attachments;
    const named: ConductorAttachment[] = [];
    let total = 0;
    for (const one of attachments) {
      if (!SAFE_ATTACHMENT_ID.test(one.id)) {
        throw new ConductorRefused({
          why: `“${one.name}” came with the id ${JSON.stringify(one.id)}, which is not a name this server will write a file under.`,
          auth: false,
        });
      }
      const held = join(attachmentsDir(), one.id);
      if (!existsSync(held)) {
        throw new ConductorRefused({
          why: attachmentGone(one.name),
          auth: false,
        });
      }
      const path = realpathSync(held);
      const bytes = statSync(path).size;
      total += bytes;
      if (total > PROMPT_ATTACHMENT_BYTE_CAP) {
        throw new ConductorRefused({
          why: promptAttachmentsTooBig(total),
          auth: false,
        });
      }
      named.push({ ...one, bytes, path });
    }
    return named;
  };

  // ── the three records, written on one throttle ─────────────────────────

  /** WHAT IS OWED TO DISK — three records, one timer.
   *
   *  They move at wildly different rates: the transcript at an agent's output
   *  cadence, the works when something is observed, the conversation's own
   *  record when the session or the model changes. One timer, three flags, so
   *  a streaming answer rewrites the transcript file and nothing else — which
   *  is the whole reason the rows left `config.json`. */
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const due = { record: false, transcript: false, works: false };
  let persistedAt = 0;

  const writeDue = (): void => {
    persistedAt = Date.now();
    if (due.record) {
      due.record = false;
      store.set(persistedFrom(state));
    }
    if (due.transcript) {
      due.transcript = false;
      transcriptStore.set(transcriptFrom(rows()));
    }
    if (due.works) {
      due.works = false;
      worksStore.set([...works.values()]);
    }
  };

  /** Something moved; the file should say so within the window. Leading-edge:
   *  the first movement is durable immediately, and a burst then costs one
   *  write a second instead of six hundred. */
  const schedule = (what: keyof typeof due): void => {
    due[what] = true;
    if (persistTimer !== undefined) return;
    const since = Date.now() - persistedAt;
    if (since >= PERSIST_THROTTLE_MS) {
      writeDue();
      return;
    }
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      if (due.record || due.transcript || due.works) writeDue();
    }, PERSIST_THROTTLE_MS - since);
    // A pending write must never be the reason this process stays up: the
    // records are a convenience for the NEXT kolu-server, and `dispose`
    // flushes them.
    persistTimer.unref();
  };

  /** Write one record NOW, whatever the throttle thinks. The two callers are
   *  the movements whose whole point is that what was there is gone: a work
   *  ending (with its files kept and the history capped) and the wipe. */
  const writeNow = (what: keyof typeof due): void => {
    due[what] = true;
    writeDue();
  };

  /** Write whatever the throttle still owes, now. The one caller is `dispose`
   *  — a server that stopped mid-window would otherwise lose the tail of the
   *  conversation it just finished having. */
  const flushPersist = (): void => {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    if (due.record || due.transcript || due.works) writeDue();
  };

  const snapshot = (): ConductorFrame => ({
    kind: "snapshot",
    seq,
    rows: [...rows()],
  });

  /** One place where a conversation's movement reaches everybody: the rows we
   *  keep, the readers subscribed now, and the file a restart will read.
   *
   *  REMOVES, then UPSERTS, then APPENDS — the canonical fold order, stated on
   *  `ConductorFrameSchema` and obeyed identically by the client's copy. A
   *  frame that removes a row and re-upserts the same id in one breath is a
   *  REPLACEMENT, and an append in the same frame is appended to the row that
   *  frame just put there. */
  const applyRows = (change: {
    upserts: ReadonlyArray<ConductorRow>;
    removes: ReadonlyArray<string>;
    appends: ReadonlyArray<{ of: string; at: number; text: string }>;
  }): void => {
    seq += 1;
    for (const id of change.removes) byId.delete(id);
    for (const row of change.upserts) byId.set(row.id, row);
    for (const saying of change.appends) {
      const row = byId.get(saying.of);
      if (row !== undefined && "text" in row) {
        byId.set(saying.of, {
          ...row,
          text: appendedText(row.text, saying.at, saying.text),
        });
      }
    }
    rowsCache = null;
    const frame: ConductorFrame = {
      kind: "delta",
      seq,
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends,
    };
    for (const sink of sinks) sink(frame);
    schedule("transcript");
  };

  /** The one MCP server the session is handed, PROVEN before it is handed
   *  over. EXACTLY one, by design: the conversation's whole job is the fleet's
   *  terminals, and every other server on its wire is one the AGENT brought —
   *  which is what the roster strip's "plus the agent's own" says out loud.
   *
   *  It is an HTTP server rather than a stdio child, and that is the whole
   *  point of the fleet face: the hands are IN THIS PROCESS, over a loopback
   *  listener, so there is no relay subprocess per host and no ssh child
   *  beside the adapter. A host that arrives or leaves while the conversation
   *  runs flows through the one URL the session was opened with.
   *
   *  WHY THE ENDPOINT IS PROVED AND NOT JUST NAMED. This hand-over happens
   *  ONCE, inside `session/new`, and nothing ever revisits it: the agent
   *  connects the server, and if that connect does not land it marks it failed
   *  for the life of the conversation and carries on — running shell commands
   *  itself instead of opening terminals, which is the one failure this whole
   *  feature exists to prevent. Measured against the pinned adapter on this
   *  host: a server naming nothing is `failed` one second in, one that accepts
   *  and never answers is `failed` eleven seconds in, and the agent says
   *  nothing about either beyond a word on a roster nobody is reading yet. So
   *  a URL that is merely a STRING is not good enough to hand over: the
   *  refusal belongs here, where it can be said in the panel, rather than
   *  thirty seconds later inside an agent that has already decided to do
   *  without us.
   *
   *  What the proof establishes is that the URL accepts this process's token
   *  and OPENS A SESSION to it — the first three things the adapter's client
   *  will find out, found out first by the server that is about to claim they
   *  work. A door that is listening and will not serve this caller is the
   *  failure that matters most, because it is the one that looks like health.
   *  It does not prove the fleet is healthy; a host that is unreachable is the
   *  fleet face's own business to refuse by name, per host, as it is asked. */
  const provenFleetServer = async (): Promise<HttpServer> => {
    const at = fleetMcp();
    if (at === null) throw new ConductorUnavailable({ why: NO_FLEET_MCP });
    // The door reports what it saw; the refusal is this module's to raise —
    // the shape `FleetHosts` already uses for a host that is not answering.
    const why = await proveFleetMcp(at, log);
    if (why !== null) throw new ConductorUnavailable({ why });
    return {
      kind: "http",
      name: "kolu",
      url: at.url,
      headers: { Authorization: `Bearer ${at.token}` },
    };
  };

  /** A bring-up that did not get there, said OUT LOUD.
   *
   *  The failure is a missing socket, an adapter that would not start, or a
   *  session the agent refused — and in every one of them the caller that
   *  tripped it may be a transcript subscription, which cannot throw at
   *  anybody. Publishing it is the difference between a panel that says what
   *  happened and an idle-looking one with a live composer under it. */
  const sayRefusal = (err: unknown): void => {
    state = { ...state, phase: "offline", refusal: sentenceOf(err) };
    publishState();
  };

  /** How many notices THIS HOST has written, for the row ids it mints. */
  let notices = 0;

  /** KOLU'S OWN SENTENCE IN THE TRANSCRIPT — a `notice` row this module
   *  writes rather than one the agent's harness reported.
   *
   *  Minted HERE and not through the harness because the failure that needs
   *  saying most is the one where there IS no harness: a wake that could not
   *  go because the conversation would not come up has nobody to mint it. The
   *  id is this host's own (`kolu:notice:N`) so it cannot collide with the
   *  harness's (`user:N`, `agent:N`), and the seq follows the last row there
   *  is — the same fence a replacement harness resumes from. */
  const sayNotice = (text: string): void => {
    notices += 1;
    applyRows({
      upserts: [
        {
          kind: "notice",
          id: `kolu:notice:${notices}`,
          seq: (rows().at(-1)?.seq ?? 0) + 1,
          since: new Date().toISOString(),
          text,
        },
      ],
      removes: [],
      appends: [],
    });
  };

  /** Bring the conversation up, once, and hand back the same promise to every
   *  caller that arrives while it is in flight — so two readers opening at the
   *  same instant cannot spawn two adapters. */
  const live = async (): Promise<Harness> => {
    const running = harness;
    if (running !== null) {
      if (running.alive()) return running;
      // A CORPSE is absent, not present-and-broken. The child exited (the
      // agent crashed, somebody killed it, the machine ran out of memory) and
      // every verb — `newSession` included — would otherwise refuse for the
      // life of the process with nothing a person could do about it. The stop
      // is fired rather than awaited so this stays synchronous up to the
      // `starting` assignment below: a second caller arriving mid-await would
      // see no harness and no bring-up in flight, and spawn a second adapter.
      harness = null;
      void running.stop().catch((err: unknown) => {
        log.warn(
          { err },
          "kolu-server: the conductor's dead agent did not clean up",
        );
      });
    }
    if (starting !== null) return starting;
    if (absent !== null) throw new ConductorUnavailable({ why: absent.why });
    if (disposed) {
      throw new ConductorUnavailable({
        why: "This kolu is shutting down, so its conductor is no longer accepting work.",
      });
    }
    remembered();
    // THE WHOLE BRING-UP IS ONE PROMISE, assigned to `starting` on the line
    // after it is made and never awaited before then — so two readers arriving
    // in the same tick share it rather than spawning two adapters. It has to
    // be a promise from the first step now that the first step is asking
    // whether this kolu's own fleet MCP face is answering ({@link
    // provenFleetServer}): a refusal there is a rejection like any other, which
    // is why there is no synchronous arm around the options any more.
    const begun = (async (): Promise<Harness> => {
      const kolu = await provenFleetServer();
      return spawn({
        leg: ENGINE.leg,
        adapter: seating as Exclude<typeof seating, NotHere>,
        cwd: home,
        // WHICH STORE THE AGENT'S SIGNATURE COMES OUT OF, for the sentence a
        // signed-out panel shows. Read from THIS process's environment because
        // that is the environment the adapter is spawned into — kolu-server's
        // own, not the one a person's terminal happens to have.
        configDir: conductorConfigDir(process.env, home),
        mcpServers: [kolu],
        teaching: teachingLines(hostName),
        log,
        // A conversation that never had a turn is opened again, not resumed —
        // see {@link hadATurn}. Decided at EVERY spawn, not once at boot: a
        // replacement adapter over a "new session" nobody has spoken into yet
        // is the same id with nothing behind it.
        resume: resume !== null && hadATurn(rows()) ? resume : null,
        // THE RESTART FENCE (see the module doc), taken HERE rather than at the
        // restore, because the restore is not the only spawn: a replacement
        // adapter comes up over everything the dead one minted as well as
        // everything the file restored, and a fence frozen at restore time
        // would hand it a number it has already passed — `user:1` and
        // `agent:2` minted a second time, overwriting by id the rows we are
        // still holding. `rows()` is sorted by `seq`, so its last is the
        // highest one that exists.
        resumedSeq: rows().at(-1)?.seq ?? 0,
        // THE DIVIDER FENCE, across the same seam and for the same reason.
        // A replacement harness builds a FRESH transcript, whose
        // "no two dividers in a row" guard can only see the rows IT minted —
        // so a `newSession` taken straight after a respawn would mint a
        // divider beside our last row, which is already one, and the
        // panel would draw two rules for one reset until the next boot
        // read collapsed them.
        resumedEndsWithDivider: rows().at(-1)?.kind === "divider",
        // The terminals this conversation was working with. Membership
        // otherwise accrues only from tool-call frames, and a resumed
        // conversation's frames are the replay the harness drops — so without
        // this seed the first publish would carry an empty fleet, and we
        // would write that emptiness back over our own record.
        fleet: state.fleet,
        model: chosenModel,
        onChange: (change) => {
          if (change.kind === "state") {
            // A TEARDOWN'S LAST BREATH IS NOT NEWS. `stop()` nulls the live
            // session and publishes one final state saying so, and we persist
            // what we are told — so a drain or an upgrade would write
            // `sessionId: null` beside the rows it just kept, and the next
            // boot would restore the transcript into a conversation it never
            // resumed. What the file must hold is the conversation as it stood
            // when the process let go of it.
            if (disposed) return;
            // The harness answers for the conversation; `seen`, `work` and
            // `held` are this module's and are folded back on by
            // `publishState`.
            state = {
              ...state,
              ...change.state,
              ...serverAuthored,
            };
            // WHICH CONVERSATION A REPLACEMENT ADAPTER COMES BACK INTO: the
            // one this agent is in NOW, rather than the id the file named at
            // boot. A conversation can move on without anybody restarting —
            // somebody asks for a new session, or the agent refuses the
            // remembered id because its own store has never heard of it and
            // the harness opens a fresh one in its place — and a replacement
            // spawned over the boot-time id would then ask for a conversation
            // that is either gone (one more break and one more line, every
            // crash) or STALE, which is a panel quietly reverting to an older
            // chat. The null is skipped for the reason just above: a
            // teardown's last breath is a stop, not a conversation ending.
            if (state.sessionId !== null) resume = state.sessionId;
            publishState();
            schedule("record");
            // THE TURN BOUNDARY, whichever way the turn ended — answered,
            // refused, cancelled. Everything a member terminal said while it
            // was running has been waiting for exactly this moment, and it
            // leaves as ONE wake. Not on `asking`: a form on screen is a turn
            // still running, and a wake sent into it would queue behind the
            // answer a person has not given yet.
            if (state.phase === "idle") void flush();
            return;
          }
          applyRows(change);
        },
      });
    })();
    starting = begun
      .then((started) => {
        harness = started;
        // AN AGENT THAT CAME UP IS AN EDGE A HELD WAKE WAITS FOR. A flush
        // that failed because the conversation would not start left its news
        // on the list ({@link flush}); nothing else here would notice that
        // the reason is gone, and a conversation that is now up with news
        // nobody delivered is the indefinite wait this whole feature exists
        // to remove. Re-entrant by design: a flush that is already running is
        // the caller of this very bring-up and its own guard drops this one.
        void flush();
        return started;
      })
      .catch((err: unknown) => {
        sayRefusal(err);
        throw err;
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  };

  /** Every procedure goes through here, so the two refusals a caller can
   *  branch on are translated at ONE seam rather than at eight. A harness word
   *  that is neither is a DEFECT and crosses the wire as one: a conductor
   *  that broke in a way nobody declared should crash loudly, not arrive as a
   *  polite sentence in a chat. */
  const ask = async <T>(work: (agent: Harness) => Promise<T>): Promise<T> => {
    try {
      return await work(await live());
    } catch (err) {
      if (err instanceof HarnessUnavailable) {
        throw new ConductorUnavailable({ why: err.why });
      }
      if (err instanceof HarnessRefused) {
        throw new ConductorRefused({ why: err.why, auth: err.auth });
      }
      throw err;
    }
  };

  /**
   * EVERYTHING WAITING, OUT AS ONE TURN — or held a little longer.
   *
   * Called from the two edges that can make it possible: a terminal ringing
   * while nothing is running, and a turn ending. Both arrive asynchronously
   * and either may find the conversation busy, which is why the decision is
   * made HERE rather than at the callers — a wake is sent only into an IDLE
   * conversation, and anything else leaves the news exactly where it was.
   *
   * A WAKE MAY START THE AGENT. That is the one place this module brings a
   * conversation up for something a person did not type, and it is deliberate:
   * the whole feature is kolu noticing that a watched terminal needs the
   * Conductor, and a Conductor that is not running is one that will never
   * notice anything again. What must NOT start it is reading the list, which
   * is why {@link ConductorHost.watched} does not come through here.
   *
   * The slots are TAKEN before the wake is awaited, so a terminal that rings
   * during the round trip is held for the next flush rather than sent twice;
   * a wake that then fails puts back the ones nothing newer has replaced.
   *
   * ## When a wake cannot go at all
   *
   * It is SAID — one `notice` row naming the terminals still waiting and the
   * sentence behind the failure — and then retried on the next edge that could
   * make it work. A caught error that only reached the log is the thing
   * `AGENTS.md` refuses: the held news would sit behind an idle-looking
   * conversation with nothing on screen to say why.
   *
   * THE RETRY IS EVENT-DRIVEN AND HAS NO TIMER, because the whole design has
   * none. Three edges reach here and each is a real change in the world: the
   * conversation going idle (which includes a replacement agent finishing its
   * bring-up, a sign-in landing, and a person's own turn ending), the agent
   * coming up at all ({@link live}), and the next reading from the watcher.
   * One notice per FAILURE EPISODE rather than per retry: the news that could
   * not go is one piece of news, and a row per attempt would be a conversation
   * full of kolu apologising to itself. The latch lifts the moment a wake
   * lands.
   *
   * AN EDGE THAT ARRIVES WHILE A FLUSH IS RUNNING IS NOT LOST. Only one flush
   * runs at a time — two would be two wakes for one boundary — so a second
   * one is dropped, and `missedEdge` remembers that something happened while
   * the first was on the wire. The dropped edge is re-run when that flush
   * ends, whichever way it ended: a terminal that rang during a wake that
   * then failed would otherwise wait for an edge that has already been and
   * gone. It cannot spin, because the re-run needs a REAL edge to have landed
   * in the window, and an empty list returns at the top.
   */
  const flush = async (): Promise<void> => {
    if (disposed) return;
    if (flushing) {
      missedEdge = true;
      return;
    }
    if (heldNews.waiting().length === 0) return;
    flushing = true;
    try {
      const agent = await live();
      if (agent.state().phase !== "idle") return;
      const slots = heldNews.waiting();
      if (slots.length === 0) return;
      const events = slots.map((slot) => slot.value);
      heldNews.took(slots);
      publishState();
      try {
        await agent.wake(
          wakeText(events, (ref) => {
            const found = memberAt(ref);
            return found === undefined
              ? null
              : { role: found.member.role, title: found.work.title };
          }),
          events,
        );
      } catch (err) {
        // The words never went. They go back on the list — except for a
        // terminal that has rung AGAIN since, whose newer news is the truth
        // and must not be overwritten by this one.
        for (const slot of slots) {
          if (!heldNews.has(slot.ref)) heldNews.hold(slot.ref, slot.value);
        }
        publishState();
        throw err;
      }
      // DELIVERED, so the episode is over: the next failure is news again.
      wakeFailure = null;
      // TOLD is set when the wake was DELIVERED — its turn started — and not a
      // moment before: news that waited through a turn and then failed to go
      // is still owed, and a restart must ring about it again.
      for (const event of events) {
        const found = memberAt(event.ref);
        if (found === undefined) continue;
        // A HAND-OVER IS NOT A STANDING. `told` is what stops kolu ringing
        // twice about the same agent state, and "the person took this one
        // over" is not one of those — writing it here would make the next
        // real stop look like news already delivered.
        if (event.level === "taken-over" || event.level === "handed-back")
          continue;
        save(
          withWatch(found.work, event.ref, {
            ...found.member.watch,
            told: event.level,
          }),
        );
      }
      schedule("works");
    } catch (err) {
      // A wake nobody could deliver is not thrown — there is no caller to tell,
      // this runs off a watcher's frame or a turn ending — so it is LOGGED for
      // the operator and SAID for the person reading the panel.
      log.warn({ err }, "kolu-server: the conductor could not be woken");
      const why = sentenceOf(err);
      if (wakeFailure === null) {
        wakeFailure = why;
        const waiting = heldNews.refs();
        sayNotice(
          `kolu could not wake this conversation about ${waiting.length === 0 ? "a terminal working on one of your pieces of work" : waiting.join(", ")} — ${why} — the news is still waiting, and goes out on the next thing that happens: the conversation going idle, the agent coming back up, or the next reading of a member terminal.`,
        );
      }
    } finally {
      flushing = false;
    }
    // ... and whatever rang while that was on the wire gets its own turn now.
    if (missedEdge) {
      missedEdge = false;
      void flush();
    }
  };

  /** One terminal's news, as the event a wake is composed from — held, and
   *  flushed now if the conversation is idle. ALWAYS held first, which is what
   *  makes "one slot per terminal, newest only, in the position the first one
   *  took" true of the busy path and the idle path alike. */
  const ring = (
    watch: MemberWatch,
    seen: WatchObservation,
    level: ConductorWakeEvent["level"],
  ): void => {
    heldNews.hold(seen.ref, {
      ref: seen.ref,
      host: seen.host,
      terminalId: seen.terminalId,
      hostName: seen.hostName,
      name: watch.name,
      // EMPTY is a real answer here, and exactly one level gives it: `ended`
      // is about a terminal no agent was ever seen in, so there is no name to
      // put. Every other level is about an agent, and the sticky reading has
      // one ({@link ./members.ts}).
      agent: watch.agent ?? "",
      level,
      at: new Date().toISOString(),
    });
  };

  /** Stop a child and carry on. A teardown that threw here would skip the
   *  flush that follows it, and the record is what the next boot reads. */
  const stopQuietly = async (agent: Harness): Promise<void> => {
    try {
      await agent.stop();
    } catch (err: unknown) {
      log.warn(
        { err },
        "kolu-server: the conductor's agent did not stop cleanly",
      );
    }
  };

  // The cell is NOT published here: this host may be constructed BEFORE
  // `surface.ts` has registered the cell writer, so a write at construction
  // would reach a seam with nothing behind it. The cell is SEEDED from
  // `state()` instead, and every later movement publishes through `publish`.

  return {
    state: () => state,
    watch: (sink) => {
      // Opening the transcript IS looking at the conversation: it is the edge
      // that reads the remembered record AND the edge that brings the agent
      // up, in that order, so the snapshot below already carries what a
      // restart kept.
      remembered();
      sinks.add(sink);
      sink(snapshot());
      // The failure is not thrown: a stream whose first frame already landed
      // must not then die because the subprocess could not start — `live()`
      // publishes the refusal into the cell, which is where a reader that is
      // already watching will see it.
      void live().catch((err: unknown) => {
        log.warn({ err }, "kolu-server: the conductor could not be brought up");
      });
      return () => {
        sinks.delete(sink);
      };
    },
    prompt: async (text, mentions, attachments, steer) => {
      try {
        const sent = await ask((agent) =>
          agent.prompt(
            text,
            mentions.map((mention) => ({ ...mention })),
            // The files are already on disk — the prompt names them, and this
            // is where they are found and measured. A refused attachment
            // refuses the whole message rather than arriving as a second
            // sentence under a turn that already went out.
            namedAttachments(attachments),
            steer,
          ),
        );
        // The harness minted the user row before it answered, and that row
        // NAMES these files: the transcript is what keeps them from here on,
        // so the upload's own protection is done.
        for (const one of attachments) unsent.delete(one.id);
        return sent;
      } catch (err) {
        // THE MESSAGE NEVER LANDED, so neither did the row that would have
        // named its files — the agent refused the picture, the cap refused
        // the set, the adapter was not there. Whatever this prompt named is
        // now bytes nothing will ever mention, and the window is wider than
        // it looks: the upload happened call by call, long before Send. They
        // go with the refusal. The composer keeps its chips — that is what
        // lets a person fix the message rather than retype it — so a second
        // press re-uploads from the browser's own copy rather than trusting
        // a file this host has already let go.
        for (const one of attachments) unsent.delete(one.id);
        sweepAttachments();
        throw err;
      }
    },
    works: () => {
      // The works are on disk before they are in memory, and reading them
      // must not start an agent: the watcher asks this at boot, and a
      // conversation spawned to answer "what work is in flight" is a
      // subprocess nobody asked for.
      remembered();
      return worksRead();
    },
    readings: () => {
      remembered();
      return readingsRead();
    },
    memberRefs: () => {
      remembered();
      return everyWork().flatMap((work) =>
        work.endedAt !== null
          ? []
          : work.members
              .filter((one) => one.leftAt === null)
              .map((one) => one.terminal),
      );
    },
    membersDetail: () => {
      // Same read, same restraint — and the fields are picked rather than the
      // member spread, so the watch's working memory never reaches a reader
      // outside by accident.
      remembered();
      return everyWork().flatMap((work) =>
        work.endedAt !== null
          ? []
          : work.members
              .filter((one) => one.leftAt === null)
              .map((one) => ({
                ref: one.terminal,
                work: work.id,
                role: one.role,
                name: one.watch.name,
                agent: one.watch.agent,
                joined: one.watch.joined,
              })),
      );
    },
    openWork: async (intent) => {
      remembered();
      // BEFORE ANYTHING EXISTS. A work whose setup is half asked is a planner
      // launched on a model nobody chose, and the Conductor cannot fix that
      // by asking a second form later — so the refusal names the keys and
      // nothing is created.
      const missing = missingSetup(intent.setup);
      if (missing.length > 0) {
        throw new WorkRefusal(
          "missing-setup",
          `«${intent.title}» cannot be opened: its setup does not ask ${missing.join(", ")}. Every setup question travels in \`work_open\` — ask them all in that one call (with \`given\` for whatever the request already said), so the human answers one form.`,
        );
      }
      // ... and the two answers kolu READS BACK must be in kolu's own words,
      // or the decision is stored and then reads as nothing.
      const foreign = foreignSetupWords(intent.setup);
      if (foreign.length > 0) {
        throw new WorkRefusal(
          "missing-setup",
          `«${intent.title}» cannot be opened: ${foreign.join(", ")} — the mode and what to do on green are read back off the human's answer, so their options must be kolu's own words (${WORK_MODES.join(" | ")}; ${ON_GREEN.join(" | ")}). Ask the question in whatever words you like; offer those values.`,
        );
      }
      const id = `work:${crypto.randomUUID()}`;
      const at = nowIso();
      const opened: StoredWork = {
        ...openWorkRecord({
          id,
          title: intent.title,
          repo: intent.repo,
          branch: intent.branch,
          at,
          // WHAT THE HUMAN ASKED FOR, as kolu saw them say it: the newest
          // thing they typed. The Conductor is not asked for it — a request
          // it retyped would be its summary of the words rather than the
          // words — and an empty transcript honestly has none.
          request: newestRequest(),
        }),
        members: [],
      };
      save(opened);
      worksChanged();
      const questions: ReadonlyArray<Question> = intent.setup.map((one) => ({
        id: crypto.randomUUID(),
        key: one.key,
        question: one.question,
        options: one.options,
        // One answer each: a setup question with two answers is two questions.
        multiple: false,
        ...(one.given === undefined ? {} : { given: one.given }),
      }));
      // EVERY ANSWER ALREADY GIVEN is a set of decisions the REQUEST made, and
      // nobody is asked anything: the human said where and how in the message
      // that started this, and a form putting it back to them is the "you
      // already told me, say it again" this whole shape removes.
      if (questions.every((one) => one.given !== undefined)) {
        save(
          stored(askQuestions(opened, { ask: `given:${id}`, at, questions })),
        );
        worksChanged();
        const given = works.get(id);
        return {
          work: id,
          setup: setupOf(given ?? opened),
          declined: false,
        };
      }
      const asked = await putAsk(id, `Setting up «${intent.title}»`, questions);
      if (!asked.answered) {
        // A SETUP NOBODY ANSWERED IS A WORK NOBODY WANTED. Ending it here is
        // what keeps a declined `work_open` from leaving a card for a
        // waterfall that will never have a member.
        const refused = works.get(id);
        if (refused !== undefined && refused.endedAt === null) {
          save(
            stored(endWork(refused, { outcome: "abandoned", at: nowIso() })),
          );
          worksChanged();
        }
      }
      const settled = works.get(id);
      return {
        work: id,
        setup: setupOf(settled ?? opened),
        declined: !asked.answered,
      };
    },
    askAboutWork: async (id, questions) => {
      remembered();
      const work = openWorkAt(id);
      const asked: ReadonlyArray<Question> = questions.map((one) => ({
        id: crypto.randomUUID(),
        // NOT a setup key: this is a question about the work rather than about
        // how it is run, so no reading is ever taken off it.
        key: null,
        question: one.question,
        options: one.options,
        multiple: one.multiple === true,
      }));
      const settled = await putAsk(
        id,
        // One question IS the message: a heading repeating the only question
        // under it is a row that says everything twice.
        asked.length === 1
          ? (asked[0]?.question ?? work.title)
          : `About «${work.title}»`,
        asked,
      );
      const after = works.get(id);
      return {
        answers: asked.map((one) => {
          const decision = after?.decisions.find((two) => two.id === one.id);
          return {
            question: one.question,
            picked: decision?.answer?.picked ?? [],
            text: decision?.answer?.text ?? null,
          };
        }),
        declined: !settled.answered,
      };
    },
    joinWork: (id, ref, role, joined) => {
      remembered();
      const work = openWorkAt(id);
      const already = memberAt(ref);
      // A TERMINAL ALREADY IN THIS WORK KEEPS THE ROLE IT WAS GIVEN FIRST, and
      // keeps what its watch already knows — what it was told, whether
      // anything has been said to it, whether its command ran.
      if (already?.work.id === id) return;
      // ... and one doing something ELSE leaves that first: a terminal does
      // one piece of work at a time, and a member of two works is two cards
      // claiming the same agent.
      if (already !== undefined) {
        save(leave(already.work, ref, "released"));
      }
      const current = works.get(id) ?? work;
      const member = joinedMember(joined);
      const entered = joinWork(current, {
        terminal: ref,
        role,
        at: nowIso(),
      });
      save({
        ...entered,
        // `joinWork` appends the MODEL's member, which carries no watch — this
        // is the one transition whose answer has to be completed here.
        members: entered.members.map((one) =>
          "watch" in one
            ? (one as StoredMember)
            : { ...one, watch: member.watch },
        ),
      });
      runtime.set(ref, { last: member.last, baselining: member.baselining });
      worksChanged();
      membersMoved(true);
    },
    leaveWork: (ref) => {
      remembered();
      const found = memberAt(ref);
      if (found === undefined) return false;
      // ... and whatever it was about to say goes with it. A conversation that
      // let a member go is not owed one last word about it.
      heldNews.withdraw(ref);
      save(leave(found.work, ref, "released"));
      publishState();
      worksChanged();
      membersMoved(true);
      return true;
    },
    takeOver: (ref) => {
      remembered();
      const found = drivenMember(ref);
      if (found.driver === "you") {
        throw new WorkRefusal(
          "already-yours",
          `You have already taken over the ${found.member.role} of «${found.work.title}» (${ref}) — hand it back when you are done with it.`,
        );
      }
      handover(found, ref, "taken-over");
    },
    handBack: (ref) => {
      remembered();
      const found = drivenMember(ref);
      if (found.driver === "conductor") {
        throw new WorkRefusal(
          "already-conductors",
          `The ${found.member.role} of «${found.work.title}» (${ref}) is already the Conductor's — nobody has taken it over.`,
        );
      }
      handover(found, ref, "handed-back");
    },
    restoreWorks: (restored) => {
      // The record is read FIRST, so a restore into a process that has not
      // looked at its own file yet cannot be undone by the boot read that
      // would otherwise follow it.
      remembered();
      const at = nowIso();
      works.clear();
      for (const work of restored) {
        // EVERY OPEN QUESTION GOES, exactly as at boot: the conversation that
        // asked it is gone (it was asked before the snapshot was taken), so
        // nobody can answer it and a decision left `null` would leave the card
        // waiting on a person for ever.
        works.set(
          work.id,
          openAsks(work).reduce(
            (one, askId) => stored(dropAsk(one, askId, at)),
            work,
          ),
        );
      }
      // THE RUNTIME BOOKKEEPING IS THE MEMBERSHIP'S. A terminal the snapshot
      // does not have as a member has nothing left to read — and nothing left
      // to say. One it DOES have is baselined the way a restart baselines it,
      // off what the record kept.
      const members = new Map<string, MemberWatch>();
      for (const work of works.values()) {
        if (work.endedAt !== null) continue;
        for (const member of work.members) {
          if (member.leftAt === null)
            members.set(member.terminal, member.watch);
        }
      }
      for (const ref of [...runtime.keys()]) {
        if (members.has(ref)) continue;
        runtime.delete(ref);
        heldNews.withdraw(ref);
      }
      for (const [ref, watch] of members) {
        if (!runtime.has(ref)) runtime.set(ref, restoredMember(watch));
      }
      publishMoved();
      publishState();
      // The kept files of works this snapshot never had are unreachable from
      // here on, and the one sweep rule is what deletes them.
      sweepFiles();
      // NOT on the throttle: a restore's whole point is that what was there is
      // gone, and a window where the file still holds it is a window where the
      // next boot undoes the restore.
      writeNow("works");
      membersMoved(true);
    },
    note: (id, text) => {
      remembered();
      save(
        append(openWorkAt(id), {
          at: nowIso(),
          by: "agent",
          kind: "note",
          terminal: null,
          detail: text,
        }),
      );
      worksChanged();
    },
    saidTo: (ref) => {
      remembered();
      const found = memberAt(ref);
      // Not a member: the fleet face says this about every `agent_say`, and
      // most terminals on a fleet belong to no work.
      if (found === undefined) return;
      // The news it was about to make is the state the Conductor has just
      // acted on, so it goes — and the member re-baselines at that state.
      heldNews.withdraw(ref);
      const at = runtime.get(ref) ?? { last: null, baselining: false };
      const spoken = spokenTo({ watch: found.member.watch, ...at });
      save(withWatch(found.work, ref, spoken.watch));
      runtime.set(ref, { last: spoken.last, baselining: spoken.baselining });
      publishState();
      schedule("works");
      // NO `membersMoved`: nothing moved that a reader outside can act on —
      // `spoken` is this module's own bookkeeping about a member that is still
      // the same terminal, in the same work, with the same role.
    },
    closedTerminal: (ref) => {
      remembered();
      const found = memberAt(ref);
      const withdrew = heldNews.withdraw(ref);
      if (found === undefined && !withdrew) return;
      if (found !== undefined) save(leave(found.work, ref, "closed"));
      publishState();
      worksChanged();
      if (found !== undefined) membersMoved(true);
    },
    observe: (seen) => {
      // FOUR DIFFERENT QUESTIONS, and none of them is the others. What a
      // READER of the conversation sees is {@link publishState}'s to answer.
      // What the WORKS say is published whenever one of them moved. What the
      // FILE must hold is a member's watch bookkeeping, which carries facts no
      // frame shows (`told`, `spoken`, `ran`). What an in-process FOLLOWER
      // needs is the membership moving, apart from the rows.
      let saidSomethingNew = false;
      let moved = false;
      let membership = false;
      let rows = false;
      for (const one of seen) {
        const found = memberAt(one.ref);
        // Not a member (any more): the watcher re-scopes asynchronously, so a
        // frame in flight across a departure is ordinary rather than a fault.
        if (found === undefined) continue;
        const at = runtime.get(one.ref) ?? { last: null, baselining: false };
        const read = observed({ watch: found.member.watch, ...at }, one);
        runtime.set(one.ref, {
          last: read.member.last,
          baselining: read.member.baselining,
        });
        // THE LEVEL CHANGED, as THIS PROCESS saw it — which is what the
        // timeline is written from. `told` can already hold the level (a
        // restart re-reading the same stop), and that stop is still the first
        // one this process observed.
        const changed = at.last?.level !== one.level;
        const stamp = nowIso();
        let work = sameWatch(found.member.watch, read.member.watch)
          ? found.work
          : withWatch(found.work, one.ref, read.member.watch);
        if (
          read.member.watch.name !== found.member.watch.name ||
          read.member.watch.agent !== found.member.watch.agent
        )
          rows = true;
        // WHAT A PERSON CALLS THIS HOST, remembered for a wake that is not
        // about a reading ({@link hostNames}).
        hostNames.set(one.host, one.hostName);
        // BACK TO WORKING WITHDRAWS WHAT IT WAS GOING TO SAY: held news
        // describes how something STOOD, and this one has stopped standing
        // that way. A terminal that goes away keeps its news — that it went
        // away is exactly the thing to say, and so is a terminal a person has
        // taken over: that news is about WHO MAY TYPE, which an agent going
        // back to work does not answer.
        if (one.level === "working" && !handoverHeld(one.ref))
          heldNews.withdraw(one.ref);
        if (changed && read.ring !== null) {
          const event = ringEvent(one.ref, read.ring, stamp);
          if (event !== null) work = append(work, event);
        }
        // THE PR IS COMPARED WITH THE TIMELINE, not with the last reading —
        // so two members looking at one PR record it once, and a restart
        // records nothing twice.
        if (one.pr !== null) work = prEvents(work, one.ref, one.pr, stamp);
        if (read.drop) {
          work = leave(work, one.ref, "gone");
          membership = true;
        }
        if (work !== found.work) {
          save(work);
          moved = true;
        }
        if (changed) moved = true;
        // THE FILES, off a level change: the moment an agent stops, asks or
        // comes up is the moment its `.waterfall/` has just changed, and a
        // member that has gone has no worktree left to read.
        const worktree = read.member.watch.worktree;
        if (changed && !read.drop && worktree !== null) {
          listFiles(work.id, one.ref, { host: one.host, worktree });
        }
        if (read.ring !== null) {
          ring(read.member.watch, one, read.ring);
          saidSomethingNew = true;
        }
      }
      if (publishState()) saidSomethingNew = true;
      if (moved) worksChanged();
      if (membership || rows) membersMoved(membership);
      // Nothing anybody can act on: no new news, nothing a reader would see.
      // The flush below is what may START A TURN, so it runs on movement
      // only — a poll that read the same thing again must not wake anybody.
      if (!saidSomethingNew) return;
      // Idle right now? Then nothing is waiting for a turn to end, and the
      // news goes out at once — which is the ordinary case: the Conductor
      // says what it is doing and ends its turn.
      void flush();
    },
    // No `live()`: uploading a file must not spawn an agent. The bytes are
    // this server's own bookkeeping, and a person who pastes an image into a
    // panel they then close should not have started a Claude for it.
    attach: attachChunk,
    cancel: () => ask((agent) => agent.cancel()),
    answer: (askId, answers, from) => {
      // WHERE IT WAS ANSWERED FROM, written down BEFORE the answer goes: the
      // harness settles the question synchronously inside `answer`, so the
      // ask waiting on it reads this in the same tick. A question about no
      // work leaves an entry nobody collects — dropped when the next answer
      // under that id would be, which cannot happen: an id settles once.
      answeredFrom.set(askId, from);
      return ask((agent) => agent.answer(askId, answers));
    },
    signIn: (method) => ask((agent) => agent.signIn(method)),
    signInInput: (text) => ask((agent) => agent.signInInput(text)),
    signInCancel: () => ask((agent) => agent.signInCancel()),
    setOption: (id, value) => ask((agent) => agent.setOption(id, value)),
    newSession: () => ask((agent) => agent.newSession()),
    clearSession: () =>
      ask(async (agent) => {
        // ONE WIPE, AT THE ONE OWNER OF THE ROWS. The harness holds the
        // conversation — the rows AND everything kept beside them (which call
        // has been named, what it was armed with, which deaths were
        // announced) — and `byId` is this module's mirror of what it reports.
        // A wipe this end did on its own emptied the mirror and left the
        // owner's copy standing, so the next conversation's first tool call
        // (an agent numbers them from one again) landed on a row the harness
        // still held, said nothing new, and was reported to nobody: a wiped
        // transcript whose next card never appeared.
        //
        // The ids go WITH the verb because the mirror can hold rows this
        // harness never minted — a restart read them out of the file, or the
        // adapter it replaced minted them — and they come back as removes
        // through `onChange`, the one path where a row's disappearance reaches
        // the readers subscribed now and the file a restart will read.
        await agent.clearSession([...byId.keys()]);
        // ... and the files go with the rows that named them, under the rule
        // the sweep already states. An upload nobody has sent yet is NOT
        // swept: it belongs to the composer, which still has its chips.
        sweepAttachments();
        // THE FLEET IS A MEMORY OF THE CONVERSATION THAT IS GONE. The wipe
        // deletes what this conversation knew: the agent is about to have no
        // memory of `fleet` or of what it had been told, so a strip naming
        // those terminals belongs to a conversation that no longer exists.
        //
        // THE WORKS STAY. A piece of work outlives the conversation that
        // opened it — that is the whole point of its being a record of its own
        // — and a person pressing `New session` has said they are done with
        // the chat, not that they stopped caring about a waterfall in flight.
        // What a work DOES lose is any question it had open: the promise
        // behind it belonged to the conversation being deleted, so the
        // decision is recorded as dropped rather than left waiting on nobody.
        const at = nowIso();
        for (const work of inProgress(everyWork())) {
          const dropped = openAsks(work).reduce(
            (one, askId) => stored(dropAsk(one, askId, at)),
            work as StoredWork,
          );
          if (dropped !== work) save(dropped);
        }
        heldNews.clear();
        state = { ...state, fleet: [] };
        publishState();
        publishMoved();
        // NOT on the throttle. A wipe is the one movement whose whole purpose
        // is that what was there is gone, and a window in which the file
        // still holds it is a window in which the next reader — or the next
        // boot — restores a transcript somebody deleted.
        writeNow("record");
        writeNow("transcript");
        writeNow("works");
      }),
    dispose: async () => {
      disposed = true;
      sinks.clear();
      const pending = starting;
      const running = harness;
      harness = null;
      if (running !== null) await stopQuietly(running);
      else if (pending !== null) {
        // A bring-up IN FLIGHT is the orphan this arm exists for: the child is
        // spawned `detached`, so a teardown that only looked at `harness`
        // would leave an adapter — and its `claude`, and its MCP client —
        // running under a server that no longer exists. The stop is ISSUED
        // unconditionally, on a continuation of the same promise, so a harness
        // that arrives late is still stopped.
        //
        // What is bounded is how long the shutdown STANDS THERE for it. The
        // handle only exists once the whole open has landed, and an open that
        // is a `session/load` sits on the wire for the harness's own load
        // deadline — so an outright await makes a drain or an upgrade hang on
        // a conversation nobody is watching.
        const late = pending.then(stopQuietly, () => {});
        const deadline = Promise.withResolvers<void>();
        // Unref'd: a shutdown waiting on a child must not itself be the reason
        // this process stays up.
        setTimeout(deadline.resolve, STOP_IN_FLIGHT_MS).unref();
        await Promise.race([late, deadline.promise]);
      }
      // AFTER the stop, so whatever the stop itself wrote into the transcript
      // is in the file the next boot reads — and with the session the process
      // was in, because the stop's own final state is ignored above.
      flushPersist();
    },
  };
}
