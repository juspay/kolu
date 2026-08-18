/**
 * The kolu binary's command tree — the kolu-cli plan
 * (docs/atlas/src/content/atlas/kolu-cli.mdx). This package is the composition
 * root: the one module set allowed to import everything, so the product's argv
 * face stays out of the web server's boot (`packages/server` exports
 * `bootKoluWeb`; the volatility is in the set of faces, and only a dedicated
 * package encapsulates it).
 *
 * ## `kolu` is the ONE terminal CLI now
 *
 * The scripting verbs (`ls` · `create` · `send` · `wait` · `debrief` ·
 * `snapshot` · `history` · `kill` · `watch`) subsume what `padi-tui` and `kaval-tui` served,
 * so a user — human or agent — drives kolu terminals with one command. Every
 * verb is a PURE padi client: `padiSurface` carries the union of both TUIs'
 * needs (`lifecycle.*`, `screen.*`, `terminalAttach`, `terminalExit`), so no
 * kaval dependency enters this package and padi stays the only daemon a face
 * speaks to. That is what dissolves the plan's original objection to verb
 * parity — it assumed parity meant depending on kaval, and it does not.
 *
 * ## Three deliberate breaks with PR1
 *
 * 1. **Bare `kolu` is no longer an alias of `kolu web`.** It prints the
 *    subcommand list and exits non-zero, so a user picks a face explicitly. With
 *    twelve subcommands, silently booting a web server for a bare invocation is a
 *    footgun rather than a convenience.
 * 2. **`effect/unstable/cli` replaces cleye.** cleye binds a flag to the
 *    subcommand that PRECEDES it, so `kolu --host foo create` was a usage error.
 *    Effect CLI's SHARED flags are accepted on either side of the verb name, so
 *    both spellings are one parse. It also ships inside the `effect` the
 *    workspace already pins, so the parser costs no new dependency, and its
 *    handlers are Effects — the exit-code discipline below is the library's
 *    native shape rather than something wrapped around it.
 * 3. **`kolu web --host` is now `kolu web --bind`.** `--host` is a shared flag
 *    meaning "which padi to reach"; Effect CLI refuses a parent/child flag
 *    collision outright (`DuplicateOption`), so one name had to give. Renaming
 *    the web-only one leaves `--host` a single idea across the whole binary.
 *
 * Each face's implementation is a DYNAMIC import inside its handler, so
 * `kolu mcp` never touches the web server's module graph, a terminal verb never
 * loads either, and a reserved face fails fast having loaded nothing.
 */

// The bucket vocabulary and the supervision default, read from the LEAF that
// owns them — the same reason `DEBRIEF_*` below is imported rather than
// re-typed: a `--help` line that hand-copies a constant is a sentence nothing
// stops from going quietly false. (`@kolu/terminal-vocab/agentProjection` is a
// pure fold module, so this costs the dynamic-import fence nothing.)
import {
  WAIT_STATES,
  WATCH_DEFAULT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import { isValidTimerMs, MAX_TIMER_MS } from "@kolu/surface/wait";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
// The `kolu debrief` contract — a zero-import leaf, read HERE for the flags'
// defaults and the `--help` line, and by `verbs/debrief.ts` to perform the
// expansion. See that module's header for why it is not spelled twice.
import {
  DEBRIEF_EXPANSION,
  DEBRIEF_QUIET_MS,
  DEBRIEF_TAIL_LINES,
} from "./debriefProtocol.ts";
// The ONE version accessor (`hostname.ts` is a leaf: node built-ins + the
// server's package.json, which `/release` bumps and nix reads too) — so
// `kolu --version` can never diverge from the version the server reports.
import { serverVersion } from "kolu-server/src/hostname.ts";
import {
  type Endpoint,
  endpointFlags,
  endpointOf,
  refuseEndpointFlags,
} from "./endpoint.ts";
// Every exit-code-bearing error, and the sentence each one carries.
import { reservedFace } from "./exit.ts";
// The web face's flags and their projection onto the server's boot contract.
// They live in THIS package because they are part of the command tree: how argv
// is parsed is the CLI's volatility, and a flag declaration is a runtime call
// the web server package has no business holding.
import { bootFlagsOf, webFlags } from "./webFlags.ts";

/** The root. It carries no handler of its own — a bare `kolu` has nothing to do
 *  but show what it can do, which is exactly what Effect CLI does for a
 *  subcommand-bearing command with no handler: print the subcommand list and
 *  fail. That is user correction (1) satisfied by the library's own shape rather
 *  than by a hand-written arm. */
export const koluRoot = Command.make("kolu").pipe(
  Command.withSharedFlags(endpointFlags),
  Command.withDescription(
    "kolu — terminals for coding agents. Manage them with the verbs below; `kolu web` runs the server.",
  ),
);

/** Read the shared endpoint flags off the root, from inside a subcommand. */
const sharedEndpoint = Effect.flatMap(koluRoot, endpointOf);

/** Every terminal verb has the same shape: resolve the endpoint, load the verb's
 *  module, run it. Spelled once so a new verb is one `Command.make` plus one
 *  entry here, and so the dynamic-import fence cannot be forgotten on one arm.
 *
 *  The import is inside the handler on purpose: a verb's module reaches padi's
 *  dial kit and its render helpers, none of which `kolu web` or `kolu mcp`
 *  should pay for.
 *
 *  The requirement channel is left to INFERENCE rather than annotated `never`:
 *  reading the root's shared flags is a context read (`CommandContext<"kolu">`),
 *  which a subcommand handler is exactly the place that can satisfy. Pinning it
 *  to `never` here would be claiming this composes anywhere, which it does not
 *  and need not. */
const runVerb = <A>(
  load: () => Promise<{
    run: (endpoint: Endpoint, args: A) => Effect.Effect<void, unknown>;
  }>,
  args: A,
) =>
  Effect.flatMap(sharedEndpoint, (endpoint) =>
    Effect.flatMap(Effect.promise(load), ({ run }) => run(endpoint, args)),
  );

// ── The faces ────────────────────────────────────────────────────────────────

const web = Command.make(
  "web",
  webFlags,
  Effect.fn(function* (flags) {
    // `web` inherits the shared endpoint flags (every subcommand does) but dials
    // no padi with them — refuse rather than ignore.
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
    // No refusal: the MCP adapter's dial resolves through the SAME
    // `localPadiSocket` policy the verbs do, so every endpoint spelling is
    // honorable here. `endpointOf` still enforces the two rules that are about
    // the flags themselves (one transport at a time, no empty value).
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

// ── The terminal verbs ───────────────────────────────────────────────────────
//
// Each verb's flag record is EXPORTED and its module derives its args type from
// it (`Command.Config.Infer`), the way `webFlags.ts` already does for the web
// face. The hand-written `*Args` interfaces this replaced were a second
// statement of one fact — and the join between them was unchecked in the
// direction that matters: a flag added here and forgotten in the verb still
// compiled, shipped, and was silently never read, which is the graceful
// degradation this repo treats as a defect. The import is `import type`, so it
// is fully erased and the per-face dynamic-import fence is untouched.

/** A flag the user may omit, projected to `undefined` HERE rather than in each
 *  verb body.
 *
 *  `Option` is the PARSER's vocabulary, and `bootFlags.ts`'s header already
 *  states the rule for the web face: pushing it through a consumer whose job has
 *  nothing to do with argv is the coupling the projection exists to end. The
 *  verbs' domain types are `undefined`-flavored (`Placement`, `SendInput`,
 *  `WaitPlan`, the wire's own `Schema.optionalKey` fields), so every one of them
 *  re-narrowed out of `Option` at the top of its own body — twelve meeting
 *  points where the web face has one. This is that one, for the other eleven. */
const opt = <A>(flag: Flag.Flag<A>): Flag.Flag<A | undefined> =>
  flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

/** A SWITCH: writing `--json` means true, leaving it off means false.
 *
 *  Spelled out because `Flag.boolean` alone no longer means this. Up to and
 *  including rc.109 an absent boolean parsed as `false`; rc.110 made it behave
 *  like every other flag type and FAIL as a missing required flag
 *  (Effect-TS/effect#7296), so a bare `kolu ls` refused itself with "Missing
 *  required flag: --json". The `false` is therefore the switch's OWN meaning —
 *  the off position — not a fallback softening some absent value, which is why
 *  it is declared here once rather than defended at seven call sites. */
const sw = (flag: Flag.Flag<boolean>): Flag.Flag<boolean> =>
  flag.pipe(Flag.withDefault(false));

/** The same projection for an optional POSITIONAL (`kolu watch [<id>]`). */
const optArg = <A>(
  arg: Argument.Argument<A>,
): Argument.Argument<A | undefined> =>
  arg.pipe(Argument.optional, Argument.map(Option.getOrUndefined));

/** "A line count is a positive whole number" — ONE rule, declared on the flag
 *  so it fires during the parse and no verb body can place it late.
 *
 *  It used to be three hand-written sentences at three different TIMES, and one
 *  of them was on the wrong side of the dial: `history --lines 0` resolved its
 *  id against a live roster — after `--host` had ssh-provisioned a cold box —
 *  before saying "that is not a positive number", while `snapshot --tail 0`
 *  refused instantly. Declaring it here also puts "0 is not a --tail" on the
 *  same channel as "abc is not a --tail" (`Flag.integer`'s own refusal), which
 *  were two spellings of one rejection. */
const positiveLines = (name: string): Flag.Flag<number> =>
  Flag.integer(name).pipe(
    Flag.filter(
      (n) => n > 0,
      (n) => `--${name} takes a positive whole number of lines, got ${n}.`,
    ),
  );

/** "A millisecond window is inside the shared `setTimeout` range" — the sibling
 *  of {@link positiveLines}, and for the same reason.
 *
 *  `isValidTimerMs` is documented as the one home for the timer-range RULE, but
 *  its user-facing SENTENCE was spelled once per flag; three flags in, two of
 *  the copies had already drifted in wording. `effect` names what an
 *  out-of-range value would do to that particular flag ("fires a false timeout"
 *  vs "reports a false settle"), which is the only part that legitimately
 *  differs — the overflow is one fact. */
const timerMsFlag = (name: string, effect: string): Flag.Flag<number> =>
  Flag.integer(name).pipe(
    Flag.filter(
      isValidTimerMs,
      (n) =>
        `--${name} must be between 1 and ${MAX_TIMER_MS} milliseconds (~24.8 days) — a larger value overflows the timer and ${effect} almost immediately, got ${n}.`,
    ),
  );

/** `--timeout` — the shared bound every wait carries, declared ONCE.
 *
 *  `wait` and `debrief` had a byte-identical copy each, which is the drift
 *  {@link timerMsFlag} was introduced to close, one layer up: the range sentence
 *  was deduped and the flag around it was not. */
const timeoutFlag = opt(
  timerMsFlag("timeout", "fires a false timeout").pipe(
    Flag.withDescription("give up after this many milliseconds (exit 2)"),
  ),
);

export const lsFlags = {
  json: sw(
    Flag.boolean("json").pipe(
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
  // The columns `formatStatus` actually prints, in its order: ID · STATE ·
  // REPO·BRANCH · PR · AGENT · FOREGROUND. It used to end "and what each is
  // for", which promises the `--intent` label — a thing this table does not
  // show; what it shows is the foreground process, i.e. what each is RUNNING.
  Command.withDescription(
    "List this host's terminals — state, repo/branch, PR, agent, and what each is running.",
  ),
);

export const createFlags = {
  argv: Argument.string("argv").pipe(
    Argument.withDescription("command to run in the new terminal (after --)"),
    Argument.variadic(),
  ),
  cwd: opt(
    Flag.string("cwd").pipe(
      Flag.withDescription("working directory for the new terminal"),
    ),
  ),
  // WHERE the terminal lands on the canvas. Exactly one of these two is
  // required — `verbs/create.ts`'s `placementOf` is the gate, and its refusal
  // names the rule. `--toplevel` is a plain boolean rather than the absence of
  // `--parent` because "I didn't pass a flag" and "I decided this is top level"
  // must be different states: reading the first as the second is the silent
  // default this pair exists to delete.
  toplevel: sw(
    Flag.boolean("toplevel").pipe(
      Flag.withDescription(
        "open as a tile of its own on the canvas (mutually exclusive with --parent)",
      ),
    ),
  ),
  parent: opt(
    Flag.string("parent").pipe(
      Flag.withDescription(
        "open as a split INSIDE this terminal (mutually exclusive with --toplevel)",
      ),
    ),
  ),
  intent: opt(
    Flag.string("intent").pipe(
      Flag.withDescription("freeform label shown on the canvas"),
    ),
  ),
  repo: opt(
    Flag.string("repo").pipe(
      Flag.withDescription("repository path for --worktree"),
    ),
  ),
  worktree: opt(
    Flag.string("worktree").pipe(
      Flag.withDescription(
        "create a git worktree on this branch and open the terminal there",
      ),
    ),
  ),
  json: sw(
    Flag.boolean("json").pipe(
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
  id: Argument.string("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  text: Argument.string("text").pipe(
    Argument.withDescription("the text to type"),
    Argument.variadic(),
  ),
  key: Flag.string("key").pipe(
    Flag.withDescription(
      "send a named key instead of text (Enter, Escape, Tab, Up, C-c, M-x, …); repeatable",
    ),
    Flag.atLeast(0),
  ),
  file: opt(
    Flag.string("file").pipe(
      Flag.withDescription("read the text to send from this file"),
    ),
  ),
  // The tristate stays a tristate: `--paste` is `true`, `--no-paste` is `false`,
  // absent is `undefined` — which is what makes "both at once" unspellable (see
  // `verbs/send.ts`'s header).
  paste: opt(
    Flag.boolean("paste").pipe(
      Flag.withDescription(
        "force bracketed-paste wrapping (--no-paste forbids it)",
      ),
    ),
  ),
  json: sw(
    Flag.boolean("json").pipe(
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
  id: Argument.string("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  until: Flag.string("until").pipe(
    Flag.withDescription(
      `idle:<ms> · match:<regex> · agent buckets (${WAIT_STATES.join(", ")} — comma-separated means any-of)`,
    ),
  ),
  // The shared timer-range rule, on the flag: `runWait` THROWS a RangeError on
  // an out-of-range timeout, and `isValidTimerMs` is the one home for the
  // ceiling (`--until idle:<ms>` calls it too, inside its compound grammar).
  timeout: timeoutFlag,
  // The two orthogonal modifiers (kolu#2139). Neither is a fourth `--until`
  // form: `--settled` narrows WHEN the condition counts as met, `--snapshot`
  // widens WHAT the met carries, and each is useful without the other.
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
    Flag.boolean("json").pipe(
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
  id: Argument.string("id").pipe(
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
    Flag.boolean("json").pipe(
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
  id: Argument.string("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  tail: opt(
    positiveLines("tail").pipe(
      // Not "the last N non-blank lines" — `tailLines` drops the buffer's
      // TRAILING run of blank rows (the empty viewport below the cursor) and
      // then takes the last N, interior blanks and all. The old wording promised
      // a filter the verb does not run.
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
  // NOT "what a terminal shows now". `screen.text` returns the ENTIRE rendered
  // buffer — scrollback and viewport together, thousands of lines on a
  // long-running agent — and the README's `snapshot` section spells out why
  // calling that "the screen" is a lie a driving loop pays for. `--help` is
  // where a user meets the verb, so it must not tell the story the README just
  // corrected.
  Command.withDescription(
    "Print a terminal's whole rendered buffer (scrollback + viewport) as plain text — --tail N is the on-screen read.",
  ),
);

export const historyFlags = {
  id: Argument.string("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  // Omitting it prints the WHOLE retained scrollback (`readWholeHistory` pages
  // back to the oldest line the host still keeps); passing it fetches ONE page
  // of that size, the lines immediately above the screen. The help text used to
  // say "default: one page", which is the opposite of what happens.
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
  id: Argument.string("id").pipe(
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
    Argument.string("id").pipe(
      Argument.withDescription("narrow to one terminal"),
    ),
  ),
  json: sw(Flag.boolean("json").pipe(Flag.withDescription("emit NDJSON"))),
  // The three SUPERVISION knobs. Naming any one of them turns `watch` from a
  // change tail into the supervision feed — agent-state transitions, held and
  // repeated — which is why they are plain strings here and parsed in the verb:
  // `--held-for 60s` is a compound grammar like `--until idle:2000`, and
  // `verbs/watch.ts` refuses a bad one BEFORE it dials, exactly as `wait` does.
  // They filter in padi, never here: the CLI and the MCP face pass the same three
  // knobs to the same engine, so there is nothing to keep in sync.
  states: opt(
    Flag.string("states").pipe(
      Flag.withDescription(
        `supervise instead of tailing: report agent-state transitions for these buckets (comma-separated any-of: ${WAIT_STATES.join(", ")}). Defaults to ${WATCH_DEFAULT_STATES.join(",")} when only --held-for/--nag is given`,
      ),
    ),
  ),
  heldFor: opt(
    Flag.string("held-for").pipe(
      Flag.withDescription(
        "report a state only once it has HELD this long — milliseconds like every other window here (60000), or with a unit: 500ms, 60s, 5m, 2h, 1d",
      ),
    ),
  ),
  nag: opt(
    Flag.string("nag").pipe(
      Flag.withDescription(
        "RE-report every interval the state keeps holding, so an ignored terminal comes back instead of vanishing after one line — 300000, or 5m",
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
    "Stream terminal changes and live output activity — or, with --states/--held-for/--nag, supervise: report agents that have been sitting in a state, and keep reporting them.",
  ),
  Command.withExamples([
    {
      command: "kolu watch",
      description: "Tail every terminal's changes and output activity",
    },
    {
      command: "kolu watch --states waiting,awaiting --held-for 60s --nag 5m",
      description:
        "The supervision loop — every terminal idle a minute announces itself, every 5 minutes, until someone deals with it",
    },
    {
      command: "kolu watch --nag 5m --json",
      description:
        "The same over NDJSON, filtered in padi, for a script to consume with jq",
    },
  ]),
);

/** The whole binary. Verbs first — they are what a user reaches for — then the
 *  two server-ish faces and the reserved one. */
export const koluCli = koluRoot.pipe(
  Command.withSubcommands([
    ls,
    create,
    send,
    wait,
    debrief,
    snapshot,
    history,
    kill,
    watch,
    web,
    mcp,
    tui,
  ]),
);

/** Run the tree against an explicit argv — the seam the unit pins drive, so the
 *  dispatch is testable without touching `process.argv`. */
export const runKoluCliWith = Command.runWith(koluCli, {
  version: serverVersion,
});
