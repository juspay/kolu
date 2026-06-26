/**
 * kaval-tui — a terminal-side client for a running `kaval` daemon
 * (`list` + `create` + `snapshot` + `attach` + `kill`). It dials kaval's unix socket
 * via `unixSocketLink` and speaks `ptyHostSurface` directly — the *raw* client
 * (the browser is the *rich* one over the full kolu contract).
 * See `docs/atlas/src/content/atlas/pty-daemon-tui.mdx`.
 *
 *   kaval-tui list [--json]     list your live terminals (id · pid · idle · cwd)
 *   kaval-tui create [-- cmd]   spawn a new terminal ($SHELL or cmd), print its id
 *   kaval-tui snapshot <id>     print a terminal's current scrollback, then exit
 *   kaval-tui send <id> [text]  write input to a terminal (a prompt to an agent), then exit
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
 *                   same client over a different transport (see `hostConnect.ts`).
 *                   A remote PTY survives the link: `create` on prod, then a
 *                   later `attach` finds it.
 *
 * The CLI comes and goes; the daemon keeps owning the PTYs — `create` mints one,
 * the daemon holds it until `kill` (or another client) ends it.
 */
import { writeSync } from "node:fs";
import { homedir } from "node:os";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { SNAPSHOT_TTY_RESET as TTY_RESET } from "@kolu/terminal-protocol";
import { cli, command } from "cleye";
import {
  getPtyHostSocketPath,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostSpawnInput,
  resolveRunningKavalSocket,
} from "kaval";
import { type AttachTty, runAttach } from "./attach.ts";
import { type Connection, connectPtyHost } from "./connect.ts";
import {
  buildCreateInput,
  buildRemoteCreateInput,
  formatCreate,
  newPtyId,
} from "./create.ts";
import { isValidEscapeChar } from "./escape.ts";
import { connectPtyHostViaHost } from "./hostConnect.ts";
import { runKill } from "./kill.ts";
import { encodeKey, formatSend, planSend } from "./send.ts";
import { shellQuoteArg } from "@kolu/shell-quote";
import {
  formatList,
  formatListJson,
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
      "socket to dial — goes AFTER the subcommand. Default: kaval's own, $XDG_RUNTIME_DIR/kaval/pty-host.sock (or /tmp/kaval-$UID/pty-host.sock when $XDG_RUNTIME_DIR is unset). To reach a running kolu-server, pass ITS socket: $XDG_RUNTIME_DIR/kolu/pty-host.sock (or /tmp/kolu-$UID/pty-host.sock when $XDG_RUNTIME_DIR is unset — e.g. over ssh / a non-login session).",
  },
} as const;

// --host reaches a REMOTE kaval over ssh, provisioning it with Nix. Mutually
// exclusive with --socket (a local path); the conflict is rejected in main().
const hostFlag = {
  host: {
    type: String,
    description:
      "reach a kaval on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. The remote PTYs survive the link (create on the host, attach to it later). Mutually exclusive with --socket. Goes AFTER the subcommand.",
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
  | { kind: "default" };

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
          "Spawn a new terminal and print its id; the daemon owns it. Runs a plain $SHELL by default, or the command you pass — prefix it with `--` when it takes its own flags: `kaval-tui create -- htop -d 5`. Then `kaval-tui attach <id>` to take it over.",
      },
      flags: {
        ...endpointFlags,
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
          "Print a terminal's current rendered scrollback. <id> is the short id from `list` or any unique prefix.",
      },
      flags: { ...endpointFlags },
    }),
    command({
      name: "send",
      parameters: ["<id>", "[text...]"],
      help: {
        description:
          "Write input to a terminal — e.g. a prompt to a Claude Code / Codex / opencode agent running in it. Sends EXACTLY the text (and any `--key`s) you pass — no implicit Enter. To submit a prompt, send Enter as its own step: `kaval-tui send <id> --key Enter`. Multiline or piped-stdin text is sent as one bracketed paste so it lands as a block, not line-by-line. Text comes from the positional words or stdin; `--key` sends named/control keys (Enter, Escape, C-c, Up…) after it. <id> is the short id from `list` or any unique prefix.",
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
            "a named/control key to send after the text — repeatable, in order. Pass `--key Enter` to submit. Names: Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space; chords: C-c, M-b.",
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

/** Backpressure-aware stdout write — a large scrollback to a pipe must drain
 *  before we exit, or the tail is truncated. EPIPE (e.g. `kaval-tui list | head
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
  process.stderr.write(`kaval-tui: ${message}\n`);
  process.exit(1);
}

/** Resolve a user-typed id-or-prefix to a full terminal id against the live
 *  inventory, failing loudly on no-match or ambiguity. `attach`/`snapshot` run
 *  this first so a short id (the form `list` prints) or any unique prefix
 *  reaches the contract — which validates a full uuid — as the real id. The
 *  list round-trip is cheap and the inventory is the only truth for what's
 *  live; an ambiguous prefix names the matches so the user can add characters. */
async function resolveOne(conn: Connection, query: string): Promise<string> {
  const { entries } = await conn.client.surface.terminal.list({});
  const result = resolveTerminalId(
    query,
    entries.map((e) => e.id),
  );
  if (result.kind === "found") return result.id;
  if (result.kind === "none") {
    fail(
      `no terminal matching "${query}" — \`kaval-tui list\` shows the live ones.`,
    );
  }
  fail(
    `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
      .map(shortId)
      .join("\n  ")}`,
  );
}

/** The socket to dial. The selection policy (explicit `--socket` wins; else
 *  discover the running daemon; one→use it; many→ambiguous; none→bare default)
 *  plus the candidate labels live in `kaval`'s `resolveRunningKavalSocket` —
 *  beside the namespace construction they invert — so here kaval-tui only renders
 *  the `many` case as its own `--socket`-flavored `fail()`. */
function resolveSocketPath(override: string | undefined): string {
  const resolved = resolveRunningKavalSocket(override);
  if (resolved.kind === "many") {
    fail(
      `more than one kaval daemon is running:\n  ${resolved.candidates
        .map(({ socket, label }) => `${socket}    (${label})`)
        .join("\n  ")}\nPass --socket <path> to pick one.`,
    );
  }
  return resolved.socket;
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
  process.stderr.write(
    `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
  );
}

async function cmdCreate(
  conn: Connection,
  endpoint: Endpoint,
  command: readonly string[],
  json: boolean,
): Promise<void> {
  // Compose the WHOLE fully-specified input client-side (the host derives
  // nothing since B0). We mint the id so the returned `id` echoes ours — the
  // same way kolu-server does. WHERE the facts come from depends on the
  // endpoint: a LOCAL daemon runs on THIS machine, so our own cwd/env/$SHELL
  // are its facts; a REMOTE one (`--host`) runs elsewhere, so we read its
  // `system.info` (shell/home) and ship a host-derived, minimal env rather than
  // a local cwd that may not exist there or a wholesale local `process.env`.
  let input: PtyHostSpawnInput;
  let home: string;
  if (endpoint.kind === "host") {
    const info = await conn.client.surface.system.info({});
    input = buildRemoteCreateInput({
      id: newPtyId(),
      host: { shell: info.shell, home: info.home, path: info.path },
      localEnv: process.env,
      command,
    });
    home = info.home;
  } else {
    input = buildCreateInput({
      id: newPtyId(),
      cwd: process.cwd(),
      env: process.env,
      command,
    });
    home = homedir();
  }
  const result = await conn.client.surface.terminal.spawn(input);
  if (json) {
    // The raw { id, pid, cwd }, 2-space indented like `list --json`, with the
    // FULL id for scripts (`jq -r .id`). Controls are JSON-escaped, so — unlike
    // the human line — this path needs no sanitizing.
    await writeOut(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const program = input.argv[0] ?? "";
  await writeOut(`${formatCreate(result, { program, home })}\n`);
  // Next-step hint to stderr (stdout stays just the spawn line) — `create` is
  // the prerequisite for `attach`, so name the exact command to take it over,
  // carrying the SAME endpoint: a remote PTY is reached only with `--host`, and
  // an explicit `--socket` may not be the one autodiscovery would pick.
  process.stderr.write(
    `— attach with \`kaval-tui attach ${shortId(result.id)}${endpointHint(endpoint)}\`\n`,
  );
}

/** Read all of stdin to a UTF-8 string — the `send` payload when no positional
 *  text is given (a piped file or heredoc). Called only when stdin is NOT a tty,
 *  so it never blocks on an interactive keyboard. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Write input to a terminal — the *raw* write half of driving a program (a
 *  prompt to an agent). One-shot: it issues each planned `terminal.write` in
 *  order and exits, with no `enqueue` serialization (that guards `attach`'s
 *  concurrent keystroke+resize loop; a single send has nothing to race). */
async function cmdSend(
  conn: Connection,
  id: string,
  textArgs: readonly string[],
  flags: {
    json: boolean;
    paste: boolean | undefined;
    key: readonly string[];
  },
): Promise<void> {
  // The text to send: the positional words re-joined (the shell already split
  // them), or piped stdin when no positional is given. Read stdin only when it's
  // not a tty, so an interactive `send <id>` with nothing to say fails loud below
  // instead of blocking on the keyboard.
  let text = textArgs.join(" ");
  let fromStdin = false;
  if (text === "" && !process.stdin.isTTY) {
    text = await readStdin();
    fromStdin = true;
  }

  // Encode the named/control keys up front so an unknown key fails loud BEFORE
  // any byte reaches the terminal (no half-send). Order is preserved.
  let keyData = "";
  for (const name of flags.key) {
    const bytes = encodeKey(name);
    if (bytes === undefined) {
      fail(
        `unknown --key ${JSON.stringify(name)} — use a name (Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space) or a chord (C-c, M-b).`,
      );
    }
    keyData += bytes;
  }

  if (text === "" && keyData === "") {
    fail(
      'nothing to send — pass text, pipe it on stdin, or use --key (e.g. `kaval-tui send <id> "hello"` or `kaval-tui send <id> --key Escape`).',
    );
  }

  const plan = planSend({ text, paste: flags.paste, fromStdin, keyData });
  // Issue each write in order; awaiting in turn preserves order and applies
  // natural backpressure. Text is one write, the keys another — so a `--key
  // Enter` submit lands after the (possibly pasted) text, not inside its write.
  for (const data of plan.writes) {
    await conn.client.surface.terminal.write({ id, data });
  }

  const result = {
    id,
    bytes: plan.bytes,
    paste: plan.paste,
    keys: flags.key,
  };
  if (flags.json) {
    // Full id (for scripts), 2-space indented like `create --json`.
    await writeOut(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  // Quiet stdout, status on stderr — there's no scriptable payload, so a non-json
  // send leaves stdout empty (`--json` is the machine path).
  process.stderr.write(`— ${formatSend(result)}\n`);
}

async function cmdAttach(
  conn: Connection,
  id: string,
  escapeChar: string,
): Promise<never> {
  if (!isValidEscapeChar(escapeChar)) {
    fail(
      `--escape must be a single printable ASCII character, got ${JSON.stringify(escapeChar)}`,
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "attach needs an interactive terminal (stdin/stdout is not a tty) — for scripting, use `kaval-tui snapshot`.",
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
  process.on("exit", restore);
  // In raw mode Ctrl+C arrives as byte 0x03 and is FORWARDED to the inner
  // program (the local tty generates no SIGINT) — these handlers only catch
  // *external* signals (kill, a closing terminal). Restore, then leave with
  // the conventional 128+n code; the daemon keeps the PTY either way.
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

  const outcome = await runAttach(conn.client, id, {
    escape: escapeChar,
    tty,
  });
  restore();
  switch (outcome.kind) {
    case "detached":
      process.stderr.write(
        `— detached · ${shortId(id)} stays live in the daemon\n`,
      );
      process.exit(0);
      break;
    case "exited":
      process.stderr.write(
        `— ${shortId(id)} exited (code ${outcome.exitCode})\n`,
      );
      // Mirror the child where possible; anything unrepresentable (negative /
      // >255 — node clamps modulo 256) degrades to the generic failure 1.
      process.exit(
        outcome.exitCode >= 0 && outcome.exitCode <= 255 ? outcome.exitCode : 1,
      );
      break;
    case "not-found":
      fail(
        `no terminal ${shortId(id)} — \`kaval-tui list\` shows the live ones.`,
      );
      break;
    case "error":
      fail(outcome.message);
  }
  // Unreachable (every branch exits) — but TS needs the function to end.
  process.exit(1);
}

/** Confirm the running daemon speaks a wire-compatible pty-host contract before
 *  we invoke any command — a newer kaval-tui against an older/different daemon
 *  would otherwise fail deep inside oRPC with an opaque schema/procedure error
 *  instead of an honest "restart it" line. A major mismatch (or a newer-minor
 *  daemon) is a clean, actionable failure here. */
async function assertCompatible(conn: Connection): Promise<void> {
  const { contractVersion } = await conn.client.surface.system
    .version({})
    .catch((err: Error) => {
      throw new Error(
        `could not read the daemon's pty-host version (${err.message}) — is it a kaval (or kolu-server) new enough to expose \`system.version\`? Try restarting it.`,
      );
    });
  if (
    !isContractVersionCompatible(contractVersion, PTY_HOST_CONTRACT_VERSION)
  ) {
    fail(
      `pty-host contract mismatch: the daemon speaks ${contractVersion}, kaval-tui needs ${PTY_HOST_CONTRACT_VERSION}. Restart it (and kaval-tui) to the same build.`,
    );
  }
}

/** Dial a LOCAL kaval (or kolu-server) over its unix socket — an explicit
 *  `--socket`, else the discovered/default one. Fails loud with an actionable
 *  hint if nothing is listening. */
function connectLocal(socketOverride: string | undefined): Promise<Connection> {
  const socketPath = resolveSocketPath(socketOverride);
  return connectPtyHost(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    // The kolu-server hint names the SAME path kolu computes — and the
    // $XDG_RUNTIME_DIR-unset fallback (e.g. over ssh), the exact case where a
    // hand-built `$XDG_RUNTIME_DIR/kolu/...` collapses to a wrong `/kolu/...`.
    const koluSock = getPtyHostSocketPath(undefined, "kolu");
    return fail(
      `no socket at ${socketPath}${code ? ` (${code})` : ""} — is kaval running? Start it with \`kaval\`; the socket appears once it boots. To reach a running kolu-server instead, point at its socket: \`--socket ${koluSock}\`.`,
    );
  });
}

/** Reach a REMOTE kaval over ssh (`--host`): provision the daemon with Nix and
 *  dial it. Fails loud with the underlying ssh/nix error so a misconfigured host
 *  (no passwordless ssh, the user not in the remote's `trusted-users`) reads as
 *  actionable rather than an opaque hang — the CLI is one-shot, so it surfaces
 *  the first failure instead of spinning on HostSession's reconnect loop. */
function connectHost(host: string): Promise<Connection> {
  return connectPtyHostViaHost(host).catch((err) =>
    fail(`could not reach kaval on ${host} — ${(err as Error).message}`),
  );
}

async function main(): Promise<void> {
  // cleye already handled --help / --version (it prints and exits). We land here
  // with no command in two cases: bare `kaval-tui` (no args → show help), or the
  // common trap of a flag BEFORE the subcommand (`kaval-tui --socket X list`) —
  // cleye binds flags only after the command, so a leading flag swallows it and
  // cleye finds no command. Steer that case to the right order instead of
  // dumping bare help (which is what made the mistake look like a no-op).
  if (argv.command === undefined) {
    if (process.argv.length > 2) {
      fail(
        "no command. Flags go AFTER the subcommand — try `kaval-tui list --socket <path>` (not `kaval-tui --socket <path> list`). `kaval-tui --help` lists the commands.",
      );
    }
    argv.showHelp();
    process.exit(1);
  }

  // Pick the transport: --host reaches a remote kaval over ssh; otherwise dial a
  // local socket. They name two different daemons (an ssh target vs a path), so
  // passing both is a usage error rather than a precedence puzzle.
  if (argv.flags.host !== undefined && argv.flags.socket !== undefined) {
    fail(
      "--host and --socket are mutually exclusive: --host reaches a remote kaval over ssh, --socket dials a local one. Pass just one.",
    );
  }
  // The endpoint this command targets — its transport AND the suffix that
  // re-targets a later `attach` at the same daemon (see `endpointHint`).
  const endpoint: Endpoint =
    argv.flags.host !== undefined
      ? { kind: "host", host: argv.flags.host }
      : argv.flags.socket !== undefined
        ? { kind: "socket", socket: argv.flags.socket }
        : { kind: "default" };
  const conn =
    endpoint.kind === "host"
      ? await connectHost(endpoint.host)
      : await connectLocal(
          endpoint.kind === "socket" ? endpoint.socket : undefined,
        );

  try {
    await assertCompatible(conn);
    // Closed dispatch: every command is named, and the final else fails loud
    // — so a future addition that forgets a branch here cannot silently fall
    // through into another command's handler. (cleye already exits on commands
    // not in its registry; this guards OUR omissions.)
    if (argv.command === "list") await cmdList(conn, argv.flags.json);
    else if (argv.command === "create")
      await cmdCreate(conn, endpoint, argv._.command, argv.flags.json);
    else if (argv.command === "snapshot")
      await cmdSnapshot(conn, await resolveOne(conn, argv._.id));
    else if (argv.command === "send") {
      // The tristate lives in two Boolean flags, so the both-set combination is
      // expressible but illegal — crash loud rather than silently pick one.
      if (argv.flags.paste && argv.flags.noPaste)
        fail(
          "--paste and --no-paste are mutually exclusive — pass at most one (omit both for auto).",
        );
      await cmdSend(conn, await resolveOne(conn, argv._.id), argv._.text, {
        json: argv.flags.json,
        // Tristate: `--paste` forces on, `--no-paste` off, neither = auto.
        paste: argv.flags.paste ? true : argv.flags.noPaste ? false : undefined,
        key: argv.flags.key,
      });
    }
    else if (argv.command === "attach")
      await cmdAttach(
        conn,
        await resolveOne(conn, argv._.id),
        argv.flags.escape,
      );
    else if (argv.command === "kill")
      await runKill(conn, await resolveOne(conn, argv._.id), (line) =>
        process.stderr.write(line),
      );
    else fail("unhandled command — add a dispatch branch for it");
  } finally {
    conn.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`kaval-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
