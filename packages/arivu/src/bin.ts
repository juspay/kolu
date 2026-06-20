/**
 * The `arivu` executable — the standalone terminal-awareness daemon's entry.
 *
 * arivu dials a running kaval, runs the awareness sensors (git · PR · agent ·
 * foreground) for every terminal kaval owns, and serves the result as one
 * `awareness` collection that `arivu-tui` reads. It owns no PTYs and holds no
 * lock — it is ephemeral, recomputing from now on every start.
 *
 *   arivu                      dial the local kaval, serve on arivu's socket
 *   arivu --kaval PATH         dial a kaval at an explicit socket
 *   arivu --socket PATH        serve on an explicit socket path
 *   arivu --stdio [--kaval P]  serve over stdin/stdout (what an ssh dial speaks
 *                              to; not for interactive use)
 *
 * Run it on a box where kaval is running and drive it with `arivu-tui list`.
 * This file is the executable — it runs the daemon on load, never an import
 * target. stdout is the wire in `--stdio` mode, so ALL logging goes to stderr.
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { runArivuDaemon } from "./daemon.ts";

const USAGE = `arivu — the standalone terminal-awareness daemon

Usage:
  arivu [--kaval PATH] [--socket PATH]
  arivu --stdio [--kaval PATH]

Options:
  --kaval PATH    the kaval pty-host socket to dial (default: the running kaval,
                  discovered — a standalone one, or a kolu-server namespaced by
                  listen port; pass this to pick one when several are up).
  --socket PATH   serve the awareness surface on an explicit socket
                  (default: $XDG_RUNTIME_DIR/arivu/awareness.sock). Ignored
                  with --stdio.
  --stdio         serve over stdin/stdout instead of a socket — the transport
                  an ssh dial speaks to. Not for interactive use.
  -h, --help      show this help

Drive a running arivu with \`arivu-tui list\` / \`arivu-tui watch <id>\`.`;

const { values } = parseArgs({
  options: {
    kaval: { type: "string" },
    socket: { type: "string" },
    stdio: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

// pino to fd 2 (stderr) — NEVER stdout, which is the protocol channel in
// --stdio mode. Over --stdio (an ssh `--host` dial) default to `warn`: the
// routine sensor logs (info-level "git watcher installed" per terminal, …) are
// forwarded to the viewer's terminal and would spam its live TUI; only warnings
// and errors are worth surfacing across the link. The socket case stays `info`.
// `ARIVU_LOG_LEVEL` overrides either way, for field debugging.
const log = pino(
  {
    level: process.env.ARIVU_LOG_LEVEL ?? (values.stdio ? "warn" : "info"),
  },
  pino.destination(2),
);

runArivuDaemon({
  kavalSocket: values.kaval,
  serve: values.stdio
    ? { kind: "stdio" }
    : { kind: "socket", socketPath: values.socket },
  log,
})
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // A plain, human line on stderr — readable in an `--host` dial's streamed
    // output (and surfaced by `dialAgentOnce` as the dial's failure reason),
    // instead of a pino JSON blob. The structured error (with stack) stays at
    // debug for field debugging (ARIVU_LOG_LEVEL=debug).
    process.stderr.write(`arivu: ${msg}\n`);
    log.debug({ err }, "arivu: fatal");
    process.exit(1);
  });
