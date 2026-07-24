/**
 * vazhi (Tamil: *way, passage*) — a standalone TUI for port forwards.
 *
 * One screen, three keys: `a` opens a forward to a `host:port`, `x` cancels the
 * selected one, `q` quits and takes every forward it opened down with it. No
 * subcommands, no daemon, no config — run it, forward a port, quit.
 *
 *     pu-dev:5173  →  http://pureintent:5173  up 12m
 *
 * That line means: whatever is listening on pu-dev's own `127.0.0.1:5173` now
 * answers at that URL — a port on THIS machine, bound on every interface — so a
 * browser anywhere on the network can open it, which pu-dev's loopback could
 * never do. The URL is a real terminal hyperlink: click it.
 *
 * vazhi is deliberately independent of kolu: its only kolu import is
 * `@kolu/port-forward`, the shared library kolu's Inspector uses too. The two
 * never talk, and share nothing — every forward owns its own ssh connection, so
 * quitting (or crashing, or being SIGKILLed) takes vazhi's forwards down with
 * it and leaves nobody else's touched. Run vazhi inside a kolu terminal and
 * kolu's PTY persistence keeps it alive across browser reloads for free; run it
 * on a box with no kolu at all and it works the same.
 *
 * This module owns the process edges that exist BEFORE the screen does — the
 * TTY precondition, ink's alternate-screen mode, and the exit code. Every way
 * of *stopping* — `q`, Ctrl+C, and SIGINT/SIGTERM/SIGHUP — belongs to
 * `App.tsx`, because all of them must run the same forward teardown before the
 * process is allowed to end.
 */

import { hostname } from "node:os";
import { createForwardManager } from "@kolu/port-forward";
import { render } from "ink";
import { App } from "./App.tsx";

function fail(message: string): never {
  process.stderr.write(`vazhi: ${message}\n`);
  process.exit(1);
}

// A TUI with no terminal is a category error, not something to degrade into a
// log-printing mode — say so and stop.
if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
  fail(
    "this is an interactive TUI and needs a terminal on stdin and stdout (it has no subcommands to script).",
  );
}

// `alternateScreen` is ink's, not ours: it writes the same escapes, but it also
// restores the primary buffer and the cursor from its own unmount — which ink
// registers with signal-exit BEFORE entering the buffer. So a crash after mount
// (an uncaught throw from the render tree or a timer) gives the terminal back
// too, which hand-written enter/leave writes around `waitUntilExit()` cannot do.
// Ctrl+C stays ours: the app tears the forwards down before it lets go.
const app = render(
  <App hostname={hostname()} createForwards={createForwardManager} />,
  {
    exitOnCtrlC: false,
    alternateScreen: true,
  },
);

try {
  await app.waitUntilExit();
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
