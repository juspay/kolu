/**
 * KOLU'S ONE CONVERSATION — the Conductor, hosted by kolu-server.
 *
 * kolu-server owns exactly one ACP conversation: it spawns the adapter, holds
 * the session, keeps the transcript, persists enough of it to come back, and
 * serves the whole of it as `koluSurface`'s `conductor` cell, the
 * `conductorTranscript` stream and the `conductor` procedures.
 *
 * ## What is here, and what is beside it
 *
 * The conversation and the transcript are ONE concern with two faces — the
 * restart fence is the transcript deciding how the harness is spawned, and the
 * harness's `onChange` is the only writer of the transcript — so they share
 * this file. Everything the conversation's HANDS do is a module of its own,
 * wired by the facade at the bottom:
 *
 *  - `./workStore.ts` — the pieces of work, and what a reader is told;
 *  - `./memberStore.ts` — what kolu knows about each member terminal;
 *  - `./observing.ts` — what an observation MEANS to a work;
 *  - `./wakes.ts` — when news reaches a conversation;
 *  - `./asking.ts` — kolu's own questions, as the one form a person answers;
 *  - `./attachments.ts` — a prompt's files on their way up;
 *  - `./recordWrites.ts` — how often any of it hits disk.
 *
 * The two seams between the conversation and the rest are `putAsk` (a question
 * needs a live agent) and `newestRequest` (a work's first timeline line is
 * read off the transcript). Both are one-function ports.
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
 * The REMEMBERED records are read on that same edge, not at construction. This
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

import type { NotHere } from "@kolu/acp/engine";
import type { AgentModelLaunch } from "@kolu/agent-distro/models";
import {
  type Compaction,
  type Harness,
  type HarnessOptions,
  HarnessRefused,
  HarnessUnavailable,
  type HttpServer,
} from "@kolu/acp-harness";
import type { CellStore } from "@kolu/surface/server";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Option, Schema } from "effect";
import {
  conductorConfigDir,
  CONDUCTOR_ENGINE as ENGINE,
} from "kolu-agents/acp";
import {
  type AskField,
  appendedText,
  COMPACTION_SUMMARY_CAP,
  type ConductorAnswerWorkOutcome,
  type ConductorAttachment,
  type ConductorFrame,
  type ConductorReadingLevel,
  type ConductorRow,
  type ConductorMention,
  type ConductorSignInResult,
  type ConductorState,
  ConductorStateSchema,
  type ConductorWorkAskStanding,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import {
  ConductorRefused,
  ConductorUnavailable,
  isConductorDeclaredError,
} from "kolu-common/conductorErrors";
import type { MemberReading } from "kolu-common/works";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  ABOUT_WORK,
  type AnsweredFromFace,
  type AskReply,
  askedAnswersOf,
  foreignSetupWords,
  givenAnswersOf,
  type Header,
  hostOf,
  isKoluChoiceKey,
  isOnGreen,
  isWorkMode,
  type KoluChoiceKey,
  type KoluChoices,
  type ModelChoices,
  keysToAsk,
  koluKeysOf,
  missingSetup,
  modeOf,
  modelHarnessesOf,
  ON_GREEN,
  openSetupQuestions,
  type Question,
  type QuestionFile,
  type RequestWords,
  recordEvent,
  roleOfKey,
  roleSetupOf,
  rolesOf,
  type SentAnswer,
  type SetupAsk,
  sentValue,
  type SetupKey,
  type SetupReading,
  type StartBlocker,
  savedAnswersOf,
  setupOf,
  startBlockers,
  type UnofferedAnswer,
  unofferedAnswers,
  unofferedWhy,
  unofferedWords,
  WORK_MODES,
  type WaterfallRole,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  workIdOf,
  WorkRefusal,
  type WorkRole,
} from "kolu-work";
import type { Logger } from "pino";
import { dropSuperseded } from "./askNews.ts";
import { aboutBlock } from "./aboutBlock.ts";
import { asking } from "./asking.ts";
import { attachments } from "./attachments.ts";
import { Fleet, koluCallOf, refineKoluCall } from "./kolu.ts";
import { memberStore } from "./memberStore.ts";
import type { WatchJoin } from "./members.ts";
import type { PrWatch, WatchObservation } from "./observation.ts";
import { observing } from "./observing.ts";
import {
  type PersistedConductor,
  type PersistedMembers,
  type PersistedTranscript,
  type PersistedWorks,
  persistedFrom,
  readPersistedConductor,
  readPersistedMembers,
  readPersistedTranscript,
  readPersistedWorks,
  parsePersistedStore,
  transcriptFrom,
  UnreadablePersisted,
} from "./persisted.ts";
import { recordWrites } from "./recordWrites.ts";
import { teaching } from "./teaching.ts";
import { wakes } from "./wakes.ts";
import type { WorkFiles } from "./workFiles.ts";
import { type MemberDetail, workStore } from "./workStore.ts";

/** What a reader of the transcript stream is handed, in order: one snapshot,
 *  then deltas, for as long as it is subscribed. */
export type ConductorFrameSink = (frame: ConductorFrame) => void;

/** WHAT KOLU OFFERS for the setup questions it draws the options for (a
 *  role's harness and model), read LIVE by whoever hosts the conductor:
 *  kolu-server reads the harnesses off its agent-distro listing and asks the
 *  work's host, through padi, what a harness offers there and how a launch
 *  gives it a model.
 *
 *  Two questions, because they fail differently. `models` answers the host's
 *  word on the list — `unavailable` with its own words when the host could
 *  not list just now, never an empty list and never a refusal for that.
 *  `launch` reads the harness's adapter and runs nothing, so a start never
 *  waits on a list. */
export interface KoluOffer {
  readonly harnesses: () => ReadonlyArray<string>;
  readonly models: (where: {
    readonly host: string;
    readonly repo: string;
    readonly harness: string;
  }) => Promise<ModelChoices>;
  readonly launch: (where: {
    readonly host: string;
    readonly harness: string;
  }) => Promise<AgentModelLaunch>;
  /** Refuses ({@link WorkRefusal} `agents-not-ready`) unless `host` has a
   *  harness to choose: this kolu carries agent-distro, and the host's agents
   *  are ready. */
  readonly requireAgentsReady: (host: string) => Promise<void>;
}

/** WHAT A PLANNER OR IMPLEMENTOR STARTS ON — its saved harness and model, on
 *  the work's host, and how that harness takes a model there. Only ever
 *  answered for a setup kolu still offers. */
export interface WaterfallStart {
  readonly host: string;
  readonly harness: string;
  readonly model: string;
  readonly launch: AgentModelLaunch;
}

/** The words kolu asks its own questions in — the asker names the question,
 *  kolu says it, as it draws its options. */
const KOLU_QUESTION: Readonly<Record<KoluChoiceKey, string>> = {
  "planner.harness": "Which harness runs the planner?",
  "planner.model": "Which model does the planner run on?",
  "implementor.harness": "Which harness runs the implementor?",
  "implementor.model": "Which model does the implementor run on?",
};

/** WHAT KOLU OFFERS RIGHT NOW on `where`'s host: the harnesses it carries,
 *  and what each of `harnesses` it carries offers there — one question to the
 *  host per harness. A harness kolu does not carry is never asked about: the
 *  rule refuses it by name. A host that could not list is `unavailable` in
 *  its own words, a value the rule reads; a host that cannot be asked at all
 *  refuses ({@link WorkRefusal} `not-offered`), ending with what that left
 *  undone (`nothing`). */
async function choicesFor(
  where: Pick<Work, "key">,
  harnesses: ReadonlyArray<string>,
  offer: KoluOffer,
  nothing: string,
): Promise<KoluChoices> {
  const host = hostOf(where);
  const installed = offer.harnesses();
  const models = new Map<string, ModelChoices>();
  const asking = harnesses.filter((one) => installed.includes(one));
  if (asking.length === 0) return { harnesses: installed, models };
  // A MODEL IS ASKED FOR IN THE WORK'S REPOSITORY, with the profiles a new
  // terminal there gets — and a watch has none, so nothing about a model is
  // judged for one.
  if (where.key.kind === "watch")
    throw new WorkRefusal(
      "not-offered",
      `a watch has no repository on ${host} to ask ${asking.join(", ")} for its models in. ${nothing}`,
    );
  const repo = where.key.repo;
  for (const harness of asking) {
    try {
      models.set(harness, await offer.models({ host, repo, harness }));
    } catch {
      // WHAT A PERSON'S SHELL PRINTED IS SHOWN TO THAT PERSON AND GOES
      // NOWHERE ELSE. The listing reads a harness's models out of the
      // terminal's own environment, so what comes back when it fails carries
      // the tail of that shell's output — a `set -x` line, a misquoted
      // `export KEY=$(…)` — and this sentence is handed to the CONDUCTOR:
      // sent to a model provider and kept in the transcript for ever. So the
      // refusal names the harness and the host, and the reason stays on the
      // screen of the one person entitled to read it.
      throw new WorkRefusal(
        "not-offered",
        `kolu could not ask what ${harness} offers on ${host}. The reason is the human's to read on their own screen — it can carry their shell's output, so it is not repeated here. ${nothing}`,
      );
    }
  }
  return { harnesses: installed, models };
}

/** Every bad answer, in the words a refusal names them by. */
const unofferedSentence = (
  bad: ReadonlyArray<UnofferedAnswer>,
  choices: KoluChoices,
  where: Pick<Work, "key">,
): string =>
  bad
    .map((one) => unofferedWords(one, choices.harnesses, hostOf(where)))
    .join("; ");

/** EVERY MODE OR ON-GREEN ANSWER IN `values` THAT IS NOT ONE OF KOLU'S WORDS
 *  for it, in the words a refusal names them by. The form offers only those
 *  words; this is the rule behind it, where the answer is recorded — a word
 *  the record cannot hold is refused by name, never left asked in silence. */
const foreignAnswers = (
  work: Work,
  ask: string,
  values: ReadonlyMap<string, SentAnswer>,
): ReadonlyArray<string> =>
  work.decisions.flatMap((one) => {
    if (one.ask !== ask || one.kind !== "asked" || one.topic !== "setup")
      return [];
    const sent = values.get(one.id);
    const value =
      sent === undefined ? undefined : Option.getOrUndefined(sentValue(sent));
    if (value === undefined) return [];
    switch (one.key) {
      case "mode":
        return isWorkMode(value)
          ? []
          : [
              `mode: ${JSON.stringify(value)} is not a mode (${WORK_MODES.join(" | ")})`,
            ];
      case "on-green":
        return isOnGreen(value)
          ? []
          : [
              `on-green: ${JSON.stringify(value)} is not what kolu does on green (${ON_GREEN.join(" | ")})`,
            ];
      default:
        return [];
    }
  });

/** WHAT STARTING A ROLE WAITS ON, said as it is — the keys open in front of
 *  the human (their answer wakes the Conductor by itself) apart from the
 *  ones nobody is being asked (only `work_open` puts them). */
const blockersSentence = (blockers: ReadonlyArray<StartBlocker>): string => {
  const open = blockers.flatMap((one) =>
    one.standing.kind === "open" ? [one.key] : [],
  );
  const unasked = blockers.flatMap((one) =>
    one.standing.kind === "unasked" ? [one.key] : [],
  );
  const are = (keys: ReadonlyArray<string>) =>
    `${keys.join(", ")} ${keys.length === 1 ? "is" : "are"}`;
  return [
    ...(open.length === 0
      ? []
      : [
          `${are(open)} open in front of the human — wait for their answer; kolu wakes you with it`,
        ]),
    ...(unasked.length === 0
      ? []
      : [
          `${are(unasked)} asked of nobody — call \`work_open\` for this work, which asks ${unasked.length === 1 ? "it" : "them"}`,
        ]),
  ].join("; and ");
};

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
    /** What the message was ABOUT — terminals and pieces of work. A
     *  terminal's `host` is the encoded host key and `terminalId` the id on
     *  that host; the harness joins them into the `host/id` the agent is
     *  told, which is the only name a fleet-wide conversation can act on. */
    mentions: ReadonlyArray<ConductorMention>,
    /** The files that came with the words, by NAME — each was uploaded ahead
     *  of this call by {@link ConductorHost.attach} and is already on disk
     *  under kolu-server's state root. What the harness is handed is the same
     *  shape with `bytes` and `path` re-read from the file. */
    attachments: ReadonlyArray<ConductorAttachment>,
    /** STEER rather than queue: put the words into the turn that is running.
     *  The harness decides whether that is possible and falls back to an
     *  ordinary prompt when it is not — this end only carries the ask. */
    steer: boolean,
  ) => Promise<{ rowId: string }>;
  /** EVERY PIECE OF WORK KOLU REMEMBERS: the works in progress oldest first —
   *  a card keeps its place — then the finished ones it still keeps, newest
   *  first.
   *
   *  Reads the remembered record if nobody has yet; it never starts the agent.
   *  A work OUTLIVES the conversation that opened it, so reading one must not
   *  be a reason to spawn an adapter. */
  readonly works: () => ReadonlyArray<readonly [WorkId, Work]>;
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
  readonly membersDetail: () => ReadonlyArray<MemberDetail>;
  /**
   * OPEN A PIECE OF WORK — the one call where the Conductor states its intent.
   *
   * THE WORK IS ITS KEY: a branch on a machine, or the terminal somebody
   * asked kolu to watch. So this call is IDEMPOTENT — a key kolu already
   * holds answers THAT work as it stands (an ended one comes back Open, its
   * decisions and timeline whole), and the only questions asked are the setup
   * ones that have no answer — and kolu's own questions whose saved answer
   * kolu no longer offers (a model that left its harness's list, words saved
   * as a model before kolu drew these options), asked again with the old
   * answer and why it no longer stands in the question's words. A second card
   * for one branch is not something any caller can make.
   *
   * REFUSED, before anything exists, when the setup asks a harness for a host
   * whose coding agents are not ready (`agents-not-ready`), when it does not
   * carry what the mode it might run needs ({@link WorkRefusal},
   * `missing-setup`), when a `given` harness or model is not one kolu offers,
   * or when the host cannot say what a model is judged against
   * (`not-offered`, against {@link ConductorDeps.offer}).
   *
   * ANSWERS once the work is recorded, with the setup as it reads NOW.
   * `asked` says a form went to the human: the Conductor ends its turn, and
   * kolu WAKES it with what they said. Nothing here waits on a person.
   */
  readonly openWork: (intent: {
    readonly key: WorkKey;
    readonly title: string;
    readonly setup: ReadonlyArray<SetupAsk>;
  }) => Promise<{
    readonly work: WorkId;
    readonly setup: SetupReading;
    readonly ask: string;
    readonly asked: boolean;
    /** Whether this call created the work. `false` is a work that was already
     *  there — the same one, carried on with. */
    readonly created: boolean;
    /** ... and whether it brought an ended one back. */
    readonly reopened: boolean;
  }>;
  /** STOP A PIECE OF WORK — the one ending nobody observed. `you` is the
   *  card's button (after its confirm), `conductor` is `work_stop`. Its
   *  members leave in the same step and its open questions are dropped. */
  readonly stopWork: (work: WorkId, by: "you" | "conductor") => void;
  /** ... and bring one back: Ended → Open, decisions and timeline kept. */
  readonly reopenWork: (work: WorkId) => void;
  /** A QUESTION ABOUT A WORK, put to the human as one ask the work knows about
   *  — so the answer is a decision kept with the work, and the card, the chat
   *  and the reader all draw and answer the one decision.
   *
   *  Answers the ask's id the moment the question is recorded. The answer
   *  comes back as a WAKE, whenever the human gets to it. */
  readonly askAboutWork: (
    work: string,
    questions: ReadonlyArray<{
      /** The question's short header — two or three words, the label its
       *  decision is drawn under on the card — or none given. */
      readonly header: Header;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly multiple: boolean;
      /** The worktree-relative file the question is about — a plan to
       *  approve, a diff to look at — or none. */
      readonly file: QuestionFile;
    }>,
  ) => { readonly ask: string };
  /** THE HUMAN'S REPLY to one of those questions, from whichever face they
   *  were looking at. Records what it settles, moves the row in the chat, and
   *  WAKES the conversation with what they said — which is the only way an
   *  answer ever reaches the Conductor.
   *
   *  A DECLINE settles the whole ask; an ANSWER settles the questions it gives
   *  a value for and leaves the rest asked (`part`). `nothing-open` means
   *  somebody else got there first — a reported state in a two-tab world,
   *  not a fault. Refused ({@link WorkRefusal}) for a work nobody knows,
   *  (`nothing-answered`) for an answer that fills in no question, and
   *  (`not-offered`) for an answer that is not one of kolu's options right
   *  now — a mode or on-green outside kolu's words, a harness it does not
   *  carry, a model the host did not list — checked here, where the answer
   *  is recorded, and checked again when the role starts
   *  ({@link ConductorHost.startOf}).
   *
   *  NEVER goes through the agent: a person must be able to answer while the
   *  conversation is down, signed out or busy, and the wake is held like any
   *  other news until there is somebody to tell. */
  readonly answerWork: (answered: {
    readonly work: string;
    readonly ask: string;
    readonly from: AnsweredFromFace;
    readonly reply: AskReply;
  }) => Promise<{ readonly outcome: ConductorAnswerWorkOutcome }>;
  /** WHAT A PLANNER OR IMPLEMENTOR OF THIS WORK STARTS ON — its saved harness
   *  and model, judged by the rule that records an answer, and how the host's
   *  harness takes a model. REFUSED ({@link WorkRefusal}) for an unknown or
   *  ended work, a watch, a role with no answer yet, and — `not-offered` — a
   *  saved answer kolu no longer offers, naming which and why: never a command
   *  typed into a terminal, never a defect. `work_open` asks that question
   *  again. */
  readonly startOf: (
    work: WorkId,
    role: WaterfallRole,
  ) => Promise<WaterfallStart>;
  /** A TERMINAL JOINS A WORK, in a role stated in the same call that created
   *  or adopted it. Refused for a work that is unknown or has ended: a member
   *  of nothing is a terminal nobody is watching.
   *
   *  Idempotent: a terminal already an active member keeps the role it was
   *  given first, and keeps what kolu already knows about it. */
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
   *  what arrives is today's shape: the works AND the member bookkeeping that
   *  goes with them, which are two keys of one file and have to be restored
   *  together or a member comes back as a terminal nobody has ever read.
   *
   *  The running Conductor reloads them rather than being restarted: the works
   *  are replaced wholesale — with the questions the snapshot recorded, open
   *  if they were open, because a question is a decision nobody has answered
   *  and not a promise somebody was holding — the readers are told, the files
   *  are written NOW, and the watcher re-scopes to the restored membership. */
  readonly restoreWorks: (
    works: PersistedWorks,
    members: PersistedMembers,
  ) => void;
  /** READ THE RECORDS AGAIN — the one caller is a recovery that has just put
   *  readable bytes under a record this build refused
   *  ({@link UnreadablePersisted}), and the whole point of it is that nobody
   *  has to restart kolu-server to get their Conductor back.
   *
   *  Only reachable while the records have NOT been read: a refusal is
   *  all-or-nothing (the four reads happen together, and nothing is loaded
   *  unless all four land), so a reload is always a first read that failed
   *  being tried again — never a live conversation being re-pointed at a
   *  file it has already moved past. Reloading a host that HAS read throws,
   *  because that would be the file winning an argument with the
   *  conversation.
   *
   *  Throws again, and re-says the refusal, if the records still do not
   *  read; the readers subscribed now are handed a fresh snapshot when they
   *  do, because the rows they are holding came from a transcript that was
   *  not readable a moment ago. */
  readonly reloadRecords: () => void;
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
   * (`@kolu/acp-harness`'s holding list).
   *
   * A reading about a ref that is NOT a member is ignored rather than refused
   * — the watcher re-scopes asynchronously, and a frame in flight across a
   * departure is ordinary.
   */
  readonly observe: (seen: ReadonlyArray<WatchObservation>) => void;
  /** THE PULL-REQUEST WATCH'S SCOPE — every piece of work in progress that is
   *  a BRANCH on a machine, with the host, repository and branch kolu asks
   *  that host about. Beside {@link ConductorHost.memberRefs} and not folded
   *  into it: a work's pull request is watched whether or not a terminal is
   *  left, which is the whole of why a work the Conductor merged and then
   *  closed the terminals of now ends ({@link ConductorHost.observedPr}). */
  readonly prWatches: () => ReadonlyArray<PrWatch>;
  /**
   * WHAT THE WORK'S OWN PULL-REQUEST WATCH READ — one reading of one work's
   * branch, off the host it is on.
   *
   * ONE reader, for one pull request: what becomes an event is decided
   * against the work's timeline, so the same reading twice (the next poll,
   * the first look after a restart) writes nothing, and a merge or a close
   * ENDS the work whenever kolu next looks. A host that is not answering
   * calls this not at all — nothing is concluded from silence.
   */
  readonly observedPr: (work: WorkId, pr: PrResult) => void;
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
  /** ANSWER THE AGENT'S OWN QUESTION — an elicitation it is holding a call
   *  open for, which is the one kind of question that is answered THROUGH the
   *  conversation. kolu's own questions about a work are decisions on that
   *  work and go through {@link Conductor.answerWork} instead: nothing is
   *  waiting on them, so nothing has to be released. */
  readonly answer: (
    askId: string,
    answers: ReadonlyArray<{
      key: string;
      values: ReadonlyArray<string>;
    }> | null,
  ) => Promise<boolean>;
  /** RUN A SIGN-IN METHOD, and say what BOTH halves did. One that succeeds
   *  restarts the agent into the conversation that was live when it was
   *  asked for ({@link ConductorHost.reloadAgent} is the same restart for a
   *  signature made outside kolu): a running agent keeps the credential it
   *  started with, and the next turn must be the new account's. A restart
   *  that was refused or failed rides on the ANSWER rather than replacing
   *  it — the login still landed. */
  readonly signIn: (method: string) => Promise<ConductorSignInResult>;
  /** A PERSON ASKS TO SIGN IN — signed in already or not. Puts the sign-in
   *  row on screen with the methods the agent advertised. */
  readonly askSignIn: () => Promise<void>;
  readonly signInInput: (text: string) => Promise<void>;
  readonly signInCancel: () => Promise<boolean>;
  /** PICK UP A SIGNATURE THAT CHANGED UNDER THE AGENT — signed in again here,
   *  or outside kolu. The adapter is stopped and started again, which is the
   *  fresh `initialize` its new credential needs, and it comes back into the
   *  SAME conversation (`resume`, the session it is in now). REFUSED while a
   *  turn runs: a restart ends it with nothing on screen saying so. */
  readonly reloadAgent: () => Promise<void>;
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
  /** Process-lifetime teardown: stop the child, write the records, drop the
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
  /** WHAT KOLU OFFERS for a role's harness and model — the harnesses it
   *  carries, what each offers on a work's host, and whether that host has a
   *  harness to choose at all. Read per call: the host owns it, built once it
   *  has read its agent-distro listing. */
  readonly offer: () => KoluOffer;
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
  readonly publishWork: (id: WorkId, work: Work | null) => void;
  /** ... and ONE MEMBER TERMINAL'S membership — the `workMembers`
   *  collection, keyed by fleet ref: which work it is in and in what role.
   *  `null` REMOVES it (it left, or its work ended). Its own collection
   *  because membership moves on its own clock, and because a browser must
   *  be able to read "which work is this terminal in" without holding every
   *  work's timeline. */
  readonly publishMember: (terminal: string, member: WorkMember | null) => void;
  /** ... and HOW A MEMBER TERMINAL STANDS, by fleet ref — the other
   *  collection. `null` for a terminal that is no longer a member (there is
   *  nothing left to read). A terminal nobody has read yet is ABSENT rather
   *  than carried at zero: "nobody has looked at its host" and "it has stood
   *  this way for no time" are different facts. */
  readonly publishReading: (
    terminal: string,
    reading: MemberReading | null,
  ) => void;
  /** SOMETHING A `works` READER WOULD SEE MOVED — a work, a member row or a
   *  reading. The in-process event for readers that follow the works
   *  themselves rather than the browser's frame.
   *
   *  Pushed where the works are mutated rather than recovered by diffing
   *  published state: this host is the one thing that knows, and an answer
   *  reconstructed from a serialised frame is one more copy of it free to be
   *  wrong. */
  readonly worksMoved: () => void;
  /** THE WATCH'S SCOPE MAY HAVE MOVED — the set of member refs, or the set of
   *  branches with work in flight. Its own sink beside {@link worksMoved}
   *  because the two are different jobs: the watcher re-opens its per-host
   *  subscriptions on this one and must not tear them down because a terminal
   *  was renamed, while a reader of the ROWS needs every move. */
  readonly watchScopeMoved: () => void;
  /** The conversation's own record — `config.json`'s `conductor` key. */
  readonly store: CellStore<PersistedConductor>;
  /** THE TRANSCRIPT, in its own file. Separate from `store` because the rows
   *  are what made the state file large and rewritten at an agent's output
   *  cadence; kolu-server implements it over
   *  `<stateDir>/conductor/transcript.json`. */
  readonly transcript: CellStore<PersistedTranscript>;
  /** THE WORKS — `config.json`'s `works` key. */
  readonly works: CellStore<PersistedWorks>;
  /** ... and WHAT KOLU KNOWS ABOUT THEIR MEMBER TERMINALS — `config.json`'s
   *  `members` key. Its own key beside the works, because it is the watch's
   *  own memory of a terminal rather than part of what a work IS, and it moves
   *  on its own clock. */
  readonly members: CellStore<PersistedMembers>;
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
  readonly spawn: (
    options: HarnessOptions<ConductorRow>,
  ) => Promise<Harness<ConductorRow>>;
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
 *  agent's prose, a plan, a tool call, a question, a compaction. The second half is not
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
      case "compaction":
        return true;
    }
  }
  return false;
};

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
    publishMember,
    worksMoved,
    watchScopeMoved,
    store,
    transcript: transcriptStore,
    works: worksStore,
    members: membersStore,
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
    compactsAt: ENGINE.compacts?.at ?? null,
  } satisfies Pick<
    ConductorState,
    "install" | "agentName" | "cwd" | "compactsAt"
  >;

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
  const newestRequest = (): RequestWords => {
    const said = rows();
    for (let at = said.length - 1; at >= 0; at -= 1) {
      const row = said[at];
      if (row?.kind !== "user") continue;
      return row.text === ""
        ? { kind: "none" }
        : { kind: "said", text: row.text };
    }
    return { kind: "none" };
  };

  let seq = 0;
  const sinks = new Set<ConductorFrameSink>();
  let harness: Harness<ConductorRow> | null = null;
  let starting: Promise<Harness<ConductorRow>> | null = null;
  let disposed = false;
  /**
   * WHICH SPAWN'S NEWS IS THE CONVERSATION'S — bumped the moment a harness is
   * retired, and compared by every `onChange` against the number its own spawn
   * was given.
   *
   * A teardown's last breath says `sessionId: null`, and we persist what we
   * are told. `disposed` covered only the shutdown; a RESTART retires a
   * harness too, and the record would otherwise say there is no conversation
   * while the transcript holds its rows — for as long as the respawn takes,
   * and for ever if the respawn fails or kolu-server goes down in that window.
   */
  let generation = 0;

  // What a restart starts from — read ONCE, on the first reader's edge. The
  // records are this module's to write from here on, and re-reading them would
  // make the file the authority over a live conversation that has moved past
  // it.
  let read = false;
  /** The session id the agent is asked to replay and the model a person CHOSE.
   *  Both stay at their empty value until the record has been read, and for a
   *  state-root with nothing to resume they stay there. */
  let resume: string | null = null;
  let chosenModel: string | null = null;
  /**
   * WHETHER THE CONVERSATION BEING RESUMED HAS BEEN TAUGHT — the standing
   * prompt went out under a message of it.
   *
   * REMEMBERED HERE because a harness does not outlive the process and the
   * conversation does: an upgrade, a crash or a signature replaces the
   * subprocess, and a replacement told nothing re-taught the agent in the
   * middle of a chat. It rides the record beside the session id
   * ({@link PersistedConductor}) and is read back off every publish, which is
   * what keeps it true after a `newSession` nobody here asked for.
   */
  let taught = false;
  /**
   * THE TERMINALS THIS CONVERSATION IS WORKING WITH, in first-touch order.
   *
   * KOLU'S OWN, computed from the readings this module hands the harness
   * ({@link kolu.ts}'s `koluCallOf`): the conversation knows a tool call as
   * whatever its reader made of it, so the one end that can say which terminal
   * a call was about is the end that read it. Seeded from the record at the
   * restore, because membership otherwise accrues only from tool-call frames
   * and a resumed conversation's frames are the replay the harness drops.
   */
  let fleet = new Fleet();

  /** THE LAST FRAME A READER WAS GIVEN, or `null` before the first one — what
   *  {@link publishState} compares against to answer "would anybody see
   *  anything different?". */
  let published: ConductorState | null = null;

  /** Two frames compared by WHAT THEY SAY rather than by identity — every
   *  publish rebuilds the arrays, so `===` answers "a new array was made",
   *  which is not the question. Derived from the SCHEMA the value is declared
   *  by, so a field it grows is compared without an edit here. */
  const sameFrame = Schema.toEquivalence(ConductorStateSchema);

  /** The state as a READER sees it: whatever the harness last said, plus the
   *  three fields this server authors and the one the WAKE LANE owns. `held`
   *  is published from here rather than carried on the harness's state for the
   *  reason `install` is: each fact has exactly one author, and the
   *  conversation is not the author of kolu's watch. The works themselves are
   *  a collection of their own, because a work outlives the conversation that
   *  opened it.
   *
   *  `workAsks` IS PUBLISHED HERE, beside the harness's `openAsks` and never
   *  folded into it: the agent's own elicitations are the conversation's, and
   *  kolu's questions about a piece of work live on that work's decisions. A
   *  browser has to know which a question is the moment it appears — the
   *  work's own record can arrive after it — so they travel as two lists.
   *
   *  AND THE GATE IS HERE, answering `true` when it published. A caller
   *  cannot decide "did anything visible move?" for itself without naming
   *  every field this function folds — which is a second, hand-written copy
   *  of the projection, and the moment the projection grows a fact that copy
   *  is silently wrong and the panel freezes. The frame that is about to go
   *  out is compared with the one that did. */
  const frameNow = (): ConductorState => ({
    ...state,
    workAsks: works.openAsks(),
  });

  const publishState = (): boolean => {
    state = { ...state, held: wake.refs() };
    const frame = frameNow();
    if (published !== null && sameFrame(published, frame)) return false;
    published = frame;
    publish(frame);
    return true;
  };

  const nowIso = (): string => new Date().toISOString();

  // ── the records, written on one throttle ───────────────────────────────

  const records = recordWrites(
    {
      record: () => store.set(persistedFrom(state, taught)),
      transcript: () => transcriptStore.set(transcriptFrom(rows())),
      works: () => worksStore.set(works.persisted()),
      members: () => membersStore.set(members.saved()),
    },
    PERSIST_THROTTLE_MS,
  );

  // ── the hands ──────────────────────────────────────────────────────────

  const members = memberStore();

  const works = workStore({
    workFiles,
    publishWork,
    publishMember,
    publishReading,
    worksMoved,
    watchScopeMoved,
    // A WORK THAT ENDED TOOK ITS QUESTIONS WITH IT — the store recorded them
    // as dropped in the same write as the ending, and each arrives settled.
    // All that is left here is to say so on the row it was asked in and to
    // wake the Conductor with the ending, the same way it is woken with an
    // answer.
    ended: (settled) => {
      for (const one of settled) {
        settleAsk(one.ask, one.standing);
        wake.answered(one.news);
      }
      void wake.flush();
    },
    // THE LAST TERMINAL WENT, and the work did NOT end. Said once, in exactly
    // those words: the Conductor's answer to it is to adopt terminals back
    // into this work, never to open a second one for the same branch.
    noTerminals: (id, work) => {
      wake.noTerminals({ work: id, title: work.title, at: nowIso() });
      void wake.flush();
    },
    records,
    members,
    log,
  });

  const spool = attachments({
    stateRoot,
    log,
    namedIds: () => {
      // BEFORE THE RECORD IS READ there is nothing to judge against: `byId` is
      // empty until the restore, and a sweep comparing a restored state-root
      // with an empty transcript would delete every file the conversation is
      // still drawing.
      if (!read) return null;
      const named = new Set<string>();
      for (const row of byId.values()) {
        if (row.kind !== "user") continue;
        for (const one of row.attachments) named.add(one.id);
      }
      return named;
    },
  });

  /** WHAT A PERSON CALLS EACH HOST, as the watcher's readings say it — kept so
   *  a wake about a terminal nothing is being read from right now (a take
   *  over) can still say where it is. Empty until the first reading, and the
   *  encoded host key is the honest fallback. */
  const hostNames = new Map<string, string>();

  /**
   * WHAT A TOOL CALL MEANS TO KOLU — the reading a card is drawn from, and the
   * one place this conversation's MEMBERSHIP comes from.
   *
   * The conversation hands over what the protocol said and keeps whatever
   * comes back on the row ({@link HarnessOptions.readCall}); what the call was
   * ABOUT is kolu's own ({@link ./kolu.ts}), because only this end knows the
   * fleet's grammar and which tools its own MCP face registers. A call the
   * client could not positively name as one of OURS reaches here with no
   * server, and gets no reading at all: a card claiming to be about terminal
   * `7f3e` because a tool name happened to contain `create` would put an "open
   * tile" button on somebody else's terminal.
   *
   * The two frames of one call are FOLDED, because the arming frame carries
   * the input and the settling frame the answer — `refineKoluCall` keeps
   * whichever said something — and a terminal this conversation created or
   * typed into joins the fleet as it is read.
   */
  const readKoluCall: HarnessOptions<ConductorRow>["readCall"] = (
    frame,
    held,
  ) => {
    // THE FIRST RECOGNISED CALL of the frame, which for kolu is the whole of
    // it: the Conductor is handed ONE server (its fleet face), and the agent
    // it runs names one tool per frame. A product whose agent dispatches
    // several through one builtin reads the rest of the list.
    const call = frame.mcp[0];
    const seen =
      call === undefined
        ? null
        : koluCallOf(call.tool, frame.input, frame.answer);
    const kolu = refineKoluCall(held?.kolu ?? null, seen);
    // THE FLEET MOVES HERE, and it is SAID here: a terminal joining is news a
    // reader draws and a fact the record keeps, and nothing else in this
    // module is watching for it. Leaving it to the publish the conversation
    // makes about the row it is writing would be membership that reaches disk
    // only when something else happens to move — which is a conversation that
    // comes back from a restart having forgotten a terminal it was working
    // with.
    if (kolu !== null && fleet.touch(kolu)) {
      state = { ...state, fleet: [...fleet.ids()] };
      publishState();
      records.schedule("record");
    }
    if (
      call === undefined &&
      frame.asksThroughForm === undefined &&
      kolu === null
    ) {
      return undefined;
    }
    return {
      extra: {
        server: call?.server,
        tool: call?.tool,
        // Absent rather than `false`: every optional field of a tool row means
        // UNCHANGED, and a call whose name has not arrived yet is not a call
        // anything has called ordinary.
        asksThroughForm: frame.asksThroughForm,
        ...(kolu === null ? {} : { kolu }),
      },
    };
  };

  const wake = wakes({
    turn: async () => {
      const agent = await live();
      return {
        idle: agent.state().phase === "idle",
        // KOLU'S OWN LINE, as the row it is drawn as: the harness starts the
        // turn and knows the row only as content it was handed.
        wake: (text, events) =>
          agent.hostTurn({ kind: "wake", from: "kolu", events, text }, text),
      };
    },
    say: (text) => sayNotice(text),
    changed: () => {
      publishState();
    },
    membership: (ref) => {
      const found = works.at(ref);
      return found === undefined
        ? null
        : { role: found.member.role, title: found.work.title };
    },
    told: (ref, level) => {
      const member = members.at(ref);
      if (member === undefined) return;
      members.set(ref, { ...member, told: level });
      records.schedule("members");
    },
    stopped: () => disposed,
    log,
  });

  const observer = observing({
    store: works,
    members,
    workFiles,
    records,
    ring: (member, seen, level) => {
      wake.ring(member, seen, level);
    },
    withdraw: (ref) => wake.withdraw(ref),
    handoverHeld: (ref) => wake.handoverHeld(ref),
    hostNamed: (host, name) => {
      hostNames.set(host, name);
    },
    publishState,
    worksMoved,
    watchScopeMoved,
    flush: () => {
      void wake.flush();
    },
    log,
  });

  const asks = asking({
    store: works,
    // Through thunks rather than by reference: the two row writers are
    // declared below (they need `applyRows`), and this value is built here.
    said: (ask, work, message, fields) => {
      sayAsk(ask, work, message, fields);
    },
    settled: (ask, standing) => {
      settleAsk(ask, standing);
    },
    // THE ONE PLACE THE NEWS RULE LIVES: an answer is held and the
    // conversation is woken with it. No caller of `answer` remembers to do
    // this, and no second caller can forget to.
    news: (one) => {
      wake.answered(one);
      void wake.flush();
    },
  });

  // ── the remembered records ─────────────────────────────────────────────

  const remembered = (): void => {
    if (read) return;
    let record: PersistedConductor;
    let kept: PersistedWorks;
    let watched: PersistedMembers;
    let transcript: PersistedTranscript;
    try {
      record = readPersistedConductor(store, storePath(), stateRoot);
      kept = readPersistedWorks(worksStore, storePath(), stateRoot);
      watched = readPersistedMembers(membersStore, storePath(), stateRoot);
      transcript = readPersistedTranscript(
        transcriptStore,
        transcriptPath(),
        stateRoot,
      );
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
    // PARSED, not merely decoded: the rules JSON cannot state (a work filed
    // under its own identity, every member's work open, one planner and one
    // implementor) are checked here, in `kolu-work`'s one smart constructor,
    // and a store that breaks one is refused by name.
    parsePersistedStore(kept, watched, storePath(), stateRoot);
    works.load(kept, watched);
    if (works.all().length > 0) {
      works.publishWorks();
      // A RESTORE IS THE MEMBERSHIP MOVING: it went from nothing to whatever
      // the file held, and the watcher has to scope itself to those hosts. It
      // reads the membership itself at boot too, but this edge is also reached
      // by the first procedure call of a process whose watcher has already
      // looked.
      worksMoved();
      watchScopeMoved();
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
      // ... and so does the standing prompt: a conversation already taught is
      // not taught again by the harness that comes back to it.
      taught = record.taught;
      // THE MEMBERSHIP COMES BACK WITH THE CONVERSATION. It accrues only from
      // tool-call frames, and a resumed conversation's frames are the replay
      // the harness drops — so a fleet that could only accrue would come back
      // empty and be written back over the record.
      fleet = new Fleet(record.fleet);
      for (const row of transcript.rows) byId.set(row.id, row);
      rowsCache = null;
      state = { ...state, sessionId: record.sessionId, fleet: record.fleet };
      publishState();
    }
    // ... and the files go with them. This is the one edge where the set of
    // rows can SHRINK — the record was capped at `ROW_CAP`, or the home moved
    // and the whole transcript was let go — so it is the one edge where a file
    // can be left naming nothing.
    spool.sweep();
  };

  // ── the conversation ───────────────────────────────────────────────────

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
    records.schedule("transcript");
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
    state = {
      ...state,
      phase: "offline",
      refusal: sentenceOf(err),
      // ...AND WHAT A PERSON CAN DO ABOUT IT, when the refusal is a record
      // this build cannot read. The sentence alone would strand them: the
      // two recoveries kolu has (the newest backup that reads, or starting
      // empty with the unreadable value kept aside) are procedure calls, and
      // a button cannot be drawn off prose. Every OTHER refusal — a missing
      // socket, an agent that said no — carries `null` here and the panel
      // offers *try again*, which is what those want.
      unreadable:
        err instanceof UnreadablePersisted
          ? {
              key: err.key,
              path: err.path,
              keepsAt: err.keepsAt,
              inBackups: err.inBackups,
              detail: err.detail,
            }
          : null,
    };
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

  const UNFINISHED = "it stopped before it finished";

  const sayCompaction = (report: Compaction): void => {
    const id = `kolu:compaction:${report.id}`;
    const held = byId.get(id);
    const was = held?.kind === "compaction" ? held : null;
    applyRows({
      upserts: [
        {
          kind: "compaction",
          id,
          seq: was?.seq ?? (rows().at(-1)?.seq ?? 0) + 1,
          since: was?.since ?? new Date().toISOString(),
          state:
            report.status === "in_progress"
              ? "running"
              : report.status === "completed"
                ? "done"
                : "failed",
          at: was === null ? (state.usage?.used ?? null) : was.at,
          summary:
            report.summary === null || report.summary === ""
              ? null
              : report.summary.length > COMPACTION_SUMMARY_CAP
                ? `${report.summary.slice(0, COMPACTION_SUMMARY_CAP)}…`
                : report.summary,
          error:
            report.status === "cancelled"
              ? (report.error ?? UNFINISHED)
              : report.error,
          rules: report.teaching,
        },
      ],
      removes: [],
      appends: [],
    });
  };

  const settleStrandedCompactions = (): void => {
    const stranded = rows().flatMap((row) =>
      row.kind === "compaction" && row.state === "running"
        ? [
            {
              ...row,
              state: "failed" as const,
              error: UNFINISHED,
            },
          ]
        : [],
    );
    if (stranded.length === 0) return;
    applyRows({ upserts: stranded, removes: [], appends: [] });
  };

  /** KOLU'S OWN QUESTION, SAID IN THE TRANSCRIPT — one row, under the ask's
   *  own id, naming the work it is about.
   *
   *  Minted HERE rather than through the harness for the reason a notice is,
   *  and for one more: this row is not a question anybody answers through the
   *  agent. The thing a person presses is drawn from the WORK's decisions and
   *  answered against them, so a person can answer while the conversation is
   *  down, busy, or has been wiped and started again. What this row is is the
   *  conversation's own log of what was asked, where it was asked — which is
   *  why it goes away with the rows when somebody starts a new session, while
   *  the question itself stays on the card. */
  const sayAsk = (
    ask: string,
    work: string,
    message: string,
    fields: ReadonlyArray<AskField>,
  ): void => {
    applyRows({
      upserts: [
        {
          kind: "work-ask",
          id: ask,
          seq: (rows().at(-1)?.seq ?? 0) + 1,
          since: new Date().toISOString(),
          text: message,
          ask: { fields: [...fields], standing: { kind: "open" } },
          work,
        },
      ],
      removes: [],
      appends: [],
    });
  };

  /** ... and where it stands now, on that same row — read off the decisions,
   *  so the log and the record cannot disagree. A row still being answered
   *  (`open`, `part`) moves; one that has ended does not. A row that is not
   *  there any more (the session was wiped under it) changes nothing. */
  const settleAsk = (ask: string, standing: ConductorWorkAskStanding): void => {
    const row = byId.get(ask);
    // A WORK ASK: kolu's own question about a piece of work, which is the
    // only kind this settles — an elicitation the agent is holding is ended
    // by the call it is holding, not here.
    if (row === undefined || row.kind !== "work-ask") return;
    const now = row.ask.standing.kind;
    if (now !== "open" && now !== "part") return;
    applyRows({
      upserts: [{ ...row, ask: { ...row.ask, standing } }],
      removes: [],
      appends: [],
    });
  };

  /** Bring the conversation up, once, and hand back the same promise to every
   *  caller that arrives while it is in flight — so two readers opening at the
   *  same instant cannot spawn two adapters. */
  const live = async (): Promise<Harness<ConductorRow>> => {
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
      // ... and its dying state is not this conversation's: the stop below
      // publishes `sessionId: null` for a conversation whose rows we keep.
      generation += 1;
      void running.stop("stopped by app").catch((err: unknown) => {
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
    settleStrandedCompactions();
    // WHETHER THIS SPAWN IS COMING BACK TO A CONVERSATION. Decided at EVERY
    // spawn, not once at boot: a replacement adapter over a "new session"
    // nobody has spoken into yet is the same id with nothing behind it, and a
    // conversation that never had a turn is opened again rather than resumed
    // ({@link hadATurn}). Two options read it — which session to ask for, and
    // whether that session has been taught.
    const resuming = resume !== null && hadATurn(rows());
    // THIS SPAWN'S NUMBER, taken before the bring-up starts so the harness's
    // very first publish can be told apart from a retired one's last.
    generation += 1;
    const mine = generation;
    // THE WHOLE BRING-UP IS ONE PROMISE, assigned to `starting` on the line
    // after it is made and never awaited before then — so two readers arriving
    // in the same tick share it rather than spawning two adapters. It has to
    // be a promise from the first step now that the first step is asking
    // whether this kolu's own fleet MCP face is answering ({@link
    // provenFleetServer}): a refusal there is a rejection like any other, which
    // is why there is no synchronous arm around the options any more.
    const begun = (async (): Promise<Harness<ConductorRow>> => {
      const kolu = await provenFleetServer();
      return spawn({
        // THE ENGINE'S OWN KEY, which is what the client files this
        // conversation's memory and model notes under — read off the registry
        // rather than spelled again here.
        agent: ENGINE.id,
        leg: ENGINE.leg,
        adapter: seating as Exclude<typeof seating, NotHere>,
        cwd: home,
        // WHICH STORE THE AGENT'S SIGNATURE COMES OUT OF, for the sentence a
        // signed-out panel shows. Read from THIS process's environment because
        // that is the environment the adapter is spawned into — kolu-server's
        // own, not the one a person's terminal happens to have.
        configDir: conductorConfigDir(process.env, home),
        mcpServers: [kolu],
        teaching: teaching(hostName),
        // ... AND WHETHER IT HAS ALREADY GONE OUT in the conversation being
        // resumed. A harness is replaced for reasons that have nothing to do
        // with the chat, and one told nothing put the standing prompt back
        // into the middle of it on every restart. A conversation this spawn is
        // NOT resuming is a fresh one, which owes the teaching.
        taught: resuming && taught,
        log,
        // KOLU NAMES ITS CONVERSATION OR OPENS A NEW ONE, and never adopts:
        // which conversation this host is in is a fact kolu writes down
        // itself, and an agent's own newest stored one is a chat nobody here
        // asked for.
        opens:
          resuming && resume !== null
            ? { kind: "resume", id: resume }
            : { kind: "fresh" },
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
        // WHAT A TOOL CALL MEANS TO KOLU — the reading a card is drawn from
        // ({@link ./kolu.ts}), folded frame by frame, and the one place this
        // conversation's membership comes from.
        readCall: readKoluCall,
        // KOLU'S THREE POLICIES. A new session DIVIDES the one transcript it
        // persists; a conversation the agent has forgotten opens a FRESH one
        // rather than leaving the panel with nothing; a replay is DROPPED
        // because the rows it re-emits are ones this module already holds in a
        // richer form.
        whenNewSession: "divide",
        // ... and the numbering runs on for the life of the process, because
        // these rows are written to a file and a restored row's `seq` is one
        // nothing minted here may collide with.
        numbering: "continues",
        whenLoadRefused: "fresh",
        whenReplayed: "drop",
        ...(ENGINE.compacts === undefined
          ? {}
          : { compacts: ENGINE.compacts.due }),
        onCompaction: (compaction) => {
          if (disposed || mine !== generation) return;
          sayCompaction(compaction);
        },
        model: chosenModel,
        onChange: (change) => {
          if (change.kind === "state") {
            // A RETIRED HARNESS'S LAST BREATH IS NOT NEWS. `stop()` nulls the
            // live session and publishes one final state saying so, and we
            // persist what we are told — so a drain, an upgrade or a RESTART
            // would write `sessionId: null` beside the rows it just kept, and
            // the next boot would restore the transcript into a conversation
            // it never resumed. What the file must hold is the conversation as
            // it stood when the process let go of it. The number, not a
            // `disposed` flag: a restart retires a harness without disposing
            // of anything, and the respawn can fail.
            if (disposed || mine !== generation) return;
            // WHAT KOLU TAKES FROM A CONVERSATION, named one by one rather
            // than spread: a harness serves two products and publishes facts
            // either of them may draw (a session title, what the handshake
            // advertised, whether this session has been taught), and a spread
            // would carry whichever of them kolu's own cell does not declare
            // into a frame its schema then refuses. `seen`, `work`, `held` and
            // the FLEET are this module's — the fleet because it is read off
            // the tool readings supplied from here ({@link readKoluCall}) —
            // and are folded back on here and by `publishState`.
            taught = change.state.taught;
            state = {
              ...state,
              phase: change.state.phase,
              sessionId: change.state.sessionId,
              model: change.state.model,
              usage: change.state.usage,
              options: change.state.options,
              commands: change.state.commands,
              servers: change.state.servers,
              watching: change.state.watching,
              openAsks: change.state.openAsks,
              signIn: change.state.signIn,
              identity: change.state.identity,
              refusal: change.state.refusal,
              steers: change.state.steers,
              busySince: change.state.busySince,
              ...serverAuthored,
              fleet: [...fleet.ids()],
            };
            // A DIFFERENT CONVERSATION TAKES THE FLEET WITH IT: the terminals
            // live on — kolu owns them — but the agent about to answer has no
            // memory of having touched one, so a strip naming them belongs to
            // a conversation that is over. Asked BEFORE `resume` moves below,
            // because `resume` is what "the conversation we were in" is.
            if (state.sessionId !== null && state.sessionId !== resume) {
              fleet.clear();
              state = { ...state, fleet: [] };
            }
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
            records.schedule("record");
            // THE TURN BOUNDARY, whichever way the turn ended — answered,
            // refused, cancelled. Everything a member terminal said while it
            // was running has been waiting for exactly this moment, and it
            // leaves as ONE wake. Not on `asking`: a form on screen is a turn
            // still running, and a wake sent into it would queue behind the
            // answer a person has not given yet.
            if (state.phase === "idle") void wake.flush();
            return;
          }
          // A TURN'S ENDING IS NOT A ROW. kolu reads what a turn did off the
          // rows it moved and the state that follows it; the typed ending is
          // for a product that draws its own notice about one.
          if (change.kind === "rows") applyRows(change);
        },
      });
    })();
    starting = begun
      .then((started) => {
        harness = started;
        // AN AGENT THAT CAME UP IS AN EDGE A HELD WAKE WAITS FOR. A flush
        // that failed because the conversation would not start left its news
        // on the list (`./wakes.ts`); nothing else here would notice that the
        // reason is gone, and a conversation that is now up with news nobody
        // delivered is the indefinite wait this whole feature exists to
        // remove. Re-entrant by design: a flush that is already running is the
        // caller of this very bring-up and its own guard drops this one.
        void wake.flush();
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
  const ask = async <T>(
    work: (agent: Harness<ConductorRow>) => Promise<T>,
  ): Promise<T> => {
    try {
      return await work(await live());
    } catch (err) {
      if (err instanceof HarnessUnavailable) {
        throw new ConductorUnavailable({ why: err.why });
      }
      if (err instanceof HarnessRefused) {
        throw new ConductorRefused({ why: err.why });
      }
      throw err;
    }
  };

  /** Stop a child and carry on. A teardown that threw here would skip the
   *  flush that follows it, and the record is what the next boot reads. */
  const stopQuietly = async (agent: Harness<ConductorRow>): Promise<void> => {
    try {
      await agent.stop("stopped by app");
    } catch (err: unknown) {
      log.warn(
        { err },
        "kolu-server: the conductor's agent did not stop cleanly",
      );
    }
  };

  /**
   * THE AGENT, STARTED AGAIN into the conversation named here — the one that
   * was live when whoever asked for this pressed the button, carried in rather
   * than re-read, because a sign-in takes minutes and the conversation is the
   * one the person was looking at. `live()` spawns with it as `resume`, so the
   * restart is that conversation with a fresh `initialize`, which is when the
   * adapter reads its signature.
   *
   * A TURN IN FLIGHT REFUSES IT. `stop()` sets `stopped` before it tears
   * anything down, so a restart over a running turn ends the answer
   * mid-sentence, drops whatever was queued behind it, and reports none of it:
   * every row on screen stays exactly as it was. There is already a verb for
   * ending a turn, and this says to use it.
   */
  const reload = async (into: string | null): Promise<void> => {
    if (state.phase === "working" || state.phase === "asking") {
      throw new ConductorRefused({
        why:
          state.phase === "asking"
            ? "the agent is in the middle of a turn, waiting on a question. Answer it, or stop the turn, and restart the agent then — a restart now would end the turn mid-sentence with nothing on screen saying so."
            : "the agent is in the middle of a turn. Stop the turn, or wait for it to end, and restart the agent then — a restart now would end the answer mid-sentence and drop anything queued behind it, with nothing on screen saying so.",
      });
    }
    resume = into;
    const running = harness;
    harness = null;
    // WHAT THE OLD HARNESS SAYS NEXT IS NOT THIS CONVERSATION'S: the stop
    // below publishes `sessionId: null`, and the record must not learn it.
    generation += 1;
    if (running !== null) await stopQuietly(running);
    await ask(async () => undefined);
  };

  /** THE KEYS CHANGED HANDS — the event, the file, the readers, and the
   *  Conductor told.
   *
   *  The wake goes through the ordinary held-news path and NOT through
   *  `ask(agent)`: a person must be able to take a terminal over while the
   *  agent is down, signed out or mid-turn, so the news waits for somebody to
   *  tell exactly as a terminal's own news does. */
  const handover = (ref: string, what: "taken-over" | "handed-back"): void => {
    const found = works.at(ref);
    if (found === undefined) return;
    const member = members.at(ref);
    works.handover(ref, what);
    const split = splitFleetTerminalRef(ref);
    wake.hold(ref, {
      ref,
      host: split?.host ?? "",
      terminalId: split?.id ?? "",
      hostName: hostNames.get(split?.host ?? "") ?? split?.host ?? "",
      name: member?.name ?? "",
      agent: member?.agent ?? "",
      level: what,
      at: nowIso(),
    });
    publishState();
    works.changed();
    // NOT on the throttle: who may type into a terminal is the one fact a
    // restart must not get wrong.
    records.now("works");
    void wake.flush();
  };

  // The cell is NOT published here: this host may be constructed BEFORE
  // `surface.ts` has registered the cell writer, so a write at construction
  // would reach a seam with nothing behind it. The cell is SEEDED from
  // `state()` instead, and every later movement publishes through `publish`.

  return {
    // THE SAME FRAME A PUBLISH WOULD SEND, composed rather than remembered:
    // the cell is seeded from here, and a seed that left the works' open
    // questions out would ring nothing until the next movement.
    state: frameNow,
    observe: observer.observe,
    observedPr: observer.observedPr,
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
    prompt: async (text, mentions, attached, steer) => {
      try {
        const about = mentions.map((mention) => ({ ...mention }));
        // The files are already on disk — the prompt names them, and this is
        // where they are found and measured. A refused attachment refuses the
        // whole message rather than arriving as a second sentence under a turn
        // that already went out.
        const files = spool.named(attached);
        const sent = await ask((agent) =>
          agent.prompt(
            {
              text,
              // WHAT THE AGENT IS SENT UNDER THE WORDS: the block naming what
              // the message was ABOUT ({@link ./aboutBlock.ts}). It is written
              // here because the chips are kolu's and the agent cannot see
              // them — a conversation handed the words alone would answer
              // about a context the person thought they had given it.
              body:
                about.length === 0 ? text : `${aboutBlock(about)}\n\n${text}`,
              extra: {
                ...(about.length === 0 ? {} : { mentions: about }),
                attachments: files,
              },
              files,
            },
            steer,
          ),
        );
        // The harness minted the user row before it answered, and that row
        // NAMES these files: the transcript is what keeps them from here on,
        // so the upload's own protection is done.
        spool.sent(attached.map((one) => one.id));
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
        spool.sent(attached.map((one) => one.id));
        spool.sweep();
        throw err;
      }
    },
    works: () => {
      // The works are on disk before they are in memory, and reading them
      // must not start an agent: the watcher asks this at boot, and a
      // conversation spawned to answer "what work is in flight" is a
      // subprocess nobody asked for.
      remembered();
      return works.read();
    },
    readings: () => {
      remembered();
      return members.readings();
    },
    memberRefs: () => {
      remembered();
      return works.memberRefs();
    },
    prWatches: () => {
      // The same boot read `memberRefs` makes, and for the same reason: the
      // watch asks at boot, and a conversation spawned to answer "which
      // branches have work in flight" is a subprocess nobody asked for.
      remembered();
      return works.prWatches();
    },
    membersDetail: () => {
      remembered();
      return works.membersDetail();
    },
    openWork: async (intent) => {
      remembered();
      const offer = deps.offer();
      // NO HARNESS QUESTION FOR A HOST WITH NOTHING TO RUN: a setup that asks
      // which harness runs a role is refused, naming the host and what to do,
      // unless that host's coding agents are ready.
      if (
        intent.setup.some(
          (one) =>
            isKoluChoiceKey(one.key) && roleOfKey(one.key).what === "harness",
        )
      )
        await offer.requireAgentsReady(hostOf(intent));
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
      // ... and a harness or model the REQUEST named is judged by the rule
      // that records an answer, before the work exists — and A SAVED ANSWER
      // KOLU NO LONGER OFFERS is asked again, with what it was and why it no
      // longer stands in the question's own words (only keys with no answer
      // are asked otherwise, so a role whose saved answer cannot start would
      // never be asked again). Both against ONE reading of the host.
      const before = works.get(workIdOf(intent.key));
      const given = givenAnswersOf(
        intent.setup.flatMap((one) =>
          isKoluChoiceKey(one.key) && one.given.kind === "given"
            ? [{ key: one.key, value: one.given.value }]
            : [],
        ),
        before,
      );
      const saved = Option.match(before, {
        onNone: () => [],
        onSome: (work) =>
          savedAnswersOf(
            work,
            intent.setup.flatMap((one) =>
              isKoluChoiceKey(one.key) ? [one.key] : [],
            ),
          ),
      });
      const choices = await choicesFor(
        intent,
        modelHarnessesOf([...given, ...saved]),
        offer,
        "Nothing was opened or asked.",
      );
      const refused = unofferedAnswers(given, choices);
      if (refused.length > 0)
        throw new WorkRefusal(
          "not-offered",
          `${unofferedSentence(refused, choices, intent)}. Answer with one of kolu's options. Nothing was recorded.`,
        );
      const reasked = new Map<SetupKey, string>(
        unofferedAnswers(saved, choices).map((one) => [
          one.key,
          `${KOLU_QUESTION[one.key]} It was ${JSON.stringify(one.value)}, which ${unofferedWhy(one, choices.harnesses, hostOf(intent))}.`,
        ]),
      );
      // THE KEY IS THE WORK. A key kolu already holds answers that work as it
      // stands — reopened if it had ended — so a second card for one branch
      // is not something this call can make however often it is called.
      const opened = works.openFor({
        key: intent.key,
        title: intent.title,
        // WHAT THE HUMAN ASKED FOR, as kolu saw them say it: the newest
        // thing they typed. The Conductor is not asked for it — a request
        // it retyped would be its summary of the words rather than the
        // words — and an empty transcript honestly has none.
        request: newestRequest(),
      });
      const id = opened.id;
      // WHAT IS ASKED is read by THE ONE READING of a setup question: every
      // key with no value — the ones whose question is still open included —
      // and every saved answer kolu no longer offers. A work already set up
      // asks nothing, which is what makes carrying on with an existing work
      // free of a second form about decisions the human already made.
      const keys = keysToAsk(
        Option.some(opened.work),
        intent.setup.map((one) => one.key),
        new Set(reasked.keys()),
      );
      // ... and A KEY STILL OPEN IN AN OLDER FORM is asked in this one
      // instead: the old question is dropped, so exactly one question per key
      // is ever in front of the human, and its row in the chat says so.
      const superseded = dropSuperseded(
        opened.work,
        openSetupQuestions(opened.work, keys),
        new Date().toISOString(),
      );
      if (superseded.work !== opened.work) {
        works.save(id, superseded.work);
        works.changed();
        for (const one of superseded.settled) settleAsk(one.ask, one.standing);
      }
      const questions: ReadonlyArray<Question> = intent.setup
        .filter((one) => keys.includes(one.key))
        .map((one): Question => {
          const id = crypto.randomUUID();
          switch (one.key) {
            case "mode":
            case "on-green":
              return {
                id,
                question: one.question,
                topic: "setup",
                key: one.key,
                options: one.options,
                given: one.given,
              };
            default:
              // KOLU'S OWN QUESTIONS are worded by kolu and carry no options:
              // the form draws them live, off the listing and the host.
              return {
                id,
                question: reasked.get(one.key) ?? KOLU_QUESTION[one.key],
                topic: "setup",
                key: one.key,
                given: one.given,
              };
          }
        });
      const put =
        questions.length === 0
          ? { ask: `given:${id}`, asked: false }
          : asks.put(id, `Setting up «${intent.title}»`, questions);
      // THE SETUP AS IT READS NOW — whatever the request already gave, and
      // whatever the work already decided.
      return {
        work: id,
        setup: setupOf(Option.getOrElse(works.get(id), () => superseded.work)),
        ask: put.ask,
        asked: put.asked,
        created: opened.created,
        reopened: opened.reopened,
      };
    },
    askAboutWork: (id, questions) => {
      remembered();
      const work = works.openAt(id);
      const asked: ReadonlyArray<Question> = questions.map((one) => ({
        id: crypto.randomUUID(),
        // A QUESTION ABOUT THE WORK rather than about how it is run, so no
        // reading is ever taken off it.
        topic: "work",
        header: one.header,
        question: one.question,
        options: one.options,
        multiple: one.multiple,
        file: one.file,
      }));
      return asks.put(
        id,
        // One question IS the message: a heading repeating the only question
        // under it is a row that says everything twice.
        asked.length === 1
          ? (asked[0]?.question ?? work.title)
          : `About «${work.title}»`,
        asked,
      );
    },
    answerWork: async ({ work, ask, from, reply }) => {
      remembered();
      const found = Option.getOrThrowWith(
        works.get(work),
        () =>
          new WorkRefusal(
            "unknown-work",
            `There is no piece of work called ${JSON.stringify(work)}, so there is nothing to answer about it.`,
          ),
      );
      // AN ANSWER IS CHECKED WHERE IT IS RECORDED: a mode or an on-green
      // outside kolu's words, a harness kolu does not carry, or a model the
      // host did not list never becomes a decision.
      if (reply.kind === "answered") {
        const foreign = foreignAnswers(found, ask, reply.values);
        if (foreign.length > 0)
          throw new WorkRefusal(
            "not-offered",
            `${foreign.join("; ")}. Answer with one of kolu's words for it. Nothing was recorded.`,
          );
        const answers = askedAnswersOf(found, ask, reply.values);
        const choices = await choicesFor(
          found,
          modelHarnessesOf(answers),
          deps.offer(),
          "Nothing was recorded.",
        );
        const bad = unofferedAnswers(answers, choices);
        if (bad.length > 0)
          throw new WorkRefusal(
            "not-offered",
            `${unofferedSentence(bad, choices, found)}. Answer with one of kolu's options. Nothing was recorded.`,
          );
      }
      // NOBODY IS WAITING ON THIS ANSWER, so nothing is released by it: it is
      // recorded, the conversation is WOKEN with what was said (by `asking`'s
      // news sink, which is where that rule lives), and this call answers
      // only how it was settled. Read again after the check: another face
      // may have answered while the host was asked.
      const current = Option.getOrElse(works.get(work), () => found);
      const answered = asks.answer({
        id: work,
        work: current,
        ask,
        from,
        reply,
      });
      switch (answered.kind) {
        case "nothing-open":
          return { outcome: { kind: "nothing-open" } };
        case "nothing-answered":
          throw new WorkRefusal(
            "nothing-answered",
            `That answer fills in no question of «${current.title}», so nothing was recorded and every question is still asked. Fill in at least one, or say you would rather not.`,
          );
        case "declined":
          // A SETUP NOBODY WOULD ANSWER, FOR A WORK NOTHING HAS HAPPENED IN,
          // IS A WORK NOBODY WANTED — and it is REMOVED rather than ended.
          // There is no outcome that would be true of it: no terminal ever
          // joined it and no pull request was ever opened for it, so a card
          // reading "stopped" would be a line about a thing that never
          // happened. A decline on a work that HAS got somewhere is recorded
          // and the work stays open.
          if (
            Option.exists(
              works.get(work),
              (after) =>
                after.state.kind === "open" &&
                after.decisions.some(
                  (one) => one.ask === ask && one.topic === "setup",
                ),
            )
          )
            works.declined(work);
          publishState();
          return { outcome: { kind: "declined" } };
        case "part":
          publishState();
          return { outcome: { kind: "part", open: answered.open } };
        case "answered":
          publishState();
          return { outcome: { kind: "answered" } };
        default:
          return answered satisfies never;
      }
    },
    startOf: async (id, role) => {
      remembered();
      const found = Option.getOrThrowWith(
        works.get(id),
        () =>
          new WorkRefusal(
            "unknown-work",
            `There is no piece of work called ${JSON.stringify(id)} — open it with \`work_open\` first. Nothing was created.`,
          ),
      );
      if (found.state.kind === "ended")
        throw new WorkRefusal(
          "work-ended",
          `The piece of work ${JSON.stringify(id)} has ended, so nothing more is started for it. Nothing was created.`,
        );
      if (found.key.kind !== "branch")
        throw new WorkRefusal(
          "missing-setup",
          `«${found.title}» is a watch of a terminal, and a watch runs no ${role}. Nothing was created.`,
        );
      // WHAT IT WAITS ON, by the one reading — and said as it is: a question
      // open in front of the human will be answered by itself, and one asked
      // of nobody will not be until `work_open` asks it.
      const blockers = startBlockers(found, role);
      if (blockers.length > 0)
        throw new WorkRefusal(
          "missing-setup",
          `The ${role} of «${found.title}» cannot start yet: ${blockersSentence(blockers)}. Nothing was created.`,
        );
      if (!rolesOf(modeOf(found)).includes(role))
        throw new WorkRefusal(
          "missing-setup",
          `«${found.title}» runs in ${Option.getOrElse(modeOf(found), () => "no")} mode, which has no ${role}. Nothing was created.`,
        );
      const setup = roleSetupOf(found, role);
      if (setup.kind !== "harness-and-model")
        throw new Error(
          `startOf: the ${role} of ${id} waits on nothing, yet its setup is ${setup.kind}`,
        );
      // THE SAVED PAIR, JUDGED AGAIN — by the rule that records an answer,
      // against what the host says now: a PICKED model against its list (a
      // list the host cannot read just now refuses nothing), a TYPED one by
      // upstream's one-word rule alone, with no list asked for.
      const saved = savedAnswersOf(found, koluKeysOf(role));
      const offer = deps.offer();
      const choices = await choicesFor(
        found,
        modelHarnessesOf(saved),
        offer,
        "Nothing was created.",
      );
      const bad = unofferedAnswers(saved, choices);
      if (bad.length > 0)
        throw new WorkRefusal(
          "not-offered",
          `The ${role} of «${found.title}» cannot start on its saved setup: ${unofferedSentence(bad, choices, found)}. Call \`work_open\` for this work again — kolu asks the human again for every answer it no longer offers. Nothing was created.`,
        );
      // HOW THE HARNESS TAKES A MODEL is its adapter's word, which runs no
      // harness — so a start never depends on whether its list works today.
      const host = found.key.host;
      const launch = await offer
        .launch({ host, harness: setup.harness })
        .catch((err: unknown) => {
          if (err instanceof WorkRefusal) throw err;
          throw new WorkRefusal(
            "agents-not-ready",
            `kolu could not ask how ${setup.harness} takes a model on ${host}: ${err instanceof Error ? err.message : String(err)}. Nothing was created.`,
          );
        });
      return { host, harness: setup.harness, model: setup.model, launch };
    },
    stopWork: (id, by) => {
      remembered();
      works.stop(id, by);
      publishState();
    },
    reopenWork: (id) => {
      remembered();
      works.reopen(id);
      publishState();
    },
    joinWork: (id, ref, role, joined) => {
      remembered();
      works.join(id, ref, role, joined);
    },
    leaveWork: (ref) => {
      remembered();
      const found = works.at(ref);
      if (found === undefined) return false;
      // ... and whatever it was about to say goes with it. A conversation that
      // let a member go is not owed one last word about it.
      wake.withdraw(ref);
      works.leave(ref, "released");
      publishState();
      return true;
    },
    takeOver: (ref) => {
      remembered();
      const found = works.driven(ref);
      if (found.driver === "you") {
        throw new WorkRefusal(
          "already-yours",
          `You have already taken over the ${found.member.role} of «${found.work.title}» (${ref}) — hand it back when you are done with it.`,
        );
      }
      handover(ref, "taken-over");
    },
    handBack: (ref) => {
      remembered();
      const found = works.driven(ref);
      if (found.driver === "conductor") {
        throw new WorkRefusal(
          "already-conductors",
          `The ${found.member.role} of «${found.work.title}» (${ref}) is already the Conductor's — nobody has taken it over.`,
        );
      }
      handover(ref, "handed-back");
    },
    restoreWorks: (restored, watched) => {
      // The records are read FIRST, so a restore into a process that has not
      // looked at its own file yet cannot be undone by the boot read that
      // would otherwise follow it.
      remembered();
      // A terminal the snapshot does not have as a member has nothing left to
      // read — and nothing left to say.
      for (const ref of works.restore(restored, watched)) wake.withdraw(ref);
      publishState();
    },
    reloadRecords: () => {
      if (read) {
        throw new Error(
          "the conductor has already read its records — a reload would let the file win an argument with the live conversation",
        );
      }
      // The refusal goes FIRST, so a reload that trips again publishes the
      // new one rather than leaving the old sentence standing beside it.
      state = { ...state, refusal: null, unreadable: null };
      // Throws — and re-says the refusal through `sayRefusal` — if whatever
      // the recovery wrote still does not read. The caller is a procedure
      // that must be able to tell a person that, so nothing is swallowed.
      remembered();
      // THE READERS SUBSCRIBED NOW ARE HOLDING AN EMPTY TRANSCRIPT: they
      // subscribed while the records were unreadable, so the rows this read
      // just brought in have reached nobody. A snapshot is the one frame
      // that replaces what a reader has rather than amending it.
      seq += 1;
      const frame = snapshot();
      for (const sink of sinks) sink(frame);
      publishState();
    },
    note: (id, text) => {
      remembered();
      works.save(
        id,
        recordEvent(works.openAt(id), {
          at: nowIso(),
          by: "agent",
          kind: "note",
          about: ABOUT_WORK,
          text,
        }),
      );
      works.changed();
    },
    saidTo: observer.saidTo,
    closedTerminal: observer.closedTerminal,
    // No `live()`: uploading a file must not spawn an agent. The bytes are
    // this server's own bookkeeping, and a person who pastes an image into a
    // panel they then close should not have started a Claude for it.
    attach: (chunk) => {
      remembered();
      return spool.chunk(chunk);
    },
    cancel: () => ask((agent) => agent.cancel()),
    answer: (askId, answers) => ask((agent) => agent.answer(askId, answers)),
    signIn: async (method) => {
      // THE CONVERSATION THIS PERSON IS IN, read BEFORE the login runs. A
      // sign-in is minutes of somebody finding a password and a phone, and
      // the conversation to come back to is the one that was on screen when
      // they pressed the button — not whatever the agent's state says by the
      // time the restart gets its turn.
      const into = state.sessionId;
      const outcome = await ask((agent) => agent.signIn(method));
      // THE NEW SIGNATURE IS THE ONE THE NEXT TURN USES. The adapter caches
      // the account it read at `initialize`; its own note says a credential
      // that replaces it "is invisible until a new `initialize` runs".
      if (outcome !== "signed-in")
        return { outcome, restart: { kind: "not-due" as const } };
      try {
        await reload(into);
        return { outcome, restart: { kind: "restarted" as const } };
      } catch (err) {
        // TWO FACTS, TWO ANSWERS. The signature landed — the store has been
        // written and saying "Sign-in failed" over that is a lie somebody
        // acts on by signing in twice — and the agent is still the old one,
        // which the person must know because the next turn is the old
        // account's. A DEFECT still crashes: only the declared refusals are
        // facts about this restart.
        if (!isConductorDeclaredError(err)) throw err;
        return {
          outcome,
          restart: { kind: "did-not-restart" as const, why: err.why },
        };
      }
    },
    askSignIn: () => ask(async (agent) => agent.askSignIn()),
    signInInput: (text) => ask((agent) => agent.signInInput(text)),
    signInCancel: () => ask((agent) => agent.signInCancel()),
    // The conversation the agent is in NOW: nothing has been waited for
    // between the press and here.
    reloadAgent: () => reload(state.sessionId),
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
        spool.sweep();
        // THE FLEET IS A MEMORY OF THE CONVERSATION THAT IS GONE. The wipe
        // deletes what this conversation knew: the agent is about to have no
        // memory of `fleet` or of what it had been told, so a strip naming
        // those terminals belongs to a conversation that no longer exists.
        //
        // THE WORKS STAY, AND SO DO THEIR QUESTIONS. A piece of work outlives
        // the conversation that opened it — that is the whole point of its
        // being a record of its own — and a person pressing `New session` has
        // said they are done with the chat, not that they stopped caring
        // about a waterfall in flight.
        //
        // A QUESTION IS NOT THE CONVERSATION'S TO LOSE either, now that
        // nothing holds a promise behind it: it is a decision with no answer
        // yet, the card still offers it, and answering it wakes whatever
        // conversation comes next. Dropping them here is what used to make a
        // plan approval vanish the moment somebody started fresh.
        wake.clear();
        fleet.clear();
        state = { ...state, fleet: [] };
        publishState();
        works.publishWorks();
        // NOT on the throttle. A wipe is the one movement whose whole purpose
        // is that what was there is gone, and a window in which the file
        // still holds it is a window in which the next reader — or the next
        // boot — restores a transcript somebody deleted.
        records.now("record");
        records.now("transcript");
        records.now("works");
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
      records.flush();
    },
  };
}
