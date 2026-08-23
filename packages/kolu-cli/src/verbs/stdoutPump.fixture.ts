/**
 * Child process for the live-feed stdout pins. Runs the SHIPPED pump —
 * `shared.ts`'s `stdoutSink` draining an unbounded queue, the same two lines
 * `kolu watch` and `padi-tui` build — over the child's real `process.stdout`,
 * which the test spawns as a pipe(2).
 *
 * It must be the production sink and not a hand-written `write`: a fixture that
 * writes to the fd itself passes whatever the verb does, so it can neither go
 * red on a regression nor tell two write paths apart. That is exactly what the
 * previous version of this fixture did.
 *
 *   (no flag)        one line, then idle — the consumer must see it with NO
 *                    later write behind it.
 *   --unterminated   the same line without its newline, so the pin can go red.
 *   --flood          lines forever — the consumer never reads, and the writer
 *                    must SLOW DOWN rather than die.
 */
import { type Cause, Effect, Queue, Stream } from "effect";
import { stdoutSink } from "./shared.ts";

const lines = await Effect.runPromise(Queue.unbounded<string, Cause.Done>());

void Effect.runPromise(
  Stream.run(Stream.fromQueue(lines), stdoutSink).pipe(
    Effect.catchTag("StdoutWriteFailed", (err) =>
      Effect.sync(() => {
        // Loud, and on stderr, so a pin that fails says WHY the bytes stopped
        // rather than only that they did.
        process.stderr.write(`STDOUT WRITE FAILED: ${String(err.cause)}\n`);
        process.exit(7);
      }),
    ),
  ) as Effect.Effect<void, never, never>,
);

/** The verb's own `offer`: payload and terminator in ONE queued string. */
const offer = (line: string): void => {
  Queue.offerUnsafe(lines, `${line}\n`);
};

if (process.argv.includes("--unterminated")) {
  Queue.offerUnsafe(lines, "SNAPSHOT");
} else if (process.argv.includes("--flood")) {
  for (let n = 0; n < 100_000; n += 1) offer(`SNAPSHOT ${"x".repeat(200)}`);
} else {
  offer("SNAPSHOT");
}

// Stay alive so nothing else can write — the pin is about THIS line reaching
// the consumer, not about a later write flushing it.
await new Promise<void>((resolve) => {
  setTimeout(resolve, 30_000);
});
