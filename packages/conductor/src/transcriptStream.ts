import type { ConductorFrame } from "kolu-common/conductor";
import { Effect, Queue, Stream } from "effect";
import type { Logger } from "pino";
import type { ConductorHost } from "./conductor.ts";

export function conductorTranscriptSource(
  host: ConductorHost,
  log: Logger,
): Stream.Stream<ConductorFrame> {
  return Stream.callback<ConductorFrame>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        host.watch((frame) => {
          Queue.offerUnsafe(queue, frame);
        }),
      ),
      (unwatch) =>
        Effect.sync(() => {
          unwatch();
          log.debug("kolu-server: conductorTranscript subscription ended");
        }),
    ),
  );
}
