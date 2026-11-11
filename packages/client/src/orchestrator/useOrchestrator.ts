/** The ACTIVE host's conversation: what it is doing, and the eight things a
 *  person can ask of it.
 *
 *  The cell is read through the pool-wide mirror (`useOrchestratorFacts`) rather
 *  than opened again here — the badge already needs every host, and a second
 *  subscription to the same member is a second frame to disagree with.
 *
 *  Every verb is a REQUEST of a conversation, which is why the cell beside them
 *  is read-only, and why the refusals are not all alike.
 *  `OrchestratorUnavailable` is the adapter not being there at all; that one is
 *  a toast, because nothing on screen otherwise explains why the press did
 *  nothing.
 *
 *  `OrchestratorRefused` is a no — and WHICH no decides where it lands. The
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
  OrchestratorAttachment,
  OrchestratorMention,
  OrchestratorState,
} from "@kolu/padi-client/orchestrator";
import { Effect } from "effect";
import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runAction } from "../runAction";
import { activePadiRpc, encActiveHost } from "../wire";
import {
  orchestratorStateOf,
  useOrchestratorFacts,
} from "./useOrchestratorFacts";

/** Render a failure for a toast, keeping the server's own sentence — a declared
 *  refusal carries its `why` as its `message`, so this never flattens it to a
 *  generic line. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Orchestrator {
  readonly state: Accessor<OrchestratorState>;
  /** `attachments` name bytes padi ALREADY HOLDS — each one was uploaded when
   *  it was attached and carries the path it was written to, so this frame is
   *  the size of its words however many screenshots rode with it.
   *
   *  `settled` is told whether the message was ACCEPTED. The composer keeps
   *  the words and the chips until it hears `true`, because a refusal raised
   *  before the row exists leaves nothing on screen to hold them — the *send
   *  again* button has no such second chance to offer, so it passes none. */
  prompt(
    text: string,
    mentions: readonly OrchestratorMention[],
    attachments: readonly OrchestratorAttachment[],
    settled?: (accepted: boolean) => void,
  ): void;
  cancel(): void;
  /** `answers === null` DECLINES — the agent is told you would not say. */
  answer(askId: string, answers: readonly AskAnswer[] | null): void;
  signIn(method: string): void;
  signInInput(text: string): void;
  signInCancel(): void;
  setOption(id: string, value: string): void;
  newSession(): void;
}

export const useOrchestrator = createSharedRoot<Orchestrator>(() => {
  // Instantiating the mirror here is what guarantees the active host's cell is
  // subscribed even on a screen that draws no badge.
  useOrchestratorFacts();
  const state = createMemo(() => orchestratorStateOf(encActiveHost()));

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
    prompt: (text, mentions, attachments, settled) =>
      runAction(
        "orchestrator prompt",
        activePadiRpc.orchestrator
          .prompt({
            text,
            mentions: [...mentions],
            attachments: [...attachments],
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
      ask("Could not stop the turn", activePadiRpc.orchestrator.cancel({})),
    answer: (askId, answers) =>
      ask(
        "Could not answer",
        activePadiRpc.orchestrator.answer({
          askId,
          answers: answers === null ? null : [...answers],
        }),
        (result) => {
          // A two-tab world: somebody else got there first. A reported state,
          // not a fault — the row is already settled on screen.
          if (!result.settled) toast.info("That question was already answered");
        },
      ),
    signIn: (method) =>
      ask(
        "Sign-in failed",
        activePadiRpc.orchestrator.signIn({ method }),
        (result) => {
          if (result.outcome === "signed-in") toast.success("Signed in");
          if (result.outcome === "failed")
            toast.error("Sign-in did not complete");
        },
      ),
    signInInput: (text) =>
      ask(
        "Could not send that",
        activePadiRpc.orchestrator.signInInput({ text }),
      ),
    signInCancel: () =>
      ask(
        "Could not cancel sign-in",
        activePadiRpc.orchestrator.signInCancel({}),
      ),
    setOption: (id, value) =>
      ask(
        "The agent kept its setting",
        activePadiRpc.orchestrator.setOption({ id, value }),
      ),
    newSession: () =>
      ask(
        "Could not start a new session",
        activePadiRpc.orchestrator.newSession({}),
      ),
  };
});
