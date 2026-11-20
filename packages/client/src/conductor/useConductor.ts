import type {
  AskAnswer,
  ConductorAnswerWorkOutcome,
  ConductorAttachment,
  ConductorMention,
  ConductorState,
  ConductorStoreKey,
} from "kolu-common/conductor";
import type { AnsweredFromFace, SentAnswer, WorkId } from "kolu-work";
import { Effect } from "effect";
import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runAction } from "../runAction";
import { app } from "../wire";
import { pinTranscript } from "./transcriptScroll";
import { useConductorFacts } from "./useConductorFacts";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Conductor {
  readonly state: Accessor<ConductorState>;
  prompt(
    text: string,
    mentions: readonly ConductorMention[],
    attachments: readonly ConductorAttachment[],
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
  answerWork(
    work: WorkId,
    ask: string,
    answers: Readonly<Record<string, SentAnswer>> | null,
    from: AnsweredFromFace,
    recorded?: (outcome: ConductorAnswerWorkOutcome) => void,
  ): void;
  stopWork(work: WorkId): void;
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
  newSession(): void;
  clearSession(): void;
  takeOver(terminal: string): void;
  handBack(terminal: string): void;
  recoverStore(key: ConductorStoreKey, how: "backup" | "empty"): void;
}

export const useConductor = createSharedRoot<Conductor>(() => {
  const state = useConductorFacts();

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
                  Object.entries(answers).map(([decision, sent]) => [
                    decision,
                    "typed" in sent ? { typed: sent.typed } : [...sent],
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
          if (result.outcome === "failed") {
            toast.error("Sign-in did not complete");
            return;
          }
          if (result.outcome !== "signed-in") return;
          if (result.restart.kind === "did-not-restart") {
            toast.warning(
              `Signed in, but the agent did not restart: ${result.restart.why}`,
              { duration: 10_000 },
            );
            return;
          }
          toast.success("Signed in — the agent restarted");
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
      pinTranscript();
      ask(
        "Could not start a new session",
        app.procedures.conductor.newSession({}),
      );
    },
    clearSession: () => {
      pinTranscript();
      ask(
        "Could not start a new session",
        app.procedures.conductor.clearSession({}),
      );
    },
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
