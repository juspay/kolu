/**
 * Child process for the pipe-flush pin: offer ONE watch line on process.stdout
 * via the live pump, then stay alive so nothing else can write. Spawned with
 * stdout as pipe(2) into GNU `head`. `--unterminated` writes the payload with
 * no newline so the pin can go red — a test that cannot fail is not a pin.
 */
import { writeSync } from "node:fs";
import { Effect, Queue, Stream } from "effect";
import { writeStdoutLine } from "./shared.ts";

if (process.argv.includes("--unterminated")) {
  writeSync(1, "SNAPSHOT");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30_000);
  });
} else {
  const program = Effect.gen(function* () {
    const lines = yield* Queue.unbounded<string>();
    yield* Effect.forkChild(
      Stream.runForEach(Stream.fromQueue(lines), writeStdoutLine),
    );
    yield* Queue.offer(lines, "SNAPSHOT");
    yield* Effect.sleep("30 seconds");
  });

  Effect.runPromise(Effect.scoped(program)).catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
