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
import { parseArgs } from "node:util";
import {
  getPtyHostSocketPath,
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
} from "@kolu/pty-host";
import { type Connection, connectPtyHost } from "./connect.ts";
import { formatList, formatListJson } from "./render.ts";

const HELP = `kolu-tui — a terminal-side client for kolu-server's pty-host (beta)

Usage:
  kolu-tui list [--json]       list your live terminals
  kolu-tui snapshot <id>       print a terminal's current scrollback, then exit
  kolu-tui help                show this help

Options:
  --socket <path>   pty-host socket (default: $XDG_RUNTIME_DIR/kolu/pty-host.sock
                    on systemd Linux, else /tmp/kolu-$UID/pty-host.sock)
  --json            machine-readable output (list)
  -h, --help        show this help

kolu-tui connects to a running kolu-server over a local unix socket. Start the
server first (e.g. \`nix run github:juspay/kolu\`); the socket appears once it
boots.`;

interface Args {
  command: string | undefined;
  id: string | undefined;
  socket: string | undefined;
  json: boolean;
  help: boolean;
}

function parse(argv: string[]): Args {
  // `pnpm start -- …` forwards a literal `--`; node:util treats `--` as
  // end-of-options, so strip a leading one. First positional is the command,
  // second (for snapshot) is the terminal id.
  const cleaned = argv[0] === "--" ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args: cleaned,
    allowPositionals: true,
    options: {
      socket: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  return {
    command: positionals[0],
    id: positionals[1],
    socket: values.socket,
    json: values.json ?? false,
    help: values.help ?? false,
  };
}

/** Backpressure-aware stdout write — a large scrollback to a pipe must drain
 *  before we exit, or the tail is truncated. */
function writeOut(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.write(text)) resolve();
    else process.stdout.once("drain", resolve);
  });
}

function fail(message: string): never {
  process.stderr.write(`kolu-tui: ${message}\n`);
  process.exit(1);
}

async function cmdList(conn: Connection, args: Args): Promise<void> {
  const { entries } = await conn.client.surface.terminal.list({});
  await writeOut(
    args.json
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
    .catch(() => {
      throw new Error(
        "could not read the server's pty-host version — is it a kolu-server new enough to expose `system.version`? Try restarting it.",
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

async function run(conn: Connection, args: Args): Promise<void> {
  switch (args.command) {
    case "list":
      return cmdList(conn, args);
    case "snapshot": {
      if (args.id === undefined) fail("snapshot <id>: missing terminal id");
      return cmdSnapshot(conn, args.id);
    }
    default:
      fail(`unknown command "${args.command}" (try: list, snapshot, --help)`);
  }
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.help || args.command === "help") {
    await writeOut(`${HELP}\n`);
    return;
  }
  if (args.command === undefined) {
    process.stderr.write(`${HELP}\n`);
    process.exit(1);
  }

  const socketPath = getPtyHostSocketPath(args.socket);
  const conn = await connectPtyHost(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no pty-host socket at ${socketPath}${code ? ` (${code})` : ""} — is kolu-server running? the socket appears once it boots.`,
    );
  });

  try {
    await assertCompatible(conn);
    await run(conn, args);
  } finally {
    conn.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`kolu-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
