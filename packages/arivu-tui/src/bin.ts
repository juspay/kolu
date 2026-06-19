/**
 * arivu-tui — a terminal-side viewer for a running `arivu` daemon. It dials
 * arivu's unix socket and reads the `awareness` collection: what each terminal
 * *is in* (repo branch · PR + checks · agent state · foreground), where
 * kaval-tui shows what's *running* in each PTY.
 *
 *   arivu-tui list [--json]   one row per terminal — id · branch · pr · agent · fg
 *   arivu-tui watch <id>      follow one terminal's awareness live (Ctrl-C to stop)
 *
 * `list` prints a short id (the leading chars of the full uuid); `<id>` in
 * `watch` is that short form or any unique prefix, resolved against the live set.
 * By default it reaches an arivu on THIS machine; `--socket PATH` points at a
 * different local socket. (A remote `--host <ssh>` dial is P2.)
 */

import { ARIVU_CONTRACT_VERSION, type TerminalId } from "@kolu/arivu-contract";
import { arivuSocketPath } from "@kolu/arivu-contract/socket";
import { cli, command } from "cleye";
import { type Connection, connectArivu } from "./connect.ts";
import { snapshotAwareness } from "./read.ts";
import {
  formatAwarenessJson,
  formatAwarenessList,
  formatAwarenessRow,
  resolveTerminalId,
  shortId,
} from "./render.ts";

// cleye binds flags only AFTER the subcommand, so `--socket` goes after the
// command: `arivu-tui list --socket <path>`, never before it.
const socketFlag = {
  socket: {
    type: String,
    description:
      "the arivu socket to dial — goes AFTER the subcommand. Default: $XDG_RUNTIME_DIR/arivu/awareness.sock (or /tmp/arivu-$UID/awareness.sock off systemd).",
  },
} as const;

const argv = cli({
  name: "arivu-tui",
  version: ARIVU_CONTRACT_VERSION,
  help: {
    description:
      "A viewer for the arivu terminal-awareness daemon (beta). Dials a running arivu over its local unix socket — start it with `arivu` (which itself needs a running kaval).",
  },
  commands: [
    command({
      name: "list",
      help: { description: "Show every terminal's awareness — one row each." },
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
      name: "watch",
      parameters: ["<id>"],
      help: {
        description:
          "Follow one terminal's awareness live until Ctrl-C. <id> is the short id from `list` or any unique prefix.",
      },
      flags: { ...socketFlag },
    }),
  ],
});

function fail(message: string): never {
  process.stderr.write(`arivu-tui: ${message}\n`);
  process.exit(1);
}

/** Dial the arivu daemon — an explicit `--socket`, else the default path. Fails
 *  loud with an actionable hint if nothing is listening. */
function connect(socketOverride: string | undefined): Promise<Connection> {
  const socketPath = arivuSocketPath(socketOverride);
  return connectArivu(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no arivu at ${socketPath}${code ? ` (${code})` : ""} — is it running? Start it with \`arivu\` (it needs a running kaval).`,
    );
  });
}

async function cmdList(conn: Connection, json: boolean): Promise<void> {
  const entries = await snapshotAwareness(conn.client);
  process.stdout.write(
    json
      ? `${formatAwarenessJson(entries)}\n`
      : `${formatAwarenessList(entries)}\n`,
  );
}

async function cmdWatch(conn: Connection, query: string): Promise<void> {
  // Resolve the id-or-prefix against the live set first — an honest not-found
  // before we open a follow stream.
  const entries = await snapshotAwareness(conn.client);
  const result = resolveTerminalId(
    query,
    entries.map(([id]) => id),
  );
  if (result.kind === "none") {
    fail(
      `no terminal matching "${query}" — \`arivu-tui list\` shows the live ones.`,
    );
  }
  if (result.kind === "ambiguous") {
    fail(
      `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
        .map(shortId)
        .join("\n  ")}`,
    );
  }
  const id: TerminalId = result.id;

  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.on("SIGINT", stop);
  process.stderr.write(`— watching ${shortId(id)} · Ctrl-C to stop\n`);

  // End the follow when the terminal departs (its key leaves the set) — the
  // per-key value stream does not self-end on removal, so the keys stream is
  // what tells us it's gone. Fire-and-forget; `conn.dispose()` reaps it.
  void (async () => {
    try {
      for await (const keys of await conn.client.surface.awareness.keys({})) {
        if (!keys.includes(id)) {
          abort.abort();
          break;
        }
      }
    } catch {
      // aborted, or the keys stream ended — nothing to do.
    }
  })();

  try {
    for await (const value of await conn.client.surface.awareness.get(
      { key: id },
      { signal: abort.signal },
    )) {
      // Home + clear, then repaint the single row — a live-updating view.
      process.stdout.write("\x1b[H\x1b[2J");
      process.stdout.write(`${formatAwarenessRow(id, value)}\n`);
    }
  } catch (err) {
    if (!abort.signal.aborted) fail((err as Error).message);
  } finally {
    process.off("SIGINT", stop);
  }
  process.stderr.write(`— ${shortId(id)} is no longer watched\n`);
}

async function main(): Promise<void> {
  // cleye already handled --help / --version. We land here with no command for
  // bare `arivu-tui` (show help) or a flag BEFORE the subcommand (cleye binds
  // flags only after the command, so a leading flag swallows it) — steer that
  // to the right order rather than dumping bare help.
  if (argv.command === undefined) {
    if (process.argv.length > 2) {
      fail(
        "no command. Flags go AFTER the subcommand — try `arivu-tui list --socket <path>` (not `arivu-tui --socket <path> list`). `arivu-tui --help` lists the commands.",
      );
    }
    argv.showHelp();
    process.exit(1);
  }

  const conn = await connect(argv.flags.socket);
  try {
    if (argv.command === "list") await cmdList(conn, argv.flags.json);
    else if (argv.command === "watch") await cmdWatch(conn, argv._.id);
    else fail("unhandled command — add a dispatch branch for it");
  } finally {
    conn.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`arivu-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
