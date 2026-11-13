/**
 * THE CONDUCTOR'S MEMBERS OF `koluSurface`, as a fragment kolu-server splices
 * into its own implementation.
 *
 * The cell, the transcript stream and the eleven procedures are what a browser
 * subscribes to, and what they DO is this package's — "`conductor.prompt`
 * sends a message to the conversation" is a sentence about the conversation,
 * not about the web server that happens to carry it. kolu-server spreads what
 * this returns into `implementKoluSurface` beside its own members; the shape
 * is the surface's, so nothing here invents a second one.
 *
 * It takes the live host as a THUNK rather than the host itself. The
 * conversation is built on its first reader (an ACP child nobody has looked at
 * is a subprocess nobody asked for), and the cell's serve-time seed is itself
 * one of those readers — so a fragment holding a host would force the child up
 * at boot, which is the one thing the laziness is for.
 */

import { Effect } from "effect";
import {
  type ConductorRefused,
  type ConductorUnavailable,
  isConductorDeclaredError,
} from "kolu-common/conductorErrors";
import type { Logger } from "pino";
import type { ConductorHost } from "./conductor.ts";
import { conductorTranscriptSource } from "./transcriptStream.ts";

/** THE HANDLER BRIDGE — the one place the "declared vs defect" line is drawn
 *  for every `conductor` procedure, rather than once per member.
 *
 *  A value the host raises on purpose (`ConductorUnavailable`,
 *  `ConductorRefused`) is a caller's to branch on, so it rides the Effect
 *  FAILURE channel. Anything else — a state file nobody can read, a bug in the
 *  bookkeeping — is a DEFECT and dies loudly: a conductor that broke in a way
 *  nobody declared should crash, not arrive as a polite sentence in a chat.
 *  The same shape, and the same argument, as padi's `handle`. */
function ask<A, E = ConductorRefused | ConductorUnavailable>(
  body: () => A | Promise<A>,
): Effect.Effect<A, E> {
  return Effect.catch(
    Effect.tryPromise({
      try: async () => body(),
      catch: (err: unknown) => err,
    }),
    (err) =>
      isConductorDeclaredError(err)
        ? Effect.fail(err as E)
        : (Effect.die(err) as Effect.Effect<A, E>),
  );
}

/** The cell seed, the stream source and the procedure namespace, for a caller
 *  that is building `koluSurface`'s implementation. */
export function conductorSurfaceMembers(deps: {
  /** The live conversation, read per call — see the module doc. */
  readonly host: () => ConductorHost;
  readonly log: Logger;
}) {
  const host = deps.host;
  return {
    /** The SEED the served cell opens with: the live value, which before the
     *  agent is up says `offline` with the remembered session and fleet — the
     *  truth, and the thing a reader arriving first must see. */
    state: () => host().state(),
    /** Explicit snapshot-then-deltas. The snapshot is queued synchronously
     *  inside the subscribe, so a reader's first frame can never race a delta,
     *  and a re-subscribe after a dropped socket re-leads with a fresh one the
     *  reducer assigns over. */
    transcript: () => conductorTranscriptSource(host(), deps.log),
    procedures: {
      prompt: ({
        input,
      }: {
        input: {
          text: string;
          mentions: Parameters<ConductorHost["prompt"]>[1];
          attachments: Parameters<ConductorHost["prompt"]>[2];
          steer: boolean;
        };
      }) =>
        ask(() =>
          host().prompt(
            input.text,
            input.mentions,
            input.attachments,
            input.steer,
          ),
        ),
      /** TAKE ONE TERMINAL OFF THE LIST kolu wakes this conversation about —
       *  the watched panel's remove control.
       *
       *  NO BRING-UP, which is why it does not go through the same door as a
       *  prompt: the list is this server's bookkeeping, and a person tidying
       *  it up in a panel they are about to close must not have started a
       *  Claude for it. The host answers whether the entry was there; the wire
       *  member declares no output, because what a reader needs is the cell it
       *  is already watching. */
      unwatch: ({ input }: { input: { ref: string } }) =>
        ask<void, ConductorUnavailable>(() => {
          host().unwatchTerminal(input.ref);
        }),
      /** The chunked upload a prompt's attachments arrive on, ahead of the
       *  prompt that names them — the whole reason no base64 rides a `prompt`
       *  frame. Straight through: the host validates the id, the continuation
       *  path and the per-attachment cap, and says no in the same two declared
       *  errors every other verb here does. */
      attach: ({ input }: { input: Parameters<ConductorHost["attach"]>[0] }) =>
        ask(() => host().attach(input)),
      cancel: () => ask(() => host().cancel()),
      answer: ({
        input,
      }: {
        input: {
          askId: string;
          answers: Parameters<ConductorHost["answer"]>[1];
        };
      }) =>
        ask(async () => ({
          settled: await host().answer(input.askId, input.answers),
        })),
      signIn: ({ input }: { input: { method: string } }) =>
        ask(async () => ({ outcome: await host().signIn(input.method) })),
      signInInput: ({ input }: { input: { text: string } }) =>
        ask(() => host().signInInput(input.text)),
      // The host answers whether there WAS an attempt to cancel; the wire
      // member declares no output, so the answer is dropped here rather than
      // widened on the contract — a caller learns the outcome from the state
      // it is already watching. Declared `ConductorUnavailable` alone, which
      // is what the member says.
      signInCancel: () =>
        ask<void, ConductorUnavailable>(async () => {
          await host().signInCancel();
        }),
      setOption: ({ input }: { input: { id: string; value: string } }) =>
        ask(() => host().setOption(input.id, input.value)),
      newSession: () => ask(() => host().newSession()),
      clearSession: () => ask(() => host().clearSession()),
    },
  };
}
