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
 *   pulam-tui wait <id> --until <state>  block until that terminal's agent
 *                                  reaches a bucket (working/awaiting/waiting),
 *                                  then exit — the done-signal for driving an
 *                                  agent that drives another agent
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
  awaitAgentState,
  settledSnapshot,
  snapshotAwareness,
  watchAwareness,
} from "./read.ts";
import {
  agentMatchesUntil,
  formatAwarenessJson,
  formatStatus,
  formatWaitMet,
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
      "reach a pulam on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. The remote pulam runs as the SSH user, so that user must own the kaval it dials (the socket dir is 0700, owner-only); SSH in as the user that runs kaval. The remote pulam dials the remote kaval and recomputes awareness from now. Mutually exclusive with --socket.",
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
      "A terminal-side client for the pulam awareness daemon — what every terminal is in (repo·branch · PR · agent · foreground), read from a running `pulam` (start it with `pulam`, which needs a running kaval). `status` snapshots it; `watch` follows it live; `wait` blocks until a terminal's agent reaches a state (working/awaiting/waiting), the done-signal for scripting an agent that drives another agent. `--json` is scriptable; `--host <ssh>` reads a remote machine over ssh. The browser fleet dashboard is `pulam-web`.",
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
    command({
      name: "wait",
      parameters: ["<id>"],
      help: {
        description:
          "Block until a terminal's agent reaches a state, then exit — the done-signal for scripting an agent that drives another agent. `--until` is a comma list of buckets: working, awaiting, waiting (`awaiting,waiting` = the agent's turn ended). `--timeout <ms>` caps the wait and fails loud. `--json` prints `{ id, agent }`. <id> is the short id from `status` or any unique prefix.",
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
            "milliseconds to wait before failing loud (default: wait indefinitely until the state, the link drops, or Ctrl+C)",
        },
        ...jsonFlag,
      },
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
    json ? `${formatAwarenessJson(entries)}\n` : `${formatStatus(entries)}\n`,
  );
}

/** An `AbortController` that fires on the process's stop signals — the shared
 *  "Ctrl+C / external kill unwinds the live mirror" wiring both `watch` and
 *  `wait` hold open a link with. */
function abortOnShutdownSignals(): AbortController {
  const abort = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => abort.abort());
  }
  return abort;
}

async function cmdWatch(
  conn: Connection,
  query: string | undefined,
  json: boolean,
): Promise<void> {
  // Ctrl+C (and external kill) abort the mirror → its `.done` settles → we
  // dispose the link and exit cleanly. The link is held open until then.
  const abort = abortOnShutdownSignals();
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

async function cmdWait(
  conn: Connection,
  query: string,
  targets: ReadonlySet<string>,
  opts: { json: boolean; timeoutMs?: number },
): Promise<void> {
  // Ctrl+C (and external kill) abort our controller, which `awaitAgentState`
  // chains into its internal one → the mirror settles → we dispose and exit.
  // `awaitAgentState` reads this signal to return `interrupted` vs `closed`, so
  // the outcome alone tells Ctrl+C from a real link drop — no re-derivation here.
  const abort = abortOnShutdownSignals();

  // Resolve the required <id> against the live snapshot, then block on the agent
  // state — both inside the try so a thrown read still disposes the link.
  let resolvedId: TerminalId;
  let outcome: Awaited<ReturnType<typeof awaitAgentState>>;
  try {
    const entries = await snapshotAwareness(conn.client);
    resolvedId = resolveOne(
      query,
      entries.map(([id]) => id),
    );
    outcome = await awaitAgentState(conn.client, {
      id: resolvedId,
      matches: (agent) => agentMatchesUntil(agent, targets),
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
    // Distinct exit code (2) so a driving script can tell a timeout — the agent
    // never settled — from a usage/link error (1).
    process.stderr.write(
      `pulam-tui: timed out after ${opts.timeoutMs}ms waiting for ${shortId(resolvedId)} to reach ${[...targets].join("/")}.\n`,
    );
    process.exit(2);
  }
  if (outcome.kind === "gone") {
    // The terminal exited before reaching the state — it can never get there now.
    // Distinct exit code (3) so a driver tells "the agent I was driving died" from
    // a timeout (2, still alive but stuck) or a link/usage error (1).
    process.stderr.write(
      `pulam-tui: ${shortId(resolvedId)} disappeared before reaching ${[...targets].join("/")} — its terminal exited.\n`,
    );
    process.exit(3);
  }
  if (outcome.kind === "interrupted") {
    // A user interrupt (Ctrl+C) exits cleanly with the conventional 130.
    process.stderr.write(
      `— interrupted; ${shortId(resolvedId)} left waiting\n`,
    );
    process.exit(130);
  }
  // closed: the pulam link dropped before the state landed — a failure, like
  // cmdWatch treats an un-aborted settle.
  fail(
    outcome.error ??
      "the pulam link closed — the daemon stopped or the connection dropped. Is `pulam` still running?",
  );
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

  // `wait`'s flag checks are pure — they need no daemon — so validate them
  // BEFORE the dial: a bad `--until`/`--timeout` fails fast with no connection to
  // tear down and, under --host, no Nix provisioning of a daemon we'd just drop.
  // `waitTargets` is non-null exactly when the command is `wait`; its parsed
  // targets flow straight into cmdWait below.
  let waitTargets: ReadonlySet<string> | null = null;
  if (argv.command === "wait") {
    if (argv.flags.until === undefined) {
      fail(
        "--until is required — e.g. `pulam-tui wait <id> --until awaiting,waiting`.",
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
  // and `cmdWait` hold the link and dispose in their finally. The wait branch
  // keys off `waitTargets` (set iff the command is `wait`), so the pre-parsed
  // targets narrow to a non-null set here.
  if (argv.command === "status") {
    await cmdStatus(conn, argv.flags.json);
  } else if (argv.command === "watch") {
    await cmdWatch(conn, argv._.id, argv.flags.json);
  } else if (waitTargets !== null) {
    await cmdWait(conn, argv._.id, waitTargets, {
      json: argv.flags.json,
      timeoutMs: argv.flags.timeout,
    });
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
