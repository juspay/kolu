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
 * This module owns only the terminal itself — the alternate screen buffer in
 * and out, and the exit code. Everything visible is `App.tsx`.
 */

import { hostname } from "node:os";
import { render } from "ink";
import { App } from "./App.tsx";

/** Alternate screen in / out: vazhi takes the whole window and gives the
 *  scrollback back untouched when it leaves. */
const ENTER_ALT_SCREEN = `${String.fromCharCode(27)}[?1049h`;
const LEAVE_ALT_SCREEN = `${String.fromCharCode(27)}[?1049l`;

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

process.stdout.write(ENTER_ALT_SCREEN);
// Ctrl+C is handled in the app, where it can tear the forwards down first. A
// crash on the way up must still give the terminal back — otherwise the user is
// left staring at an empty alternate screen with their scrollback hidden.
let app: ReturnType<typeof render>;
try {
  app = render(<App hostname={hostname()} />, { exitOnCtrlC: false });
} catch (err) {
  process.stdout.write(LEAVE_ALT_SCREEN);
  fail(err instanceof Error ? err.message : String(err));
}

try {
  await app.waitUntilExit();
  process.stdout.write(LEAVE_ALT_SCREEN);
  process.exit(0);
} catch (err) {
  process.stdout.write(LEAVE_ALT_SCREEN);
  fail(err instanceof Error ? err.message : String(err));
}
