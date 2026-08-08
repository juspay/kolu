/**
 * kaval-tui — a terminal-side client for a running `kaval` daemon
 * (`list` + `create` + `snapshot` + `attach` + `kill`). It dials kaval's unix socket
 * via `unixSocketLink` and speaks `ptyHostSurface` directly — the *raw* client
 * (the browser is the *rich* one over the full kolu contract).
 * See `docs/atlas/src/content/atlas/pty-daemon-tui.mdx`.
 *
 *   kaval-tui list [--json]     list your live terminals (id · pid · idle · cwd)
 *   kaval-tui create [-- cmd]   spawn a new terminal ($SHELL or cmd), print its id
 *   kaval-tui snapshot <id>     print a terminal's screen (--viewport / --tail N to bound it), then exit
 *   kaval-tui send <id> [text]  write input to a terminal (a prompt to an agent), then exit
 *   kaval-tui wait <id> --until <cond>  block until output goes idle / matches, then exit
 *   kaval-tui attach <id>       take over a terminal from the shell; `~.` detaches
 *   kaval-tui kill <id>         end a terminal the daemon owns (id or prefix)
 *
 * `list` prints a short id (the leading chars of the full uuid); `<id>` in
 * `snapshot`/`attach` is that short form or any unique prefix of the full id —
 * resolved against the live inventory client-side (see `resolveOne`), so a
 * pasted full uuid keeps working. `--json` always carries the full id.
 *
 * By default it reaches a standalone `kaval` daemon on THIS machine. Two ways to
 * point it elsewhere, mutually exclusive:
 *   --socket PATH   a different LOCAL socket — e.g. a running kolu-server's
 *                   in-process terminals (`$XDG_RUNTIME_DIR/kolu/pty-host.sock`).
 *   --host <ssh>    a REMOTE kaval over ssh (R-2): provision the daemon's
 *                   closure with Nix, run `kaval --stdio`, and dial it — the
 *                   same client over a different transport.
 *                   A remote PTY survives the link: `create` on prod, then a
 *                   later `attach` finds it.
 *
 * The CLI comes and goes; the daemon keeps owning the PTYs — `create` mints one,
 * the daemon holds it until `kill` (or another client) ends it.
 */
import { fstatSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { NodeSink, NodeStdio } from "@effect/platform-node";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { dialAgentOnce } from "@kolu/surface-remote";
import {
  ACCEPTED_KEY_NAMES,
  encodeKey,
  SNAPSHOT_TTY_RESET as TTY_RESET,
} from "@kolu/terminal-protocol";
import { cli, command } from "cleye";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  type Scope,
  type Sink,
  Stdio,
  Stream,
} from "effect";
import {
  PTY_HOST_CONTRACT_VERSION,
  ptyHostClientOver,
  type PtyHostSpawnInput,
  resolveRunningKavalSocket,
} from "kaval";
import { type AttachTty, runAttach } from "./attach.ts";
import { type Connection, connectPtyHost } from "./connect.ts";
import { kavalHostDialOptions } from "./hostConnect.ts";
import {
  buildCreateInput,
  buildRemoteCreateInput,
  formatCreate,
  newPtyId,
} from "./create.ts";
import { isValidEscapeChar } from "./escape.ts";
import {
  AttachChildExited,
  attachExitCode,
  CliFailure,
  exitCodeOf,
  failure,
  reportOf,
  WaitInterrupted,
  WaitTerminalGone,
  WaitTimedOut,
} from "./exit.ts";
import { materializeHistoryPage } from "./historyPage.ts";
import { runKill } from "./kill.ts";
import {
  planSend,
  rejectUnknownSendFlags,
  resolveSendInput,
  type SendInput,
  sourceIsStream,
  sourceLabel,
} from "./send.ts";
import { executeSendPlan } from "./sendExec.ts";
import {
  awaitOutputCondition,
  isValidTimerMs,
  MAX_TIMER_MS,
  parseUntil,
  type WaitCondition,
  waitResultJson,
} from "./wait.ts";
import { shellQuoteArg } from "@kolu/shell-quote";
import {
  formatList,
  formatListJson,
  formatSend,
  resolveTerminalId,
  shortId,
} from "./render.ts";

// Declared on each subcommand (cleye binds flags only AFTER the subcommand —
// it does not inherit a parent flag — so `--socket` goes after the command:
// `kaval-tui list --socket <path>`, never `kaval-tui --socket <path> list`).
const socketFlag = {
  socket: {
    type: String,
    description:
      "socket to dial — goes AFTER the subcommand. Usually unneeded: with no --socket, kaval-tui autodiscovers the running daemon (run `kaval-tui list` to see each, labeled), and inside a kolu terminal $KAVAL_SOCKET already names your daemon. Pass --socket only to pick one when several are up: a standalone kaval serves at $XDG_RUNTIME_DIR/kaval/pty-host.sock (or /tmp/kaval-$UID/pty-host.sock when $XDG_RUNTIME_DIR is unset), and a padi-spawned kaval serves under a DIGEST-keyed namespace, $XDG_RUNTIME_DIR/kaval-<digest>/pty-host.sock (the digest is of padi's state-root — opaque, not a port) — there is no single fixed path, so run `kaval-tui list` to see each (labeled from its state-root manifest) and copy the one you want.",
  },
} as const;

// --host reaches a REMOTE kaval over ssh, provisioning it with Nix. Mutually
// exclusive with --socket (a local path); the conflict is rejected in main().
const hostFlag = {
  host: {
    type: String,
    description:
      "reach a kaval on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. kaval runs as the SSH user, so you reach the kaval owned by that user (its socket dir is 0700, owner-only); SSH in as the user that runs kaval. The remote PTYs survive the link (create on the host, attach to it later). Mutually exclusive with --socket. Goes AFTER the subcommand.",
  },
} as const;

// Every subcommand can target either a local socket or a remote host.
const endpointFlags = { ...socketFlag, ...hostFlag } as const;

/** The endpoint a command resolved to — which daemon it dialed. Carried into
 *  `create` so a remote `create` composes against the host's facts (not local
 *  ones) and so the printed "attach with …" hint names the SAME endpoint: a
 *  remote PTY is reachable only with `--host`, and an explicit `--socket` may
 *  not be what bare-`attach` autodiscovery would pick. */
type Endpoint =
  | { kind: "host"; host: string }
  | { kind: "socket"; socket: string }
  | { kind: "default"; socket: string };

/** The flag suffix that re-targets a later command at the SAME endpoint — the
 *  empty string for the default discovered socket (bare `attach` finds it). The
 *  value is shell-quoted: the hint is printed for copy-paste back into a shell,
 *  and a socket path may legitimately carry spaces (`/tmp/my sock`) that would
 *  otherwise re-split into two args (the pasted command targets the wrong thing)
 *  — see `shellQuoteArg`. */
function endpointHint(endpoint: Endpoint): string {
  if (endpoint.kind === "host")
    return ` --host ${shellQuoteArg(endpoint.host)}`;
  if (endpoint.kind === "socket")
    return ` --socket ${shellQuoteArg(endpoint.socket)}`;
  return "";
}

const argv = cli({
  name: "kaval-tui",
  version: PTY_HOST_CONTRACT_VERSION,
  help: {
    description:
      "A terminal-side client for the kaval PTY daemon (beta). Connects to a running kaval over a local unix socket — start it with `kaval`; the socket appears once it boots. Use `--socket` to reach a kolu-server's in-process terminals, or `--host <ssh>` to provision and dial a kaval on a remote machine.",
  },
  commands: [
    command({
      name: "list",
      help: { description: "List your live terminals." },
      flags: {
        ...endpointFlags,
        json: {
          type: Boolean,
          description: "machine-readable JSON output (a top-level array)",
          default: false,
        },
      },
    }),
    command({
      name: "create",
      parameters: ["[command...]"],
      help: {
        description:
          "Spawn a new terminal and print its id; the daemon owns it. Runs a plain $SHELL by default, or the command you pass — prefix it with `--` when it takes its own flags: `kaval-tui create -- htop -d 5`. Then `kaval-tui attach <id>` to take it over. The new terminal's environment is composed from a clean canonical base — the vars a shell needs (HOME, PATH, SHELL, …), presentation (TERM, LANG, …), and the login-session capability vars (XDG runtime dir, ssh-agent socket, DBUS, TMPDIR) — NOT a copy of this process's env: a var you exported into the current shell does not follow into the new terminal (an interactive shell still sources your ~/.bashrc / ~/.zshrc, so vars set there are present). This is deliberate — copying the caller's env leaks an orchestrating agent's private identity vars and silently loses that agent's data (see issue #1872). Add specific vars back explicitly with `--env K=V` (repeatable).",
      },
      flags: {
        ...endpointFlags,
        env: {
          type: [String],
          description:
            "add an env var to the new terminal as K=V (repeatable) — the explicit escape hatch for a var the clean canonical base drops. `--env FOO=bar --env BAZ=1`. A later --env overrides a base var of the same name. This is the ONLY way to add env; there is no inherit-everything switch (that would reopen the #1872 identity-leak).",
        },
        json: {
          type: Boolean,
          description: "machine-readable JSON output ({ id, pid, cwd })",
          default: false,
        },
      },
    }),
    command({
      name: "snapshot",
      parameters: ["<id>"],
      help: {
        description:
          "Print a terminal's rendered screen. Default: the full scrollback (thousands of lines on a long session). `--viewport` prints just the visible screen — the best read for 'what's on screen now' when driving an agent; `--tail N` (alias `--lines N`) prints the last N rendered lines. <id> is the short id from `list` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        viewport: {
          type: Boolean,
          description:
            "print only the visible screen (the terminal's last screenful), resolved against the daemon's own grid — the best default for reading an agent's current state",
          default: false,
        },
        tail: {
          type: Number,
          description:
            "print only the last N rendered lines (like `tail -N`, but over the rendered buffer)",
        },
        lines: {
          type: Number,
          description: "synonym for --tail",
        },
      },
    }),
    command({
      name: "history",
      parameters: ["<id>"],
      help: {
        description:
          "Dump a terminal's OLDER scrollback — the mirror content ABOVE the current screen that `snapshot --viewport` can't show — as VT bytes (colors preserved), cursor-paged from the newest older lines back. `--lines N` prints just the N lines immediately above the screen; omit it to dump the whole mirror history. Read-only, takes no TTY. <id> is the short id from `list` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        lines: {
          type: Number,
          description:
            "print only the N older lines immediately above the current screen (one page); omit for the full older history",
        },
      },
    }),
    command({
      name: "send",
      parameters: ["<id>", "[text...]"],
      help: {
        description:
          'Write input to a terminal — e.g. a prompt to a Claude Code / Codex / opencode agent running in it. Sends EXACTLY the text you pass, OR the `--key`s — NEVER both in one send, and never an implicit Enter. Submitting a prompt is its OWN command, because a same-breath Enter is raced by the TUI\'s paste debounce and dropped. The canonical three-step flow for a NORMAL-size prompt: `send <id> "the prompt"` (the text) · `wait <id> --until idle:300` (observe the TUI settle) · `send <id> --key Enter` (submit). Known limitation: a LARGE paste that Claude Code folds into a placeholder does not reliably submit on Enter (issue #1702) — for a big brief, write it to a file and send a short `read <path>` prompt instead. Multiline, `--file`, or piped-stdin text is sent as one bracketed paste so it lands as a block, not line-by-line. Text comes from the positional words, `--file <path>`, or stdin; `--key` sends named/control keys (' +
          ACCEPTED_KEY_NAMES +
          "; chords: C-c, M-b). <id> is the short id from `list` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        // cleye/type-flag has no `--no-<flag>` negation for a Boolean (it lands
        // in `unknownFlags`), so `--no-paste`'s off-switch is its own flag whose
        // kebab key IS what the user types: `noPaste`→`--no-paste`. `paste` /
        // `noPaste` together give the tristate (set/unset/auto); `cmdSend` folds
        // them into the effective paste.
        paste: {
          type: Boolean,
          description:
            "force bracketed paste ON (default: auto — on for multiline or stdin text, off for a single-line argument)",
        },
        noPaste: {
          type: Boolean,
          description: "force bracketed paste OFF — send the text verbatim",
        },
        key: {
          type: [String],
          description:
            "a named/control key to send — repeatable, in order. Submit a staged prompt with `--key Enter` as its OWN send (never in the same command as text). Names: " +
            ACCEPTED_KEY_NAMES +
            "; chords: C-c, M-b.",
        },
        file: {
          type: String,
          description:
            'read the send text from a file instead of the positional words — avoids the `"$(cat file)"` shell mangling of payloads with backticks / $( ). Mutually exclusive with positional text and piped stdin. Sent as a bracketed paste, same as any block: it fixes the SHELL hazard, NOT the wire bytes — a large --file payload still hits the large-paste-doesn\'t-submit limitation (issue #1702), so it is not a large-paste workaround.',
        },
        json: {
          type: Boolean,
          description:
            "machine-readable JSON output ({ id, bytes, paste, keys })",
          default: false,
        },
      },
    }),
    command({
      name: "wait",
      parameters: ["<id>"],
      help: {
        description:
          "Block until a terminal's raw OUTPUT meets a condition, then exit — the hook-free done-signal for driving an agent that drives another agent. `--until idle:<ms>` resolves once no output byte has arrived for <ms> (the agent's turn ended / it's awaiting input — the common case); `--until match:<regex>` resolves once new output matches (a completion marker or returned-prompt sentinel). `--timeout <ms>` caps the wait and fails loud (exit 2); a terminal that exits first fails loud too (exit 3). `--json` prints one result frame per outcome — `{ id, result, … }`, where `result` is met / timeout / gone / interrupted / closed (a met frame adds `fired` — idle / match —, elapsedMs, and matchedLine on a match), so a driver never falls back to the exit code alone. Keyed on raw PTY bytes, so it needs NO shell hooks and works for any terminal (vs `padi-tui wait`, which needs hooked terminals). <id> is the short id from `list` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        until: {
          type: String,
          description:
            "the condition to wait for: idle:<ms> (no output for <ms> — turn ended / at the prompt) or match:<regex> (new output matches). Note: idle never fires against a target that streams output continuously (a busy, mid-turn agent) — pair it with --timeout there and treat a timeout as 'target busy'.",
        },
        timeout: {
          type: Number,
          description:
            "milliseconds to wait before failing loud (exit 2); default: wait indefinitely until the condition, the terminal exits, the link drops, or Ctrl+C",
        },
        json: {
          type: Boolean,
          description:
            "machine-readable JSON output — one result frame per outcome: { id, result, … } (result: met / timeout / gone / interrupted / closed)",
          default: false,
        },
      },
    }),
    command({
      name: "attach",
      parameters: ["<id>"],
      help: {
        description:
          "Take over a terminal: raw passthrough until a line-start `~.` detaches (the daemon keeps the terminal). `~?` lists the escapes. <id> is the short id from `list` or any unique prefix.",
      },
      flags: {
        ...endpointFlags,
        escape: {
          type: String,
          description:
            "the line-start escape character (a single printable ASCII char)",
          default: "~",
        },
      },
    }),
    command({
      name: "kill",
      parameters: ["<id>"],
      help: {
        description:
          "End a terminal the daemon owns — the PTY is torn down and leaves `list`. <id> is the short id from `list` or any unique prefix.",
      },
      flags: { ...endpointFlags },
    }),
  ],
});

// ── stdout ───────────────────────────────────────────────────────────────

/** The stdout consumer hung up (`kaval-tui list | head -1`). Not an exit-code
 *  arm — the caller got what it asked for — so it is read as "done" at the write
 *  site rather than propagated. */
class StdoutClosed extends Data.TaggedError("StdoutClosed")<{
  /** What node reported — kept so a NON-EPIPE stdout death (a full disk, a
   *  revoked descriptor) stays legible rather than being flattened into the same
   *  silent "consumer left". */
  readonly cause: unknown;
}> {}

/** Backpressure-aware stdout, as a SINK: a large scrollback to a pipe must drain
 *  before we exit or the tail is truncated, and the sink waits on `drain` for us.
 *  `endOnDone: false` because this process does not own `process.stdout`'s
 *  lifetime — a sink that ended it would close the shell's own descriptor. */
const stdoutSink: Sink.Sink<void, string, never, StdoutClosed> =
  NodeSink.fromWritable<StdoutClosed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutClosed({ cause }),
    endOnDone: false,
  });

/** Write one block to stdout, draining first. A closed consumer is "done", not a
 *  failure — `kaval-tui list | head -1` must exit cleanly. */
const writeOut = (text: string): Effect.Effect<void> =>
  Stream.run(Stream.make(text), stdoutSink).pipe(
    Effect.catchTag("StdoutClosed", () => Effect.void),
  );

/** {@link writeOut} with a single trailing newline ensured — the common
 *  "print this block as a line" shape the screen/history dumps share. */
const writeOutLine = (text: string): Effect.Effect<void> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`);

/** stderr is the CLI's out-of-band channel (trailers, diagnostics) and is never
 *  the scriptable payload, so it is a plain synchronous write. */
const writeErr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

// ── Signals ──────────────────────────────────────────────────────────────

/** A request to stop, from the process's stop signals — the shape `wait` needs,
 *  because `interrupted` is an outcome it REPORTS (a `--json` frame, a trailer
 *  naming the terminal left running) and an interrupted fiber can report
 *  nothing. */
interface ShutdownRequest {
  readonly requested: Deferred.Deferred<void>;
}

/** Wire SIGINT / SIGTERM / SIGHUP to a stop request for the caller's scope, and
 *  UNWIRE them when it closes — so nothing survives the command that asked. */
const shutdownRequest: Effect.Effect<ShutdownRequest, never, Scope.Scope> =
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const requested = Deferred.makeUnsafe<void>();
        const request = (): void => {
          Deferred.doneUnsafe(requested, Effect.void);
        };
        const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
        for (const sig of signals) process.on(sig, request);
        return {
          value: { requested } as ShutdownRequest,
          off: () => {
            for (const sig of signals) process.off(sig, request);
          },
        };
      }),
      ({ off }) => Effect.sync(off),
    ),
    ({ value }) => value,
  );

// ── id + socket resolution ───────────────────────────────────────────────

/** Resolve a user-typed id-or-prefix to a full terminal id against the live
 *  inventory, failing loudly on no-match or ambiguity. `attach`/`snapshot` run
 *  this first so a short id (the form `list` prints) or any unique prefix
 *  reaches the contract — which validates a full uuid — as the real id. The
 *  list round-trip is cheap and the inventory is the only truth for what's
 *  live; an ambiguous prefix names the matches so the user can add characters. */
function resolveOne(
  conn: Connection,
  query: string,
): Effect.Effect<string, unknown> {
  return Effect.flatMap(
    conn.client.surface.terminal.list({}),
    ({ entries }) => {
      const result = resolveTerminalId(
        query,
        entries.map((e) => e.id),
      );
      if (result.kind === "found") return Effect.succeed(result.id);
      if (result.kind === "none") {
        return Effect.fail(
          failure(
            `no terminal matching "${query}" — \`kaval-tui list\` shows the live ones.`,
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
    },
  );
}

/** The socket to dial. The selection policy (explicit `--socket` wins; else
 *  discover the running daemon; one→use it; many→ambiguous; none→bare default)
 *  plus the candidate labels live in `kaval`'s `resolveRunningKavalSocket` —
 *  beside the namespace construction they invert — so here kaval-tui only renders
 *  the `many` case as its own `--socket`-flavored failure. */
function resolveSocketPath(
  override: string | undefined,
): Effect.Effect<string, CliFailure> {
  return Effect.suspend(() => {
    const resolved = resolveRunningKavalSocket(override);
    if (resolved.kind === "many") {
      return Effect.fail(
        failure(
          `more than one kaval daemon is running:\n  ${resolved.candidates
            .map(({ socket, label }) => `${socket}    (${label})`)
            .join("\n  ")}\nPass --socket <path> to pick one.`,
        ),
      );
    }
    return Effect.succeed(resolved.socket);
  });
}

// ── The verbs ────────────────────────────────────────────────────────────

function cmdList(
  conn: Connection,
  json: boolean,
): Effect.Effect<void, unknown> {
  return Effect.flatMap(conn.client.surface.terminal.list({}), ({ entries }) =>
    writeOut(
      json
        ? `${formatListJson(entries)}\n`
        : `${formatList(entries, { now: Date.now(), home: homedir() })}\n`,
    ),
  );
}

function cmdSnapshot(
  conn: Connection,
  id: string,
  bound: { viewport: boolean; tailLines: number | undefined },
): Effect.Effect<void, unknown> {
  // Plain rendered screen — NOT the `terminalAttach` first frame. That first
  // frame is the *serialized xterm screen state* (VT escape sequences) used for
  // late attach; piping it to a terminal would replay those control sequences,
  // and `grep`-ing it (the headless-CI use the docs promise) would match
  // against escape bytes, not text. `getScreenText` is the rendered buffer the
  // `snapshot | grep MARK-` flow needs. By default it's the *full* scrollback;
  // `--viewport` (the daemon's own last screenful) and `--tail N` bound it so
  // the agent-driving loop reads the current screen instead of `| tail`-ing a
  // huge buffer of trailing blanks.
  // The flags are already proven mutually exclusive (see the snapshot dispatch),
  // so collapse them to exactly one `extent` variant — the wire can't carry two
  // conflicting bounds.
  const extent = bound.viewport
    ? ({ kind: "viewport" } as const)
    : bound.tailLines !== undefined
      ? ({ kind: "tail", lines: bound.tailLines } as const)
      : ({ kind: "full" } as const);
  return Effect.gen(function* () {
    const { text } = yield* conn.client.surface.terminal.getScreenText({
      id,
      extent,
    });
    yield* writeOutLine(text);
    // Trailer to stderr so stdout stays clean, scriptable scrollback — derived
    // from the text we already hold, no second round-trip to decorate it.
    const lines = text ? text.replace(/\n+$/, "").split("\n").length : 0;
    yield* writeErr(
      `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
    );
  });
}

/** Rows per page when dumping the whole older history — bounds each round-trip's
 *  serialized payload; the pager loops until the mirror is exhausted. */
const HISTORY_PAGE_ROWS = 1000;

function cmdHistory(
  conn: Connection,
  id: string,
  opts: { lines: number | undefined },
): Effect.Effect<void, unknown> {
  // The `getHistory` verb self-seeds when `before` is omitted (starts from the
  // top of the current screen region) and pages older with each reply's
  // `topLine`. It returns VT-serialized chunks — the same bytes the browser
  // replays — so colors survive; a consumer that wants plain text pipes through
  // its own VT stripper, exactly as it would `snapshot`'s serialized frame.
  // The pager sends no `epoch`, so the host never serves the `stale` arm — every
  // reply is a `chunk` (the narrow below is exhaustive-safe, not a live branch).
  return Effect.gen(function* () {
    const onePage = opts.lines;
    if (onePage !== undefined) {
      // One page: the N older lines immediately above the screen.
      const res = yield* conn.client.surface.terminal.getHistory({
        id,
        max: onePage,
      });
      if (res.kind === "chunk" && res.chunk) yield* writeOutLine(res.chunk);
      yield* writeErr(`— ${shortId(id)} · older history (≤${onePage} lines)\n`);
      return;
    }
    // Whole older history: page from the screen top back to the oldest retained
    // line. We fetch newest-older first; collect, then emit OLDEST-first so the
    // dump reads top-to-bottom like the terminal produced it.
    const pages: string[] = [];
    let before: number | undefined;
    for (;;) {
      const res = yield* conn.client.surface.terminal.getHistory({
        id,
        // `before` is `Schema.optionalKey` (PLAN #17), which means the key is
        // ABSENT — an explicit `before: undefined` is a decode failure, not the
        // "self-seed from the top of the screen" request the pager's first
        // iteration means. zod's `.optional()` tolerated the explicit undefined;
        // this schema deliberately does not, so the key is SPREAD in only once
        // there is a cursor to send.
        ...(before === undefined ? {} : { before }),
        max: HISTORY_PAGE_ROWS,
      });
      if (res.kind === "stale") break;
      // An all-blank page serializes to "" but is NOT exhaustion — advance past it
      // (the cursor still moves up) so older content ABOVE a blank run isn't cut
      // off. Only `exhausted` (the top of the mirror) ends the dump. The blank-span
      // materialization (and the self-seeded-first-page edge) lives in
      // `materializeHistoryPage`, unit-tested in `historyPage.test.ts`.
      const page = materializeHistoryPage(res.chunk, before, res.topLine);
      if (page !== null) pages.push(page);
      before = res.topLine;
      if (res.exhausted) break;
    }
    for (const chunk of pages.slice().reverse()) yield* writeOutLine(chunk);
    yield* writeErr(
      `— ${shortId(id)} · ${pages.length} older page${pages.length === 1 ? "" : "s"}\n`,
    );
  });
}

/** The daemon-authoritative locator stamps `--env` must reject (fail-fast, not a silent
 *  no-op): both composers overwrite them with the real terminal id / dialed socket AFTER
 *  `extraEnv`, so `--env KAVAL_SOCKET=x` is a no-op (locally) or an inconsistency
 *  (remotely). One rule — they are STAMPED, never caller-set. (`__proto__`/`prototype`/
 *  `constructor` are NOT rejected: they are valid env names, and the record is
 *  null-prototype below, so a literal `__proto__=…` round-trips as an ordinary data key
 *  rather than mutating a prototype — the arbitrary-K=V contract holds.) */
const REJECTED_ENV_KEYS = new Set(["KAVAL_TERMINAL_ID", "KAVAL_SOCKET"]);

/** Parse+VALIDATE the repeatable `--env K=V` flag, pre-dial (like `sendCall`), so a
 *  malformed value fails BEFORE `--host` provisions the closure and launches a remote
 *  `kaval --stdio`. Splits on the FIRST `=` so a value may itself contain `=`
 *  (`--env URL=a=b` → `URL`→`a=b`), and rejects the daemon-stamped locator keys
 *  (`REJECTED_ENV_KEYS`). The record is **null-prototype** so a literal `__proto__=…`
 *  is a real data property, not a silent prototype mutation. */
function parseEnvAssignments(
  pairs: readonly string[],
): Effect.Effect<Record<string, string>, CliFailure> {
  return Effect.suspend(() => {
    const env: Record<string, string> = Object.create(null);
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        return Effect.fail(
          failure(`--env expects K=V, got ${JSON.stringify(pair)}`),
        );
      }
      const key = pair.slice(0, eq);
      if (REJECTED_ENV_KEYS.has(key)) {
        return Effect.fail(
          failure(
            `--env cannot set ${JSON.stringify(key)} — it is a daemon-stamped locator, set authoritatively.`,
          ),
        );
      }
      env[key] = pair.slice(eq + 1);
    }
    return Effect.succeed(env);
  });
}

function cmdCreate(
  conn: Connection,
  endpoint: Endpoint,
  command: readonly string[],
  extraEnv: Record<string, string>,
  json: boolean,
): Effect.Effect<void, unknown> {
  // Compose the WHOLE fully-specified input client-side (the host derives
  // nothing since B0). We mint the id so the returned `id` echoes ours — the
  // same way kolu-server does. WHERE the facts come from depends on the
  // endpoint: a LOCAL daemon runs on THIS machine, so our own cwd/env/$SHELL
  // are its facts; a REMOTE one (`--host`) runs elsewhere, so we read its
  // `system.info` (shell/home) and ship a host-derived, minimal env rather than
  // a local cwd that may not exist there or a wholesale local `process.env`.
  return Effect.gen(function* () {
    let input: PtyHostSpawnInput;
    let home: string;
    if (endpoint.kind === "host") {
      const info = yield* conn.client.surface.system.info({});
      input = buildRemoteCreateInput({
        id: newPtyId(),
        host: { shell: info.shell, home: info.home, path: info.path },
        localEnv: process.env,
        command,
        extraEnv,
      });
      home = info.home;
    } else {
      // A local endpoint carries its resolved socket in the endpoint itself (main()
      // fills it at construction), so TS narrows both local arms to a present
      // string — no unset case to guard. Stamp it as KAVAL_SOCKET so a process
      // inside the new terminal can reach the daemon that owns it.
      input = buildCreateInput({
        id: newPtyId(),
        cwd: process.cwd(),
        env: process.env,
        command,
        extraEnv,
        kavalSocket: endpoint.socket,
      });
      home = homedir();
    }
    const result = yield* conn.client.surface.terminal.spawn(input);
    if (json) {
      // The raw { id, pid, cwd }, 2-space indented like `list --json`, with the
      // FULL id for scripts (`jq -r .id`). Controls are JSON-escaped, so — unlike
      // the human line — this path needs no sanitizing.
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    const program = input.argv[0] ?? "";
    yield* writeOut(`${formatCreate(result, { program, home })}\n`);
    // Next-step hint to stderr (stdout stays just the spawn line) — `create` is
    // the prerequisite for `attach`, so name the exact command to take it over,
    // carrying the SAME endpoint: a remote PTY is reached only with `--host`, and
    // an explicit `--socket` may not be the one autodiscovery would pick.
    yield* writeErr(
      `— attach with \`kaval-tui attach ${shortId(result.id)}${endpointHint(endpoint)}\`\n`,
    );
  });
}

/** Read all of stdin to a UTF-8 string — the `send` payload for a `< file`
 *  redirect, heredoc, or `| cmd` pipe. Called only when {@link stdinIsPayload}
 *  is true, so it never blocks on an interactive keyboard or an ambient socket. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Is fd 0 a DELIBERATE stdin payload — a `fifo` (`| cmd`) or a `regular file`
 *  (`< file` / a heredoc)? A bare `!isTTY` is too broad: an agent driving `send`
 *  from a subprocess inherits a `socket` on stdin (and `/dev/null` is a char
 *  device), neither of which is a payload the user piped in. Distinguishing them
 *  by `fstat` keeps `--file` usable in exactly that agent context (stdin isn't a
 *  competing source) while still catching a real `< file` collision. A closed or
 *  unstattable fd 0 is treated as "no payload" (fail-safe, not fail-loud — the
 *  absence of readable stdin, not a corrupt one). */
function stdinIsPayload(): boolean {
  try {
    const st = fstatSync(0);
    return st.isFIFO() || st.isFile();
  } catch {
    return false;
  }
}

/** Read the send TEXT from the resolved, pre-validated source. `resolveSendInput`
 *  has already rejected every illegal combination, so this just fetches from the
 *  one live source: the positional words re-joined (the shell already split
 *  them), a `--file` payload, piped stdin, or nothing (a keys-only send). */
function readSendText(
  input: SendInput,
  textArgs: readonly string[],
): Effect.Effect<string, unknown> {
  switch (input.kind) {
    case "positional":
      return Effect.succeed(textArgs.join(" "));
    case "stdin":
      // Node's stdin is an async iterable, not an Effect — the one genuinely
      // foreign Promise on this path, so it is LIFTED rather than composed.
      return Effect.tryPromise({ try: readStdin, catch: (err) => err });
    case "file":
      // The path rides the descriptor (no cast). Read it as raw UTF-8 — no shell
      // in the loop, so backticks / $( ) in the payload reach the wire byte-exact.
      return Effect.try({
        try: () => readFileSync(input.path, "utf8"),
        catch: (err) => {
          const e = err as NodeJS.ErrnoException;
          return new Error(
            `--file ${JSON.stringify(input.path)}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
          );
        },
      });
    case "none":
      return Effect.succeed("");
  }
}

/** Write input to a terminal — the *raw* write half of driving a program (a
 *  prompt to an agent). One-shot: it issues the planned `terminal.write` (bounded
 *  by the send write deadline) and exits, with no queue serialization (that
 *  guards `attach`'s concurrent keystroke+resize loop; a single send has nothing
 *  to race). It never synthesizes an Enter — submit is the caller's own separate
 *  `send <id> --key Enter`. */
function cmdSend(
  conn: Connection,
  id: string,
  textArgs: readonly string[],
  flags: {
    json: boolean;
    paste: boolean | undefined;
    key: readonly string[];
    /** The single validated text source (`resolveSendInput`), carrying its own
     *  payload locus — the `--file` path rides the descriptor. */
    input: SendInput;
  },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const text = yield* readSendText(flags.input, textArgs);

    // A text source that reads back EMPTY (an empty --file, an empty pipe/heredoc,
    // or a literal `send <id> ""`) has nothing to submit — fail loud instead of a
    // silent 0-byte "sent" that would mask the upstream failure that produced the
    // empty payload. `none` (a keys-only send) has no text and is exempt. Emptiness
    // is a property of the READ content, so it's caught here (post-read) rather than
    // in `resolveSendInput` (which validates the flag combination, pre-read).
    if (flags.input.kind !== "none" && text.length === 0) {
      return yield* Effect.fail(
        failure(
          `nothing to send — ${sourceLabel(flags.input)} is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use --key to send a key.`,
        ),
      );
    }

    // Encode the named/control keys up front so an unknown key fails loud BEFORE
    // any byte reaches the terminal (no half-send). Order is preserved.
    let keyData = "";
    for (const name of flags.key) {
      const bytes = encodeKey(name);
      if (bytes === undefined) {
        return yield* Effect.fail(
          failure(
            `unknown --key ${JSON.stringify(name)} — use a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
          ),
        );
      }
      keyData += bytes;
    }

    // The resolved source already settled text-vs-keys (a `none` source is a
    // keys-only send; anything else is a text send — `resolveSendInput` forbids the
    // mix), so pick the plan arm from it rather than re-sniffing `text.length`. That
    // keeps the single source of truth for "text vs keys" in `resolveSendInput` and
    // makes text+keys unspellable at the plan boundary.
    const plan =
      flags.input.kind === "none"
        ? planSend({ kind: "keys", keyData })
        : planSend({
            kind: "text",
            text,
            paste: flags.paste,
            // A --file or piped-stdin payload is a block, so it auto-pastes even
            // when single-line (a file is one payload, not a line typed at a prompt).
            fromStream: sourceIsStream(flags.input),
          });
    // Drive the plan through the shared executor: it issues the write under a
    // bounded write deadline, so a terminal that isn't draining fails loud
    // instead of hanging. The acceptance test runs this SAME function, so it
    // validates the shipped sequencing, not a replica.
    yield* executeSendPlan(
      plan,
      (data) => conn.client.surface.terminal.write({ id, data }),
      shortId(id),
    );

    const result = {
      id,
      bytes: plan.bytes,
      paste: plan.paste,
      keys: flags.key,
    };
    if (flags.json) {
      // Full id (for scripts), 2-space indented like `create --json`.
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    // Quiet stdout, status on stderr — there's no scriptable payload, so a non-json
    // send leaves stdout empty (`--json` is the machine path).
    yield* writeErr(`— ${formatSend(result)}\n`);
  });
}

/** Block until terminal `id`'s raw output meets `condition`, then map the
 *  outcome to output + exit code — the thin glue over `awaitOutputCondition`
 *  (the pure, testable data layer). Exit codes mirror `padi-tui wait`: 0 met ·
 *  2 timeout · 3 the terminal exited first · 130 interrupted · 1 link/usage
 *  error. */
function cmdWait(
  conn: Connection,
  id: string,
  condition: WaitCondition,
  opts: { json: boolean; timeoutMs?: number },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    // A Ctrl+C settles the wait as `interrupted` — an OUTCOME, not an
    // interruption, because `--json` must still emit a frame for it and the
    // trailer must still name the terminal left running.
    const outcome = yield* Effect.scoped(
      Effect.flatMap(shutdownRequest, (shutdown) =>
        awaitOutputCondition(conn.client, {
          id,
          condition,
          timeoutMs: opts.timeoutMs,
          stop: Deferred.await(shutdown.requested),
        }),
      ),
    );

    // One machine-readable frame for EVERY outcome (the full id, 2-space indented
    // like `create`/`send --json`), serialized from the single `waitResultJson`
    // source of truth and emitted before the exit-code branches below — so a
    // `--json` driver gets a structured `result` for met / timeout / gone /
    // interrupted / closed alike, never just a bare exit code.
    if (opts.json) {
      yield* writeOut(
        `${JSON.stringify(waitResultJson(id, outcome), null, 2)}\n`,
      );
    }

    if (outcome.kind === "met") {
      if (!opts.json) {
        const detail =
          outcome.fired === "match"
            ? `matched ${JSON.stringify(outcome.matchedLine)}`
            : "output idle";
        yield* writeErr(
          `— ${shortId(id)} ${detail} after ${outcome.elapsedMs}ms\n`,
        );
      }
      return;
    }
    if (outcome.kind === "timeout") {
      // Report `outcome.elapsedMs` (always populated by the data layer) rather
      // than `opts.timeoutMs` (which is `number | undefined`, so a future
      // non-timer `timeout` route couldn't silently print "undefinedms").
      return yield* Effect.fail(
        new WaitTimedOut({
          stderr: `kaval-tui: timed out after ${outcome.elapsedMs}ms waiting for ${shortId(id)} (output never met the condition).\n`,
        }),
      );
    }
    if (outcome.kind === "gone") {
      return yield* Effect.fail(
        new WaitTerminalGone({
          stderr: `kaval-tui: ${shortId(id)} exited before the condition was met — its terminal is gone.\n`,
        }),
      );
    }
    if (outcome.kind === "interrupted") {
      return yield* Effect.fail(
        new WaitInterrupted({
          stderr: `— interrupted; ${shortId(id)} left running\n`,
        }),
      );
    }
    // closed: the link dropped before the condition landed — a failure, not a
    // clean stop.
    return yield* Effect.fail(
      failure(
        outcome.error ??
          "the kaval link closed — the daemon stopped or the connection dropped. Is `kaval` still running?",
      ),
    );
  });
}

function cmdAttach(
  conn: Connection,
  id: string,
  escapeChar: string,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    if (!isValidEscapeChar(escapeChar)) {
      return yield* Effect.fail(
        failure(
          `--escape must be a single printable ASCII character, got ${JSON.stringify(escapeChar)}`,
        ),
      );
    }
    const stdio = yield* Stdio.Stdio;
    if (!(yield* stdio.stdinIsTerminal) || !(yield* stdio.stdoutIsTerminal)) {
      return yield* Effect.fail(
        failure(
          "attach needs an interactive terminal (stdin/stdout is not a tty) — for scripting, use `kaval-tui snapshot`.",
        ),
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
    // BELT AND BRACES, and BOTH are load-bearing. `runAttach`'s scope finalizer
    // is the braces: it restores on every path the fiber can take, including a
    // failure and an interrupt. This process-level hook is the BELT, for the two
    // paths NO finalizer can reach — `process.exit` (the signal handlers just
    // below, and every `process.exit` at the run edge) and a crash. Do not let
    // "Effect gives us finalizers now" delete it: a finalizer that never runs
    // leaves the user's shell in raw mode with the alt-buffer up.
    process.on("exit", restore);
    // In raw mode Ctrl+C arrives as byte 0x03 and is FORWARDED to the inner
    // program (the local tty generates no SIGINT) — these handlers only catch
    // *external* signals (kill, a closing terminal). Restore, then leave with
    // the conventional 128+n code; the daemon keeps the PTY either way. They
    // exit the PROCESS rather than settling an outcome, because there is no
    // screen state left worth reporting through: the tty is going away.
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

    const outcome = yield* runAttach(conn.client, id, {
      escape: escapeChar,
      tty,
    });
    restore();
    switch (outcome.kind) {
      case "detached":
        return yield* writeErr(
          `— detached · ${shortId(id)} stays live in the daemon\n`,
        );
      case "exited": {
        yield* writeErr(`— ${shortId(id)} exited (code ${outcome.exitCode})\n`);
        const code = attachExitCode(outcome.exitCode);
        // Mirror the child: a zero exit IS this command succeeding, so only a
        // non-zero one is a failure to carry out.
        return code === 0
          ? undefined
          : yield* Effect.fail(new AttachChildExited({ stderr: "", code }));
      }
      case "not-found":
        return yield* Effect.fail(
          failure(
            `no terminal ${shortId(id)} — \`kaval-tui list\` shows the live ones.`,
          ),
        );
      case "error":
        return yield* Effect.fail(failure(outcome.message));
    }
  });
}

/** Confirm the running daemon speaks a wire-compatible pty-host contract before
 *  we invoke any command — a newer kaval-tui against an older/different daemon
 *  would otherwise fail deep inside the RPC layer with an opaque schema/route
 *  error instead of an honest "restart it" line. A major mismatch (or a
 *  newer-minor daemon) is a clean, actionable failure here. A peer from a
 *  DIFFERENT protocol epoch cannot answer this at all (it cannot decode the
 *  frame) — that one is the transport's verdict, not this check's. */
function assertCompatible(conn: Connection): Effect.Effect<void, CliFailure> {
  return Effect.flatMap(
    Effect.catch(conn.client.surface.system.version({}), (err) =>
      Effect.fail(
        failure(
          `could not read the daemon's pty-host version (${(err as Error).message}) — is it a kaval (or kolu-server) new enough to expose \`system.version\`? Try restarting it.`,
        ),
      ),
    ),
    ({ contractVersion }) =>
      isContractVersionCompatible(contractVersion, PTY_HOST_CONTRACT_VERSION)
        ? Effect.void
        : Effect.fail(
            failure(
              `pty-host contract mismatch: the daemon speaks ${contractVersion}, kaval-tui needs ${PTY_HOST_CONTRACT_VERSION}. Restart it (and kaval-tui) to the same build.`,
            ),
          ),
  );
}

/** Dial the resolved endpoint, SCOPED — the link lives exactly as long as the
 *  caller's scope, so no verb can leak the protocol fibers a wire link holds.
 *  Both arms fail loud with the underlying reason so a misconfigured host (no
 *  passwordless ssh, the user not in the remote's `trusted-users`) or a dead
 *  socket reads as actionable rather than an opaque hang — the CLI is one-shot,
 *  so it surfaces the first failure instead of spinning on a reconnect loop. */
function connectTo(
  endpoint: Endpoint,
): Effect.Effect<Connection, CliFailure, Scope.Scope> {
  if (endpoint.kind === "host") {
    return Effect.flatMap(
      Effect.acquireRelease(
        Effect.catch(
          Effect.tryPromise({
            try: () =>
              dialAgentOnce(kavalHostDialOptions(endpoint.host, process.env)),
            catch: (err) => err,
          }),
          (err) =>
            Effect.fail(
              failure(
                `could not reach kaval on ${endpoint.host} — ${(err as Error).message}`,
              ),
            ),
        ),
        (dial) => Effect.sync(() => dial.dispose()),
      ),
      // The dial hands back a STRUCTURAL face plus the transport's tag-keyed
      // dispatch. We rebuild the face through kaval's own `ptyHostClientOver` so
      // both transports carry the identical spec-typed client and every `cmd*()`
      // stays transport-blind. `dispatch` is optional on the dial because it is a
      // property of the transport, not of the dial — every real ssh dial supplies
      // one, so its absence is a framework bug to crash on, never a shape to
      // degrade around.
      (dial) =>
        dial.dispatch === undefined
          ? Effect.fail(
              failure(
                `the ssh dial to ${endpoint.host} returned no transport dispatch — the kaval client cannot be built over it (a @kolu/surface-remote bug, not a host problem).`,
              ),
            )
          : Effect.succeed({ client: ptyHostClientOver(dial.dispatch) }),
    );
  }
  return Effect.catch(connectPtyHost(endpoint.socket), (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    // No hand-built path in the hint: a padi-spawned kaval is keyed by a DIGEST
    // of padi's state-root (`kaval-<digest>/`), so there is no single fixed path
    // to name — point at `kaval-tui list` (autodiscovery) or $KAVAL_SOCKET (set
    // inside any kolu terminal) instead of computing a wrong one.
    return Effect.fail(
      failure(
        `no socket at ${endpoint.socket}${code ? ` (${code})` : ""} — is a daemon running? Start a standalone one with \`kaval\`; the socket appears once it boots. To reach a padi-spawned kaval instead, run \`kaval-tui list\` to discover its socket (digest-keyed, so there is no fixed path), or use \`--socket "$KAVAL_SOCKET"\` from inside a kolu terminal.`,
      ),
    );
  });
}

// ── The one program, and the one run edge ────────────────────────────────

function program(): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    // cleye already handled --help / --version (it prints and exits). We land here
    // with no command in two cases: bare `kaval-tui` (no args → show help), or the
    // common trap of a flag BEFORE the subcommand (`kaval-tui --socket X list`) —
    // cleye binds flags only after the command, so a leading flag swallows it and
    // cleye finds no command. Steer that case to the right order instead of
    // dumping bare help (which is what made the mistake look like a no-op).
    if (argv.command === undefined) {
      if (process.argv.length > 2) {
        return yield* Effect.fail(
          failure(
            "no command. Flags go AFTER the subcommand — try `kaval-tui list --socket <path>` (not `kaval-tui --socket <path> list`). `kaval-tui --help` lists the commands.",
          ),
        );
      }
      argv.showHelp();
      return yield* Effect.fail(new CliFailure({ stderr: "" }));
    }

    // Pick the transport: --host reaches a remote kaval over ssh; otherwise dial a
    // local socket. They name two different daemons (an ssh target vs a path), so
    // passing both is a usage error rather than a precedence puzzle.
    if (argv.flags.host !== undefined && argv.flags.socket !== undefined) {
      return yield* Effect.fail(
        failure(
          "--host and --socket are mutually exclusive: --host reaches a remote kaval over ssh, --socket dials a local one. Pass just one.",
        ),
      );
    }

    // `wait`'s flag checks are pure (no daemon), so validate them BEFORE the dial:
    // a bad `--until`/`--timeout` fails fast with no connection to tear down and,
    // under --host, no Nix provisioning of a daemon we'd just drop. `waitCall`
    // captures the WHOLE validated wait invocation (condition + its output opts)
    // and is non-null exactly when the command is `wait` — so the dispatch below
    // keys off it directly, "wait implies a parsed condition" carried as a value
    // rather than re-derived by a "can't happen" guard at the use site.
    let waitCall: {
      condition: WaitCondition;
      json: boolean;
      timeoutMs: number | undefined;
    } | null = null;
    if (argv.command === "wait") {
      if (argv.flags.until === undefined) {
        return yield* Effect.fail(
          failure(
            "--until is required — e.g. `kaval-tui wait <id> --until idle:800` or `--until match:'DONE'`.",
          ),
        );
      }
      const parsed = parseUntil(argv.flags.until);
      if (parsed.kind === "error")
        return yield* Effect.fail(failure(parsed.message));
      if (
        argv.flags.timeout !== undefined &&
        !isValidTimerMs(argv.flags.timeout)
      ) {
        // Cap at the setTimeout ceiling (~24.8 days): a larger timeout would
        // overflow and fire near-instantly, so reject it rather than coerce.
        return yield* Effect.fail(
          failure(
            `--timeout must be a positive number of milliseconds ≤ ${MAX_TIMER_MS} (~24.8 days).`,
          ),
        );
      }
      waitCall = {
        condition: parsed,
        json: argv.flags.json,
        timeoutMs: argv.flags.timeout,
      };
    }

    // `send`'s flag checks are pure too, so validate them BEFORE the dial, same as
    // `wait`: a conflicting flag fails fast with no connection to tear down (and,
    // under --host, no daemon to provision then drop). `sendCall` carries the whole
    // validated invocation — the resolved paste tristate, the keys, the resolved
    // text source, and the output mode — and is non-null exactly when the command
    // is `send`, so the dispatch keys off it directly.
    let sendCall: {
      text: readonly string[];
      paste: boolean | undefined;
      key: readonly string[];
      input: SendInput;
      json: boolean;
    } | null = null;
    if (argv.command === "send") {
      // `send`'s flags are a closed set, so an unknown flag is a typo or a removed
      // flag — fail loud, never silently ignore (a `--submit` quietly dropped would
      // send the text UNSUBMITTED, the exact footgun this command removed). `--submit`
      // gets a migration message; cleye collects the rest in `unknownFlags`.
      yield* Effect.try({
        try: () => rejectUnknownSendFlags(Object.keys(argv.unknownFlags)),
        catch: (err) => failure((err as Error).message),
      });
      // Validate the WHOLE send-input combination and resolve the single text
      // source — the paste/no-paste exclusion, text+--key, two sources at once, and
      // the empty send all live in this ONE pure validator, pre-dial. It throws a
      // teaching error surfaced as `kaval-tui:` by the run edge; `stdinIsPayload()`
      // `fstat`s fd 0 so an agent's ambient socket stdin doesn't read as a source.
      const input = yield* Effect.try({
        try: () =>
          resolveSendInput({
            hasPositional: argv._.text.length > 0,
            file: argv.flags.file,
            stdinIsPayload: stdinIsPayload(),
            hasKeys: argv.flags.key.length > 0,
            paste: argv.flags.paste === true,
            noPaste: argv.flags.noPaste === true,
          }),
        catch: (err) => failure((err as Error).message),
      });
      sendCall = {
        text: argv._.text,
        // Tristate: `--paste` forces on, `--no-paste` off, neither = auto. (The
        // both-set conflict is already rejected by resolveSendInput above.)
        paste: argv.flags.paste ? true : argv.flags.noPaste ? false : undefined,
        key: argv.flags.key,
        input,
        json: argv.flags.json,
      };
    }
    // Validate `--env` PRE-DIAL too (mirrors `sendCall`): a malformed `K=V` or a
    // rejected key must fail BEFORE `--host` provisions the closure and launches a
    // remote `kaval --stdio` — otherwise the loud validation error lands after the
    // expensive, side-effecting remote spawn. `env` is a create-only flag.
    const createEnv =
      argv.command === "create"
        ? yield* parseEnvAssignments(argv.flags.env)
        : {};

    // The endpoint this command targets — its transport AND the suffix that
    // re-targets a later `attach` at the same daemon (see `endpointHint`). A local
    // endpoint resolves its socket ONCE here, up front, and CARRIES it: we dial it
    // AND (for `create`) stamp it as KAVAL_SOCKET into the spawned terminal, so an
    // agent inside can reach the daemon that owns it (the $TMUX convention). The
    // resolved path lives on the endpoint itself, so both local arms are known to
    // carry a socket — no parallel nullable to reconcile.
    const endpoint: Endpoint =
      argv.flags.host !== undefined
        ? { kind: "host", host: argv.flags.host }
        : yield* Effect.map(
            resolveSocketPath(argv.flags.socket),
            (socket): Endpoint =>
              argv.flags.socket !== undefined
                ? { kind: "socket", socket }
                : { kind: "default", socket },
          );

    // ONE scope for the whole command: the link is released on the way out
    // whichever way we leave — a returned value, a tagged failure, or an
    // interrupt — with no `finally` to forget and nothing left un-awaited.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const conn = yield* connectTo(endpoint);
        yield* assertCompatible(conn);
        // Closed dispatch: every command is named, and the final else fails loud
        // — so a future addition that forgets a branch here cannot silently fall
        // through into another command's handler. (cleye already exits on commands
        // not in its registry; this guards OUR omissions.)
        if (argv.command === "list") {
          return yield* cmdList(conn, argv.flags.json);
        }
        if (argv.command === "create") {
          return yield* cmdCreate(
            conn,
            endpoint,
            argv._.command,
            createEnv,
            argv.flags.json,
          );
        }
        if (argv.command === "snapshot") {
          // `--viewport`, `--tail`, and `--lines` (a synonym for `--tail`) each
          // bound the output differently, so more than one is ambiguous — crash
          // loud rather than silently pick a precedence. `--tail`/`--lines`
          // collapse to one `tailLines`; both set is the same conflict.
          const { viewport, tail, lines } = argv.flags;
          const bounds = [
            viewport && "--viewport",
            tail !== undefined && "--tail",
            lines !== undefined && "--lines",
          ].filter(Boolean);
          if (bounds.length > 1) {
            return yield* Effect.fail(
              failure(
                `${bounds.join(" and ")} are mutually exclusive — pass at most one (omit all for the full scrollback).`,
              ),
            );
          }
          const tailLines = tail ?? lines;
          if (
            tailLines !== undefined &&
            (!Number.isInteger(tailLines) || tailLines < 0)
          ) {
            return yield* Effect.fail(
              failure(
                `--tail/--lines takes a non-negative whole number of lines, got ${JSON.stringify(tailLines)}.`,
              ),
            );
          }
          return yield* cmdSnapshot(conn, yield* resolveOne(conn, argv._.id), {
            viewport,
            tailLines,
          });
        }
        if (argv.command === "history") {
          const { lines } = argv.flags;
          if (lines !== undefined && (!Number.isInteger(lines) || lines <= 0)) {
            return yield* Effect.fail(
              failure(
                `--lines takes a positive whole number of lines, got ${JSON.stringify(lines)}.`,
              ),
            );
          }
          return yield* cmdHistory(conn, yield* resolveOne(conn, argv._.id), {
            lines,
          });
        }
        if (sendCall !== null) {
          // `sendCall` is non-null exactly when the command is `send` (parsed +
          // validated pre-dial above), so keying the branch off it carries the
          // validated invocation straight through — mirrors the `waitCall` dispatch.
          return yield* cmdSend(
            conn,
            yield* resolveOne(conn, argv._.id),
            sendCall.text,
            {
              json: sendCall.json,
              paste: sendCall.paste,
              key: sendCall.key,
              input: sendCall.input,
            },
          );
        }
        if (waitCall !== null) {
          // `waitCall` is non-null exactly when the command is `wait` (parsed +
          // validated pre-dial above), so keying the branch off it — rather than
          // re-checking `argv.command === "wait"` and re-narrowing with an internal
          // "can't happen" guard — carries the validated invocation straight through
          // (mirrors padi-tui's `waitTargets !== null` dispatch).
          return yield* cmdWait(
            conn,
            yield* resolveOne(conn, argv._.id),
            waitCall.condition,
            { json: waitCall.json, timeoutMs: waitCall.timeoutMs },
          );
        }
        if (argv.command === "attach") {
          return yield* cmdAttach(
            conn,
            yield* resolveOne(conn, argv._.id),
            argv.flags.escape,
          );
        }
        if (argv.command === "kill") {
          return yield* runKill(
            conn,
            yield* resolveOne(conn, argv._.id),
            (line) => process.stderr.write(line),
          );
        }
        return yield* Effect.fail(
          failure("unhandled command — add a dispatch branch for it"),
        );
      }),
    );
  });
}

/** THE exit map, at THE run edge — the whole of it, because `exit.ts` already
 *  made each arm carry its own line and its own code. */
Effect.runPromiseExit(program().pipe(Effect.provide(NodeStdio.layer))).then(
  (exit) => {
    if (Exit.isSuccess(exit)) process.exit(0);
    const error = Cause.squash(exit.cause);
    process.stderr.write(reportOf(error));
    process.exit(exitCodeOf(error));
  },
);
