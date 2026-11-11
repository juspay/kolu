/**
 * A subprocess's pipes, as a stream of JSON-RPC messages.
 *
 * TRANSPORT, and only that: how a child's stdin/stdout become the Web streams
 * the ACP SDK's ndjson codec wants. Whether the child ever ran is
 * {@link ./child.ts}'s (`unstartable`, attached at spawn). Written out by hand
 * rather than reached for through `stream.Web`'s helpers because the three
 * hazards below are lifecycle facts this file has to be exact about, and a
 * helper whose behaviour we would be assuming is not exactness.
 */

import type { Readable, Writable } from "node:stream";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";

/** Messages in and out of a spawned child. Throws for a child spawned without
 *  pipes, which is a caller's mistake rather than a subprocess's. */
export const streamOver = (stdio: {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
}): Stream => {
  const stdout = stdio.stdout;
  const stdin = stdio.stdin;
  if (stdout === null || stdin === null) {
    throw new Error("the subprocess was spawned without pipes");
  }

  // Stashed so `cancel` — which is `connection.close()` followed by
  // `child.stop()` — can mark the controller closed the same way `end` does,
  // BEFORE leftover stdout arrives.
  let stop: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // A process exiting can deliver `end` AND `error`, and a consumer cancel
      // closes the controller while leftover stdout is still in flight. Closing
      // twice is already caught by the `try`; enqueueing AFTER close is the
      // throw `Invalid state: Controller is already closed`. Drop the chunk —
      // the conversation it belongs to is already gone.
      let closed = false;
      const onData = (chunk: Buffer): void => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          stop?.();
        }
      };
      const onClose = (): void => {
        stop?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      stop = () => {
        if (closed) return;
        closed = true;
        stdout.removeListener("data", onData);
        stdout.removeListener("end", onClose);
        // `error` STAYS: Node throws on an unhandled `error` event, and a
        // process on its way out can still deliver one after `end`.
      };
      stdout.on("data", onData);
      stdout.on("end", onClose);
      stdout.on("error", onClose);
    },
    cancel() {
      stop?.();
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      stdin.write(chunk, (cause) =>
        cause == null ? resolve() : reject(cause),
      );
      return promise;
    },
    close() {
      stdin.end();
    },
    abort() {
      stdin.destroy();
    },
  });

  return ndJsonStream(writable, readable);
};
