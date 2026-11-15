/** The conversation: what it is doing, and the eight things a person can ask
 *  of it.
 *
 *  ONE conversation, hosted by kolu-server, whose hands reach every host — so
 *  every verb here is a kolu-surface procedure, never the active host's padi.
 *
 *  The cell is read through the shared mirror (`useConductorFacts`) rather
 *  than opened again here — the badge already reads it, and a second
 *  subscription to the same member is a second frame to disagree with.
 *
 *  Every verb is a REQUEST of a conversation, which is why the cell beside them
 *  is read-only, and why the refusals are not all alike.
 *  `ConductorUnavailable` is the adapter not being there at all; that one is
 *  a toast, because nothing on screen otherwise explains why the press did
 *  nothing.
 *
 *  `ConductorRefused` is a no — and WHICH no decides where it lands. The
 *  agent's no to a turn is not this call's failure at all: `prompt` answers
 *  with its row id and the turn runs behind it, so an agent that refuses marks
 *  that row `delivery: "refused"` with *send again* beside it and nothing here
 *  ever sees an error. Every refusal that DOES come back through `prompt` was
 *  raised before any row existed — an attachment this agent cannot be sent, a
 *  message over the cap — so it has no row to land on and a toast is its only
 *  face. That is why `prompt` no longer swallows the tag: a swallowed refusal
 *  with no row is a message that vanished. */

import type {
  AskAnswer,
  ConductorAnswerWorkOutcome,
  ConductorAttachment,
  ConductorMention,
  ConductorState,
  ConductorStoreKey,
} from "kolu-common/conductor";
import type { AnsweredFromFace, WorkId } from "kolu-work";
import { Effect } from "effect";
import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runAction } from "../runAction";
import { app } from "../wire";
import { pinTranscript } from "./transcriptScroll";
import { useConductorFacts } from "./useConductorFacts";

/** Render a failure for a toast, keeping the server's own sentence — a declared
 *  refusal carries its `why` as its `message`, so this never flattens it to a
 *  generic line. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Conductor {
  readonly state: Accessor<ConductorState>;
  /** `attachments` name bytes kolu-server ALREADY HOLDS — each one was uploaded when
   *  it was attached and carries the path it was written to, so this frame is
   *  the size of its words however many screenshots rode with it.
   *
   *  `settled` is told whether the message was ACCEPTED. The composer keeps
   *  the words and the chips until it hears `true`, because a refusal raised
   *  before the row exists leaves nothing on screen to hold them — the *send
   *  again* button has no such second chance to offer, so it passes none. */
  prompt(
    text: string,
    mentions: readonly ConductorMention[],
    attachments: readonly ConductorAttachment[],
    /** STEER rather than queue — Alt+Enter, and only where the cell offers it
     *  (`steer.ts` holds the rule). kolu-server puts the words into the turn
     *  that is running; a steer the agent did not take goes out as a plain
     *  prompt, so passing `true` can never lose a message. */
    steer: boolean,
    settled?: (accepted: boolean) => void,
  ): void;
  cancel(): void;
  /** ANSWER THE AGENT'S OWN QUESTION — an elicitation it is holding a call
   *  open for. `answers === null` DECLINES it.
   *
   *  kolu's own questions about a piece of work are NOT these: they are
   *  decisions on the work, answered through {@link Conductor.answerWork}. */
  answer(askId: string, answers: readonly AskAnswer[] | null): void;
  /** ANSWER ONE OF KOLU'S OWN QUESTIONS ABOUT A PIECE OF WORK, keyed by the
   *  DECISION each answer belongs to. `answers === null` declines the whole
   *  ask.
   *
   *  `from` is WHICH FACE answered — the work's card, the chat, the reader a
   *  file is open in, or that reader in a window of its own. All four draw
   *  the one decision and any of them settles it; the record keeps which one
   *  the person was looking at.
   *
   *  Nothing is waiting on this: the Conductor was told its question had been
   *  put and ended its turn, so this writes the decision and kolu WAKES it
   *  with what was said. That is also why it works while the conversation is
   *  down — the only failure it can raise is the work's own refusal.
   *
   *  `recorded` is told WHAT THE RECORD TOOK: the whole ask, a decline, or
   *  only part of it — and `part` names the questions still asked. A form
   *  that sent some of its questions blank keeps THEIR drafts and forgets
   *  only what was written down, so nothing a person typed is lost to a
   *  value the record would not take. */
  answerWork(
    work: WorkId,
    ask: string,
    answers: Readonly<Record<string, readonly string[]>> | null,
    from: AnsweredFromFace,
    recorded?: (outcome: ConductorAnswerWorkOutcome) => void,
  ): void;
  /** END A PIECE OF WORK ON PURPOSE — the card's **Stop**, behind its
   *  confirm. One of only two ways a work ends that is not the forge saying
   *  merged or closed (the Conductor's own `work_stop` is the other): kolu
   *  failing to SEE a terminal is not one of them. The record stays, its
   *  members are released in the same step, and the card then offers
   *  {@link Conductor.reopenWork}. */
  stopWork(work: WorkId): void;
  /** ... AND BACK. An ended work opens again with its decisions and its
   *  timeline intact — the same thing `work_open` on its key does, which is
   *  why this never asks anything a second time. */
  reopenWork(work: WorkId): void;
  signIn(method: string): void;
  /** Ask for the sign-in row — signed in or not. */
  askSignIn(): void;
  /** Restart the agent into the same conversation, to pick up a signature
   *  that changed outside it. */
  reloadAgent(): void;
  signInInput(text: string): void;
  signInCancel(): void;
  setOption(id: string, value: string): void;
  /** A fresh conversation OVER the transcript — the rows stay, with the
   *  divider the harness mints between them. The one caller is *try again*
   *  under a refused bring-up. */
  newSession(): void;
  /** A fresh conversation AND AN EMPTY ONE: the rows, the record, the files
   *  and the remembered fleet all go, host-side. The header menu's confirmed
   *  `New session` is the one caller. Two verbs rather than a flag, because
   *  what a person LOSES is the whole of the difference. */
  clearSession(): void;
  /** TAKE A DRIVEN TERMINAL off the Conductor — `terminal` is its
   *  `<host>/<id>` ref. The lock is a fact about the WORK (an event on its
   *  timeline), which is why this is a request of the record rather than a
   *  local flag: a reload, a second browser and the agent itself all read the
   *  same answer, and the conversation is woken to stop typing into it.
   *
   *  These two declare `ConductorRefused` ALONE on the wire: an agent that is
   *  down or signed out must not stand between a person and the keyboard of a
   *  terminal in front of them. */
  takeOver(terminal: string): void;
  /** ... and give it back: the Conductor drives it again, and is woken to
   *  say so. */
  handBack(terminal: string): void;
  /** PUT A RECORD KOLU COULD NOT READ BACK IN A STATE IT CAN — the two
   *  buttons under an unreadable-record refusal, which is the one screen
   *  where the Conductor is down for a reason the AGENT has nothing to do
   *  with. `how: "backup"` takes the newest state backup that reads;
   *  `how: "empty"` keeps the unreadable value aside and starts that record
   *  empty. The server's answer says what it did, which is why this one is
   *  reported on success as well as on failure: a recovery nobody can see
   *  the result of is indistinguishable from a button that did nothing. */
  recoverStore(key: ConductorStoreKey, how: "backup" | "empty"): void;
}

export const useConductor = createSharedRoot<Conductor>(() => {
  // The mirror IS the state here — reading it through the shared root is what
  // guarantees the cell is subscribed even on a screen that draws no badge.
  const state = useConductorFacts();

  /** The common edge: run a verb and report whatever went wrong with it. These
   *  verbs have no row to carry a refusal, so the toast is the whole report;
   *  `label` names the ask, so it says which one failed. */
  const ask = <A>(
    label: string,
    effect: Effect.Effect<A, unknown>,
    onDone?: (value: A) => void,
  ): void => {
    runAction(
      label,
      effect.pipe(
        Effect.tap((value: A) =>
          Effect.sync(() => {
            onDone?.(value);
          }),
        ),
        Effect.catch((err: unknown) =>
          Effect.sync(() => {
            toast.error(`${label}: ${reason(err)}`);
          }),
        ),
      ),
    );
  };

  return {
    state,
    prompt: (text, mentions, attachments, steer, settled) =>
      runAction(
        "conductor prompt",
        app.procedures.conductor
          .prompt({
            text,
            mentions: [...mentions],
            attachments: [...attachments],
            steer,
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                settled?.(true);
              }),
            ),
            // EVERY failure this call can see happened before a row existed —
            // the module header has the argument — so the toast is the only
            // report there is, and the composer is told to keep what it has.
            Effect.catch((err: unknown) =>
              Effect.sync(() => {
                toast.error(`Could not send: ${reason(err)}`);
                settled?.(false);
              }),
            ),
          ),
      ),
    cancel: () =>
      ask("Could not stop the turn", app.procedures.conductor.cancel({})),
    answer: (askId, answers) =>
      ask(
        "Could not answer",
        app.procedures.conductor.answer({
          askId,
          answers: answers === null ? null : [...answers],
        }),
        (result) => {
          // A two-tab world: somebody else got there first. A reported state,
          // not a fault — the row is already settled on screen.
          if (!result.settled) toast.info("That question was already answered");
        },
      ),
    answerWork: (work, askId, answers, from, recorded) =>
      ask(
        "Could not answer",
        app.procedures.conductor.answerWork({
          work,
          ask: askId,
          answers:
            answers === null
              ? null
              : Object.fromEntries(
                  Object.entries(answers).map(([decision, values]) => [
                    decision,
                    [...values],
                  ]),
                ),
          from,
        }),
        (result) => {
          recorded?.(result.outcome);
          switch (result.outcome.kind) {
            case "answered":
            case "declined":
            case "part":
              return;
            // Two faces of one question — a card and a popped-out reader, say
            // — and the second one to press is told so rather than failing.
            case "nothing-open":
              toast.info("That question was already answered");
              return;
            default:
              return result.outcome satisfies never;
          }
        },
      ),
    signIn: (method) =>
      ask(
        "Sign-in failed",
        app.procedures.conductor.signIn({ method }),
        (result) => {
          if (result.outcome === "signed-in") toast.success("Signed in");
          if (result.outcome === "failed")
            toast.error("Sign-in did not complete");
        },
      ),
    signInInput: (text) =>
      ask(
        "Could not send that",
        app.procedures.conductor.signInInput({ text }),
      ),
    signInCancel: () =>
      ask(
        "Could not cancel sign-in",
        app.procedures.conductor.signInCancel({}),
      ),
    askSignIn: () =>
      ask("Could not open sign-in", app.procedures.conductor.askSignIn({})),
    reloadAgent: () =>
      ask(
        "Could not restart the agent",
        app.procedures.conductor.reloadAgent({}),
        () =>
          toast.success("Restarted — the next message uses the new sign-in"),
      ),
    setOption: (id, value) =>
      ask(
        "The agent kept its setting",
        app.procedures.conductor.setOption({ id, value }),
      ),
    // STOP and REOPEN — requests of the RECORD, like the two hand-over verbs
    // beside them: a person must be able to put a piece of work down (and
    // pick it back up) while the conversation is down. The card has already
    // asked before Stop gets here; the refusal, if any, is the work's own
    // sentence.
    stopWork: (work) =>
      ask(
        "Could not stop the work",
        app.procedures.conductor.stopWork({ work }),
      ),
    reopenWork: (work) =>
      ask(
        "Could not open it again",
        app.procedures.conductor.reopenWork({ work }),
      ),
    newSession: () => {
      // The transcript this offset described is about to be replaced
      // wholesale; a pixel from the old conversation would land the new one
      // mid-air (or, clamped against two rows, back at the top).
      pinTranscript();
      ask(
        "Could not start a new session",
        app.procedures.conductor.newSession({}),
      );
    },
    clearSession: () => {
      // Same reason, harder: there will be NO rows to clamp a remembered
      // offset against.
      pinTranscript();
      ask(
        "Could not start a new session",
        app.procedures.conductor.clearSession({}),
      );
    },
    // The label IS the report: a refusal here is the work's own sentence
    // ("that terminal is not driven by a piece of work"), and the banner it
    // was pressed from is still on screen saying who drives it.
    takeOver: (terminal) =>
      ask(
        "Could not take it over",
        app.procedures.conductor.takeOver({ terminal }),
      ),
    handBack: (terminal) =>
      ask(
        "Could not hand it back",
        app.procedures.conductor.handBack({ terminal }),
      ),
    // THE ONE VERB WHOSE SUCCESS IS ALSO A REPORT. The others move something
    // on screen — a row, a lock, a session — and the screen is the answer.
    // This one's whole result is a sentence: which snapshot kolu took, or
    // where it kept the value it could not read. The panel under it is about
    // to be replaced by a conversation coming up, so the toast is where that
    // sentence can live long enough to be read.
    recoverStore: (key, how) => {
      pinTranscript();
      ask(
        "Could not recover",
        app.procedures.conductor.recoverStore({ key, how }),
        (result) => {
          toast.success(result.said);
        },
      );
    },
  };
});
