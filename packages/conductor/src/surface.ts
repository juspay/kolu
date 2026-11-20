import { Effect } from "effect";
import {
  type ConductorRefused,
  type ConductorUnavailable,
  isConductorDeclaredError,
} from "kolu-common/conductorErrors";
import type { Logger } from "pino";
import type { ConductorHost } from "./conductor.ts";
import { conductorTranscriptSource } from "./transcriptStream.ts";

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
  readonly host: () => ConductorHost;
  readonly log: Logger;
}) {
  const host = deps.host;
  return {
    state: () => host().state(),
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
        ask(() => host().signIn(input.method)),
      signInInput: ({ input }: { input: { text: string } }) =>
        ask(() => host().signInInput(input.text)),
      signInCancel: () =>
        ask<void, ConductorUnavailable>(async () => {
          await host().signInCancel();
        }),
      askSignIn: () =>
        ask<void, ConductorUnavailable>(() => host().askSignIn()),
      reloadAgent: () => ask(() => host().reloadAgent()),
      setOption: ({ input }: { input: { id: string; value: string } }) =>
        ask(() => host().setOption(input.id, input.value)),
      newSession: () => ask(() => host().newSession()),
      clearSession: () => ask(() => host().clearSession()),
    },
  };
}
