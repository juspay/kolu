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
 *   padi-tui create (--toplevel | --parent <id>) [--worktree <branch>]
 *                   [--repo <path>] [-- argv]
 *                                           spawn a terminal — placement is
 *                                           REQUIRED (a tile of its own, or a
 *                                           split of --parent; no default), in a
 *                                           fresh worktree with --worktree,
 *                                           optionally launching an agent
 *                                           (`-- claude`); print its id
 *
 * Discovery (flags go AFTER the subcommand): with no flag, padi-tui honors
 * $PADI_SOCKET — stamped into every terminal padi spawns — so inside a kolu
 * terminal it "just works"; otherwise it autodiscovers the running padi. Point it
 * at a different LOCAL daemon with --socket <path> or --state-root <dir> (dev/e2e),
 * or at a REMOTE padi over ssh with --host <ssh>: provision the daemon's closure
 * with Nix, run `padi --stdio`, and speak the same `padiSurface` over that link
 * (see `hostConnect.ts`). Read verbs (status/watch/wait) are safe; `create` lands a
 * REAL terminal on the host — and it survives the link. --host is mutually
 * exclusive with --socket / --state-root (all name a daemon; --host is remote).
 *
 * ## The exit-code contract, and where it lives
 *
 * 0 met/done · 1 usage or link failure · 2 `wait` timed out · 3 the terminal
 * exited first · 130 interrupted. Drivers script against these, so they are a
 * CONTRACT, not an implementation detail — which is why every failure is a tagged
 * error carrying BOTH its exact stderr line and its `Runtime.errorExitCode`, and
 * why the mapping happens exactly once, at the run edge below. No command calls
 * `process.exit` any more.
 *
 * The run edge is `Effect.runPromise` and NOT `NodeRuntime.runMain`, deliberately:
 * `runMain` turns SIGINT into fiber interruption, and this CLI's stop semantics
 * are PER COMMAND — `watch` stopped by Ctrl+C is a clean 0 (the user got what
 * they asked for), while `wait` interrupted is a 130 that must still print which
 * terminal was left waiting. An interrupt cannot produce either of those, so the
 * signals are wired to a scoped request the commands can observe.
 */

import { NodeSink } from "@effect/platform-node";
import {
  awaitAgentState,
  isWaitState,
  WAIT_STATES,
  type WaitState,
  watchTerminals,
} from "@kolu/padi/dial";
import {
  PADI_SURFACE_VERSION,
  type TerminalPlacement,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi/surface";
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
import {
  connectPadiTui,
  type Connection,
  type PadiTuiClient,
} from "./connect.ts";
import { placementGate, runCreate } from "./create.ts";
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
  resolveTerminalId,
  shortId,
} from "@kolu/padi/render";

/** Parse this TUI's `--until` — a comma list of bucket names — into the set of
 *  target buckets, or a loud error. Whitespace is trimmed, case folded, and
 *  duplicates collapse; an empty list or any token outside `WAIT_STATES` is
 *  rejected (fail-fast — no silent drop of an unrecognized state).
 *
 *  LOCAL, and that is the boundary rather than an oversight: `watch.ts`'s header
 *  in padi states it — "the CLI-flag grammar (`--until`'s comma parse and its
 *  error strings) stays in the face; only the surface-shaped vocabulary and the
 *  watch/wait machinery live here". It briefly lived in `@kolu/padi/render`,
 *  where its `--until:`-prefixed message was argv grammar inside a formatter.
 *  What padi owns is {@link isWaitState}: whether a token names a bucket. */
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

// Declared on each subcommand — cleye binds flags only AFTER the subcommand (it
// does not inherit a parent flag), so `--socket` goes after the command:
// `padi-tui status --socket <path>`, never `padi-tui --socket <path> status`.
const localEndpointFlags = {
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

// --host reaches a REMOTE padi over ssh, provisioning it with Nix. Mutually
// exclusive with --socket / --state-root (all name a daemon, --host a remote one);
// the conflict is rejected in main().
const hostFlag = {
  host: {
    type: String,
    description:
      "reach a padi on a REMOTE machine over ssh, provisioning it via Nix — e.g. --host nix@prod. padi runs as the SSH user, so you reach the padi owned by that user (its socket dir is 0700, owner-only); SSH in as the user that runs padi. Read verbs (status/watch/wait) are safe; `create` lands a REAL terminal on the host (that's the point), and it survives the link. Mutually exclusive with --socket / --state-root. Goes AFTER the subcommand.",
  },
} as const;

// Every subcommand can target a local daemon (--socket / --state-root) or a
// remote host (--host).
const endpointFlags = { ...localEndpointFlags, ...hostFlag } as const;

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
      "A terminal-side client for the padi workspace daemon — what every terminal is in (record state · repo·branch · PR · agent · foreground), read from a running `padi`. `status` snapshots it; `watch` follows it live (● = live byte activity); `wait` blocks until a terminal's agent reaches a state (working/awaiting/waiting) — the done-signal for scripting an agent that drives another agent; `create` spawns a terminal, split tile, or worktree'd agent. Runs against the local padi by default, or a REMOTE one over ssh with `--host <ssh>` (provisioned with Nix). `--json` is scriptable.",
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
          "Spawn a terminal on the host and print its id; padi owns it and it appears on the canvas. Placement is REQUIRED — pass exactly one of `--toplevel` (a tile of its own) or `--parent <id>` (a split inside that terminal); there is no default. `--worktree <branch>` creates a fresh git worktree (off `--repo`, default the cwd) and opens the terminal there; anything after `--` is run in the new terminal — e.g. `padi-tui create --toplevel --worktree feat -- claude` spawns a worktree'd Claude Code in one command.",
      },
      flags: {
        ...endpointFlags,
        toplevel: {
          type: Boolean,
          description:
            "open the new terminal as a TILE OF ITS OWN on the canvas (mutually exclusive with --parent)",
          // `default: false` so the flag is a plain boolean, not a tristate —
          // "absent" and "false" are the same statement here (you did not claim
          // top level), and the REQUIRED-ness is enforced by the pair gate in
          // `cmdCreate`, which is where the rule can be spelled with its reason.
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
        ...jsonFlag,
      },
    }),
  ],
});

/** The stdout consumer hung up (`padi-tui status | head -1`). Not an exit-code
 *  arm — the caller got what it asked for — so it is caught at each write site
 *  and read as "done" rather than propagated, and it lives here rather than in
 *  `exit.ts`, which is exclusively the codes a driver branches on. */
class StdoutClosed extends Data.TaggedError("StdoutClosed")<{
  /** What node reported — kept so a NON-EPIPE stdout death (a full disk, a
   *  revoked descriptor) is still legible if it ever needs looking at, rather
   *  than being flattened into the same silent "consumer left". */
  readonly cause: unknown;
}> {}

// ── stdout ───────────────────────────────────────────────────────────────

/** Backpressure-aware stdout, as a SINK: a large snapshot to a pipe must drain
 *  before we exit or the tail is truncated, and the sink waits on `drain` for us.
 *  `endOnDone: false` because this process does not own `process.stdout`'s
 *  lifetime — a sink that ended it would close the shell's own descriptor.
 *
 *  A sink rather than a promise-returning `writeOut` because `watch` needs
 *  backpressure to be STRUCTURAL: it used to chain each line onto a growing
 *  `pending` promise, which is a queue with no name and no way to observe it. */
const stdoutSink: Sink.Sink<void, string, never, StdoutClosed> =
  NodeSink.fromWritable<StdoutClosed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutClosed({ cause }),
    endOnDone: false,
  });

/** Write one block to stdout, draining first. */
const writeOut = (text: string): Effect.Effect<void, StdoutClosed> =>
  Stream.run(Stream.make(text), stdoutSink);

/** Drain a queue of ready-to-print lines into stdout until the queue ends,
 *  calling `onClosed` if the consumer hangs up first (`… | head -1`). The
 *  queue's END is what flushes it, so a caller that stops producing and ends the
 *  queue has a definite "everything printed" point to join on. */
const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  onClosed: () => void,
): Effect.Effect<void> =>
  Stream.run(Stream.fromQueue(lines), stdoutSink).pipe(
    Effect.catchTag("StdoutClosed", () => Effect.sync(onClosed)),
  );

/** stderr is the CLI's out-of-band channel (trailers, diagnostics) and is never
 *  the scriptable payload, so it is a plain synchronous write. */
const writeErr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

// ── Signals ──────────────────────────────────────────────────────────────

/** A request to stop, from the process's stop signals.
 *
 *  Two faces of the same fact, because two consumers need different shapes:
 *  `signal` for the shared watch/wait scaffolds, which still speak AbortSignal;
 *  `requested` for this CLI's own races, so "the user stopped us" is awaited
 *  rather than polled off a flag after the fact. */
interface ShutdownRequest {
  readonly signal: AbortSignal;
  readonly requested: Deferred.Deferred<void>;
  readonly request: () => void;
}

/** Wire SIGINT / SIGTERM / SIGHUP to a stop request for the caller's scope, and
 *  UNWIRE them when it closes — so nothing survives the command that asked. */
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

// ── Endpoint resolution (pure, pre-dial) ─────────────────────────────────

/** The one `--worktree over --host needs --repo` usage-error message. Named once
 *  because it is enforced at TWO sites — the pre-dial fast-path in `main` (fail
 *  before Nix-provisioning a cold host) and the transport-blind invariant in
 *  `cmdCreate` (`repoPath === undefined` iff host + no --repo) — so the two can't
 *  drift. Both guards stay; only the string is shared. */
const WORKTREE_OVER_HOST_NEEDS_REPO =
  "--worktree over --host needs --repo <path on the host>: the worktree is cut on the REMOTE machine, so it can't default to your local directory. Pass --repo with an absolute path on the host.";

/** The one daemon a command targets: a REMOTE padi over ssh (`--host`) or a LOCAL
 *  one at a resolved socket path. Each arm carries exactly what its connect needs,
 *  so the payload is live and `main` switches on it once — there is no parallel
 *  `conn`/`endpoint` pair to keep in agreement. Stays local to `main`; the
 *  co-location fact `create` needs rides on `Connection.localCwd` instead. */
type Endpoint =
  | { kind: "host"; host: string }
  | { kind: "local"; socketPath: string };

/** Resolve the flags to the ONE daemon target, owning all three-way
 *  mutual-exclusion in one place: `--host` reaches a remote padi over ssh and is
 *  mutually exclusive with the local `--socket` / `--state-root`; absent it, the
 *  local socket policy (`--socket` vs `--state-root`) stays `resolveSocketPath`'s
 *  own concern. So the whole "name exactly one target" policy reads top-to-bottom
 *  here instead of fragmenting across `main` and the socket resolver. */
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

/** Dial the resolved endpoint, SCOPED — the link lives exactly as long as the
 *  caller's scope. Both arms fail loud with the underlying ssh/nix/skew reason
 *  so a misconfigured host (no passwordless ssh, the user not in the remote's
 *  `trusted-users`, a contract skew) or an unreachable socket reads as
 *  actionable rather than as a decode failure on the first real call — the CLI
 *  is one-shot, so it surfaces the first failure instead of spinning on a
 *  reconnect loop. */
function connectTo(
  endpoint: Endpoint,
): Effect.Effect<Connection, CliFailure, Scope.Scope> {
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

// ── id resolution ────────────────────────────────────────────────────────

/** Resolve a user-typed id-or-prefix to a full terminal id against the live
 *  terminals, failing loudly on no-match or ambiguity — so `<id>` accepts the
 *  short id `status` prints (or any unique prefix) and a pasted full id
 *  round-trips. */
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

/** Snapshot the live terminals and resolve a user-typed id-or-prefix to a full id
 *  — the snapshot+map+resolveOne dance `watch`, `wait`, and `create --parent`
 *  share. `resolveOne` (and the CLI's failure vocabulary) stay in this layer, so
 *  `read.ts` remains free of any exit concern. */
function resolveArg(
  client: PadiTuiClient,
  query: string,
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(client), (ids) =>
    resolveOne(query, ids),
  );
}

// ── The verbs ────────────────────────────────────────────────────────────

/** Read the terminals collection, waiting for padi's sensors to resolve, then
 *  RELEASE the link — a snapshot needs no live connection afterward, so the dial
 *  and the read share a scope that closes before anything is printed. The settle
 *  wait matters for a just-spawned terminal mid-sensor-resolution; against a warm
 *  padi it settles at once (see `settledSnapshot`). */
function cmdStatus(
  endpoint: Endpoint,
  json: boolean,
): Effect.Effect<void, unknown> {
  return Effect.flatMap(
    Effect.scoped(
      Effect.flatMap(connectTo(endpoint), (conn) =>
        settledSnapshot(conn.client),
      ),
    ),
    (entries) =>
      writeOut(
        json ? `${formatStatusJson(entries)}\n` : `${formatStatus(entries)}\n`,
      ),
  );
}

/** Follow the terminals collection live until the user stops us, or fail loud
 *  when the link drops under us.
 *
 *  The two endings are the two arms of one race, and that IS the discrimination
 *  the old `if (!abort.signal.aborted)` re-derived after the fact: the mirror
 *  settling on its own can only mean the link closed, and a stop request can only
 *  come from us. Lines ride a queue into the stdout sink, so a slow consumer
 *  applies real backpressure — and ending the queue after the stop is what
 *  flushes it, replacing the hand-chained `pending` promise. */
function cmdWatch(
  endpoint: Endpoint,
  query: string | undefined,
  json: boolean,
): Effect.Effect<void, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* shutdownRequest;
      const conn = yield* connectTo(endpoint);
      const only =
        query === undefined ? undefined : yield* resolveArg(conn.client, query);

      const lines = yield* Queue.unbounded<string, Cause.Done>();
      const emit = (line: string): void => {
        Queue.offerUnsafe(lines, line);
      };
      let upstreamError: string | undefined;

      // A closed stdout (`padi-tui watch | head -1`) is the consumer hanging up
      // — the same clean stop a Ctrl+C is, so it requests the same shutdown
      // rather than being reported as a link failure.
      const pump = yield* Effect.forkChild(
        pumpToStdout(lines, () => shutdown.request()),
      );

      const watching = Effect.tryPromise({
        try: () =>
          watchTerminals(
            conn.client,
            {
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
            shutdown.signal,
            (line) => {
              upstreamError ??= line;
              process.stderr.write(`padi-tui: ${line}\n`);
            },
          ),
        catch: (err) => err,
      });

      const ending = yield* Effect.raceAll<Effect.Effect<"stopped" | "closed">>(
        [
          // The user stopped us (a signal, or the consumer hanging up).
          Effect.as(Deferred.await(shutdown.requested), "stopped"),
          // The mirror settled although nobody asked it to — the link dropped.
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

      // Whatever ended it, stop producing and FLUSH what is already queued
      // before leaving — a `watch` that dropped its last lines on the way out
      // would be indistinguishable from one that never saw the event.
      shutdown.request();
      yield* Queue.end(lines);
      yield* Fiber.join(pump);

      if (ending === "closed") {
        // For a live monitor a dropped link is a failure, not a clean EOF.
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
    // The link is released the moment the wait settles — the outcome is a value,
    // and nothing after this needs the daemon.
    const { resolvedId, outcome } = yield* Effect.scoped(
      Effect.gen(function* () {
        const shutdown = yield* shutdownRequest;
        const conn = yield* connectTo(endpoint);
        const resolvedId = yield* resolveArg(conn.client, query);
        const outcome = yield* Effect.tryPromise({
          try: () =>
            awaitAgentState(conn.client, {
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
    // closed: the padi link dropped before the state landed — a failure.
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
    // The placement gate is PURE and runs before the dial, so a bare
    // `padi-tui create` fails instantly rather than after `--host` has
    // Nix-provisioned a cold box for a command that was never going to run. The
    // DECISION is `@kolu/padi/render`'s, shared with `kolu create` so the two
    // faces cannot drift; only the command name and the failure type are ours,
    // and both live in `create.ts` where a test can reach them — nothing in this
    // module can be imported without `cli(…)` parsing `process.argv`.
    const stated = yield* placementGate(flags);

    const created = yield* Effect.scoped(
      Effect.gen(function* () {
        const conn = yield* connectTo(endpoint);
        // Resolve --parent prefix against the live terminals (a short id or prefix).
        // The ARM was decided above; only the id inside it needs the live roster,
        // and it is read off that arm rather than re-derived from the raw flags —
        // one decision, read once.
        const placement: TerminalPlacement =
          stated.kind === "toplevel"
            ? TOPLEVEL_PLACEMENT
            : {
                kind: "child-of",
                parentId: yield* resolveArg(conn.client, stated.parentQuery),
              };

        // WHERE the new terminal opens depends on whether this daemon shares our
        // filesystem — the one co-location fact `conn.localCwd` carries. A LOCAL padi
        // runs on THIS machine, so `conn.localCwd` is `process.cwd()`, a real path
        // there; a REMOTE one (`--host`) runs elsewhere, so `conn.localCwd` is
        // undefined — the local cwd need not exist on the host, and padi defaults to
        // the remote user's HOME (endpoint.ts: cwd resolves to home when undefined).
        // `--worktree` overrides cwd with the host-side worktree path inside
        // runCreate either way, but its repo is a HOST path over ssh: a remote
        // --worktree can't default to the local cwd (a repo on the wrong machine),
        // so it requires an explicit --repo.
        let worktree: { repoPath: string; name: string } | undefined;
        if (flags.worktree !== undefined) {
          const repoPath = flags.repo ?? conn.localCwd;
          if (repoPath === undefined) {
            return yield* Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
          }
          worktree = { repoPath, name: flags.worktree };
        }

        const result = yield* runCreate(conn.client, {
          placement,
          worktree,
          // A plain LOCAL create opens where you are (the tmux convention); a REMOTE
          // one has `conn.localCwd` undefined so padi defaults to the host's home.
          // --worktree overrides this with the worktree path inside runCreate.
          cwd: conn.localCwd,
          argv: command,
        });
        return { result, placement };
      }),
    );

    const { result, placement } = created;
    if (flags.json) {
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    // stdout is just the id (scriptable — `id=$(padi-tui create --toplevel)`);
    // the rest to stderr.
    yield* writeOut(`${result.id}\n`);
    const bits = [`— created ${shortId(result.id)}`];
    // Placement is always reported: top level is a decision now, not a silence.
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

// ── The one program, and the one run edge ────────────────────────────────

function program(): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    // cleye already handled --help / --version. We land here with no command for
    // bare `padi-tui` (show help) or the common trap of a flag BEFORE the subcommand
    // (`padi-tui --socket X status`) — cleye binds flags only after the command, so
    // a leading flag swallows it. Steer that case to the right order.
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

    // `wait`'s flag checks are pure — validate them BEFORE the dial so a bad
    // `--until`/`--timeout` fails fast with no connection to tear down. `waitTargets`
    // is non-null exactly when the command is `wait`; its parsed targets flow
    // straight into cmdWait below.
    let waitTargets: ReadonlySet<string> | null = null;
    if (argv.command === "wait") {
      if (argv.flags.until === undefined) {
        return yield* Effect.fail(
          failure(
            "--until is required — e.g. `padi-tui wait <id> --until awaiting,waiting`.",
          ),
        );
      }
      const parsed = parseUntilStates(argv.flags.until);
      if (parsed.kind === "error") {
        return yield* Effect.fail(failure(parsed.message));
      }
      if (
        argv.flags.timeout !== undefined &&
        !(Number.isFinite(argv.flags.timeout) && argv.flags.timeout > 0)
      ) {
        return yield* Effect.fail(
          failure("--timeout must be a positive number of milliseconds."),
        );
      }
      waitTargets = parsed.targets;
    }

    // Pick the transport once: `resolveEndpoint` owns the whole "name exactly one
    // daemon target" policy (--host vs --socket / --state-root) and returns the ONE
    // target, each arm carrying exactly what its connect needs. --host reaches a remote
    // padi over ssh; otherwise dial the resolved local socket.
    const endpoint = yield* resolveEndpoint(argv.flags);

    // A remote `--worktree` without `--repo` is a pure USAGE error — the worktree is
    // cut on the remote host, so it can't default to the local cwd. Reject it BEFORE
    // dialing (the same fail-fast the `wait` flags get above), so a cold or
    // unreachable host doesn't make the user wait on provisioning only to learn the
    // command was malformed. `cmdCreate` keeps the transport-blind guard on
    // `conn.localCwd` as the defensive invariant.
    if (
      argv.command === "create" &&
      endpoint.kind === "host" &&
      argv.flags.worktree !== undefined &&
      argv.flags.repo === undefined
    ) {
      return yield* Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
    }

    // Narrow on `argv.command` so cleye's per-command flag/positional union collapses
    // to the one shape (only `wait` carries `--until`/`--timeout`, only `create` the
    // worktree flags). Every verb owns its own scope, so the link it dials is
    // released on its way out whichever way it leaves.
    if (argv.command === "status") {
      return yield* cmdStatus(endpoint, argv.flags.json);
    }
    if (argv.command === "watch") {
      return yield* cmdWatch(endpoint, argv._.id, argv.flags.json);
    }
    if (argv.command === "wait") {
      // `waitTargets` was parsed + validated in the pre-dial block above (the command
      // is `wait`), so it is non-null here; the guard keeps TS honest without a cast.
      if (waitTargets === null) {
        return yield* Effect.fail(failure("--until is required."));
      }
      return yield* cmdWait(endpoint, argv._.id, waitTargets, {
        json: argv.flags.json,
        timeoutMs: argv.flags.timeout,
      });
    }
    if (argv.command === "create") {
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
    }
    return yield* Effect.fail(
      failure("unhandled command — add a dispatch branch for it"),
    );
  });
}

/** THE exit map, at THE run edge — the whole of it, in five lines, because
 *  `exit.ts` already made each arm carry its own line and its own code. */
Effect.runPromiseExit(program()).then((exit) => {
  if (Exit.isSuccess(exit)) process.exit(0);
  const error = Cause.squash(exit.cause);
  process.stderr.write(reportOf(error));
  process.exit(exitCodeOf(error));
});
