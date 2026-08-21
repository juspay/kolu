/**
 * Child process for the pipe-flush pin. Writes ONE line to fd 1 (the live
 * `process.stdout` of a CLI child) and stays alive so nothing else can write.
 * Spawned with stdout as pipe(2) into GNU `head`. `--unterminated` omits the
 * newline so the pin can go red.
 *
 * Deliberately not an Effect.run* edge: the production helper is writeSync on
 * the fd, and this child is that write. The full Queue→pump path is the
 * daemon e2e's `kolu watch | head -1`.
 */
import { writeSync } from "node:fs";
import { terminateWatchLine } from "@kolu/padi/dial";

if (process.argv.includes("--unterminated")) {
  writeSync(1, "SNAPSHOT");
} else {
  writeSync(1, terminateWatchLine("SNAPSHOT"));
}

await new Promise<void>((resolve) => {
  setTimeout(resolve, 30_000);
});
