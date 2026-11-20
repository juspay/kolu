import {
  type Channel,
  inMemoryPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import { log } from "./log.ts";

/** The process-wide in-process publisher — shared with kolu-server's surface
 *  (it imports this from `@kolu/padi/assembly`) because ONE instance is what
 *  makes cross-channel ordering a fact rather than a hope. */
export const publisher = inMemoryPublisher();

let dirtySubscribers = 0;

const dirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);

async function* tallied<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  dirtySubscribers += 1;
  try {
    for await (const value of source) yield value;
  } finally {
    dirtySubscribers -= 1;
  }
}

const subscribeDirty = (
  signal: AbortSignal | undefined,
): AsyncIterable<Record<string, never>> =>
  tallied(dirtyChannel.subscribe(signal));

export const terminalsDirtyChannel: Channel<Record<string, never>> = {
  publish: (value) => dirtyChannel.publish(value),
  subscribe: subscribeDirty,
  consume: ({ onEvent, onError }) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of subscribeDirty(controller.signal)) {
          onEvent(value);
        }
      } catch (err) {
        if (!controller.signal.aborted) onError(err);
      }
    })();
    return () => controller.abort();
  },
};

/** Live `terminals:dirty` subscribers — the diagnostics readout. Not the
 *  publisher's size: it is the one thing this module can count honestly, and a
 *  consumer that fails to unsubscribe shows up as a climbing count. */
export const publisherSize = (): number => dirtySubscribers;

/** Emit the shared `terminals:dirty` pulse — the SINGLE writer-facing arm every
 *  terminal/metadata writer calls when a restore-relevant change lands. Arms the
 *  autosave gate and reconciles the activity taps. */
export function notifyDirty(): void {
  try {
    terminalsDirtyChannel.publish({});
  } catch (err) {
    log.error({ err }, "terminals:dirty publish threw");
  }
}
