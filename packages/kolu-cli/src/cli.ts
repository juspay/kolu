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
 * The scripting verbs (`ls` · `create` · `send` · `wait` · `snapshot` ·
 * `history` · `kill` · `watch`) subsume what `padi-tui` and `kaval-tui` served,
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
 *    eleven faces, silently booting a web server for a bare invocation is a
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

import { isValidTimerMs, MAX_TIMER_MS } from "@kolu/surface/wait";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
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

export const lsFlags = {
  json: Flag.boolean("json").pipe(
    Flag.withDescription("emit the full terminal records as JSON"),
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
    "List this host's terminals — state, agent, repo/branch, PR, and what each is for.",
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
  parent: opt(
    Flag.string("parent").pipe(
      Flag.withDescription("create as a split of this terminal"),
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
  json: Flag.boolean("json").pipe(
    Flag.withDescription(
      "emit the new terminal's record as JSON ({id, worktree?, ran?}) instead of the bare id",
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
    "Create a terminal — optionally a split, a fresh worktree, and an agent to run in it. Prints the new id.",
  ),
  Command.withExamples([
    {
      command: 'kolu create --intent "fix #2117" -- claude',
      description: "Open a terminal and start Claude Code in it",
    },
    {
      command: "kolu create --repo ~/code/kolu --worktree fix-2117 -- claude",
      description: "Cut a worktree and start an agent there",
    },
    {
      command: 'kolu create --parent "$KAVAL_TERMINAL_ID" -- codex',
      description: "Split your own tile and start another agent beside you",
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
  json: Flag.boolean("json").pipe(
    Flag.withDescription(
      "emit what was written as JSON ({id, bytes, paste, keys}) on stdout, instead of the stderr trailer",
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
      "idle:<ms> · match:<regex> · agent buckets (working, awaiting, waiting — comma-separated means any-of)",
    ),
  ),
  // The shared timer-range rule, on the flag: `runWait` THROWS a RangeError on
  // an out-of-range timeout, and `isValidTimerMs` is the one home for the
  // ceiling (`--until idle:<ms>` calls it too, inside its compound grammar).
  timeout: opt(
    Flag.integer("timeout").pipe(
      Flag.withDescription("give up after this many milliseconds (exit 2)"),
      Flag.filter(
        isValidTimerMs,
        (n) =>
          `--timeout must be between 1 and ${MAX_TIMER_MS} milliseconds (~24.8 days) — a larger delay overflows the timer and fires a false timeout almost immediately, got ${n}.`,
      ),
    ),
  ),
  json: Flag.boolean("json").pipe(
    Flag.withDescription(
      "emit one outcome frame ({id, result, …}) for EVERY arm — met, timeout, gone, interrupted — so a driver branches on `result`, not on the exit code",
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
  ]),
);

export const snapshotFlags = {
  id: Argument.string("id").pipe(
    Argument.withDescription("terminal id (any unique prefix)"),
  ),
  tail: opt(
    positiveLines("tail").pipe(
      Flag.withDescription("print only the last N non-blank lines"),
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
    "Print what a terminal shows now, as plain text — the verb for reading an agent's reply.",
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
  json: Flag.boolean("json").pipe(Flag.withDescription("emit NDJSON")),
} as const;

const watch = Command.make(
  "watch",
  watchFlags,
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/watch.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Stream terminal changes and live output activity until interrupted.",
  ),
);

/** The whole binary. Verbs first — they are what a user reaches for — then the
 *  two server-ish faces and the reserved one. */
export const koluCli = koluRoot.pipe(
  Command.withSubcommands([
    ls,
    create,
    send,
    wait,
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
