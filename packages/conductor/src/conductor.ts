import type { NotHere } from "@kolu/acp/engine";
import type { AgentModelLaunch } from "@kolu/agent-distro/models";
import {
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
 *  gives it a model. */
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

const KOLU_QUESTION: Readonly<Record<KoluChoiceKey, string>> = {
  "planner.harness": "Which harness runs the planner?",
  "planner.model": "Which model does the planner run on?",
  "implementor.harness": "Which harness runs the implementor?",
  "implementor.model": "Which model does the implementor run on?",
};

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
      throw new WorkRefusal(
        "not-offered",
        `kolu could not ask what ${harness} offers on ${host}. The reason is the human's to read on their own screen — it can carry their shell's output, so it is not repeated here. ${nothing}`,
      );
    }
  }
  return { harnesses: installed, models };
}

const unofferedSentence = (
  bad: ReadonlyArray<UnofferedAnswer>,
  choices: KoluChoices,
  where: Pick<Work, "key">,
): string =>
  bad
    .map((one) => unofferedWords(one, choices.harnesses, hostOf(where)))
    .join("; ");

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
   *  `offline` with the remembered session and fleet, which is the truth. */
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
   *  seen in it and how it joined. */
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
   *  ({@link ConductorHost.startOf}). */
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
   *  state (`already-yours`). */
  readonly takeOver: (terminal: string) => void;
  /** ... and gives them back. Refused `not-driven`, or `already-conductors`
   *  when nobody had taken it over. */
  readonly handBack: (terminal: string) => void;
  /** EVERY WORK, REPLACED — a restored backup of the server's store.
   *
   *  The snapshot has already been decoded through the migration ladder, so
   *  what arrives is today's shape: the works AND the member bookkeeping that
   *  goes with them, which are two keys of one file and have to be restored
   *  together or a member comes back as a terminal nobody has ever read. */
  readonly restoreWorks: (
    works: PersistedWorks,
    members: PersistedMembers,
  ) => void;
  /** READ THE RECORDS AGAIN — the one caller is a recovery that has just put
   *  readable bytes under a record this build refused
   *  ({@link UnreadablePersisted}), and the whole point of it is that nobody
   *  has to restart kolu-server to get their Conductor back. */
  readonly reloadRecords: () => void;
  /** THE ONE THING THE CONDUCTOR WRITES ON A TIMELINE that kolu did not
   *  observe: a line of text. Nothing reads a note to decide anything. */
  readonly note: (work: string, text: string) => void;
  /** THE CONDUCTOR JUST SPOKE TO THE AGENT IN THIS TERMINAL — `agent_say`
   *  landed its keystrokes. */
  readonly saidTo: (ref: string) => void;
  /** THE CONDUCTOR JUST CLOSED THIS TERMINAL — `lifecycle_kill` answered. */
  readonly closedTerminal: (ref: string) => void;
  /** WHAT THE WATCHER SAW, for refs on CONNECTED hosts only. */
  readonly observe: (seen: ReadonlyArray<WatchObservation>) => void;
  /** THE PULL-REQUEST WATCH'S SCOPE — every piece of work in progress that is
   *  a BRANCH on a machine, with the host, repository and branch kolu asks
   *  that host about. Beside {@link ConductorHost.memberRefs} and not folded
   *  into it: a work's pull request is watched whether or not a terminal is
   *  left, which is the whole of why a work the Conductor merged and then
   *  closed the terminals of now ends ({@link ConductorHost.observedPr}). */
  readonly prWatches: () => ReadonlyArray<PrWatch>;
  /** WHAT THE WORK'S OWN PULL-REQUEST WATCH READ — one reading of one work's
   * branch, off the host it is on. */
  readonly observedPr: (work: WorkId, pr: PrResult) => void;
  /** ONE CHUNK of a file on its way up, ahead of the prompt that names it. */
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
  /** THE WIPE — the header menu's `New session`, behind its one confirm. */
  readonly clearSession: () => Promise<void>;
  /** Process-lifetime teardown: stop the child, write the records, drop the
   *  readers. AWAITED by kolu-server's shutdown, because the adapter is spawned
   *  `detached` — a teardown that only fired the stop would leave the adapter,
   *  its `claude` and its MCP client running after the server that owns them
   *  is gone. */
  readonly dispose: () => Promise<void>;
}

/** WHERE THE FLEET MCP FACE IS LISTENING, and the credential that opens it. */
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
   *  or `null` while the listener is not up. */
  readonly fleetMcp: () => FleetMcpEndpoint | null;
  /** WHAT KOLU OFFERS for a role's harness and model — the harnesses it
   *  carries, what each offers on a work's host, and whether that host has a
   *  harness to choose at all. Read per call: the host owns it, built once it
   *  has read its agent-distro listing. */
  readonly offer: () => KoluOffer;
  /** PROVE that endpoint answers — a real request, no timer — returning the
   *  sentence that says why not, or `null` when it will serve this caller. */
  readonly proveFleetMcp: (
    at: FleetMcpEndpoint,
    log: Logger,
  ) => Promise<string | null>;
  /** Publish the live cell value. */
  readonly publish: (state: ConductorState) => void;
  /** PUBLISH ONE PIECE OF WORK — the `works` collection's writer, pushed in
   *  for the same reason `publish` is. `null` REMOVES it (it fell off the
   *  history cap, or a restore replaced the set). */
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
   *  themselves rather than the browser's frame. */
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
  /** How a conversation is STARTED — `startHarness`, pushed in at assembly. */
  readonly spawn: (
    options: HarnessOptions<ConductorRow>,
  ) => Promise<Harness<ConductorRow>>;
}

const NO_FLEET_MCP =
  "This kolu has not published its fleet MCP endpoint yet, so the conductor cannot tell its agent where the fleet's terminals are. Try again once the server has finished starting.";

const PERSIST_THROTTLE_MS = 1_000;

const STOP_IN_FLIGHT_MS = 5_000;

const sentenceOf = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "why" in err) {
    const { why } = err;
    if (typeof why === "string" && why !== "") return why;
  }
  return err instanceof Error ? err.message : String(err);
};

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
  } satisfies Pick<ConductorState, "install" | "agentName" | "cwd">;

  let state: ConductorState = {
    ...DEFAULT_CONDUCTOR_STATE,
    ...serverAuthored,
  };

  const byId = new Map<string, ConductorRow>();
  let rowsCache: ReadonlyArray<ConductorRow> | null = null;
  const rows = (): ReadonlyArray<ConductorRow> =>
    (rowsCache ??= [...byId.values()].sort((a, b) => a.seq - b.seq));

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

  let generation = 0;

  let read = false;

  let resume: string | null = null;
  let chosenModel: string | null = null;

  let taught = false;

  let fleet = new Fleet();

  let published: ConductorState | null = null;

  const sameFrame = Schema.toEquivalence(ConductorStateSchema);

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

  const records = recordWrites(
    {
      record: () => store.set(persistedFrom(state, taught)),
      transcript: () => transcriptStore.set(transcriptFrom(rows())),
      works: () => worksStore.set(works.persisted()),
      members: () => membersStore.set(members.saved()),
    },
    PERSIST_THROTTLE_MS,
  );

  const members = memberStore();

  const works = workStore({
    workFiles,
    publishWork,
    publishMember,
    publishReading,
    worksMoved,
    watchScopeMoved,

    ended: (settled) => {
      for (const one of settled) {
        settleAsk(one.ask, one.standing);
        wake.answered(one.news);
      }
      void wake.flush();
    },

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
      if (!read) return null;
      const named = new Set<string>();
      for (const row of byId.values()) {
        if (row.kind !== "user") continue;
        for (const one of row.attachments) named.add(one.id);
      }
      return named;
    },
  });

  const hostNames = new Map<string, string>();

  const readKoluCall: HarnessOptions<ConductorRow>["readCall"] = (
    frame,
    held,
  ) => {
    const call = frame.mcp[0];
    const seen =
      call === undefined
        ? null
        : koluCallOf(call.tool, frame.input, frame.answer);
    const kolu = refineKoluCall(held?.kolu ?? null, seen);

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

    said: (ask, work, message, fields) => {
      sayAsk(ask, work, message, fields);
    },
    settled: (ask, standing) => {
      settleAsk(ask, standing);
    },

    news: (one) => {
      wake.answered(one);
      void wake.flush();
    },
  });

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
      sayRefusal(err);
      throw err;
    }

    read = true;

    parsePersistedStore(kept, watched, storePath(), stateRoot);
    works.load(kept, watched);
    if (works.all().length > 0) {
      works.publishWorks();

      worksMoved();
      watchScopeMoved();
    }

    if (record.cwd === home) {
      resume = record.sessionId;

      chosenModel = record.model;

      taught = record.taught;

      fleet = new Fleet(record.fleet);
      for (const row of transcript.rows) byId.set(row.id, row);
      rowsCache = null;
      state = { ...state, sessionId: record.sessionId, fleet: record.fleet };
      publishState();
    }

    spool.sweep();
  };

  const snapshot = (): ConductorFrame => ({
    kind: "snapshot",
    seq,
    rows: [...rows()],
  });

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

  const provenFleetServer = async (): Promise<HttpServer> => {
    const at = fleetMcp();
    if (at === null) throw new ConductorUnavailable({ why: NO_FLEET_MCP });

    const why = await proveFleetMcp(at, log);
    if (why !== null) throw new ConductorUnavailable({ why });
    return {
      kind: "http",
      name: "kolu",
      url: at.url,
      headers: { Authorization: `Bearer ${at.token}` },
    };
  };

  const sayRefusal = (err: unknown): void => {
    state = {
      ...state,
      phase: "offline",
      refusal: sentenceOf(err),

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

  let notices = 0;

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

  const settleAsk = (ask: string, standing: ConductorWorkAskStanding): void => {
    const row = byId.get(ask);

    if (row === undefined || row.kind !== "work-ask") return;
    const now = row.ask.standing.kind;
    if (now !== "open" && now !== "part") return;
    applyRows({
      upserts: [{ ...row, ask: { ...row.ask, standing } }],
      removes: [],
      appends: [],
    });
  };

  const live = async (): Promise<Harness<ConductorRow>> => {
    const running = harness;
    if (running !== null) {
      if (running.alive()) return running;
      harness = null;

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

    const resuming = resume !== null && hadATurn(rows());

    generation += 1;
    const mine = generation;
    const begun = (async (): Promise<Harness<ConductorRow>> => {
      const kolu = await provenFleetServer();
      return spawn({
        agent: ENGINE.id,
        leg: ENGINE.leg,
        adapter: seating as Exclude<typeof seating, NotHere>,
        cwd: home,

        configDir: conductorConfigDir(process.env, home),
        mcpServers: [kolu],
        teaching: teaching(hostName),

        taught: resuming && taught,
        log,

        opens:
          resuming && resume !== null
            ? { kind: "resume", id: resume }
            : { kind: "fresh" },
        resumedSeq: rows().at(-1)?.seq ?? 0,
        resumedEndsWithDivider: rows().at(-1)?.kind === "divider",

        readCall: readKoluCall,

        whenNewSession: "divide",

        numbering: "continues",
        whenLoadRefused: "fresh",
        whenReplayed: "drop",
        model: chosenModel,
        onChange: (change) => {
          if (change.kind === "state") {
            if (disposed || mine !== generation) return;

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
            if (state.sessionId !== null && state.sessionId !== resume) {
              fleet.clear();
              state = { ...state, fleet: [] };
            }

            if (state.sessionId !== null) resume = state.sessionId;
            publishState();
            records.schedule("record");

            if (state.phase === "idle") void wake.flush();
            return;
          }

          if (change.kind === "rows") applyRows(change);
        },
      });
    })();
    starting = begun
      .then((started) => {
        harness = started;

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

    generation += 1;
    if (running !== null) await stopQuietly(running);
    await ask(async () => undefined);
  };

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
    records.now("works");
    void wake.flush();
  };

  return {
    state: frameNow,
    observe: observer.observe,
    observedPr: observer.observedPr,
    watch: (sink) => {
      remembered();
      sinks.add(sink);
      sink(snapshot());

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

        const files = spool.named(attached);
        const sent = await ask((agent) =>
          agent.prompt(
            {
              text,

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

        spool.sent(attached.map((one) => one.id));
        return sent;
      } catch (err) {
        spool.sent(attached.map((one) => one.id));
        spool.sweep();
        throw err;
      }
    },
    works: () => {
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

      if (
        intent.setup.some(
          (one) =>
            isKoluChoiceKey(one.key) && roleOfKey(one.key).what === "harness",
        )
      )
        await offer.requireAgentsReady(hostOf(intent));

      const missing = missingSetup(intent.setup);
      if (missing.length > 0) {
        throw new WorkRefusal(
          "missing-setup",
          `«${intent.title}» cannot be opened: its setup does not ask ${missing.join(", ")}. Every setup question travels in \`work_open\` — ask them all in that one call (with \`given\` for whatever the request already said), so the human answers one form.`,
        );
      }

      const foreign = foreignSetupWords(intent.setup);
      if (foreign.length > 0) {
        throw new WorkRefusal(
          "missing-setup",
          `«${intent.title}» cannot be opened: ${foreign.join(", ")} — the mode and what to do on green are read back off the human's answer, so their options must be kolu's own words (${WORK_MODES.join(" | ")}; ${ON_GREEN.join(" | ")}). Ask the question in whatever words you like; offer those values.`,
        );
      }

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

      const opened = works.openFor({
        key: intent.key,
        title: intent.title,

        request: newestRequest(),
      });
      const id = opened.id;

      const keys = keysToAsk(
        Option.some(opened.work),
        intent.setup.map((one) => one.key),
        new Set(reasked.keys()),
      );

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

        topic: "work",
        header: one.header,
        question: one.question,
        options: one.options,
        multiple: one.multiple,
        file: one.file,
      }));
      return asks.put(
        id,

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
      remembered();

      for (const ref of works.restore(restored, watched)) wake.withdraw(ref);
      publishState();
    },
    reloadRecords: () => {
      if (read) {
        throw new Error(
          "the conductor has already read its records — a reload would let the file win an argument with the live conversation",
        );
      }
      state = { ...state, refusal: null, unreadable: null };

      remembered();

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

    attach: (chunk) => {
      remembered();
      return spool.chunk(chunk);
    },
    cancel: () => ask((agent) => agent.cancel()),
    answer: (askId, answers) => ask((agent) => agent.answer(askId, answers)),
    signIn: async (method) => {
      const into = state.sessionId;
      const outcome = await ask((agent) => agent.signIn(method));
      if (outcome !== "signed-in")
        return { outcome, restart: { kind: "not-due" as const } };
      try {
        await reload(into);
        return { outcome, restart: { kind: "restarted" as const } };
      } catch (err) {
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

    reloadAgent: () => reload(state.sessionId),
    setOption: (id, value) => ask((agent) => agent.setOption(id, value)),
    newSession: () => ask((agent) => agent.newSession()),
    clearSession: () =>
      ask(async (agent) => {
        await agent.clearSession([...byId.keys()]);

        spool.sweep();

        wake.clear();
        fleet.clear();
        state = { ...state, fleet: [] };
        publishState();
        works.publishWorks();
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
        const late = pending.then(stopQuietly, () => {});
        const deadline = Promise.withResolvers<void>();

        setTimeout(deadline.resolve, STOP_IN_FLIGHT_MS).unref();
        await Promise.race([late, deadline.promise]);
      }
      records.flush();
    },
  };
}
