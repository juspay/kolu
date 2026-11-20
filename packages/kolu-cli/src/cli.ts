import {
  isScreenImageLines,
  SCREEN_IMAGE_MAX_ROWS,
} from "@kolu/padi-client/surface";
import { isValidTimerMs, timerRangeMessage } from "@kolu/surface/wait";
import {
  WAIT_STATES,
  WATCH_DEFAULT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { serverVersion } from "kolu-server/src/hostname.ts";
import {
  DEBRIEF_EXPANSION,
  DEBRIEF_QUIET_MS,
  DEBRIEF_TAIL_LINES,
} from "./debriefProtocol.ts";
import {
  type Endpoint,
  endpointFlags,
  endpointOf,
  refuseEndpointFlags,
} from "./endpoint.ts";
import { reservedFace } from "./exit.ts";
import { koluSurfaceFace } from "./surfaceFace.ts";
import { bootFlagsOf, webFlags } from "./webFlags.ts";

export const koluRoot = Command.make("kolu").pipe(
  Command.withSharedFlags(endpointFlags),
  Command.withDescription(
    "kolu — terminals for coding agents. Manage them with the verbs below; `kolu web` runs the server.",
  ),
);

const sharedEndpoint = Effect.flatMap(koluRoot, endpointOf);

const runVerb = <A>(
  load: () => Promise<{
    run: (endpoint: Endpoint, args: A) => Effect.Effect<void, unknown>;
  }>,
  args: A,
) =>
  Effect.flatMap(sharedEndpoint, (endpoint) =>
    Effect.flatMap(Effect.promise(load), ({ run }) => run(endpoint, args)),
  );

const web = Command.make(
  "web",
  webFlags,
  Effect.fn(function* (flags) {
    yield* Effect.flatMap(koluRoot, (r) => refuseEndpointFlags(r, "web"));
    const { bootKoluWeb } = yield* Effect.promise(() => import("kolu-server"));
    yield* Effect.promise(() => bootKoluWeb(bootFlagsOf(flags)));
  }),
).pipe(
  Command.withDescription(
    "Run the kolu web server (the browser face). Binds with --bind/--port.",
  ),
);

const mcp = Command.make(
  "mcp",
  {},
  Effect.fn(function* () {
    const endpoint = yield* endpointOf(yield* koluRoot);
    const { runKoluMcp } = yield* Effect.promise(() => import("./mcp.ts"));
    yield* runKoluMcp({ endpoint });
  }),
).pipe(
  Command.withDescription(
    "Serve a padi's terminals to a coding agent over MCP (stdio) — a pure padi client, no web server.",
  ),
);

const tui = Command.make(
  "tui",
  {},
  Effect.fn(function* () {
    return yield* Effect.fail(reservedFace("tui"));
  }),
).pipe(
  Command.withDescription(
    "Reserved — the terminal canvas is not shipped yet (see kolu.dev/atlas/kolu-cli.html).",
  ),
);

const opt = <A>(flag: Flag.Flag<A>): Flag.Flag<A | undefined> =>
  flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

/** A SWITCH: writing `--json` means true, leaving it off means false.
 *
 *  Spelled out because `Flag.Boolean` alone no longer means this. Up to and
 *  including rc.109 an absent boolean parsed as `false`; rc.110 made it behave
 *  like every other flag type and FAIL as a missing required flag
 *  (Effect-TS/effect#7296), so a bare `kolu ls` refused itself with "Missing
 *  required flag: --json". The `false` is therefore the switch's OWN meaning —
 *  the off position — not a fallback softening some absent value, which is why
 *  it is declared here once rather than defended at seven call sites. */
const sw = (flag: Flag.Flag<boolean>): Flag.Flag<boolean> =>
  flag.pipe(Flag.withDefault(false));

const optArg = <A>(
  arg: Argument.Argument<A>,
): Argument.Argument<A | undefined> =>
  arg.pipe(Argument.optional, Argument.map(Option.getOrUndefined));

const positiveLines = (name: string): Flag.Flag<number> =>
  Flag.Int(name).pipe(
    Flag.filter(
      (n) => n > 0,
      (n) => `--${name} takes a positive whole number of lines, got ${n}.`,
    ),
  );

const timerMsFlag = (name: string, effect: string): Flag.Flag<number> =>
  Flag.Int(name).pipe(
    Flag.filter(isValidTimerMs, (n) =>
      timerRangeMessage(`--${name}`, effect, String(n)),
    ),
  );

const timeoutFlag = opt(
  timerMsFlag("timeout", "fires a false timeout").pipe(
    Flag.withDescription("give up after this many milliseconds (exit 2)"),
  ),
);

export const lsFlags = {
  json: sw(
    Flag.Boolean("json").pipe(
      Flag.withDescription("emit the full terminal records as JSON"),
    ),
  ),
} as const;

const ls = Command.make(
  "ls",
  lsFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/ls.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "List this host's terminals — state, repo/branch, PR, agent, and what each is running.",
  ),
);

export const createFlags = {
  argv: Argument.String("argv").pipe(
    Argument.withDescription("command to run in the new terminal (after --)"),
    Argument.variadic(),
  ),
  cwd: opt(
    Flag.String("cwd").pipe(
      Flag.withDescription("working directory for the new terminal"),
    ),
  ),
  toplevel: sw(
    Flag.Boolean("toplevel").pipe(
      Flag.withDescription(
        "open as a tile of its own on the canvas (mutually exclusive with --parent)",
      ),
    ),
  ),
  parent: opt(
    Flag.String("parent").pipe(
      Flag.withDescription(
        "open as a split INSIDE this terminal (mutually exclusive with --toplevel)",
      ),
    ),
  ),
  intent: opt(
    Flag.String("intent").pipe(
      Flag.withDescription("freeform label shown on the canvas"),
    ),
  ),
  repo: opt(
    Flag.String("repo").pipe(
      Flag.withDescription("repository path for --worktree"),
    ),
  ),
  worktree: opt(
    Flag.String("worktree").pipe(
      Flag.withDescription(
        "create a git worktree on this branch and open the terminal there",
      ),
    ),
  ),
  json: sw(
    Flag.Boolean("json").pipe(
      Flag.withDescription(
        "emit the new terminal's record as JSON ({id, worktree?, ran?}) instead of the bare id",
      ),
    ),
  ),
} as const;

const create = Command.make(
  "create",
  createFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/create.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Create a terminal — state its placement (--toplevel or --parent <id>), optionally in a fresh worktree, with an agent to run in it. Prints the new id.",
  ),
  Command.withExamples([
    {
      command: 'kolu create --toplevel --intent "fix #2117" -- claude',
      description: "Open a tile of its own and start Claude Code in it",
    },
    {
      command:
        "kolu create --toplevel --repo ~/code/kolu --worktree fix-2117 -- claude",
      description: "Cut a worktree and start an agent there, as its own tile",
    },
    {
      command: 'kolu create --parent "$KAVAL_TERMINAL_ID" -- codex',
      description: "Split your own tile and start another agent beside you",
    },
    {
      command: "kolu create",
      description:
        "Refused: placement is not optional — say --toplevel or --parent <id>",
    },
  ]),
);

export const sendFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  text: Argument.String("text").pipe(
    Argument.withDescription("the text to type"),
    Argument.variadic(),
  ),
  key: Flag.String("key").pipe(
    Flag.withDescription(
      "send a named key instead of text (Enter, Escape, Tab, Up, C-c, M-x, …); repeatable",
    ),
    Flag.atLeast(0),
  ),
  file: opt(
    Flag.String("file").pipe(
      Flag.withDescription("read the text to send from this file"),
    ),
  ),
  paste: opt(
    Flag.Boolean("paste").pipe(
      Flag.withDescription(
        "force bracketed-paste wrapping (--no-paste forbids it)",
      ),
    ),
  ),
  json: sw(
    Flag.Boolean("json").pipe(
      Flag.withDescription(
        "emit what was written as JSON ({id, bytes, paste, keys}) on stdout, instead of the stderr trailer",
      ),
    ),
  ),
} as const;

const send = Command.make(
  "send",
  sendFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/send.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Type into a terminal — text, or a named key with --key. Text and keys are mutually exclusive.",
  ),
  Command.withExamples([
    {
      command: 'kolu send 3f9c "review this PR"',
      description: "Type a prompt (it is NOT submitted — see --key Enter)",
    },
    {
      command: "kolu send 3f9c --key Enter",
      description: "Submit what was typed",
    },
  ]),
);

export const waitFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  until: Flag.String("until").pipe(
    Flag.withDescription(
      `idle:<ms> · match:<regex> · agent buckets (${WAIT_STATES.join(", ")} — comma-separated means any-of)`,
    ),
  ),
  timeout: timeoutFlag,
  settled: opt(
    timerMsFlag("settled", "reports a false settle").pipe(
      Flag.withDescription(
        "report met only once output has ALSO been quiet this many milliseconds — a conjunct on --until, evaluated on the same subscription",
      ),
    ),
  ),
  snapshot: opt(
    positiveLines("snapshot").pipe(
      Flag.withDescription(
        "stamp the met with the last N rendered screen lines — on stdout, or as `screen` in the --json frame",
      ),
    ),
  ),
  json: sw(
    Flag.Boolean("json").pipe(
      Flag.withDescription(
        "emit one outcome frame ({id, result, …}) for EVERY arm — met, timeout, gone, interrupted — so a driver branches on `result`, not on the exit code",
      ),
    ),
  ),
} as const;

const wait = Command.make(
  "wait",
  waitFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/wait.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Block until a terminal's output settles or matches, or its agent reaches a state.",
  ),
  Command.withExamples([
    {
      command: "kolu wait 3f9c --until idle:2000 --timeout 10000",
      description: "Wait for output to go quiet for 2s (any terminal)",
    },
    {
      command: "kolu wait 3f9c --until awaiting,waiting --timeout 600000",
      description: "Wait for the agent's turn to END",
    },
    {
      command:
        "kolu wait 3f9c --until awaiting,waiting --settled 15000 --snapshot 40",
      description:
        "…and only once it is genuinely quiet — then print its last 40 lines (see `kolu debrief`)",
    },
  ]),
);

export const debriefFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  quiet: timerMsFlag("quiet", "reports a false settle").pipe(
    Flag.withDescription(
      `require this many milliseconds of output quiet before believing the turn is over — this is wait's --settled (default ${DEBRIEF_QUIET_MS})`,
    ),
    Flag.withDefault(DEBRIEF_QUIET_MS),
  ),
  tail: positiveLines("tail").pipe(
    Flag.withDescription(
      `print this many screen lines on stdout — this is wait's --snapshot (default ${DEBRIEF_TAIL_LINES})`,
    ),
    Flag.withDefault(DEBRIEF_TAIL_LINES),
  ),
  timeout: timeoutFlag,
  json: sw(
    Flag.Boolean("json").pipe(
      Flag.withDescription("`wait`'s outcome frame, with `screen` on the met"),
    ),
  ),
} as const;

const debrief = Command.make(
  "debrief",
  debriefFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/debrief.ts"), args);
  }),
).pipe(
  Command.withDescription(
    `Wait until a worker's turn is over AND its output is quiet, then print its screen — exactly \`${DEBRIEF_EXPANSION}\`.`,
  ),
  Command.withExamples([
    {
      command: "kolu debrief 4bba",
      description:
        "Block until the worker has actually finished, then read what it thinks happened",
    },
    {
      command: "kolu debrief 4bba --quiet 30000 --timeout 900000",
      description: "Give a subagent-heavy worker a longer quiet window",
    },
  ]),
);

export const snapshotFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  tail: opt(
    positiveLines("tail").pipe(
      Flag.withDescription(
        "print only the last N lines, ignoring the trailing blank rows a rendered buffer ends in",
      ),
    ),
  ),
} as const;

const snapshot = Command.make(
  "snapshot",
  snapshotFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/snapshot.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Print a terminal's whole rendered buffer (scrollback + viewport) as plain text — --tail N is the on-screen read.",
  ),
);

export const screenshotFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  lines: opt(
    positiveLines("lines").pipe(
      Flag.filter(
        isScreenImageLines,
        (n) =>
          `--lines captures at most ${SCREEN_IMAGE_MAX_ROWS} rows, got ${n}.`,
      ),
      Flag.withDescription(
        `capture only the last N rendered rows (1-${SCREEN_IMAGE_MAX_ROWS}; default: the visible screen)`,
      ),
    ),
  ),
  out: opt(
    Flag.String("out").pipe(
      Flag.withAlias("o"),
      Flag.withDescription(
        "write the PNG here (default: kolu-screenshot.png; `-` writes the bytes to stdout)",
      ),
    ),
  ),
} as const;

const screenshot = Command.make(
  "screenshot",
  screenshotFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/screenshot.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Save a terminal's screen as a themed PNG — the picture `snapshot` flattens to text.",
  ),
);

export const historyFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  lines: opt(
    positiveLines("lines").pipe(
      Flag.withDescription(
        "print only the N lines just above the screen (default: the whole retained scrollback)",
      ),
    ),
  ),
} as const;

const history = Command.make(
  "history",
  historyFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/history.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Print the scrollback above the current screen, oldest first.",
  ),
);

export const killFlags = {
  id: Argument.String("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
} as const;

const kill = Command.make(
  "kill",
  killFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/kill.ts"), args);
  }),
).pipe(Command.withDescription("End a terminal."));

export const watchFlags = {
  id: optArg(
    Argument.String("id").pipe(
      Argument.withDescription("narrow to one terminal"),
    ),
  ),
  json: sw(Flag.Boolean("json").pipe(Flag.withDescription("emit NDJSON"))),
  states: opt(
    Flag.String("states").pipe(
      Flag.withDescription(
        `supervise instead of tailing: report agent-state transitions for these buckets (comma-separated any-of: ${WAIT_STATES.join(", ")}). Defaults to ${WATCH_DEFAULT_STATES.join(",")} when only --held-for/--nag is given`,
      ),
    ),
  ),
  heldFor: opt(
    Flag.String("held-for").pipe(
      Flag.withDescription(
        "report a state only once it has HELD this long — milliseconds like every other window here (60000), or with a unit: 500ms, 60s, 5m, 2h, 1d",
      ),
    ),
  ),
  nag: opt(
    Flag.String("nag").pipe(
      Flag.withDescription(
        "RE-report every interval the state keeps holding, so an ignored terminal comes back instead of vanishing after one line — 300000, or 5m. Suffix a count to make it finite: 30m/3 is three reminders past the first report, then quiet until the state changes",
      ),
    ),
  ),
  ignore: Flag.String("ignore").pipe(
    Flag.withDescription(
      "mute this terminal (repeatable). Fail-open: a stale or unknown id costs nothing, and every new terminal is still watched",
    ),
    Flag.atLeast(0),
  ),
  ignoreSelf: sw(
    Flag.Boolean("ignore-self").pipe(
      Flag.withDescription(
        "mute the terminal this process is running inside (KAVAL_TERMINAL_ID). Refused if this is not a kolu-owned PTY — pass --ignore <id> rather than guessing",
      ),
    ),
  ),
  heartbeat: opt(
    Flag.String("heartbeat").pipe(
      Flag.withDescription(
        "emit a timestamped alive line every interval so a quiet pipe means 'nothing matching', not 'the stream is dead' — 10000, or 10s. Omit to stay silent when nothing is happening",
      ),
    ),
  ),
} as const;

const watch = Command.make(
  "watch",
  watchFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/watch.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Stream terminal changes and live output activity — or, with --states/--held-for/--nag, supervise: report agents that have been sitting in a state, and keep reporting them (finitely, when the interval carries a count, --nag 30m/3).",
  ),
  Command.withExamples([
    {
      command: "kolu watch",
      description: "Tail every terminal's changes and output activity",
    },
    {
      command:
        "kolu watch --states waiting,awaiting --held-for 60s --nag 5m --ignore-self",
      description:
        "The supervision loop — every terminal idle a minute announces itself, every 5 minutes, until someone deals with it. --ignore-self keeps the orchestrator's own house out of the feed",
    },
    {
      command: "kolu watch --nag 5m --json --heartbeat 10s",
      description:
        "The same over NDJSON, filtered in padi, for a script to consume with jq. --heartbeat makes a quiet pipe mean nothing is matching, not that the stream died",
    },
  ]),
);

export const koluCli = koluRoot.pipe(
  Command.withSubcommands([
    ls,
    create,
    send,
    wait,
    debrief,
    snapshot,
    screenshot,
    history,
    kill,
    watch,
    web,
    mcp,
    koluSurfaceFace(koluRoot),
    tui,
  ]),
);

export const runKoluCliWith = Command.runWith(koluCli, {
  version: serverVersion,
});
