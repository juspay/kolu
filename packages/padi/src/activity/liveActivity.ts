import { pollOnEvent, streamFromAbortableSource } from "@kolu/surface/server";
import {
  TERMINAL_IDLE_AFTER_MS,
  type TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { Stream } from "effect";
import type { Logger } from "pino";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  createActivityTracker,
  sameActivitySet,
} from "./terminalActivityTracker.ts";
import {
  ACTIVITY_RESUBSCRIBE_DELAY_MS,
  resubscribeStream,
} from "../terminalEndpoint/local.ts";
import { onAbortOnce } from "../abortableDelay.ts";

type ActivityStreamDeps = {
  source: (input: Record<string, never>) => Stream.Stream<TerminalId[]>;
};

/** Run `body` on a signal that aborts with `signal` and, either way, when the
 *  body ends — so a consumer that stops iterating tears the work down. */
async function* withLocalAbort<T>(
  signal: AbortSignal,
  body: (signal: AbortSignal) => AsyncGenerator<T>,
): AsyncGenerator<T> {
  const localAbort = new AbortController();
  const release = onAbortOnce(signal, () => localAbort.abort());
  try {
    yield* body(localAbort.signal);
  } finally {
    release();
    localAbort.abort();
  }
}

export function createLiveActivitySource(log: Logger): ActivityStreamDeps {
  return {
    source: (_input) =>
      streamFromAbortableSource<TerminalId[]>((signal) =>
        withLocalAbort(signal, async function* activityFrames(sig) {
          const tracker = createActivityTracker(TERMINAL_IDLE_AFTER_MS);

          void resubscribeStream({
            signal: sig,
            delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
            getStream: () => ptyHostClient.surface.activity.get({}),
            onEvent: (edge) => tracker.noteOutput(edge.id as TerminalId),
            onDrop: (err) =>
              log.debug(
                { err },
                "kaval activity subscribe failed; will re-subscribe",
              ),
          });

          try {
            yield* pollOnEvent<TerminalId[]>({
              read: async () => tracker.snapshot(),
              isEqual: sameActivitySet,
              install: (onEvent) => tracker.onChange(onEvent),
              signal: sig,
              onReadError: () => {},
            });
          } finally {
            tracker.dispose();
          }
        }),
      ),
  };
}
