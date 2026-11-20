import type { Readable, Writable } from "node:stream";

import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";

export const streamOver = (stdio: {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
}): Stream => {
  const stdout = stdio.stdout;
  const stdin = stdio.stdin;
  if (stdout === null || stdin === null) {
    throw new Error("the subprocess was spawned without pipes");
  }

  let stop: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // A process exiting can deliver `end` AND `error`, and a consumer
      // cancel closes the controller while leftover stdout is still in
      // flight: both `close` and `enqueue` throw on a closed controller.
      let closed = false;
      const onData = (chunk: Buffer) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk));
      };
      const onClose = () => {
        if (closed) return;
        stop?.();
        controller.close();
      };
      stop = () => {
        if (closed) return;
        closed = true;
        stdout.removeListener("data", onData);
        stdout.removeListener("end", onClose);
        // `error` stays: Node throws an unhandled `error` event, and a
        // process exiting can still deliver one after `end`.
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
      return new Promise<void>((resolve, reject) => {
        stdin.write(chunk, (cause) =>
          cause == null ? resolve() : reject(cause),
        );
      });
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
