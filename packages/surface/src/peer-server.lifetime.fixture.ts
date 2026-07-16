/**
 * Child-process fixture for `peer-server.lifetime.test.ts` — NOT a test file
 * (vitest only picks up `*.test.ts`). Run via `node --import tsx`.
 *
 * Serves a one-procedure router over the DEFAULT process stdio while holding
 * a live `setInterval` — the drishti#109 shape: any live handle keeps the
 * event loop alive after the serve promise settles, so without the
 * framework-owned exit this process is an immortal orphan the moment its
 * parent closes the pipe.
 *
 * Modes (argv):
 *   (none)          — serve; live interval; post-settle sync log.
 *   --self-error    — after ready, destroy stdin with an error → exercises
 *                     the `reason: "error"` arm (must exit 1).
 *   --wedged-on-end — pass an `onEnd` that never settles → exercises the
 *                     hard deadline (must still exit, at ~ the deadline).
 */
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { z } from "zod";
import { serveOverStdio } from "./peer-server";

const t = implement({ ping: oc.output(z.string()) });
const router = t.router({ ping: t.ping.handler(() => "pong") });

const args = process.argv.slice(2);

// The orphaning handle: a live interval that outlives the link. Deliberately
// never cleared — the pin asserts the framework exit wins over it.
setInterval(() => {}, 1_000);

process.stderr.write("fixture: serving\n");

if (args.includes("--self-error")) {
  // A read-stream error is not injectable from the parent side of a pipe
  // (closing it is a clean EOF), so the fixture injects it on its own stdin.
  setTimeout(() => {
    process.stdin.destroy(new Error("injected read error"));
  }, 50);
}

// Spread via a variable: keeps the RED commit typechecking before the
// framework grows `onEnd` (spread expressions skip excess-property checks).
const wedged = args.includes("--wedged-on-end")
  ? { onEnd: () => new Promise<never>(() => {}) }
  : {};

const end = await serveOverStdio({ router, ...wedged });

// Post-settle sync work must still run before the framework-owned exit
// (teardown step 4): the parent asserts this line arrived.
process.stderr.write(`fixture: settled reason=${end.reason}\n`);
