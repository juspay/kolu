import type { PadiStateEvent } from "@kolu/padi-client/surface";
import { Effect, Queue, Stream } from "effect";
import type { Logger } from "pino";
import type { StateWatchHub, StateWatchSpec } from "./stateWatch.ts";

export function stateWatchSource(
  hub: StateWatchHub,
  spec: StateWatchSpec,
  log: Logger,
): Stream.Stream<readonly PadiStateEvent[]> {
  return Stream.callback<readonly PadiStateEvent[]>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        hub.subscribe(spec, (batch) => {
          Queue.offerUnsafe(queue, batch);
        }),
      ),
      (sub) =>
        Effect.sync(() => {
          sub.stop();
          log.debug("padi: watchStates subscription ended");
        }),
    ),
  );
}
