/**
 * kaval-tui — a terminal-side client for a running `kaval` daemon
 * (R-4 Phases 1–2: `list` + `snapshot` + `attach`). It dials kaval's unix
 * socket via `unixSocketLink` and speaks `ptyHostSurface` directly — the *raw*
 * client (the browser is the *rich* one over the full kolu contract).
 * See `docs/atlas/src/content/atlas/pty-daemon-tui.mdx`.
 *
 *   kaval-tui list [--json]     list your live terminals (id · pid · idle · cwd)
 *   kaval-tui snapshot <id>     print a terminal's current scrollback, then exit
 *   kaval-tui attach <id>       take over a terminal from the shell; `~.` detaches
 *
 * By default it reaches a standalone `kaval` daemon. To drive a running
 * kolu-server's in-process terminals instead (until B2 flips kolu onto the
 * daemon), point `--socket` at kolu's socket
 * (`$XDG_RUNTIME_DIR/kolu/pty-host.sock`).
 *
 * `spawn` / `kill` are later phases. The CLI comes and goes; the daemon keeps
 * owning the PTYs.
 */
import { writeSync } from "node:fs";
import { homedir } from "node:os";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { SNAPSHOT_TTY_RESET as TTY_RESET } from "@kolu/terminal-protocol";
import { cli, command } from "cleye";
import { getPtyHostSocketPath, PTY_HOST_CONTRACT_VERSION } from "kaval";
import { type AttachTty, runAttach } from "./attach.ts";
import { type Connection, connectPtyHost } from "./connect.ts";
import { isValidEscapeChar } from "./escape.ts";
import { formatList, formatListJson } from "./render.ts";

// Declared on each subcommand (cleye binds flags only AFTER the subcommand —
// it does not inherit a parent flag — so `--socket` goes after the command:
// `kaval-tui list --socket <path>`, never `kaval-tui --socket <path> list`).
const socketFlag = {
  socket: {
    type: String,
    description:
      "socket to dial — goes AFTER the subcommand. Default: kaval's own, $XDG_RUNTIME_DIR/kaval/pty-host.sock (or /tmp/kaval-$UID/pty-host.sock when $XDG_RUNTIME_DIR is unset). To reach a running kolu-server, pass ITS socket: $XDG_RUNTIME_DIR/kolu/pty-host.sock (or /tmp/kolu-$UID/pty-host.sock when $XDG_RUNTIME_DIR is unset — e.g. over ssh / a non-login session).",
  },
} as const;

const argv = cli({
  name: "kaval-tui",
  version: PTY_HOST_CONTRACT_VERSION,
  help: {
    description:
      "A terminal-side client for the kaval PTY daemon (beta). Connects to a running kaval over a local unix socket — start it with `kaval`; the socket appears once it boots. Use `--socket` to reach a kolu-server's in-process terminals instead. spawn / kill land later.",
  },
  commands: [
    command({
      name: "list",
      help: { description: "List your live terminals." },
      flags: {
        ...socketFlag,
        json: {
          type: Boolean,
          description: "machine-readable JSON output (a top-level array)",
          default: false,
        },
      },
    }),
    command({
      name: "snapshot",
      parameters: ["<id>"],
      help: { description: "Print a terminal's current rendered scrollback." },
      flags: { ...socketFlag },
    }),
    command({
      name: "attach",
      parameters: ["<id>"],
      help: {
        description:
          "Take over a terminal: raw passthrough until a line-start `~.` detaches (the daemon keeps the terminal). `~?` lists the escapes.",
      },
      flags: {
        ...socketFlag,
        escape: {
          type: String,
          description:
            "the line-start escape character (a single printable ASCII char)",
          default: "~",
        },
      },
    }),
  ],
});

/** Backpressure-aware stdout write — a large scrollback to a pipe must drain
 *  before we exit, or the tail is truncated. EPIPE (e.g. `kaval-tui list | head
 *  -1`) is treated as "done" rather than an error so the process exits cleanly. */
function writeOut(text: string): Promise<void> {
  return new Promise((resolve) => {
    // Register error handler BEFORE write() so a sync EPIPE doesn't go unhandled.
    process.stdout.once("error", resolve);
    if (process.stdout.write(text)) {
      process.stdout.removeListener("error", resolve);
      resolve();
    } else {
      process.stdout.once("drain", () => {
        process.stdout.removeListener("error", resolve);
        resolve();
      });
    }
  });
}

function fail(message: string): never {
  process.stderr.write(`kaval-tui: ${message}\n`);
  process.exit(1);
}

async function cmdList(conn: Connection, json: boolean): Promise<void> {
  const { entries } = await conn.client.surface.terminal.list({});
  await writeOut(
    json
      ? `${formatListJson(entries)}\n`
      : `${formatList(entries, { now: Date.now(), home: homedir() })}\n`,
  );
}

async function cmdSnapshot(conn: Connection, id: string): Promise<void> {
  // Plain rendered scrollback — NOT the `terminalAttach` first frame. That
  // first frame is the *serialized xterm screen state* (VT escape sequences)
  // used for late attach; piping it to a terminal would replay those control
  // sequences, and `grep`-ing it (the headless-CI use the docs promise) would
  // match against escape bytes, not text. `getScreenText` is the rendered
  // buffer the `snapshot | grep MARK-` flow needs.
  const { text } = await conn.client.surface.terminal.getScreenText({ id });
  await writeOut(text.endsWith("\n") ? text : `${text}\n`);
  // Trailer to stderr so stdout stays clean, scriptable scrollback — derived
  // from the text we already hold, no second round-trip to decorate it.
  const lines = text ? text.replace(/\n+$/, "").split("\n").length : 0;
  process.stderr.write(`— ${id} · ${lines} line${lines === 1 ? "" : "s"}\n`);
}

async function cmdAttach(
  conn: Connection,
  id: string,
  escapeChar: string,
): Promise<never> {
  if (!isValidEscapeChar(escapeChar)) {
    fail(
      `--escape must be a single printable ASCII character, got ${JSON.stringify(escapeChar)}`,
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "attach needs an interactive terminal (stdin/stdout is not a tty) — for scripting, use `kaval-tui snapshot`.",
    );
  }

  // ONE restore for every exit path — detach, PTY exit, signals, crash. The
  // snapshot/deltas replay terminal modes (alt-buffer, mouse tracking,
  // bracketed paste, app cursor keys) onto the real terminal, so leaving
  // without this resets nothing and wrecks the user's shell. Synchronous
  // (`writeSync`) and idempotent so it is safe from a process 'exit' handler,
  // where async writes never flush.
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    try {
      writeSync(process.stdout.fd, TTY_RESET);
    } catch {
      // A dead stdout (terminal already gone, e.g. SIGHUP) has nothing left
      // to restore.
    }
  };
  process.on("exit", restore);
  // In raw mode Ctrl+C arrives as byte 0x03 and is FORWARDED to the inner
  // program (the local tty generates no SIGINT) — these handlers only catch
  // *external* signals (kill, a closing terminal). Restore, then leave with
  // the conventional 128+n code; the daemon keeps the PTY either way.
  for (const [sig, n] of [
    ["SIGINT", 2],
    ["SIGTERM", 15],
    ["SIGHUP", 1],
  ] as const) {
    process.on(sig, () => {
      restore();
      process.exit(128 + n);
    });
  }

  const tty: AttachTty = {
    input: process.stdin,
    write: writeOut,
    size: () => ({
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    }),
    onResize: (cb) => {
      process.stdout.on("resize", cb);
      return () => process.stdout.off("resize", cb);
    },
    setRawMode: (on) => process.stdin.setRawMode(on),
  };

  const outcome = await runAttach(conn.client, id, {
    escape: escapeChar,
    tty,
  });
  restore();
  switch (outcome.kind) {
    case "detached":
      process.stderr.write(`— detached · ${id} stays live in the daemon\n`);
      process.exit(0);
      break;
    case "exited":
      process.stderr.write(`— ${id} exited (code ${outcome.exitCode})\n`);
      // Mirror the child where possible; anything unrepresentable (negative /
      // >255 — node clamps modulo 256) degrades to the generic failure 1.
      process.exit(
        outcome.exitCode >= 0 && outcome.exitCode <= 255 ? outcome.exitCode : 1,
      );
      break;
    case "not-found":
      fail(`no terminal ${id} — \`kaval-tui list\` shows the live ones.`);
      break;
    case "error":
      fail(outcome.message);
  }
  // Unreachable (every branch exits) — but TS needs the function to end.
  process.exit(1);
}

/** Confirm the running daemon speaks a wire-compatible pty-host contract before
 *  we invoke any command — a newer kaval-tui against an older/different daemon
 *  would otherwise fail deep inside oRPC with an opaque schema/procedure error
 *  instead of an honest "restart it" line. A major mismatch (or a newer-minor
 *  daemon) is a clean, actionable failure here. */
async function assertCompatible(conn: Connection): Promise<void> {
  const { contractVersion } = await conn.client.surface.system
    .version({})
    .catch((err: Error) => {
      throw new Error(
        `could not read the daemon's pty-host version (${err.message}) — is it a kaval (or kolu-server) new enough to expose \`system.version\`? Try restarting it.`,
      );
    });
  if (
    !isContractVersionCompatible(contractVersion, PTY_HOST_CONTRACT_VERSION)
  ) {
    fail(
      `pty-host contract mismatch: the daemon speaks ${contractVersion}, kaval-tui needs ${PTY_HOST_CONTRACT_VERSION}. Restart it (and kaval-tui) to the same build.`,
    );
  }
}

async function main(): Promise<void> {
  // cleye already handled --help / --version (it prints and exits). We land here
  // with no command in two cases: bare `kaval-tui` (no args → show help), or the
  // common trap of a flag BEFORE the subcommand (`kaval-tui --socket X list`) —
  // cleye binds flags only after the command, so a leading flag swallows it and
  // cleye finds no command. Steer that case to the right order instead of
  // dumping bare help (which is what made the mistake look like a no-op).
  if (argv.command === undefined) {
    if (process.argv.length > 2) {
      fail(
        "no command. Flags go AFTER the subcommand — try `kaval-tui list --socket <path>` (not `kaval-tui --socket <path> list`). `kaval-tui --help` lists the commands.",
      );
    }
    argv.showHelp();
    process.exit(1);
  }

  const socketPath = getPtyHostSocketPath(argv.flags.socket, "kaval");
  const conn = await connectPtyHost(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    // The kolu-server hint names the SAME path kolu computes — and the
    // $XDG_RUNTIME_DIR-unset fallback (e.g. over ssh), the exact case where a
    // hand-built `$XDG_RUNTIME_DIR/kolu/...` collapses to a wrong `/kolu/...`.
    const koluSock = getPtyHostSocketPath(undefined, "kolu");
    return fail(
      `no socket at ${socketPath}${code ? ` (${code})` : ""} — is kaval running? Start it with \`kaval\`; the socket appears once it boots. To reach a running kolu-server instead, point at its socket: \`--socket ${koluSock}\`.`,
    );
  });

  try {
    await assertCompatible(conn);
    // Closed dispatch: every command is named, and the final else fails loud
    // — so a Phase 3 addition (spawn) that forgets a branch here cannot
    // silently fall through into another command's handler. (cleye already
    // exits on commands not in its registry; this guards OUR omissions.)
    if (argv.command === "list") await cmdList(conn, argv.flags.json);
    else if (argv.command === "snapshot") await cmdSnapshot(conn, argv._.id);
    else if (argv.command === "attach")
      await cmdAttach(conn, argv._.id, argv.flags.escape);
    else fail("unhandled command — add a dispatch branch for it");
  } finally {
    conn.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`kaval-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
