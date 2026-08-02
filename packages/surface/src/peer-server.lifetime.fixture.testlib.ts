/**
 * Child-process fixture for `peer-server.lifetime.test.ts` — NOT a test file
 * (vitest only picks up `*.test.ts`). Run via `node --import tsx`.
 *
 * Serves the lifetime surface over the DEFAULT process stdio while holding a
 * live `setInterval` — the drishti#109 shape: any live handle keeps the event
 * loop alive after the serve promise settles, so without the framework-owned
 * exit this process is an immortal orphan the moment its parent closes the
 * pipe.
 *
 * Modes (argv):
 *   (none)          — serve; live interval; post-settle sync log.
 *   --self-error    — after ready, destroy stdin with an error → exercises the
 *                     `reason: "error"` arm (must exit 1). A genuinely abnormal
 *                     read death (EIO-shaped), injected on our own stdin
 *                     because a parent closing its pipe end is a clean EOF, not
 *                     an error.
 */
import { Effect, Schedule, Stream } from "effect";
import { serveOverStdio } from "./peer-server";
import { lifetimeSurface } from "./peer-server.lifetime.contract";
import { implementSurface } from "./server";

const runtime = implementSurface(lifetimeSurface, {
  procedures: { sys: { ping: () => Effect.succeed("pong") } },
  streams: {
    tick: {
      source: () =>
        Stream.map(
          Stream.fromSchedule(Schedule.spaced("25 millis")),
          (n: number) => ({ n }),
        ),
    },
  },
});

const args = process.argv.slice(2);

// The orphaning handle: a live interval that outlives the link. Deliberately
// never cleared — the pin asserts the framework exit wins over it.
setInterval(() => {}, 1_000);

process.stderr.write("fixture: serving\n");

if (args.includes("--self-error")) {
  setTimeout(() => {
    process.stdin.destroy(new Error("injected read error"));
  }, 50);
}

const end = await serveOverStdio({
  group: runtime.group,
  handlers: runtime.handlers,
});

// Post-settle sync work must still run before the framework-owned exit
// (teardown step 4): the parent asserts this line arrived.
process.stderr.write(`fixture: settled reason=${end.reason}\n`);
