import { type Cause, Effect, Queue, Stream } from "effect";
import { stdoutSink } from "./shared.ts";

const lines = await Effect.runPromise(Queue.unbounded<string, Cause.Done>());

void Effect.runPromise(
  Stream.run(Stream.fromQueue(lines), stdoutSink).pipe(
    Effect.catchTag("StdoutWriteFailed", (err) =>
      Effect.sync(() => {
        process.stderr.write(`STDOUT WRITE FAILED: ${String(err.cause)}\n`);
        process.exit(7);
      }),
    ),
  ) as Effect.Effect<void, never, never>,
);

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

await new Promise<void>((resolve) => {
  setTimeout(resolve, 30_000);
});
