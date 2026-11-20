import { fstatSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { NodeSink } from "@effect/platform-node";
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
  Stream,
} from "effect";
import {
  PTY_HOST_CONTRACT_VERSION,
  ptyHostClientOver,
  type PtyHostSpawnInput,
  resolveRunningKavalSocket,
} from "kaval";
import { CONTAINING_TERMINAL_ENV } from "kolu-pty";
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

const hostFlag = {
  host: {
    type: String,
    description:
      "reach a kaval on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. kaval runs as the SSH user, so you reach the kaval owned by that user (its socket dir is 0700, owner-only); SSH in as the user that runs kaval. The remote PTYs survive the link (create on the host, attach to it later). Mutually exclusive with --socket. Goes AFTER the subcommand.",
  },
} as const;

const endpointFlags = { ...socketFlag, ...hostFlag } as const;

type Endpoint =
  | { kind: "host"; host: string }
  | { kind: "socket"; socket: string }
  | { kind: "default"; socket: string };

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
        // cleye/type-flag has no `--no-<flag>` negation for a Boolean: it lands
        // in `unknownFlags`, so the off-switch has to be its own flag.
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

class StdoutClosed extends Data.TaggedError("StdoutClosed")<{
  readonly cause: unknown;
}> {}

const stdoutSink: Sink.Sink<void, string, never, StdoutClosed> =
  NodeSink.fromWritable<StdoutClosed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutClosed({ cause }),
    endOnDone: false,
  });

const writeOut = (text: string): Effect.Effect<void> =>
  Stream.run(Stream.make(text), stdoutSink).pipe(
    Effect.catchTag("StdoutClosed", () => Effect.void),
  );

const writeOutLine = (text: string): Effect.Effect<void> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`);

const writeErr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

interface ShutdownRequest {
  readonly requested: Deferred.Deferred<void>;
}

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
    const lines = text ? text.replace(/\n+$/, "").split("\n").length : 0;
    yield* writeErr(
      `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
    );
  });
}

const HISTORY_PAGE_ROWS = 1000;

function cmdHistory(
  conn: Connection,
  id: string,
  opts: { lines: number | undefined },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const onePage = opts.lines;
    if (onePage !== undefined) {
      const res = yield* conn.client.surface.terminal.getHistory({
        id,
        max: onePage,
      });
      if (res.kind === "chunk" && res.chunk) yield* writeOutLine(res.chunk);
      yield* writeErr(`— ${shortId(id)} · older history (≤${onePage} lines)\n`);
      return;
    }
    const pages: string[] = [];
    let before: number | undefined;
    for (;;) {
      const res = yield* conn.client.surface.terminal.getHistory({
        id,
        ...(before === undefined ? {} : { before }),
        max: HISTORY_PAGE_ROWS,
      });
      if (res.kind === "stale") break;
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

const REJECTED_ENV_KEYS = new Set([CONTAINING_TERMINAL_ENV, "KAVAL_SOCKET"]);

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
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    const program = input.argv[0] ?? "";
    yield* writeOut(`${formatCreate(result, { program, home })}\n`);
    yield* writeErr(
      `— attach with \`kaval-tui attach ${shortId(result.id)}${endpointHint(endpoint)}\`\n`,
    );
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function stdinIsPayload(): boolean {
  try {
    const st = fstatSync(0);
    return st.isFIFO() || st.isFile();
  } catch {
    return false;
  }
}

function readSendText(
  input: SendInput,
  textArgs: readonly string[],
): Effect.Effect<string, unknown> {
  switch (input.kind) {
    case "positional":
      return Effect.succeed(textArgs.join(" "));
    case "stdin":
      return Effect.tryPromise({ try: readStdin, catch: (err) => err });
    case "file":
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

function cmdSend(
  conn: Connection,
  id: string,
  textArgs: readonly string[],
  flags: {
    json: boolean;
    paste: boolean | undefined;
    key: readonly string[];
    input: SendInput;
  },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const text = yield* readSendText(flags.input, textArgs);

    if (flags.input.kind !== "none" && text.length === 0) {
      return yield* Effect.fail(
        failure(
          `nothing to send — ${sourceLabel(flags.input)} is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use --key to send a key.`,
        ),
      );
    }

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

    const plan =
      flags.input.kind === "none"
        ? planSend({ kind: "keys", keyData })
        : planSend({
            kind: "text",
            text,
            paste: flags.paste,
            fromStream: sourceIsStream(flags.input),
          });
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
      return yield* writeOut(`${JSON.stringify(result, null, 2)}\n`);
    }
    yield* writeErr(`— ${formatSend(result)}\n`);
  });
}

function cmdWait(
  conn: Connection,
  id: string,
  condition: WaitCondition,
  opts: { json: boolean; timeoutMs?: number },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
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
    return yield* Effect.fail(
      failure(
        outcome.error ??
          "the kaval link closed — the daemon stopped or the connection dropped. Is `kaval` still running?",
      ),
    );
  });
}

const STDOUT_GONE_CODES: Record<string, true> = {
  EPIPE: true,
  EBADF: true,
  EIO: true,
  ENXIO: true,
};

function cmdAttach(
  conn: Connection,
  id: string,
  escapeChar: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    if (!isValidEscapeChar(escapeChar)) {
      return yield* Effect.fail(
        failure(
          `--escape must be a single printable ASCII character, got ${JSON.stringify(escapeChar)}`,
        ),
      );
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return yield* Effect.fail(
        failure(
          "attach needs an interactive terminal (stdin/stdout is not a tty) — for scripting, use `kaval-tui snapshot`.",
        ),
      );
    }

    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      try {
        writeSync(process.stdout.fd, TTY_RESET);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (STDOUT_GONE_CODES[code] !== true) throw err;
      }
    };
    process.on("exit", restore);
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
    return Effect.fail(
      failure(
        `no socket at ${endpoint.socket}${code ? ` (${code})` : ""} — is a daemon running? Start a standalone one with \`kaval\`; the socket appears once it boots. To reach a padi-spawned kaval instead, run \`kaval-tui list\` to discover its socket (digest-keyed, so there is no fixed path), or use \`--socket "$KAVAL_SOCKET"\` from inside a kolu terminal.`,
      ),
    );
  });
}

type ParsedCall =
  | {
      readonly kind: "wait";
      readonly condition: WaitCondition;
      readonly json: boolean;
      readonly timeoutMs: number | undefined;
    }
  | {
      readonly kind: "send";
      readonly text: readonly string[];
      readonly paste: boolean | undefined;
      readonly key: readonly string[];
      readonly input: SendInput;
      readonly json: boolean;
    }
  | { readonly kind: "none" };

function program(): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
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

    if (argv.flags.host !== undefined && argv.flags.socket !== undefined) {
      return yield* Effect.fail(
        failure(
          "--host and --socket are mutually exclusive: --host reaches a remote kaval over ssh, --socket dials a local one. Pass just one.",
        ),
      );
    }

    let parsedCall: ParsedCall = { kind: "none" };
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
        return yield* Effect.fail(
          failure(
            `--timeout must be a positive number of milliseconds ≤ ${MAX_TIMER_MS} (~24.8 days).`,
          ),
        );
      }
      parsedCall = {
        kind: "wait",
        condition: parsed,
        json: argv.flags.json,
        timeoutMs: argv.flags.timeout,
      };
    }

    if (argv.command === "send") {
      yield* Effect.try({
        try: () => rejectUnknownSendFlags(Object.keys(argv.unknownFlags)),
        catch: (err) => failure((err as Error).message),
      });
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
      parsedCall = {
        kind: "send",
        text: argv._.text,
        paste: argv.flags.paste ? true : argv.flags.noPaste ? false : undefined,
        key: argv.flags.key,
        input,
        json: argv.flags.json,
      };
    }
    const createEnv =
      argv.command === "create"
        ? yield* parseEnvAssignments(argv.flags.env)
        : {};

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

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const conn = yield* connectTo(endpoint);
        yield* assertCompatible(conn);
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
        if (parsedCall.kind === "send") {
          return yield* cmdSend(
            conn,
            yield* resolveOne(conn, argv._.id),
            parsedCall.text,
            {
              json: parsedCall.json,
              paste: parsedCall.paste,
              key: parsedCall.key,
              input: parsedCall.input,
            },
          );
        }
        if (parsedCall.kind === "wait") {
          return yield* cmdWait(
            conn,
            yield* resolveOne(conn, argv._.id),
            parsedCall.condition,
            { json: parsedCall.json, timeoutMs: parsedCall.timeoutMs },
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

Effect.runPromiseExit(program()).then((exit) => {
  if (Exit.isSuccess(exit)) process.exit(0);
  const error = Cause.squash(exit.cause);
  process.stderr.write(reportOf(error));
  process.exit(exitCodeOf(error));
});
