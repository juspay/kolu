import { NodeSink } from "@effect/platform-node";
import { readTerminalKeys, settledSnapshot } from "@kolu/padi/read";
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
  shortId,
} from "@kolu/padi/render";
import { resolveTerminalId } from "@kolu/padi-client/terminalId";
import {
  PADI_SURFACE_VERSION,
  type TerminalPlacement,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import {
  isWaitState,
  WAIT_STATES,
  type WaitState,
} from "@kolu/padi-client/terminalVocab";
import { awaitAgentState, watchTerminals } from "@kolu/padi-client/watch";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { cli, command } from "cleye";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  type Scope,
  type Sink,
  Stream,
} from "effect";
import { connectPadiTui, type PadiTuiClient } from "./connect.ts";
import { directoryOf, placementGate, runCreate } from "./create.ts";
import {
  CliFailure,
  exitCodeOf,
  failure,
  reportOf,
  WaitInterrupted,
  WaitTerminalGone,
  WaitTimedOut,
} from "./exit.ts";
import { connectPadiTuiViaHost } from "./hostConnect.ts";
import { resolveSocketPath } from "./socketTarget.ts";

function parseUntilStates(
  raw: string,
):
  | { kind: "ok"; targets: Set<WaitState> }
  | { kind: "error"; message: string } {
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const unknown = tokens.filter((t) => !isWaitState(t));
  if (tokens.length === 0 || unknown.length > 0) {
    const offending = unknown.length > 0 ? unknown.join(", ") : "(none given)";
    return {
      kind: "error",
      message: `--until: unknown state(s) ${offending} — use a comma list of: ${WAIT_STATES.join(", ")} (e.g. --until awaiting,waiting).`,
    };
  }
  return { kind: "ok", targets: new Set(tokens as WaitState[]) };
}

function waitFlags(flags: {
  until: string | undefined;
  timeout: number | undefined;
}): Effect.Effect<
  { targets: ReadonlySet<WaitState>; timeoutMs: number | undefined },
  CliFailure
> {
  if (flags.until === undefined) {
    return Effect.fail(
      failure(
        "--until is required — e.g. `padi-tui wait <id> --until awaiting,waiting`.",
      ),
    );
  }
  const parsed = parseUntilStates(flags.until);
  if (parsed.kind === "error") return Effect.fail(failure(parsed.message));
  if (
    flags.timeout !== undefined &&
    !(Number.isFinite(flags.timeout) && flags.timeout > 0)
  ) {
    return Effect.fail(
      failure("--timeout must be a positive number of milliseconds."),
    );
  }
  return Effect.succeed({ targets: parsed.targets, timeoutMs: flags.timeout });
}

function subcommandFlags<Extra extends object>(extra: Extra) {
  return {
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
    host: {
      type: String,
      description:
        "reach a padi on a REMOTE machine over ssh, provisioning it via Nix — e.g. --host nix@prod. padi runs as the SSH user, so you reach the padi owned by that user (its socket dir is 0700, owner-only); SSH in as the user that runs padi. Read verbs (status/watch/wait) are safe; `create` lands a REAL terminal on the host (that's the point), and it survives the link. Mutually exclusive with --socket / --state-root. Goes AFTER the subcommand.",
    },
    json: {
      type: Boolean,
      description: "machine-readable JSON output",
      default: false,
    },
    ...extra,
  };
}

function parseArgv() {
  return cli({
    name: "padi-tui",
    version: PADI_SURFACE_VERSION,
    help: {
      description:
        "A terminal-side client for the padi workspace daemon — what every terminal is in (record state · repo·branch · PR · agent · foreground), read from a running `padi`. `status` snapshots it; `watch` follows it live (● = live byte activity); `wait` blocks until a terminal's agent reaches a state (working/awaiting/waiting) — the done-signal for scripting an agent that drives another agent; `create` spawns a terminal, split tile, or worktree'd agent. Runs against the local padi by default, or a REMOTE one over ssh with `--host <ssh>` (provisioned with Nix). `--json` is scriptable.",
    },
    commands: [
      command({
        name: "status",
        help: {
          description:
            "Snapshot every terminal — one row (state · repo·branch · PR · agent · foreground), then exit.",
        },
        flags: subcommandFlags({}),
      }),
      command({
        name: "watch",
        parameters: ["[id]"],
        help: {
          description:
            "Follow the terminals collection live, printing a line per change until Ctrl+C; a trailing ● marks a terminal moving bytes right now. Bare `watch` follows every terminal; pass an id (short id from `status` or a unique prefix) to narrow to one.",
        },
        flags: subcommandFlags({}),
      }),
      command({
        name: "wait",
        parameters: ["<id>"],
        help: {
          description:
            "Block until a terminal's agent reaches a state, then exit — the done-signal for scripting an agent that drives another agent. `--until` is a comma list of buckets: working, awaiting, waiting (`awaiting,waiting` = the agent's turn ended). Because the mirror replays the current state on connect, the two-phase `wait --until working` THEN `wait --until awaiting,waiting` loop is robust against the stale-state race. `--timeout <ms>` caps the wait and fails loud (exit 2); a terminal that exits first fails loud too (exit 3). `--json` prints `{ id, agent }`. <id> is the short id from `status` or any unique prefix.",
        },
        flags: subcommandFlags({
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
        }),
      }),
      command({
        name: "create",
        parameters: ["[command...]"],
        help: {
          description:
            "Spawn a terminal on the host and print its id; padi owns it and it appears on the canvas. Placement is REQUIRED — pass exactly one of `--toplevel` (a tile of its own) or `--parent <id>` (a split inside that terminal); there is no default. `--worktree <branch>` creates a fresh git worktree (off `--repo`, default the cwd) and opens the terminal there; anything after `--` is run in the new terminal — e.g. `padi-tui create --toplevel --worktree feat -- claude` spawns a worktree'd Claude Code in one command.",
        },
        flags: subcommandFlags({
          toplevel: {
            type: Boolean,
            description:
              "open the new terminal as a TILE OF ITS OWN on the canvas (mutually exclusive with --parent)",
            default: false,
          },
          parent: {
            type: String,
            description:
              "make the new terminal a SPLIT TILE of this terminal (a short id from `status` or a unique prefix); mutually exclusive with --toplevel",
          },
          worktree: {
            type: String,
            description:
              "create a fresh git worktree on this branch name and open the terminal in it (a worktree'd agent in one command)",
          },
          repo: {
            type: String,
            description:
              "with --worktree: the repo to branch from (an absolute path on the padi's machine). Default (local padi): the current directory. Over --host it must be given explicitly — the worktree is cut on the REMOTE host, so it can't default to your local directory.",
          },
        }),
      }),
    ],
  });
}

class StdoutClosed extends Data.TaggedError("StdoutClosed")<{
  readonly cause: unknown;
}> {}

const stdoutSink: Sink.Sink<void, string, never, StdoutClosed> =
  NodeSink.fromWritable<StdoutClosed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutClosed({ cause }),
    endOnDone: false,
  });

const writeOut = (text: string): Effect.Effect<void, StdoutClosed> =>
  Stream.run(Stream.make(text), stdoutSink);

const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  onClosed: () => void,
): Effect.Effect<void> =>
  Stream.run(Stream.fromQueue(lines), stdoutSink).pipe(
    Effect.catchTag("StdoutClosed", () => Effect.sync(onClosed)),
  );

const writeErr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

interface ShutdownRequest {
  readonly signal: AbortSignal;
  readonly requested: Deferred.Deferred<void>;
  readonly request: () => void;
}

const shutdownRequest: Effect.Effect<ShutdownRequest, never, Scope.Scope> =
  Effect.acquireRelease(
    Effect.sync(() => {
      const abort = new AbortController();
      const requested = Deferred.makeUnsafe<void>();
      const request = (): void => {
        abort.abort();
        Deferred.doneUnsafe(requested, Effect.void);
      };
      const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
      for (const sig of signals) process.on(sig, request);
      return {
        value: { signal: abort.signal, requested, request } as ShutdownRequest,
        off: () => {
          for (const sig of signals) process.off(sig, request);
        },
      };
    }),
    ({ off }) => Effect.sync(off),
  ).pipe(Effect.map(({ value }) => value));

type Endpoint =
  | { kind: "host"; host: string }
  | { kind: "local"; socketPath: string };

function resolveEndpoint(flags: {
  host: string | undefined;
  socket: string | undefined;
  stateRoot: string | undefined;
}): Effect.Effect<Endpoint, CliFailure> {
  if (flags.host !== undefined) {
    if (flags.socket !== undefined || flags.stateRoot !== undefined) {
      return Effect.fail(
        failure(
          "--host is mutually exclusive with --socket / --state-root: --host reaches a REMOTE padi over ssh, --socket / --state-root name a LOCAL one. Pass just one.",
        ),
      );
    }
    return Effect.succeed({ kind: "host", host: flags.host });
  }
  return Effect.map(resolveSocketPath(flags), (socketPath) => ({
    kind: "local",
    socketPath,
  }));
}

function connectTo(
  endpoint: Endpoint,
): Effect.Effect<PadiTuiClient, CliFailure, Scope.Scope> {
  const message = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);
  return endpoint.kind === "host"
    ? Effect.catch(connectPadiTuiViaHost(endpoint.host), (err) =>
        Effect.fail(
          failure(`could not reach padi on ${endpoint.host} — ${message(err)}`),
        ),
      )
    : Effect.catch(connectPadiTui(endpoint.socketPath), (err) =>
        Effect.fail(
          failure(
            `could not reach padi at ${endpoint.socketPath} — ${message(err)}. Is padi running? Inside a kolu terminal $PADI_SOCKET names it; otherwise pass --socket <path> or --state-root <dir>.`,
          ),
        ),
      );
}

function resolveOne(
  query: string,
  ids: readonly TerminalId[],
): Effect.Effect<TerminalId, CliFailure> {
  const result = resolveTerminalId(query, ids);
  if (result.kind === "found") return Effect.succeed(result.id);
  if (result.kind === "none") {
    return Effect.fail(
      failure(
        `no terminal matching "${query}" — \`padi-tui status\` shows the live ones.`,
      ),
    );
  }
  return Effect.fail(
    failure(
      `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
        .map(shortId)
        .join("\n  ")}`,
    ),
  );
}

function resolveArg(
  client: PadiTuiClient,
  query: string,
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(client), (ids) =>
    resolveOne(query, ids),
  );
}

function cmdStatus(
  endpoint: Endpoint,
  json: boolean,
): Effect.Effect<void, unknown> {
  return Effect.flatMap(
    Effect.scoped(
      Effect.flatMap(connectTo(endpoint), (client) => settledSnapshot(client)),
    ),
    (entries) =>
      writeOut(
        json ? `${formatStatusJson(entries)}\n` : `${formatStatus(entries)}\n`,
      ),
  );
}

function cmdWatch(
  endpoint: Endpoint,
  query: string | undefined,
  json: boolean,
): Effect.Effect<void, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* shutdownRequest;
      const client = yield* connectTo(endpoint);
      const only =
        query === undefined ? undefined : yield* resolveArg(client, query);

      const lines = yield* Queue.unbounded<string, Cause.Done>();
      const emit = (line: string): void => {
        Queue.offerUnsafe(lines, line);
      };
      let upstreamError: string | undefined;

      const pump = yield* Effect.forkChild(
        pumpToStdout(lines, () => shutdown.request()),
      );

      const watching = Effect.tryPromise({
        try: () =>
          watchTerminals(client, {
            handlers: {
              onUpsert: (id, value, live) => {
                if (only !== undefined && id !== only) return;
                emit(
                  json
                    ? `${formatWatchJson(id, value, { live })}\n`
                    : `${formatWatchEvent(id, value, { now: Date.now(), live })}\n`,
                );
              },
              onRemove: (id) => {
                if (only !== undefined && id !== only) return;
                emit(
                  json
                    ? `${formatWatchRemovalJson(id)}\n`
                    : `${formatWatchRemoval(id, { now: Date.now() })}\n`,
                );
              },
              onActivity: (id, live) => {
                if (only !== undefined && id !== only) return;
                emit(
                  json
                    ? `${formatWatchActivityJson(id, live)}\n`
                    : `${formatWatchActivity(id, live, { now: Date.now() })}\n`,
                );
              },
            },
            signal: shutdown.signal,
            log: (line) => {
              upstreamError ??= line;
              process.stderr.write(`padi-tui: ${line}\n`);
            },
          }),
        catch: (err) => err,
      });

      const ending = yield* Effect.raceAll<Effect.Effect<"stopped" | "closed">>(
        [
          Effect.as(Deferred.await(shutdown.requested), "stopped"),
          Effect.as(
            Effect.catch(watching, (err) =>
              Effect.sync(() => {
                upstreamError ??=
                  err instanceof Error ? err.message : String(err);
              }),
            ),
            "closed",
          ),
        ],
      );

      shutdown.request();
      yield* Queue.end(lines);
      yield* Fiber.join(pump);

      if (ending === "closed") {
        return yield* Effect.fail(
          failure(
            upstreamError ??
              "the padi link closed — the daemon stopped or the connection dropped. Is `padi` still running?",
          ),
        );
      }
    }),
  );
}

function cmdWait(
  endpoint: Endpoint,
  query: string,
  targets: ReadonlySet<string>,
  opts: { json: boolean; timeoutMs?: number },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { resolvedId, outcome } = yield* Effect.scoped(
      Effect.gen(function* () {
        const shutdown = yield* shutdownRequest;
        const client = yield* connectTo(endpoint);
        const resolvedId = yield* resolveArg(client, query);
        const outcome = yield* Effect.tryPromise({
          try: () =>
            awaitAgentState(client, {
              id: resolvedId,
              targets,
              timeoutMs: opts.timeoutMs,
              signal: shutdown.signal,
            }),
          catch: (err) => err,
        });
        return { resolvedId, outcome };
      }),
    );

    if (outcome.kind === "met") {
      return yield* opts.json
        ? writeOut(
            `${JSON.stringify({ id: resolvedId, agent: outcome.agent }, null, 2)}\n`,
          )
        : writeErr(`— ${formatWaitMet(resolvedId, outcome.agent)}\n`);
    }
    if (outcome.kind === "timeout") {
      return yield* Effect.fail(
        new WaitTimedOut({
          stderr: `padi-tui: timed out after ${opts.timeoutMs}ms waiting for ${shortId(resolvedId)} to reach ${[...targets].join("/")}.\n`,
        }),
      );
    }
    if (outcome.kind === "gone") {
      return yield* Effect.fail(
        new WaitTerminalGone({
          stderr: `padi-tui: ${shortId(resolvedId)} disappeared before reaching ${[...targets].join("/")} — its terminal exited.\n`,
        }),
      );
    }
    if (outcome.kind === "interrupted") {
      return yield* Effect.fail(
        new WaitInterrupted({
          stderr: `— interrupted; ${shortId(resolvedId)} left waiting\n`,
        }),
      );
    }
    return yield* Effect.fail(
      failure(
        outcome.error ??
          "the padi link closed — the daemon stopped or the connection dropped. Is `padi` still running?",
      ),
    );
  });
}

function cmdCreate(
  endpoint: Endpoint,
  flags: {
    toplevel: boolean;
    parent: string | undefined;
    worktree: string | undefined;
    repo: string | undefined;
    json: boolean;
  },
  command: readonly string[],
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const stated = yield* placementGate(flags);
    const directory = yield* directoryOf(
      endpoint.kind === "host"
        ? { kind: "remote" }
        : { kind: "local", cwd: process.cwd() },
      flags,
    );

    const created = yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connectTo(endpoint);
        const placement: TerminalPlacement =
          stated.kind === "toplevel"
            ? TOPLEVEL_PLACEMENT
            : {
                kind: "child-of",
                parentId: yield* resolveArg(client, stated.parentQuery),
              };

        const result = yield* runCreate(client, {
          placement,
          directory,
          argv: command,
        });
        return { result, placement };
      }),
    );

    const { result, placement } = created;
    if (flags.json) {
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    yield* writeOut(`${result.id}\n`);
    const bits = [`— created ${shortId(result.id)}`];
    bits.push(
      placement.kind === "child-of"
        ? `split of ${shortId(placement.parentId)}`
        : "top-level",
    );
    if (result.worktree !== undefined) {
      bits.push(
        `worktree ${result.worktree.branch} at ${result.worktree.path}`,
      );
    }
    if (result.ran !== undefined) bits.push(`running \`${result.ran}\``);
    yield* writeErr(`${bits.join(" · ")}\n`);
  });
}

type Argv = ReturnType<typeof parseArgv>;

function program(argv: Argv): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    if (argv.command === undefined) {
      if (process.argv.length > 2) {
        return yield* Effect.fail(
          failure(
            "no command. Flags go AFTER the subcommand — try `padi-tui status --socket <path>` (not `padi-tui --socket <path> status`). `padi-tui --help` lists the commands.",
          ),
        );
      }
      argv.showHelp();
      return yield* Effect.fail(new CliFailure({ stderr: "" }));
    }

    if (argv.command === "status") {
      const endpoint = yield* resolveEndpoint(argv.flags);
      return yield* cmdStatus(endpoint, argv.flags.json);
    }
    if (argv.command === "watch") {
      const endpoint = yield* resolveEndpoint(argv.flags);
      return yield* cmdWatch(endpoint, argv._.id, argv.flags.json);
    }
    if (argv.command === "wait") {
      const { targets, timeoutMs } = yield* waitFlags(argv.flags);
      const endpoint = yield* resolveEndpoint(argv.flags);
      return yield* cmdWait(endpoint, argv._.id, targets, {
        json: argv.flags.json,
        timeoutMs,
      });
    }
    const endpoint = yield* resolveEndpoint(argv.flags);
    return yield* cmdCreate(
      endpoint,
      {
        toplevel: argv.flags.toplevel,
        parent: argv.flags.parent,
        worktree: argv.flags.worktree,
        repo: argv.flags.repo,
        json: argv.flags.json,
      },
      argv._.command,
    );
  });
}

function main(): void {
  Effect.runPromiseExit(program(parseArgv())).then((exit) => {
    if (Exit.isSuccess(exit)) process.exit(0);
    const error = Cause.squash(exit.cause);
    process.stderr.write(reportOf(error));
    process.exit(exitCodeOf(error));
  });
}

if (import.meta.main) main();
