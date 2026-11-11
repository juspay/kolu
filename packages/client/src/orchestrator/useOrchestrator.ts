/** The ACTIVE host's conversation: what it is doing, and the eight things a
 *  person can ask of it.
 *
 *  The cell is read through the pool-wide mirror (`useOrchestratorFacts`) rather
 *  than opened again here — the badge already needs every host, and a second
 *  subscription to the same member is a second frame to disagree with.
 *
 *  Every verb is a REQUEST of a conversation, which is why the cell beside them
 *  is read-only, and why the refusals are not all alike. `OrchestratorRefused`
 *  is the agent saying no to this one thing; the conversation is still there and
 *  the transcript row says so in the agent's own words, so the prompt path
 *  deliberately does NOT toast it — the row is the report, and a toast beside it
 *  is the same sentence twice. `OrchestratorUnavailable` is the adapter not
 *  being there at all; that one is a toast, because nothing on screen otherwise
 *  explains why the press did nothing. */

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
  /** `attachments` carry their own `dataUrl` on the way up — the bytes padi
   *  writes under its state root and then references by path. */
  prompt(
    text: string,
    mentions: readonly OrchestratorMention[],
    attachments: readonly OrchestratorAttachment[],
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

  /** The common edge: run a verb, and report anything that is not the agent's
   *  own refusal. `label` names the ask, so the toast says which one failed. */
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
    prompt: (text, mentions, attachments) =>
      runAction(
        "orchestrator prompt",
        activePadiRpc.orchestrator
          .prompt({
            text,
            mentions: [...mentions],
            attachments: [...attachments],
          })
          .pipe(
            // The agent's no lands on the user row as `delivery: "refused"`,
            // with *send again* where a retry is honest. Toasting it too would
            // report one refusal in two places.
            Effect.catchTag("OrchestratorRefused", () => Effect.void),
            Effect.catch((err: unknown) =>
              Effect.sync(() => {
                toast.error(`Could not send: ${reason(err)}`);
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
