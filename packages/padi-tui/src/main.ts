/**
 * padi-tui — a terminal-side client for a running `padi` daemon. It dials padi's
 * digest-keyed unix socket (via the shared `@kolu/padi/dial` kit) and reads its
 * `padiSurface`: what each terminal *is in* (record state · repo·branch · PR ·
 * agent state · foreground) and, crucially, the precise agent-state DONE-SIGNAL
 * for driving an agent that drives another agent. It is the raw, non-interactive
 * sibling of kaval-tui — verbs, no canvas (kolu-tui at W4 is the interactive one).
 *
 *   padi-tui status [--json]                a one-shot snapshot of every terminal
 *   padi-tui watch [<id>] [--json]          follow live until Ctrl+C — every
 *                                           terminal, or one by id (short/prefix);
 *                                           the trailing ● marks live byte activity
 *   padi-tui wait <id> --until <buckets>    block until that terminal's agent
 *                                           reaches a bucket (working/awaiting/
 *                                           waiting), then exit — the done-signal
 *   padi-tui create [--parent <id>] [--worktree <branch>] [--repo <path>] [-- argv]
 *                                           spawn a terminal (a split tile with
 *                                           --parent, in a fresh worktree with
 *                                           --worktree), optionally launching an
 *                                           agent (`-- claude`); print its id
 *
 * Discovery (flags go AFTER the subcommand): with no flag, padi-tui honors
 * $PADI_SOCKET — stamped into every terminal padi spawns — so inside a kolu
 * terminal it "just works"; otherwise it autodiscovers the running padi. Point it
 * elsewhere with --socket <path> or --state-root <dir> (dev/e2e). (A REMOTE padi
 * over ssh is W3; today padi-tui is local-only.)
 */

import { resolveRunningPadiSocket } from "@kolu/padi/dial";
import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import {
  connectPadiTui,
  type Connection,
  type PadiTuiClient,
} from "./connect.ts";
import { cli, command } from "cleye";
import { runCreate } from "./create.ts";
import {
  awaitAgentState,
  readTerminalKeys,
  settledSnapshot,
  watchTerminals,
} from "./read.ts";
import {
  formatStatus,
  formatStatusJson,
  formatWaitMet,
  formatWatchActivity,
  formatWatchActivityJson,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
  parseUntilStates,
  resolveTerminalId,
  shortId,
} from "./render.ts";

// Declared on each subcommand — cleye binds flags only AFTER the subcommand (it
// does not inherit a parent flag), so `--socket` goes after the command:
// `padi-tui status --socket <path>`, never `padi-tui --socket <path> status`.
const endpointFlags = {
  socket: {
    type: String,
    description:
      "the padi socket to dial — goes AFTER the subcommand. Usually unneeded: inside a kolu terminal $PADI_SOCKET already names the padi that owns it, and otherwise padi-tui autodiscovers the running daemon. Pass --socket only to pick one explicitly (padi keys its socket by a DIGEST of its state-root, so there is no single fixed path).",
  },
  stateRoot: {
    type: String,
    description:
      "the padi STATE-ROOT to target (dev/e2e) — padi-tui derives the same digest→socket path padi computes for itself. Mutually exclusive with --socket; goes AFTER the subcommand.",
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
  name: "padi-tui",
  version: PADI_SURFACE_VERSION,
  help: {
    description:
      "A terminal-side client for the padi workspace daemon — what every terminal is in (record state · repo·branch · PR · agent · foreground), read from a running `padi`. `status` snapshots it; `watch` follows it live (● = live byte activity); `wait` blocks until a terminal's agent reaches a state (working/awaiting/waiting) — the done-signal for scripting an agent that drives another agent; `create` spawns a terminal, split tile, or worktree'd agent. `--json` is scriptable.",
  },
  commands: [
    command({
      name: "status",
      help: {
        description:
          "Snapshot every terminal — one row (state · repo·branch · PR · agent · foreground), then exit.",
      },
      flags: { ...endpointFlags, ...jsonFlag },
    }),
    command({
      name: "watch",
      parameters: ["[id]"],
      help: {
        description:
          "Follow the terminals collection live, printing a line per change until Ctrl+C; a trailing ● marks a terminal moving bytes right now. Bare `watch` follows every terminal; pass an id (short id from `status` or a unique prefix) to narrow to one.",
      },
      flags: { ...endpointFlags, ...jsonFlag },
    }),
    command({
      name: "wait",
      parameters: ["<id>"],
      help: {
        description:
          "Block until a terminal's agent reaches a state, then exit — the done-signal for scripting an agent that drives another agent. `--until` is a comma list of buckets: working, awaiting, waiting (`awaiting,waiting` = the agent's turn ended). Because the mirror replays the current state on connect, the two-phase `wait --until working` THEN `wait --until awaiting,waiting` loop is robust against the stale-state race. `--timeout <ms>` caps the wait and fails loud (exit 2); a terminal that exits first fails loud too (exit 3). `--json` prints `{ id, agent }`. <id> is the short id from `status` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        until: {
          type: String,
          description:
            "comma list of agent buckets to wait for: working, awaiting, waiting (awaiting,waiting = the agent's turn ended)",
        },
        timeout: {
          type: Number,
          description:
            "milliseconds to wait before failing loud (exit 2); default: wait indefinitely until the state, the terminal exits, the link drops, or Ctrl+C",
        },
        ...jsonFlag,
      },
    }),
    command({
      name: "create",
      parameters: ["[command...]"],
      help: {
        description:
          "Spawn a terminal on the host and print its id; padi owns it and it appears on the canvas. `--parent <id>` makes it a split tile of another terminal; `--worktree <branch>` creates a fresh git worktree (off `--repo`, default the cwd) and opens the terminal there; anything after `--` is run in the new terminal — e.g. `padi-tui create --worktree feat -- claude` spawns a worktree'd Claude Code in one command.",
      },
      flags: {
        ...endpointFlags,
        parent: {
          type: String,
          description:
            "make the new terminal a SPLIT TILE of this terminal (a short id from `status` or a unique prefix)",
        },
        worktree: {
          type: String,
          description:
            "create a fresh git worktree on this branch name and open the terminal in it (a worktree'd agent in one command)",
        },
        repo: {
          type: String,
          description:
            "with --worktree: the repo to branch from (an absolute path on the host). Default: the current directory.",
        },
        ...jsonFlag,
      },
    }),
  ],
});

/** Backpressure-aware stdout write — a large snapshot to a pipe must drain before
 *  we exit, or the tail is truncated. EPIPE (e.g. `padi-tui status | head -1`) is
 *  treated as "done" rather than an error so we exit cleanly. */
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
  process.stderr.write(`padi-tui: ${message}\n`);
  process.exit(1);
}

/** The socket to dial. The selection policy (`--socket` wins; else `--state-root`;
 *  else $PADI_SOCKET; else discover) plus the candidate labels live in the shared
 *  `resolveRunningPadiSocket` (the dial kit), so here padi-tui only renders the
 *  `many` ambiguity as its own pick-one `fail()`. */
function resolveSocketPath(flags: {
  socket: string | undefined;
  stateRoot: string | undefined;
}): string {
  if (flags.socket !== undefined && flags.stateRoot !== undefined) {
    fail(
      "--socket and --state-root are mutually exclusive: --socket is a literal socket path, --state-root derives one. Pass just one.",
    );
  }
  const resolved = resolveRunningPadiSocket({
    socket: flags.socket,
    stateRoot: flags.stateRoot,
  });
  if (resolved.kind === "many") {
    fail(
      `more than one padi daemon is running:\n  ${resolved.candidates
        .map((d) => `${d.socket}    (${d.stateRoot ?? "unknown state-root"})`)
        .join(
          "\n  ",
        )}\nPass --socket <path> or --state-root <dir> to pick one.`,
    );
  }
  return resolved.socket;
}

/** Dial a LOCAL padi at an already-resolved socket path. `connectPadiTui` runs the
 *  control-core handshake + compatibility gate, so a skew or an unreachable socket
 *  fails loud here with an actionable hint rather than deep inside oRPC. */
function connectLocal(socketPath: string): Promise<Connection> {
  return connectPadiTui(socketPath).catch((err) =>
    fail(
      `could not reach padi at ${socketPath} — ${(err as Error).message}. Is padi running? Inside a kolu terminal $PADI_SOCKET names it; otherwise pass --socket <path> or --state-root <dir>.`,
    ),
  );
}

/** Resolve a user-typed id-or-prefix to a full terminal id against the live
 *  terminals, failing loudly on no-match or ambiguity — so `<id>` accepts the
 *  short id `status` prints (or any unique prefix) and a pasted full id
 *  round-trips. */
function resolveOne(query: string, ids: TerminalId[]): TerminalId {
  const result = resolveTerminalId(query, ids);
  if (result.kind === "found") return result.id;
  if (result.kind === "none") {
    fail(
      `no terminal matching "${query}" — \`padi-tui status\` shows the live ones.`,
    );
  }
  fail(
    `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
      .map(shortId)
      .join("\n  ")}`,
  );
}

/** Snapshot the live terminals and resolve a user-typed id-or-prefix to a full id
 *  — the snapshot+map+resolveOne dance `watch`, `wait`, and `create --parent`
 *  share. `resolveOne` (and `fail`) stay in this CLI layer, so `read.ts` remains
 *  `process.exit`-free. */
async function resolveArg(
  client: PadiTuiClient,
  query: string,
): Promise<TerminalId> {
  return resolveOne(query, await readTerminalKeys(client));
}

/** An `AbortController` that fires on the process's stop signals — the shared
 *  "Ctrl+C / external kill unwinds the live mirror" wiring `watch` and `wait`
 *  hold open a link with. */
function abortOnShutdownSignals(): AbortController {
  const abort = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => abort.abort());
  }
  return abort;
}

async function cmdStatus(conn: Connection, json: boolean): Promise<void> {
  // Read the terminals collection, waiting for padi's sensors to resolve, then
  // release the link — a snapshot needs no live connection afterward. The settle
  // wait matters for a just-spawned terminal mid-sensor-resolution; against a warm
  // padi it settles at once (see settledSnapshot).
  let entries: Awaited<ReturnType<typeof settledSnapshot>>;
  try {
    entries = await settledSnapshot(conn.client);
  } finally {
    conn.dispose();
  }
  await writeOut(
    json ? `${formatStatusJson(entries)}\n` : `${formatStatus(entries)}\n`,
  );
}

async function cmdWatch(
  conn: Connection,
  query: string | undefined,
  json: boolean,
): Promise<void> {
  const abort = abortOnShutdownSignals();
  // A closed stdout (`padi-tui watch | head -1`) surfaces as an stdout error
  // (EPIPE) — treat it as the consumer hanging up and abort the mirror so we
  // unwind and exit cleanly. The abort marks this a clean stop, not the link drop
  // the un-aborted-settle check below treats as a failure.
  process.stdout.on("error", () => abort.abort());

  // Serialize the watch lines through the backpressure-aware `writeOut` so a slow
  // consumer applies real backpressure. The mirror's sink callbacks are sync, so
  // they chain onto `pending` and we flush it before returning.
  let pending: Promise<void> = Promise.resolve();
  const emit = (line: string): void => {
    pending = pending.then(() => writeOut(`${line}\n`));
  };

  let upstreamError: string | undefined;
  const log = (line: string): void => {
    upstreamError ??= line;
    process.stderr.write(`padi-tui: ${line}\n`);
  };

  let only: TerminalId | undefined;
  try {
    if (query !== undefined) {
      only = await resolveArg(conn.client, query);
    }
    await watchTerminals(
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
        onActivity: (id, live) => {
          if (only !== undefined && id !== only) return;
          emit(
            json
              ? formatWatchActivityJson(id, live)
              : formatWatchActivity(id, live, { now: Date.now() }),
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

  // The mirror settled though the user never asked to stop — the padi link
  // dropped. For a live monitor that is a failure, not a clean EOF. (Ctrl+C and a
  // consumer hang-up both abort, so they skip this and exit 0.)
  if (!abort.signal.aborted) {
    fail(
      upstreamError ??
        "the padi link closed — the daemon stopped or the connection dropped. Is `padi` still running?",
    );
  }
}

async function cmdWait(
  conn: Connection,
  query: string,
  targets: ReadonlySet<string>,
  opts: { json: boolean; timeoutMs?: number },
): Promise<void> {
  const abort = abortOnShutdownSignals();

  let resolvedId: TerminalId;
  let outcome: Awaited<ReturnType<typeof awaitAgentState>>;
  try {
    resolvedId = await resolveArg(conn.client, query);
    outcome = await awaitAgentState(conn.client, {
      id: resolvedId,
      targets,
      timeoutMs: opts.timeoutMs,
      signal: abort.signal,
    });
  } finally {
    conn.dispose();
  }

  if (outcome.kind === "met") {
    if (opts.json) {
      await writeOut(
        `${JSON.stringify({ id: resolvedId, agent: outcome.agent }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`— ${formatWaitMet(resolvedId, outcome.agent)}\n`);
    }
    return;
  }
  if (outcome.kind === "timeout") {
    // Distinct exit code (2): a timeout — the agent never settled — vs a
    // usage/link error (1).
    process.stderr.write(
      `padi-tui: timed out after ${opts.timeoutMs}ms waiting for ${shortId(resolvedId)} to reach ${[...targets].join("/")}.\n`,
    );
    process.exit(2);
  }
  if (outcome.kind === "gone") {
    // The terminal exited before reaching the state — distinct exit code (3) so a
    // driver tells "the agent I was driving died" from a timeout (2) or error (1).
    process.stderr.write(
      `padi-tui: ${shortId(resolvedId)} disappeared before reaching ${[...targets].join("/")} — its terminal exited.\n`,
    );
    process.exit(3);
  }
  if (outcome.kind === "interrupted") {
    process.stderr.write(
      `— interrupted; ${shortId(resolvedId)} left waiting\n`,
    );
    process.exit(130);
  }
  // closed: the padi link dropped before the state landed — a failure.
  fail(
    outcome.error ??
      "the padi link closed — the daemon stopped or the connection dropped. Is `padi` still running?",
  );
}

async function cmdCreate(
  conn: Connection,
  flags: {
    parent: string | undefined;
    worktree: string | undefined;
    repo: string | undefined;
    json: boolean;
  },
  command: readonly string[],
): Promise<void> {
  // Resolve --parent prefix against the live terminals (a short id or prefix).
  let parentId: TerminalId | undefined;
  if (flags.parent !== undefined) {
    parentId = await resolveArg(conn.client, flags.parent);
  }
  const worktree =
    flags.worktree !== undefined
      ? { repoPath: flags.repo ?? process.cwd(), name: flags.worktree }
      : undefined;

  const result = await runCreate(conn.client, {
    parentId,
    worktree,
    // A plain create opens where you are (the tmux convention); --worktree
    // overrides this with the worktree path inside runCreate.
    cwd: process.cwd(),
    argv: command,
  });

  if (flags.json) {
    await writeOut(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  // stdout is just the id (scriptable — `id=$(padi-tui create)`); the rest to stderr.
  await writeOut(`${result.id}\n`);
  const bits = [`— created ${shortId(result.id)}`];
  if (parentId !== undefined) bits.push(`split of ${shortId(parentId)}`);
  if (result.worktree !== undefined) {
    bits.push(`worktree ${result.worktree.branch} at ${result.worktree.path}`);
  }
  if (result.ran !== undefined) bits.push(`running \`${result.ran}\``);
  process.stderr.write(`${bits.join(" · ")}\n`);
}

async function main(): Promise<void> {
  // cleye already handled --help / --version. We land here with no command for
  // bare `padi-tui` (show help) or the common trap of a flag BEFORE the subcommand
  // (`padi-tui --socket X status`) — cleye binds flags only after the command, so
  // a leading flag swallows it. Steer that case to the right order.
  if (argv.command === undefined) {
    if (process.argv.length > 2) {
      fail(
        "no command. Flags go AFTER the subcommand — try `padi-tui status --socket <path>` (not `padi-tui --socket <path> status`). `padi-tui --help` lists the commands.",
      );
    }
    argv.showHelp();
    process.exit(1);
  }

  // `wait`'s flag checks are pure — validate them BEFORE the dial so a bad
  // `--until`/`--timeout` fails fast with no connection to tear down. `waitTargets`
  // is non-null exactly when the command is `wait`; its parsed targets flow
  // straight into cmdWait below.
  let waitTargets: ReadonlySet<string> | null = null;
  if (argv.command === "wait") {
    if (argv.flags.until === undefined) {
      fail(
        "--until is required — e.g. `padi-tui wait <id> --until awaiting,waiting`.",
      );
    }
    const parsed = parseUntilStates(argv.flags.until);
    if (parsed.kind === "error") fail(parsed.message);
    if (
      argv.flags.timeout !== undefined &&
      !(Number.isFinite(argv.flags.timeout) && argv.flags.timeout > 0)
    ) {
      fail("--timeout must be a positive number of milliseconds.");
    }
    waitTargets = parsed.targets;
  }

  const socketPath = resolveSocketPath({
    socket: argv.flags.socket,
    stateRoot: argv.flags.stateRoot,
  });
  const conn = await connectLocal(socketPath);

  // Narrow on `argv.command` so cleye's per-command flag/positional union collapses
  // to the one shape (only `wait` carries `--until`/`--timeout`, only `create` the
  // worktree flags). `cmdStatus` disposes its own link (snapshots then releases);
  // `cmdWatch`/`cmdWait`/`cmdCreate` dispose in their own flow / finally.
  if (argv.command === "status") {
    await cmdStatus(conn, argv.flags.json);
  } else if (argv.command === "watch") {
    await cmdWatch(conn, argv._.id, argv.flags.json);
  } else if (argv.command === "wait") {
    // `waitTargets` was parsed + validated in the pre-dial block above (the command
    // is `wait`), so it is non-null here; the guard keeps TS honest without a cast.
    if (waitTargets === null) fail("--until is required.");
    await cmdWait(conn, argv._.id, waitTargets, {
      json: argv.flags.json,
      timeoutMs: argv.flags.timeout,
    });
  } else if (argv.command === "create") {
    try {
      await cmdCreate(
        conn,
        {
          parent: argv.flags.parent,
          worktree: argv.flags.worktree,
          repo: argv.flags.repo,
          json: argv.flags.json,
        },
        argv._.command,
      );
    } finally {
      conn.dispose();
    }
  } else {
    conn.dispose();
    fail("unhandled command — add a dispatch branch for it");
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`padi-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
