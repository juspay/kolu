/**
 * A subprocess's pipes, as a stream of JSON-RPC messages.
 *
 * This package starts two kinds of subprocess and both speak line-delimited
 * JSON-RPC on stdio — the ACP agent ({@link ./agent.ts}) and, for the length of
 * one question, an optional MCP server this host might be running
 * ({@link ./probes.ts}). What they say to each
 * other is nothing alike; how a message gets on and off a pipe is identical, so
 * it is written once, here, and neither of them owns it.
 *
 * What this file owns is TRANSPORT, and only that: how a child's stdin/stdout
 * become Web streams. Whether the child ever ran is `@kolu/child`'s
 * (`unstartable`, attached at spawn). Built by hand rather than with
 * `stream.Web` helpers because this runs under Bun's Node compatibility, and
 * the two adapters differ in when they close and how they surface a broken
 * pipe — twenty lines with the lifecycle written out beats a helper whose
 * behaviour we would be assuming. That is a reason to change this file and no
 * reason to change either caller.
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

  // Stashed so `cancel` (`connection.close` then `child.stop`) can mark
  // the controller closed the same way `end` does, before leftover stdout
  // arrives.
  let stop: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // A process exiting can deliver `end` AND `error`, and a consumer
      // cancel closes the controller while leftover stdout is still in
      // flight. Close twice is already caught; enqueue AFTER close is the
      // throw `Invalid state: Controller is already closed` — the
      // load-dependent flake `deliveries.test.ts` showed under a full
      // suite. Drop the chunk; the conversation is already gone.
      let closed = false;
      const onData = (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          stop?.();
        }
      };
      const onClose = () => {
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
