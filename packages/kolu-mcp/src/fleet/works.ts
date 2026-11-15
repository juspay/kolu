/**
 * THE PIECES OF WORK, as the fleet face reaches them — a port, and the five
 * tools that move them.
 *
 * kolu-server owns the works: they are stored with the rest of kolu's state,
 * they are what the server's watcher reads to decide which terminals can wake
 * a turn, and they outlive this MCP face entirely — a reconnecting conductor
 * finds the same works, and so does a NEW conversation ("New session" clears
 * the chat and keeps the work). So the face holds none of it — the same
 * reasoning `FleetHosts` is built on one file over, for the same reason: a
 * second copy inside this package is a copy that can be wrong.
 *
 * What the face DOES own is the vocabulary:
 *
 *  - `work_open` names a piece of work (title, repo, branch) AND carries its
 *    setup questions, which kolu puts to the human as ONE form; the answers
 *    become decisions on the work, and the host, the mode, the harness and
 *    model per role and what to do on green are READINGS of them.
 *  - `work_adopt` brings a terminal that already exists into a work, in a
 *    role — the roster check and the found-state answer `watch_terminal` had,
 *    plus the two facts that make a member a member.
 *  - `work_leave` takes one out; `work_note` puts a line on the timeline;
 *    `work_ask` asks the human something ABOUT a work, so the answer is kept
 *    with the work rather than lost with the conversation.
 *
 * READING them is a RESOURCE, not a sixth tool: `works`
 * (`surface://cells/works`), served off this port's {@link FleetWorks.rows}.
 * A conversation that could only MOVE its works would have to remember them
 * across restarts, and the observed failure that rule was written for is a
 * restarted Conductor saying it is "not certain" what it is running.
 *
 * A ROLE AND A WORK ARE REQUIRED, not defaulted. "Make me a terminal" with no
 * work is a terminal nobody is watching and no card to find it on; the
 * refusal costs one turn, the silence costs the run.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal } from "@kolu/padi-client/surface";
import { activeAgent } from "@kolu/padi-client/terminalVocab";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import { Effect, Schema } from "effect";
import {
  type Driver,
  type OnGreen,
  OnGreenSchema,
  type SetupKey,
  SetupKeySchema,
  type Standing,
  type WorkMode,
  WorkModeSchema,
  type Outcome,
  WorkRefusal,
  type WorkKey,
  type WorkRefusalKind,
  type WorkRole,
  WorkRoleSchema,
} from "kolu-work";
import type { FleetHostState, FleetWatchJoinSchema } from "./fleetSurface.ts";
import { type FleetHosts, requireTerminal } from "./hosts.ts";
import { FleetTerminalRefSchema } from "./refSchema.ts";
import { rosterStandingOf, stillSettling } from "../rosterEvidence.ts";

/** HOW a terminal came to be a member of a work — the fact the server's
 *  watcher needs to decide what its first observation means.
 *
 *   - `created` / `created-run` — the Conductor made this terminal, so the
 *     first reading is normally a bare shell and every later level is news.
 *     `created-run` additionally means a command was typed at that shell, so a
 *     terminal that runs it and comes back to the prompt with no agent ever
 *     seen is a bring-up that failed, not a terminal to wait on for ever.
 *   - `asked` — the Conductor adopted a terminal that was already there. Its
 *     first observation is a BASELINE, not news: an idle worker that was idle
 *     before anyone looked must not ring as if it had just stopped. The state
 *     it was found in is in `work_adopt`'s answer instead. */
export type FleetWatchJoin = typeof FleetWatchJoinSchema.Type;

/** One MEMBER of a work, as this port answers it: the terminal, what it is
 *  there to do, and the last thing kolu SAW in it. `name` and `agent` are
 *  `null` until something has read the terminal — never a stand-in empty
 *  string, because "nobody has looked yet" and "it is called nothing" are
 *  different answers to an agent deciding whether a worker is still there. */
export interface FleetWorkMemberRow {
  readonly ref: string;
  readonly role: WorkRole;
  readonly name: string | null;
  readonly agent: string | null;
  readonly joined: FleetWatchJoin;
  /** Whose keyboard it is — `kolu-work`'s own reading of the work's timeline
   *  ({@link Driver}), never a second fact kept beside it. `you` means the
   *  person took it over and the Conductor must not send it input. */
  readonly driver: Driver | null;
}

/** ONE PIECE OF WORK IN PROGRESS, as the port answers it — every field a
 *  READING of the stored record rather than a second copy of it. `onGreen` is
 *  the one place the script reads what to do when CI is green. */
export interface FleetWorkRow {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly branch: string;
  readonly host: string;
  readonly mode: WorkMode | null;
  readonly onGreen: OnGreen | null;
  /** WHERE IT STANDS, as `kolu-work` reads it off the timeline — a TOKEN
   *  (who is waited on and why), never a phrase. The words an agent reads are
   *  this face's ({@link standingWords}), the card's are the browser's, and
   *  the model keeps the decision. */
  readonly standing: Standing;
  readonly members: ReadonlyArray<FleetWorkMemberRow>;
  readonly openQuestions: ReadonlyArray<string>;
}

/** A finished work, as the resource still names it: enough to say what
 *  happened and to ask about it, and no more. */
export interface FleetFinishedWorkRow {
  readonly id: string;
  readonly title: string;
  readonly outcome: Outcome;
  readonly endedAt: string;
}

export interface FleetWorksRows {
  readonly works: ReadonlyArray<FleetWorkRow>;
  readonly finished: ReadonlyArray<FleetFinishedWorkRow>;
}

/** What `work_open` states: WHICH WORK (its key — a branch on a machine, or
 *  the terminal to watch), and every setup question in one call. */
export interface FleetWorkIntent {
  readonly key: WorkKey;
  readonly title: string;
  readonly setup: ReadonlyArray<{
    readonly key: SetupKey;
    readonly question: string;
    readonly options: ReadonlyArray<string>;
    readonly given?: string | undefined;
  }>;
}

/** ... and what it answers: the work, the setup as the decisions now READ,
 *  and whether anything was PUT TO THE HUMAN. Nothing here waits for them:
 *  the setup is whatever the request already gave, and the rest arrives as a
 *  wake when they answer. */
export interface FleetWorkOpened {
  readonly work: string;
  readonly host: string;
  readonly mode: WorkMode | null;
  readonly roles: ReadonlyArray<{
    readonly role: WorkRole;
    readonly harness: string | null;
    readonly model: string | null;
  }>;
  readonly onGreen: OnGreen | null;
  /** The ask the questions were put as — the id the work's decisions carry. */
  readonly ask: string;
  /** Whether a form actually went to the human. `false` when the request had
   *  already given every answer, which is a set of decisions and nobody was
   *  asked anything. */
  readonly asked: boolean;
  /** `false` when this key already had a piece of work — the SAME one is
   *  being carried on with, and no second card was made. */
  readonly created: boolean;
  /** ... and `true` when it had ended and this call brought it back. */
  readonly reopened: boolean;
}

/** A question put, and nothing more: the ask it was put as. */
export interface FleetWorkAsked {
  readonly ask: string;
}

/** The Conductor's pieces of work, as the fleet face reaches them.
 *  kolu-server owns them — this is only the door. */
export interface FleetWorks {
  /** Every work in progress and the last few finished ones. The ONE read: the
   *  `works` resource serves these rows and the tools answer off them, so
   *  "what am I running" has a single answer however it is asked. */
  rows(): FleetWorksRows;
  /** THE RECORD MOVED — a member joined or left, an agent was seen, a work
   *  ended. The `works` resource re-reads on this, which is how a terminal
   *  that went away reaches a conductor that is not calling anything. */
  subscribe(cb: () => void): () => void;
  /** OPEN A WORK and put its setup questions to the human as one ask — and
   *  ANSWER AT ONCE. Nothing here waits on a person: the human's answers
   *  arrive later, as a wake, and the work carries them as decisions.
   *  Refused, with nothing created, when the setup does not carry a question
   *  the mode needs. */
  open(intent: FleetWorkIntent): FleetWorkOpened;
  /** Ask the human something about a work — and answer at once, with the ask
   *  it was put as. The answer comes back as a wake. */
  ask(
    work: string,
    questions: ReadonlyArray<{
      readonly header: string;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly multiple?: boolean | undefined;
      readonly file?: string | undefined;
    }>,
  ): FleetWorkAsked;
  /** A terminal joins a work in a role, saying how it got there. Idempotent:
   *  a terminal already in that work keeps the role it was given first. */
  join(ref: string, work: string, role: WorkRole, joined: FleetWatchJoin): void;
  /** STOP a work — `stopped by the conductor`. */
  stop(work: string): void;
  /** A member leaves; `false` when it was not one. */
  leave(ref: string): boolean;
  /** The Conductor's one line on a work's timeline. */
  note(work: string, text: string): void;
  /** The Conductor just spoke to the agent in this terminal (`agent_say`
   *  landed its keys). The news that terminal is holding is about a state the
   *  Conductor has now acted on, so the server withdraws it and re-baselines;
   *  a ref that is nobody's member is simply ignored. */
  said(ref: string): void;
  /** The Conductor just closed this terminal (`lifecycle_kill` answered). A
   *  death it caused is not news to it, so the member leaves its work in
   *  silence and anything held about it is withdrawn. */
  closed(ref: string): void;
  /** THE PRE-CHECK `lifecycle_create` runs BEFORE anything is created — the
   *  one question a create has to answer first, and the only one it can
   *  answer without a round trip. `null` means the work is there and in
   *  progress. */
  check(work: string): "unknown-work" | "work-ended" | null;
}

/** Why a call about a work was refused, as this face reports it — the kinds
 *  the conductor raises, re-declared nowhere: both ends build from the one
 *  tuple in `kolu-work`'s `refusal.ts`. */
export interface WorkRefusalDetail extends Record<string, unknown> {
  readonly kind: WorkRefusalKind;
  readonly work?: string;
}

/** The conductor's refusal, as the failure an agent reads — its own sentence
 *  kept whole, because it names what to do: which setup key was not asked,
 *  which work has ended. Anything else is a fault and says so.
 *
 *  `instanceof` the class the host actually threw: every refusal kind is a
 *  reading of the record, so the class lives in `kolu-work` — which this face
 *  already depends on — and the duck-typed read that used to stand here
 *  (because the arrow could not point back) is gone. */
const refusalFailure = (err: unknown, work: string): ToolFailure =>
  err instanceof WorkRefusal
    ? new ToolFailure<WorkRefusalDetail>(err.why, { kind: err.kind, work })
    : new ToolFailure(
        `kolu could not answer about ${JSON.stringify(work)}: ${String(err)}`,
        { kind: "work-call-failed", work },
      );

/** WHERE A WORK STANDS, in the words an AGENT reads it in.
 *
 *  The model answers a token and every face spells it: the card writes a lead
 *  and a live check tally, and this writes the half-sentence that follows
 *  "waiting on". One table here rather than a phrase in the model is what
 *  lets the two differ without either rewriting the other's prose. */
export const standingWords = (standing: Standing): string => {
  switch (standing.why) {
    case "question":
      return standing.what;
    case "merge":
      return standing.ref === null
        ? "merge the PR"
        : `merge PR #${standing.ref}`;
    case "ci":
      return "CI running";
    case "watching":
      return "watching";
    case "working":
      return "agents at work";
    default:
      // A finished work: how it ended is the whole answer.
      return standing.why;
  }
};

/** The pre-check, as a sentence. Written HERE rather than passed through the
 *  port because the port answers a question ("is this work there?") and the
 *  prose that goes with the answer is the face's own vocabulary. */
export const workCheckFailure = (
  work: string,
  refused: "unknown-work" | "work-ended",
): ToolFailure =>
  new ToolFailure<WorkRefusalDetail>(
    refused === "unknown-work"
      ? `There is no piece of work called ${JSON.stringify(work)} — read the \`works\` resource for the ones kolu is keeping, and open one with \`work_open\` first. Nothing was created.`
      : `The piece of work ${JSON.stringify(work)} has ended, so nothing more joins it. Open a new one with \`work_open\`. Nothing was created.`,
    { kind: refused, work },
  );

const OptionsSchema = Schema.Array(
  Schema.String.check(Schema.isMinLength(1)),
).check(Schema.isMinLength(1));

const WorkOpenArgsSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      'What this piece of work IS, in a few words a person would recognise on a card — the thing being built, not the procedure ("rename the dock\'s badge", not "waterfall").',
  }),
  // A WORK IS ITS KEY: the branch on a machine, or the terminal being
  // watched. Not a setup question — the machine a work runs on identifies it,
  // and a thing that identifies a work cannot be a question that may go
  // unanswered. Opening the same key twice is the SAME work, carried on with.
  host: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "WHICH MACHINE, as a fleet host ref (`local`, `remote:<target>`) — required unless `watch` is given. If the human's request does not say which machine, ASK THEM IN YOUR REPLY and end your turn; open the work when they answer. Never guess.",
    }),
  ),
  repo: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "The repository's absolute path on that host. Required unless `watch` is given.",
    }),
  ),
  branch: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "The branch (and worktree name) the work is on. Required unless `watch` is given. A work IS its branch: opening this host, repo and branch again returns the piece of work that is already there (reopening it if it had ended) rather than making a second one.",
    }),
  ),
  watch: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "A plain WATCH of one terminal somebody else started, by its `<host>/<id>` ref — instead of host/repo/branch. The work is keyed by that terminal.",
    }),
  ),
  // THE TWO QUESTIONS WHOSE ANSWERS ARE READ BACK AS VOCABULARY, typed as
  // that vocabulary. `modeOf` and `onGreenOf` read a decision only when the
  // answer is one of their words, so a `mode` question offering "the full
  // thing" would be answered, stored, and then read as NOTHING — a work with
  // no mode, and nobody able to say why. The decoder refuses it instead, with
  // the words in the message.
  setup: Schema.Array(
    Schema.Union([
      Schema.Struct({
        key: Schema.Literal("mode"),
        question: Schema.String.check(Schema.isMinLength(1)),
        options: Schema.Array(WorkModeSchema)
          .check(Schema.isMinLength(1))
          .annotate({
            description:
              "The modes to offer, best first. These are kolu's own words — `full`, `trivial`, `watch` — because the work's mode is READ back off the answer.",
          }),
        given: Schema.optionalKey(WorkModeSchema),
      }),
      Schema.Struct({
        key: Schema.Literal("on-green"),
        question: Schema.String.check(Schema.isMinLength(1)),
        options: Schema.Array(OnGreenSchema)
          .check(Schema.isMinLength(1))
          .annotate({
            description:
              "What to do when CI is green, in kolu's own words: `merge` or `hand-over`. The card and the script both read this decision back, so the words are the vocabulary rather than a sentence.",
          }),
        given: Schema.optionalKey(OnGreenSchema),
      }),
      Schema.Struct({
        key: SetupKeySchema.annotate({
          description:
            "Which setup question this is. `host` and `mode` are always required; a mode that could be `full` or `trivial` also requires `implementor.harness`, `implementor.model` and `on-green`, and `full` requires `planner.harness` and `planner.model`.",
        }),
        question: Schema.String.check(Schema.isMinLength(1)).annotate({
          description: "The question, in the words the human will read.",
        }),
        options: OptionsSchema.annotate({
          description:
            "The options to offer, best first (last time's answer first). At least one: a question with no options is a form nobody can press — the human always gets a box to type their own answer beside them.",
        }),
        given: Schema.optionalKey(
          Schema.String.annotate({
            description:
              "The answer the human's REQUEST already carried. Recorded as a decision answered from the request; they are not asked it.",
          }),
        ),
      }),
    ]),
  ).check(Schema.isMinLength(1)),
});
type WorkOpenArgs = typeof WorkOpenArgsSchema.Type;

const WorkAskArgsSchema = Schema.Struct({
  work: Schema.String.annotate({
    description: "The piece of work this question is about, by its id.",
  }),
  questions: Schema.Array(
    Schema.Struct({
      header: Schema.String.check(Schema.isMinLength(1)).annotate({
        description:
          'The question\'s SHORT HEADER — two or three words, which is how this decision is labelled on the work\'s card ("Plan approval", "Failing check"). Not a sentence, and not your reasoning.',
      }),
      question: Schema.String.check(Schema.isMinLength(1)).annotate({
        description:
          "The question itself, in the words the human reads. Ask the question only — your reasoning about it belongs in your prose, not in here.",
      }),
      options: OptionsSchema,
      multiple: Schema.optionalKey(
        Schema.Boolean.annotate({
          description: "Whether more than one option may be picked.",
        }),
      ),
      file: Schema.optionalKey(
        Schema.String.annotate({
          description:
            "The file the human must READ to answer this — the plan, for a plan approval — relative to the work's worktree, exactly as the work's own file events spell it (`.waterfall/plan.md`). Every face that draws the question then offers a button that opens it in the reader. Leave it out for a question about no file.",
        }),
      ),
    }),
  ).check(Schema.isMinLength(1)),
});
type WorkAskArgs = typeof WorkAskArgsSchema.Type;

const WorkAdoptArgsSchema = Schema.Struct({
  id: FleetTerminalRefSchema,
  work: Schema.String.annotate({
    description: "The piece of work this terminal joins, by its id.",
  }),
  role: WorkRoleSchema.annotate({
    description:
      "What it is there to do: `planner`, `implementor`, or `other` for a terminal the human simply asked you to keep an eye on.",
  }),
});
type WorkAdoptArgs = typeof WorkAdoptArgsSchema.Type;

const WorkLeaveArgsSchema = Schema.Struct({ id: FleetTerminalRefSchema });
type WorkLeaveArgs = typeof WorkLeaveArgsSchema.Type;

const WorkStopArgsSchema = Schema.Struct({
  work: Schema.String.annotate({
    description: "The piece of work to end, by its id.",
  }),
});
type WorkStopArgs = typeof WorkStopArgsSchema.Type;

const WorkNoteArgsSchema = Schema.Struct({
  work: Schema.String,
  text: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "The line to put on the work's timeline. Nothing reads a note to decide anything — it is for the person looking at the card later.",
  }),
});
type WorkNoteArgs = typeof WorkNoteArgsSchema.Type;

/** Why adopting a terminal was refused. `not-a-fleet-ref` / `unknown-host` /
 *  `host-not-connected` are `hosts.ts`'s own refusals, re-raised verbatim;
 *  this module adds only the last one. */
export interface AdoptRefusal extends Record<string, unknown> {
  readonly kind: "terminal-not-in-roster";
  readonly id: string;
}

/** The state a terminal was found in when it joined a work — the answer to
 *  "what am I actually adopting", so joining does not have to be followed by a
 *  screen read to learn whether the worker is busy, idle, absent or asleep.
 *
 *  It exists for a second reason too: an adopted terminal BASELINES on its
 *  first observation (it must not ring for a state that was already true when
 *  the Conductor looked), so the state that will NOT wake it is told here,
 *  once, instead of being silently swallowed. */
export type WorkMemberFound =
  | { readonly kind: "asleep"; readonly state: string }
  | { readonly kind: "no-agent" }
  | { readonly kind: "agent"; readonly agent: string; readonly bucket: string };

/** Refuse unless the host's roster actually holds this terminal RIGHT NOW.
 *
 *  The roster, not a record read: a `get` on an unknown key is a declared
 *  per-member error whose shape differs by arm, while "is it in the census" is
 *  the exact question — does this host have a terminal by that name — and it is
 *  one frame. A dormant terminal PASSES: a sleeping worker is a thing a
 *  conductor legitimately adopts (it wakes when the human wakes it), and this
 *  tool writes nothing into the terminal, so there is no live PTY to need.
 *
 *  ONE frame, off ONE member: the census rides the roster's own standing
 *  (`padiSurface` 7.4), so "it is not there" and "that list is not a census
 *  yet" are read from the same value and can never be mixed from two that
 *  arrived apart — which is what reading the `terminals` collection beside the
 *  standing allowed, through any projection that folds them separately
 *  (#2376). */
function requireInRoster(
  hosts: FleetHosts,
  ref: string,
): Effect.Effect<{ id: string; padi: PadiSurfaceClient }, ToolFailure> {
  return Effect.flatMap(requireTerminal(hosts, ref), ({ id, padi }) =>
    Effect.flatMap(
      Effect.mapError(
        rosterStandingOf(padi, id, ref),
        (cause) =>
          new ToolFailure<AdoptRefusal>(
            `could not read the roster of the host behind ${ref}: ${String(cause)}`,
            { kind: "terminal-not-in-roster", id: ref },
          ),
      ),
      (
        standing,
      ): Effect.Effect<{ id: string; padi: PadiSurfaceClient }, ToolFailure> =>
        standing === "held"
          ? Effect.succeed({ id, padi })
          : // ABSENT FROM A LIST THAT MAY NOT BE A CENSUS. A padi that has not
            // finished adopting its terminals has no census to be absent from,
            // so an absence is only an absence once the roster is ESTABLISHED.
            Effect.fail(
              new ToolFailure<AdoptRefusal>(
                standing === "absent"
                  ? `${ref} is not a terminal on that host — nothing by that name is in its roster, so adopting it would mean waiting for news that can never come. Read the terminals resource for the live list.`
                  : stillSettling(ref),
                { kind: "terminal-not-in-roster", id: ref },
              ),
            ),
    ),
  );
}

/** The record, read as the one sentence the answer carries. The SAME reading
 *  `agent_say` makes (padi's own `activeAgent` narrowing plus the shared
 *  bucket fold), so "what state is it in" has one answer across this face. */
function foundState(
  ref: string,
  id: string,
  padi: PadiSurfaceClient,
): Effect.Effect<WorkMemberFound, ToolFailure> {
  return Effect.map(
    Effect.mapError(
      firstFrameOrThrow(
        padi.surface.terminals.get({ key: id }),
        `${ref} is in the roster but answered no record, so what is running in it is unknown.`,
      ),
      (cause) =>
        new ToolFailure<AdoptRefusal>(
          `could not read ${ref}'s record: ${String(cause)}`,
          { kind: "terminal-not-in-roster", id: ref },
        ),
    ),
    (frame): WorkMemberFound => {
      const record = frame as PadiTerminal;
      if (record.state !== "active") {
        return { kind: "asleep", state: record.state };
      }
      const agent = activeAgent(record);
      return agent === null
        ? { kind: "no-agent" }
        : {
            kind: "agent",
            agent: agent.kind,
            bucket: agentBucket(agent.state),
          };
    },
  );
}

/** The sentence every asking tool ends its answer with. ONE place, because
 *  the two tools say the same thing and the thing they say is the whole rule:
 *  the question is put, you are not waiting for it, and the answer comes back
 *  as a turn kolu starts. */
const ASKED_SAID =
  "Asked. The question is in front of the human now and NOTHING is waiting on them: say what you asked, END YOUR TURN, and kolu will wake you with their answer — who answered, from where, and what they said. Never poll the `works` resource for it, and never ask the same question again because no answer came back: it is already on the card, and asking twice puts two forms in front of them.";

/** THE KEY `work_open` NAMES — a branch on a machine, or the terminal to
 *  watch. Refused here rather than halfway in: a work with no machine is a
 *  work with no identity, and the Conductor is owed the sentence that says to
 *  ask the human which one. */
const workKeyOfArgs = (args: WorkOpenArgs): WorkKey => {
  if (args.watch !== undefined) return { kind: "watch", terminal: args.watch };
  if (
    args.host === undefined ||
    args.repo === undefined ||
    args.branch === undefined
  ) {
    throw new WorkRefusal(
      "missing-setup",
      `«${args.title}» cannot be opened: a piece of work IS a branch on a machine, so \`work_open\` needs \`host\` (a fleet host ref), \`repo\` and \`branch\` — or \`watch\` for a plain watch of one terminal. If the human's request does not say which machine, ask them in your reply and END YOUR TURN; open the work when they answer. Nothing was created.`,
    );
  }
  return {
    kind: "branch",
    host: args.host,
    repo: args.repo,
    branch: args.branch,
  };
};

/** `work_open` — state a piece of work, and ask its setup in one form. */
export function workOpenTool(works: FleetWorks): BespokeTool {
  return {
    input: WorkOpenArgsSchema,
    mutates: true,
    title: "Open a piece of work",
    description:
      "Open a piece of work and ask the human its setup — in ONE form, the whole of it: which host, which mode, which harness and model per role, and what to do when CI is green. kolu puts the questions to the human, records every one as a DECISION on this work, and ANSWERS YOU AT ONCE: nothing in kolu's tools ever waits for a person. The answer carries the work's id, the setup as kolu reads it back RIGHT NOW (`host`, `mode`, `roles` — harness and model each — `onGreen`; each one `null` while its question is still open), and `asked: true` when a form went to them. Use `given` for anything the human's request already said — it is recorded as their answer without asking, and reads back immediately. Refused, with nothing created, when the setup does not carry a question the mode needs. When `asked` is true, say what you asked and END YOUR TURN: kolu wakes you with every answer, and a setup they decline ends the work as abandoned and tells you the same way. Everything after this names the work it answers with: `lifecycle_create`, `work_adopt`, `work_ask`, `work_note`.",
    handler: (args, _bundle, _signal) => {
      const intent = args as WorkOpenArgs;
      return Effect.try({
        try: () => {
          const opened = works.open({
            key: workKeyOfArgs(intent),
            title: intent.title,
            setup: intent.setup,
          });
          return opened.asked ? { ...opened, said: ASKED_SAID } : opened;
        },
        catch: (err: unknown) => refusalFailure(err, intent.title),
      });
    },
  };
}

/** `work_ask` — a question about a work, kept with the work. */
export function workAskTool(works: FleetWorks): BespokeTool {
  return {
    input: WorkAskArgsSchema,
    mutates: true,
    title: "Ask the human about a piece of work",
    description:
      "Ask the human one or more questions ABOUT a piece of work — approving a plan, a tradeoff nobody told you how to make, what to do about a failing check. They see one form; each question is stored as a DECISION on that work and shows on its card, so it survives this conversation and a restart. THIS CALL ANSWERS AT ONCE, with the ask's id: the question does not hold your turn open, and you must not wait for it — say what you asked and end the turn. kolu wakes you when they answer, saying who answered, from where (the card, the chat, the reader) and what; a question they decline, or one whose work ends under it, reaches you the same way. They may answer from the card, the chat or the reader a file is open in — any of them settles the one question. Every question needs a `header` of two or three words — the card draws the decision as `header — answer`, one line — and options (the human also gets a box to type their own answer). Give `file` when the question is about something they must READ before answering — the plan, for a plan approval — and every face offers them a button that opens it. Keep your reasoning about the choice in your PROSE, never in the question text: a question that argues its own answer is drawn back to the human as a wall of words. A question about NO work is your own question tool's, not this: it belongs to the conversation alone.",
    handler: (args, _bundle, _signal) => {
      const { work, questions } = args as WorkAskArgs;
      return Effect.try({
        try: () => ({ ...works.ask(work, questions), said: ASKED_SAID }),
        catch: (err: unknown) => refusalFailure(err, work),
      });
    },
  };
}

/** `work_adopt` — a terminal that already exists joins a work, in a role. */
export function workAdoptTool(
  hosts: FleetHosts,
  works: FleetWorks,
): BespokeTool {
  return {
    input: WorkAdoptArgsSchema,
    mutates: true,
    title: "Adopt a terminal into a piece of work",
    description:
      "Bring a terminal that already exists into a piece of work, saying what it is there to do. From then on kolu wakes you when its agent stops, asks you something, or the terminal dies — so you end your turn instead of waiting on it. A terminal YOU create with `lifecycle_create` is a member already (it takes the same `work` and `role`); this is for one the human points you at. Refused if nothing by that name is there, or if the work is unknown or has ended. Answers the work's members AND the state the terminal was found in (`found`: the agent and its bucket, or `no-agent` / `asleep`) — that state is the BASELINE, so it will not be reported to you as news; anything after it will.",
    handler: (args, _bundle, _signal) => {
      const { id, work, role } = args as WorkAdoptArgs;
      const refused = works.check(work);
      if (refused !== null) return Effect.fail(workCheckFailure(work, refused));
      return Effect.flatMap(requireInRoster(hosts, id), (terminal) =>
        Effect.flatMap(
          foundState(id, terminal.id, terminal.padi),
          (found): Effect.Effect<unknown, ToolFailure> => {
            // The member is recorded AFTER the state is read, so the answer and
            // the record describe the same moment: a terminal joined first and
            // read second could ring for a change that happened in between
            // while this answer still called it idle.
            try {
              works.join(id, work, role, "asked");
            } catch (err: unknown) {
              return Effect.fail(refusalFailure(err, work));
            }
            const joined = works.rows().works.find((one) => one.id === work);
            return Effect.succeed({
              work,
              role,
              members: joined?.members.map((one) => one.ref) ?? [id],
              found,
            });
          },
        ),
      );
    },
  };
}

/** `work_leave` — a member's part is done. */
export function workLeaveTool(works: FleetWorks): BespokeTool {
  return {
    input: WorkLeaveArgsSchema,
    mutates: true,
    title: "Take a terminal out of its piece of work",
    description:
      "A member's part is done, or the human asked you to drop it: this terminal stops being part of its work and stops waking you. Answers which work it left and whether it was a member at all (`left: false` simply means it was not, which is not an error: a terminal that died has already left by itself). Closing a terminal yourself needs no call here — one you close with `lifecycle_kill` leaves in silence.",
    // No roster check, deliberately: the common reason to let a member go is
    // that it is finished or gone, and refusing to forget a terminal because
    // it no longer exists would leave a work unable to shed exactly the
    // members that should go.
    handler: (args, _bundle, _signal) =>
      Effect.sync(() => {
        const { id } = args as WorkLeaveArgs;
        const was = works
          .rows()
          .works.find((one) => one.members.some((two) => two.ref === id));
        return { left: works.leave(id), work: was?.id ?? null };
      }),
  };
}

/** `work_stop` — the one ending the Conductor can write. */
export function workStopTool(works: FleetWorks): BespokeTool {
  return {
    input: WorkStopArgsSchema,
    mutates: true,
    title: "Stop a piece of work",
    description:
      "END a piece of work: it is really over, or the human said to drop it. Its terminals stop being members and its open questions are dropped; its decisions and its whole timeline stay, and the card offers Reopen. This and the forge merging or closing its pull request are the ONLY ways a work ends — a work whose terminals have all gone has NOT ended, and `work_open` on the same host, repo and branch carries it on rather than starting a second one.",
    handler: (args, _bundle, _signal) => {
      const { work } = args as WorkStopArgs;
      return Effect.try({
        try: () => {
          works.stop(work);
          return { work, stopped: true };
        },
        catch: (err: unknown) => refusalFailure(err, work),
      });
    },
  };
}

/** `work_note` — the one line the Conductor writes on a timeline. */
export function workNoteTool(works: FleetWorks): BespokeTool {
  return {
    input: WorkNoteArgsSchema,
    mutates: true,
    title: "Put a note on a piece of work",
    description:
      "Write one line on a work's timeline — something you decided, something you noticed, something the human should see later. It is the ONLY thing about a work you write that kolu did not observe for itself, and nothing reads it to decide anything: it is for the person reading the card.",
    handler: (args, _bundle, _signal) => {
      const { work, text } = args as WorkNoteArgs;
      return Effect.try({
        try: () => {
          works.note(work, text);
          return { work, noted: true };
        },
        catch: (err: unknown) => refusalFailure(err, work),
      });
    },
  };
}

/** The host's reading of one member, as the `works` resource carries it — the
 *  port's row plus whether this fleet can still reach the machine it is on.
 *
 *  The two halves come from different owners and that is the whole of this
 *  function: the MEMBER is kolu-server's (it is stored with the work), and
 *  whether its host is still here is the POOL's, read at the instant of the
 *  read like every other member. A ref whose host has left keeps its row with
 *  two nulls rather than being dropped — "I am running something I can no
 *  longer reach" is the answer, and dropping it would read as a work that
 *  never had it. */
export const memberWithHost = (
  hosts: FleetHosts,
  fleet: ReadonlySet<string>,
  member: FleetWorkMemberRow,
  split: (ref: string) => { host: string } | null,
): FleetWorkMemberRow & {
  readonly hostName: string | null;
  readonly hostState: FleetHostState | null;
} => {
  const at = split(member.ref);
  const host = at !== null && fleet.has(at.host) ? at.host : null;
  return {
    ...member,
    hostName: host === null ? null : hosts.display(host),
    hostState: host === null ? null : hosts.state(host),
  };
};
