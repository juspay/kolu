/**
 * pulam-tui — a terminal-side client for a running `pulam` daemon. It dials
 * pulam's unix socket and reads the `terminalWorkspaceSurface`: what each
 * terminal *is in* (repo·branch · PR + checks · agent state · foreground),
 * where kaval-tui shows what's *running* in each PTY. It is the *raw* client
 * (the browser fleet dashboard, `pulam-web`, is the *rich* one) — a thin
 * scriptable CLI, kaval-tui's sibling, no TUI.
 * See `docs/atlas/src/content/atlas/pulam-tui.mdx`.
 *
 *   pulam-tui status [--json]      a one-shot snapshot of every terminal
 *   pulam-tui watch [<id>] [--json]  follow live until Ctrl+C — every terminal,
 *                                  or one by id (a short id or unique prefix)
 *
 * By default it reaches a pulam on THIS machine. Two ways to point it elsewhere,
 * mutually exclusive (flags go AFTER the subcommand):
 *   --socket PATH   a different LOCAL socket.
 *   --host <ssh>    a REMOTE pulam over ssh: provision the daemon's closure with
 *                   Nix, run `pulam --stdio`, and dial it — the same awareness
 *                   surface over a different transport (see `hostConnect.ts`).
 *                   The remote pulam DISCOVERS the running kaval (a standalone
 *                   one or a home-manager kolu-server, namespaced by listen
 *                   port); add `--kaval <path>` only to pick one when several
 *                   kavals run on the host. Nothing survives the link (pulam is
 *                   ephemeral by design).
 *
 * Watching the whole FLEET across many hosts is `pulam-web`'s job, not this
 * CLI's: pulam-tui is single-daemon, like kaval-tui.
 */

import { pulamSocketPath } from "@kolu/terminal-workspace/socket";
import {
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { cli, command } from "cleye";
import { type Connection, connectPulam } from "./connect.ts";
import { connectPulamViaHost } from "./hostConnect.ts";
import {
  assertCompatible,
  settledSnapshot,
  snapshotAwareness,
  watchAwareness,
} from "./read.ts";
import {
  formatAwarenessJson,
  formatStatus,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
  resolveTerminalId,
  shortId,
} from "./render.ts";

// Declared on each subcommand — cleye binds flags only AFTER the subcommand (it
// does not inherit a parent flag), so `--socket` goes after the command:
// `pulam-tui status --socket <path>`, never `pulam-tui --socket <path> status`.
const endpointFlags = {
  socket: {
    type: String,
    description:
      "the pulam socket to dial — goes AFTER the subcommand. Default: $XDG_RUNTIME_DIR/pulam/awareness.sock (or /tmp/pulam-$UID/awareness.sock off systemd). Mutually exclusive with --host.",
  },
  host: {
    type: String,
    description:
      "reach a pulam on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. The remote pulam dials the remote kaval and recomputes awareness from now. Mutually exclusive with --socket.",
  },
  kaval: {
    type: String,
    description:
      "with --host: the kaval pty-host socket the remote pulam should dial. Default: the remote pulam discovers the running kaval (standalone, or a kolu-server).",
  },
} as const;

const jsonFlag = {
  json: {
    type: Boolean,
    description: "machine-readable JSON output",
    default: false,
  },
} as const;

const argv = cli({
  name: "pulam-tui",
  version: TERMINAL_WORKSPACE_CONTRACT_VERSION,
  help: {
    description:
      "A terminal-side client for the pulam awareness daemon — what every terminal is in (repo·branch · PR · agent · foreground), read from a running `pulam` (start it with `pulam`, which needs a running kaval). `status` snapshots it; `watch` follows it live. `--json` on either is scriptable; `--host <ssh>` reads a remote machine over ssh. The browser fleet dashboard is `pulam-web`.",
  },
  commands: [
    command({
      name: "status",
      help: {
        description:
          "Snapshot every terminal — one row per terminal (repo·branch · PR · agent · foreground · idle), then exit.",
      },
      flags: { ...endpointFlags, ...jsonFlag },
    }),
    command({
      name: "watch",
      parameters: ["[id]"],
      help: {
        description:
          "Follow awareness live, printing a line per change until Ctrl+C. Bare `watch` follows every terminal; pass an id (a short id from `status` or a unique prefix) to narrow to one.",
      },
      flags: { ...endpointFlags, ...jsonFlag },
    }),
  ],
});

/** Backpressure-aware stdout write — a large snapshot to a pipe must drain
 *  before we exit, or the tail is truncated. EPIPE (e.g. `pulam-tui status |
 *  head -1`) is treated as "done" rather than an error so we exit cleanly. */
function writeOut(text: string): Promise<void> {
  return new Promise((resolve) => {
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
  process.stderr.write(`pulam-tui: ${message}\n`);
  process.exit(1);
}

/** Dial a LOCAL pulam over its unix socket — an explicit `--socket`, else the
 *  default path. Fails loud with an actionable hint if nothing is listening. */
function connectLocal(socketOverride: string | undefined): Promise<Connection> {
  const socketPath = pulamSocketPath(socketOverride);
  return connectPulam(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no pulam at ${socketPath}${code ? ` (${code})` : ""} — is it running? Start it with \`pulam\` (it needs a running kaval).`,
    );
  });
}

/** Reach a REMOTE pulam over ssh (`--host`): provision the daemon with Nix and
 *  dial it. Fails loud with the underlying ssh/nix error so a misconfigured host
 *  (no passwordless ssh, the user not in the remote's `trusted-users`) reads as
 *  actionable rather than an opaque hang — the CLI surfaces the first failure
 *  instead of spinning on a reconnect loop. */
function connectHost(
  host: string,
  kavalSocket: string | undefined,
): Promise<Connection> {
  return connectPulamViaHost(host, kavalSocket).catch((err) =>
    fail(`could not reach pulam on ${host} — ${(err as Error).message}`),
  );
}

/** Resolve a user-typed id-or-prefix to a full terminal id against the live
 *  awareness snapshot, failing loudly on no-match or ambiguity — so `watch
 *  <id>` accepts the short id `status` prints (or any unique prefix) and a
 *  pasted full id round-trips. Matching is case-insensitive (UUIDs are lowercase
 *  hex). An empty query is rejected as a no-match rather than silently matching
 *  the sole terminal. */
function resolveOne(query: string, ids: TerminalId[]): TerminalId {
  const result = resolveTerminalId(query, ids);
  if (result.kind === "found") return result.id;
  if (result.kind === "none") {
    fail(
      `no terminal matching "${query}" — \`pulam-tui status\` shows the live ones.`,
    );
  }
  fail(
    `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
      .map(shortId)
      .join("\n  ")}`,
  );
}

/** Validate the endpoint flags shared by both commands and pick the transport.
 *  --host and --socket name two different daemons, so both is a usage error;
 *  --kaval only travels over the --host dial. */
function connect(flags: {
  host: string | undefined;
  socket: string | undefined;
  kaval: string | undefined;
}): Promise<Connection> {
  if (flags.host !== undefined && flags.socket !== undefined) {
    fail(
      "--host and --socket are mutually exclusive: --host reaches a remote pulam over ssh, --socket dials a local one. Pass just one.",
    );
  }
  if (flags.kaval !== undefined && flags.host === undefined) {
    fail(
      "--kaval only applies with --host (it picks which kaval the remote pulam dials). For a local pulam, point pulam itself at the kaval when you start it.",
    );
  }
  return flags.host !== undefined
    ? connectHost(flags.host, flags.kaval)
    : connectLocal(flags.socket);
}

async function cmdStatus(conn: Connection, json: boolean): Promise<void> {
  // Read the awareness collection, waiting for the daemon's sensors to resolve,
  // then release the link — a snapshot needs no live connection afterward (and a
  // remote daemon's forwarded stderr can't reach us once the link is gone). The
  // settle wait matters for `--host`, which provisions a FRESH ephemeral pulam:
  // a plain first-frame read would catch each terminal's unresolved seed and
  // render every row blank (see settledSnapshot).
  let entries: Awaited<ReturnType<typeof settledSnapshot>>;
  try {
    entries = await settledSnapshot(conn.client);
  } finally {
    conn.dispose();
  }
  await writeOut(
    json
      ? `${formatAwarenessJson(entries)}\n`
      : `${formatStatus(entries, { now: Date.now() })}\n`,
  );
}

async function cmdWatch(
  conn: Connection,
  query: string | undefined,
  json: boolean,
): Promise<void> {
  // Ctrl+C (and external kill) abort the mirror → its `.done` settles → we
  // dispose the link and exit cleanly. The link is held open until then.
  const abort = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => abort.abort());
  }
  // A closed stdout — `pulam-tui watch | head -1`, the reader hanging up —
  // surfaces as an stdout `error` (EPIPE). Without a handler that's an unhandled
  // crash; treat it as the consumer hanging up and abort the mirror so we unwind
  // and exit cleanly (the same "EPIPE is done, not an error" stance `writeOut`
  // takes for `status`). The abort marks this a clean stop, not the link drop the
  // un-aborted-settle check below treats as a failure.
  process.stdout.on("error", () => abort.abort());

  // Serialize the watch lines through the backpressure-aware `writeOut`: each
  // line waits for the prior `drain`, so a slow consumer (piping into a paging
  // `jq`) applies real backpressure instead of `write()`-returns-false being
  // ignored. The mirror's sink callbacks are synchronous, so they chain onto
  // `pending` and we flush it before returning. `writeOut` never rejects (it
  // resolves on an stdout error), so the chain can't reject.
  let pending: Promise<void> = Promise.resolve();
  const emit = (line: string): void => {
    pending = pending.then(() => writeOut(`${line}\n`));
  };

  // Diagnostic sink for NON-abort upstream failures (a dropped link, a protocol
  // error). Surface each to stderr AND remember the first, so an un-aborted
  // settle below can report what actually broke rather than a generic line.
  let upstreamError: string | undefined;
  const log = (line: string): void => {
    upstreamError ??= line;
    process.stderr.write(`pulam-tui: ${line}\n`);
  };

  // Narrow to one terminal? Resolve the prefix to a full id INSIDE the try so a
  // thrown read still disposes the link (like `cmdStatus`); then filter the live
  // stream to exactly it. A no-match / ambiguous prefix fails loud and exits.
  let only: TerminalId | undefined;
  try {
    if (query !== undefined) {
      const entries = await snapshotAwareness(conn.client);
      only = resolveOne(
        query,
        entries.map(([id]) => id),
      );
    }
    await watchAwareness(
      conn.client,
      {
        onUpsert: (id, value, live) => {
          if (only !== undefined && id !== only) return;
          emit(
            json
              ? formatWatchJson(id, value, { live })
              : formatWatchEvent(id, value, { now: Date.now(), live }),
          );
        },
        onRemove: (id) => {
          if (only !== undefined && id !== only) return;
          emit(
            json
              ? formatWatchRemovalJson(id)
              : formatWatchRemoval(id, { now: Date.now() }),
          );
        },
      },
      abort.signal,
      log,
    );
    await pending;
  } finally {
    conn.dispose();
  }

  // The mirror settled though the user never asked to stop (no Ctrl+C, no EPIPE
  // hang-up) — the pulam link dropped: the daemon exited, the socket closed, or a
  // stream/protocol error ended every subscription. For a live monitor that is a
  // failure, not a clean EOF, so surface it and exit non-zero rather than looking
  // like a tidy stop. (Ctrl+C and a consumer hang-up both abort, so they skip
  // this and exit 0.)
  if (!abort.signal.aborted) {
    fail(
      upstreamError ??
        "the pulam link closed — the daemon stopped or the connection dropped. Is `pulam` still running?",
    );
  }
}

async function main(): Promise<void> {
  // cleye already handled --help / --version. We land here with no command for
  // bare `pulam-tui` (show help) or the common trap of a flag BEFORE the
  // subcommand (`pulam-tui --host X status`) — cleye binds flags only after the
  // command, so a leading flag swallows it. Steer that case to the right order.
  if (argv.command === undefined) {
    if (process.argv.length > 2) {
      fail(
        "no command. Flags go AFTER the subcommand — try `pulam-tui status --host <ssh>` (not `pulam-tui --host <ssh> status`). `pulam-tui --help` lists the commands.",
      );
    }
    argv.showHelp();
    process.exit(1);
  }

  const conn = await connect({
    host: argv.flags.host,
    socket: argv.flags.socket,
    kaval: argv.flags.kaval,
  });
  // Confirm a wire-compatible workspace contract before reading — a skewed
  // daemon otherwise fails deep in oRPC with an opaque error. (Disposes the link
  // on mismatch via the catch below.)
  try {
    await assertCompatible(conn.client);
  } catch (err) {
    conn.dispose();
    fail((err as Error).message);
  }

  // `cmdStatus` disposes its own link (it snapshots then releases); `cmdWatch`
  // holds the link and disposes in its finally.
  if (argv.command === "status") {
    await cmdStatus(conn, argv.flags.json);
  } else if (argv.command === "watch") {
    await cmdWatch(conn, argv._.id, argv.flags.json);
  } else {
    conn.dispose();
    fail("unhandled command — add a dispatch branch for it");
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`pulam-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
