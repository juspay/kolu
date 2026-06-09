/**
 * kolu-tui — a terminal-side client for kolu-server's in-process pty-host
 * (R-4 Phase 1: `list` + `snapshot`). It dials the server's unix socket via
 * `stdioLink` and speaks `ptyHostSurface` directly — the *raw* client (the
 * browser is the *rich* one over the full kolu contract). See
 * `docs/plans/remote-terminals.pty-daemon.tui.html`.
 *
 *   kolu-tui list [--json]     list your live terminals (id · pid · idle · cwd)
 *   kolu-tui snapshot <id>     print a terminal's current scrollback, then exit
 *
 * Read-only by design this phase — `attach` / `spawn` / `kill` are later
 * phases. The CLI comes and goes; kolu-server keeps owning the PTYs.
 */
import { homedir } from "node:os";
import {
  getPtyHostSocketPath,
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
} from "@kolu/pty-host";
import { cli, command } from "cleye";
import { type Connection, connectPtyHost } from "./connect.ts";
import { formatList, formatListJson } from "./render.ts";

// Shared on both subcommands (cleye doesn't inherit a parent flag into a
// subcommand's parsed type, so it's declared on each that needs it).
const socketFlag = {
  ptyHostSocket: {
    type: String,
    description:
      "pty-host socket path (default: $XDG_RUNTIME_DIR/kolu/pty-host.sock on systemd Linux, else /tmp/kolu-$UID/pty-host.sock)",
  },
} as const;

const argv = cli({
  name: "kolu-tui",
  version: PTY_HOST_CONTRACT_VERSION,
  help: {
    description:
      "A terminal-side client for kolu-server's pty-host (beta). Connects to a running kolu-server over a local unix socket — start the server first (e.g. `nix run github:juspay/kolu`); the socket appears once it boots. Read-only this phase: attach / spawn / kill land later.",
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
  ],
});

/** Backpressure-aware stdout write — a large scrollback to a pipe must drain
 *  before we exit, or the tail is truncated. EPIPE (e.g. `kolu-tui list | head
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
  process.stderr.write(`kolu-tui: ${message}\n`);
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

/** Confirm the running server speaks a wire-compatible pty-host contract before
 *  we invoke any command — a newer kolu-tui against an older/different server
 *  would otherwise fail deep inside oRPC with an opaque schema/procedure error
 *  instead of an honest "restart your server" line. A major mismatch (or a
 *  newer-minor server) is a clean, actionable failure here. */
async function assertCompatible(conn: Connection): Promise<void> {
  const { contractVersion } = await conn.client.surface.system
    .version({})
    .catch((err: Error) => {
      throw new Error(
        `could not read the server's pty-host version (${err.message}) — is it a kolu-server new enough to expose \`system.version\`? Try restarting it.`,
      );
    });
  if (
    !isPtyHostContractCompatible(contractVersion, PTY_HOST_CONTRACT_VERSION)
  ) {
    fail(
      `pty-host contract mismatch: server speaks ${contractVersion}, kolu-tui needs ${PTY_HOST_CONTRACT_VERSION}. Restart kolu-server (and kolu-tui) to the same build.`,
    );
  }
}

async function main(): Promise<void> {
  // cleye already handled --help / --version / unknown commands (it prints and
  // exits). No subcommand at all → show help and signal misuse.
  if (argv.command === undefined) {
    argv.showHelp();
    process.exit(1);
  }

  const socketPath = getPtyHostSocketPath(argv.flags.ptyHostSocket);
  const conn = await connectPtyHost(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no pty-host socket at ${socketPath}${code ? ` (${code})` : ""} — is kolu-server running? the socket appears once it boots.`,
    );
  });

  try {
    await assertCompatible(conn);
    if (argv.command === "list") await cmdList(conn, argv.flags.json);
    else await cmdSnapshot(conn, argv._.id);
  } finally {
    conn.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`kolu-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
