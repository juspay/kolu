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

import { Data, Effect, Runtime } from "effect";
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
// The web face's flags and their projection onto the server's boot contract.
// They live in THIS package because they are part of the command tree: how argv
// is parsed is the CLI's volatility, and a flag declaration is a runtime call
// the web server package has no business holding.
import { bootFlagsOf, webFlags } from "./webFlags.ts";

/** A face the plan RESERVES but has not shipped (`kolu tui`).
 *
 *  `Data.TaggedError`, not `Schema.TaggedError`: this error never crosses a wire
 *  — it is raised and handled inside one process — so it needs a `_tag` to match
 *  on, not a codec. The two `Runtime` markers are what turn the tag into an exit
 *  code without a second mapping table: `errorExitCode` is the code the run
 *  edge's teardown reads off the squashed cause, and `errorReported: false`
 *  suppresses Effect's own pretty log so the ONE line the user sees is the named
 *  message below. */
export class ReservedFaceError extends Data.TaggedError("ReservedFaceError")<{
  readonly message: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** The named fail-fast for a face that is planned but not shipped. */
export const reservedFaceMessage = (face: string): string =>
  `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`;

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
    const shared = yield* koluRoot;
    // The MCP adapter owns its own local dial and re-resolves it per redial, so
    // an explicit socket has nowhere to live in that discipline yet — accept the
    // ssh target only, and say so for the other two.
    yield* refuseEndpointFlags(shared, "mcp", ["host"]);
    const endpoint = yield* endpointOf(shared);
    const { runKoluMcp } = yield* Effect.promise(() => import("./mcp.ts"));
    yield* runKoluMcp({
      host: endpoint.kind === "host" ? endpoint.ssh : undefined,
    });
  }),
).pipe(
  Command.withDescription(
    "Serve this host's terminals to a coding agent over MCP (stdio) — a pure padi client, no web server.",
  ),
);

const tui = Command.make(
  "tui",
  {},
  Effect.fn(function* () {
    return yield* Effect.fail(
      new ReservedFaceError({ message: reservedFaceMessage("tui") }),
    );
  }),
).pipe(
  Command.withDescription(
    "Reserved — the terminal canvas is not shipped yet (see kolu.dev/atlas/kolu-cli.html).",
  ),
);

// ── The terminal verbs ───────────────────────────────────────────────────────

const ls = Command.make(
  "ls",
  {
    json: Flag.boolean("json").pipe(
      Flag.withDescription("emit the full terminal records as JSON"),
    ),
  },
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/ls.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "List this host's terminals — state, agent, repo/branch, PR, and what each is for.",
  ),
);

const create = Command.make(
  "create",
  {
    argv: Argument.string("argv").pipe(
      Argument.withDescription("command to run in the new terminal (after --)"),
      Argument.variadic(),
    ),
    cwd: Flag.string("cwd").pipe(
      Flag.withDescription("working directory for the new terminal"),
      Flag.optional,
    ),
    parent: Flag.string("parent").pipe(
      Flag.withDescription("create as a split of this terminal"),
      Flag.optional,
    ),
    intent: Flag.string("intent").pipe(
      Flag.withDescription("freeform label shown on the canvas"),
      Flag.optional,
    ),
    repo: Flag.string("repo").pipe(
      Flag.withDescription("repository path for --worktree"),
      Flag.optional,
    ),
    worktree: Flag.string("worktree").pipe(
      Flag.withDescription(
        "create a git worktree on this branch and open the terminal there",
      ),
      Flag.optional,
    ),
    json: Flag.boolean("json").pipe(
      Flag.withDescription(
        "emit the new terminal's record as JSON ({id, worktree?, ran?}) instead of the bare id",
      ),
    ),
  },
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

const send = Command.make(
  "send",
  {
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
    file: Flag.string("file").pipe(
      Flag.withDescription("read the text to send from this file"),
      Flag.optional,
    ),
    paste: Flag.boolean("paste").pipe(
      Flag.withDescription(
        "force bracketed-paste wrapping (--no-paste forbids it)",
      ),
      Flag.optional,
    ),
    json: Flag.boolean("json").pipe(
      Flag.withDescription(
        "emit what was written as JSON ({id, bytes, paste, keys}) on stdout, instead of the stderr trailer",
      ),
    ),
  },
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

const wait = Command.make(
  "wait",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription("terminal id (any unique prefix)"),
    ),
    until: Flag.string("until").pipe(
      Flag.withDescription(
        "idle:<ms> · match:<regex> · agent buckets (working, awaiting, waiting — comma-separated means any-of)",
      ),
    ),
    timeout: Flag.integer("timeout").pipe(
      Flag.withDescription("give up after this many milliseconds (exit 2)"),
      Flag.optional,
    ),
    json: Flag.boolean("json").pipe(
      Flag.withDescription(
        "emit one outcome frame ({id, result, …}) for EVERY arm — met, timeout, gone, interrupted — so a driver branches on `result`, not on the exit code",
      ),
    ),
  },
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

const snapshot = Command.make(
  "snapshot",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription("terminal id (any unique prefix)"),
    ),
    tail: Flag.integer("tail").pipe(
      Flag.withDescription("print only the last N non-blank lines"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/snapshot.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Print what a terminal shows now, as plain text — the verb for reading an agent's reply.",
  ),
);

const history = Command.make(
  "history",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription("terminal id (any unique prefix)"),
    ),
    lines: Flag.integer("lines").pipe(
      // Omitting it prints the WHOLE retained scrollback (`wholeHistory` pages
      // back to the oldest line the host still keeps); passing it fetches ONE
      // page of that size, the lines immediately above the screen. The help text
      // used to say "default: one page", which is the opposite of what happens.
      Flag.withDescription(
        "print only the N lines just above the screen (default: the whole retained scrollback)",
      ),
      Flag.optional,
    ),
  },
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/history.ts"), args);
  }),
).pipe(
  Command.withDescription(
    "Print the scrollback above the current screen, oldest first.",
  ),
);

const kill = Command.make(
  "kill",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription("terminal id (any unique prefix)"),
    ),
  },
  Effect.fn(function* (args) {
    yield* runVerb(() => import("./verbs/kill.ts"), args);
  }),
).pipe(Command.withDescription("End a terminal."));

const watch = Command.make(
  "watch",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription("narrow to one terminal"),
      Argument.optional,
    ),
    json: Flag.boolean("json").pipe(Flag.withDescription("emit NDJSON")),
  },
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
