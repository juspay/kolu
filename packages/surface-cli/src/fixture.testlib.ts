/**
 * The fixture surface every test in this package drives — the same small
 * process monitor the `@kolu/surface` README and the Surface docs use
 * (`load` · `processes` · `nodeLog` · `autosave` · `proc.kill`), so the shapes
 * exercised here are the shapes the framework's own examples teach.
 *
 * One member of each kind, because the projection has one rule per kind and a
 * fixture missing a kind would leave that rule untested. Two things are added
 * for what the CLI has that MCP does not: `proc.kill` declares an ERROR (so the
 * exit matrix has a real refusal to travel, rather than a fabricated one), and
 * there is a BESPOKE verb (so the hand-authored path is driven end to end).
 *
 * This is a `.testlib`, not a `.test`: it is imported by the unit test AND by
 * the tiny host binary the end-to-end cases spawn, so both drive one surface.
 */

import type { Logger } from "@kolu/log";
import {
  buildSurfaceFace,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import { defineSurface } from "@kolu/surface/define";
import { exposeFace, type ExposeMap } from "@kolu/surface/expose";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import type { SurfaceVerb } from "@kolu/surface/verbs";
import { Effect, Schema, Stream } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import {
  type EndpointSeam,
  type ProjectedCommand,
  surfaceCommands,
  type SurfaceCliConnection,
  surfaceHelp,
  type VerbAnnotation,
} from "./commands";
import type { SurfaceCliHelp } from "./help";

// ── The surface ──────────────────────────────────────────────────────────

const Load = Schema.Struct({
  one: Schema.Finite,
  five: Schema.Finite,
  fifteen: Schema.Finite,
});
const ZERO: typeof Load.Type = { one: 0, five: 0, fifteen: 0 };

const Pid = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Proc = Schema.Struct({
  command: Schema.String,
  cpuPct: Schema.Finite,
  memPct: Schema.Finite,
});

const LogFrame = Schema.Struct({
  kind: Schema.Literals(["snapshot", "delta"]),
  text: Schema.String,
});

const Tick = Schema.Struct({ at: Schema.Int, every: Schema.Int });

/** A DECLARED refusal — the exit-1 arm of the contract, as a real domain error
 *  rather than a fabricated one. */
class NoSuchPid extends Schema.TaggedError<NoSuchPid>(
  "@kolu/surface-cli/test/NoSuchPid",
)("NoSuchPid", { pid: Schema.Int }) {
  override get message(): string {
    return `no process ${this.pid}`;
  }
}

/** One input carrying EVERY flag shape the projection has a rule for, because a
 *  rule with no fixture field is a rule no case can drive: the table in
 *  `flags.ts`'s header and the fields below are meant to be read against each
 *  other. */
const KillArgs = Schema.Struct({
  pid: Pid,
  /** An optional field, so the projection's omit-when-absent rule is driven. */
  signal: Schema.optionalKey(Schema.Literals(["TERM", "KILL"])),
  /** A repeatable scalar array and an open string record, so the two
   *  non-obvious flag shapes are driven. */
  because: Schema.optionalKey(Schema.Array(Schema.String)),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** The boolean TRISTATE — `--force` / `--no-force` / neither must reach the
   *  verb as three DIFFERENT payloads, which is the whole reason no parser
   *  default is given. Same class of hazard as the variadic's `atLeast(1)`. */
  force: Schema.optionalKey(Schema.Boolean),
  /** The float arm, distinct from the integer `pid`. */
  after: Schema.optionalKey(Schema.Finite),
  /** The plain string arm — no enum, so not a choice flag. */
  reason: Schema.optionalKey(Schema.String),
  /** Not a scalar, so it takes the field's own JSON: `--trace '{"id":"x"}'`. */
  trace: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
});

export const surface = defineSurface({
  cells: {
    load: { schema: Load, default: ZERO },
    // Offered by the CLI's map, WITHHELD by the served face (see `SERVED`). The
    // two gates are separate decisions by design, so this is a member a user can
    // type and the server refuses — and the refusal is the far side ANSWERING,
    // which must not be reported as an unreachable endpoint.
    withheld: { schema: Schema.String, default: "never seen" },
  },
  collections: {
    processes: {
      keySchema: Pid,
      schema: Proc,
      // `deltas` is not a default collection verb, and `watch` is the command
      // that projects it — so the fixture opts in, which is also what proves
      // the projection reads the member's OWN verbs rather than assuming.
      verbs: ["keys", "get", "deltas", "upsert", "delete"],
    },
    // A collection with NO `keys` verb — legal, and the case that used to make a
    // read of an item THAT IS RIGHT THERE fail, because the item read was handed
    // a membership stream the surface does not serve.
    mounts: { keySchema: Schema.String, schema: Schema.String, verbs: ["get"] },
  },
  streams: {
    nodeLog: { inputSchema: Schema.String, outputSchema: LogFrame },
    // A NON-STRING input, so the `[arg]` position is driven through the
    // JSON-reading half of the text-to-schema rule and not only the verbatim
    // half — a face that forwarded the raw token would hand the string "5" to a
    // decoder that has already proven it needs the number 5.
    ticks: { inputSchema: Schema.Int, outputSchema: Tick },
  },
  events: {
    autosave: {
      inputSchema: Schema.String,
      outputSchema: Schema.Struct({ at: Schema.Finite }),
    },
  },
  procedures: {
    proc: {
      kill: {
        input: KillArgs,
        // It answers with WHAT IT SAW beside the verdict, so a case can pin the
        // payload a flag shape produced — an assertion on "did it exit 0" would
        // pass for a tristate that arrived as `false` when nobody said so.
        output: Schema.Struct({ ok: Schema.Boolean, saw: KillArgs }),
        error: NoSuchPid,
      },
      /** No input at all — the `Schema.Void` arm of the bridge. */
      count: { output: Schema.Struct({ n: Schema.Int }) },
      /** DECLARED by the spec and named by NO expose map — what default-deny
       *  means, with something real to withhold. The three `system/*` members
       *  cannot play this part: `defineSurface` reserves them on the GROUP and
       *  never puts them in `spec`, and the projection walks the spec, so a case
       *  asserting `system_live` is absent from `--help` passes with the expose
       *  map deleted outright. */
      reap: { output: Schema.Struct({ swept: Schema.Int }) },
    },
  },
});

/** What the CLI face offers. Read-only where it is genuinely read-only, so the
 *  `mutates` default is exercised in both directions. */
export const EXPOSE = {
  load: "resource",
  processes: "resource",
  mounts: "resource",
  nodeLog: "resource",
  ticks: "resource",
  withheld: "resource",
  autosave: "resource",
  "proc.kill": "tool",
  "proc.count": { tool: { mutates: false } },
} satisfies ExposeMap<typeof surface.spec>;

/** A BESPOKE verb: hand-authored, composing over the live client — the same
 *  record `serveSurfaceAsMcp` would take as one of its `tools`. Its input is a
 *  bare scalar, so it also drives the `wrapped` (positional) arm. */
export const VERBS: Record<string, SurfaceVerb> = {
  echo: {
    description: "Echo one line back — a hand-authored verb over the client.",
    mutates: false,
    input: Schema.String,
    handler: (args, _client: SurfaceClientCallable) =>
      Effect.succeed({ said: args }),
  },
};

// ── Serving it ───────────────────────────────────────────────────────────

/** A fixed, keys-less collection — nothing mutates it, so a read of it answers
 *  the same in every case. */
const MOUNTS = new Map<string, string>([["root", "/"]]);

const TABLE = new Map<number, typeof Proc.Type>([
  [7, { command: "vitest", cpuPct: 12.5, memPct: 3 }],
  [42, { command: "node", cpuPct: 0.5, memPct: 1 }],
  // Spendable pids: a kill SUCCEEDS at most once per pid (it removes it), and
  // the flag-shape cases each need a success to read `saw` off. One each, so no
  // case depends on what another left behind.
  [101, { command: "spendable", cpuPct: 0, memPct: 0 }],
  [102, { command: "spendable", cpuPct: 0, memPct: 0 }],
  [103, { command: "spendable", cpuPct: 0, memPct: 0 }],
  [104, { command: "spendable", cpuPct: 0, memPct: 0 }],
]);

/** The `{ group, handlers }` pair this fixture is served from. */
function buildRuntime() {
  const table = new Map(TABLE);
  return implementSurface(surface, {
    cells: {
      load: { store: inMemoryStore(ZERO) },
      withheld: { store: inMemoryStore("never seen") },
    },
    collections: {
      processes: {
        readAll: () => table,
        upsert: (pid, proc) => {
          table.set(pid, proc);
        },
        remove: (pid) => {
          table.delete(pid);
        },
      },
      mounts: {
        readAll: () => MOUNTS,
        upsert: () => {},
        remove: () => {},
      },
    },
    streams: {
      nodeLog: {
        source: (nodeId) =>
          Stream.succeed({
            kind: "snapshot" as const,
            text: `opened ${nodeId}`,
          }),
      },
      // A BURST, not one frame: the hung-up-reader case needs a producer that
      // keeps writing after its reader has left, and enough of it to fill a pipe
      // buffer — otherwise the whole answer fits in the pipe, nothing ever meets
      // an EPIPE, and the case passes while measuring nothing. The one-shot read
      // still takes only the head.
      ticks: {
        source: (every) =>
          Stream.map(Stream.range(0, 50_000), (at) => ({ at, every })),
      },
    },
    events: { autosave: {} },
    procedures: {
      proc: {
        kill: ({ input, ctx }) =>
          table.has(input.pid)
            ? Effect.sync(() => {
                ctx.collections.processes.remove(input.pid);
                return { ok: true, saw: input };
              })
            : Effect.fail(new NoSuchPid({ pid: input.pid })),
        count: () => Effect.succeed({ n: table.size }),
        reap: () => Effect.succeed({ swept: 0 }),
      },
    },
  });
}

/** What the SERVED face allows — deliberately NARROWER than {@link EXPOSE}, the
 *  CLI's own table. The two gates are separate decisions (a client's table is
 *  ergonomics; the serving face's is the gate), and `withheld` is the member that
 *  proves it: the CLI offers it, the server refuses it, and the refusal has to
 *  read as the far side answering rather than as nothing being there. */
const SERVED = {
  load: "resource",
  processes: "resource",
  mounts: "resource",
  nodeLog: "resource",
  ticks: "resource",
  autosave: "resource",
  "proc.kill": "tool",
  "proc.count": { tool: { mutates: false } },
} satisfies ExposeMap<typeof surface.spec>;

/** Serve the fixture on `socketPath`, with the served face's own exposure — the
 *  second gate, so a test proves the CLI's table and the server's are separate
 *  decisions. */
export async function serveFixture(
  socketPath: string,
  log: Logger,
): Promise<UnixSocketListener> {
  const runtime = buildRuntime();
  return await serveOverUnixSocket({
    socketPath,
    group: runtime.group,
    handlers: runtime.handlers,
    expose: exposeFace(surface, SERVED),
    log,
  });
}

// ── Consuming it ─────────────────────────────────────────────────────────

/** The endpoint seam a host owns: one `--socket` flag, one sentence naming it,
 *  one dial. Exactly the shape `packages/server`'s `dialOlai` will have. */
export const endpointFlags = { socket: Flag.string("socket") };

/** The parameter type is INFERRED from `endpointFlags` above — nothing here
 *  restates the flag record's shape, so renaming `socket` is a compile error
 *  rather than an `undefined` this fixture would dial as `"undefined"`. */
export function resolveFixture(values: { readonly socket: string }) {
  return Effect.succeed({
    where: values.socket,
    open: (): Promise<SurfaceCliConnection> =>
      unixSocketLink({
        group: surface.group,
        socketPath: values.socket,
      }).then((link) => ({
        client: buildSurfaceFace(
          surface,
          link.dispatch,
        ) as SurfaceClientCallable,
        dispose: () => link.dispose(),
      })),
  });
}

/** The CLI-only ergonomics every root below mounts.
 *
 *  ONE const, because the three roots are meant to differ by exactly one thing —
 *  the endpoint seam — and one of them silently carried NO annotations at all,
 *  which is invisible as a block that simply is not written. */
const ANNOTATE: Record<string, VerbAnnotation> = {
  proc_kill: { positional: ["pid"] },
  // The one `render` in the tree, so the TTY arm has a driver. Its shape is
  // deliberately unlike the JSON: a test asserting one cannot pass by accident
  // against the other.
  proc_count: { render: (out) => `processes: ${(out as { n: number }).n}` },
};

/** The projection over ONE endpoint seam — everything the roots below share, so
 *  what is left at each of them is the one thing it is there to prove. */
function commandsWith<F extends Command.Command.FlagConfig, R>(
  endpoint: EndpointSeam<F, R>,
  help?: SurfaceCliHelp,
) {
  return surfaceCommands({
    surface,
    expose: EXPOSE,
    verbs: VERBS,
    endpoint,
    annotate: ANNOTATE,
    help,
    info: { name: "demo" },
  });
}

/** The fixture's HELP WORDING — the app's half of the page, which is the half
 *  the framework cannot write. Deliberately incomplete: `echo` is in no group,
 *  so the trailing catch-all group is exercised by the same fixture that
 *  exercises the ones an author did write. */
export const HELP: SurfaceCliHelp = {
  command: "surface",
  purpose: "Drive the demo surface from a shell.",
  groups: [
    { title: "Read", verbs: ["get", "keys", "watch", "list"] },
    { title: "Write", verbs: ["proc_kill"] },
    { title: "Ask", verbs: ["proc_count"] },
  ],
  examples: {
    get: "get processes 1",
    proc_kill: "proc_kill 4241 --signal HUP",
  },
  flags: [{ spelling: "--socket <path>", description: "the socket to dial" }],
  answer: "Answers go to stdout; anything else goes to stderr.",
};

/** The projected commands, as the fixture host mounts them. */
export function fixtureCommands(): ReadonlyArray<ProjectedCommand> {
  return commandsWith({ flags: endpointFlags, resolve: resolveFixture });
}

/** The whole binary's tree — a root with the projected verbs under it, the way
 *  `olai surface <verb>` mounts them. */
export function fixtureRoot() {
  return Command.make("demo").pipe(
    Command.withDescription("the surface-cli fixture host"),
    Command.withSubcommands([...fixtureCommands()]),
  );
}

/** The SAME projection, mounted the other way the seam allows: the endpoint flag
 *  is declared ONCE on the parent as a shared flag, and `resolve` reads it back
 *  out of the parent's context — which is what `kolu-cli` does, and why, so that
 *  `demo --socket X proc_count` parses as well as `demo proc_count --socket X`.
 *  A flag declared on a subcommand only parses AFTER that subcommand's name.
 *
 *  Nothing about the projection changes: `flags` is simply absent, so this face
 *  adds none and there is no parent/child collision to have. */
export function fixtureRootWithParentFlags() {
  const root = Command.make("demo").pipe(
    Command.withSharedFlags(endpointFlags),
    Command.withDescription("the surface-cli fixture host (parent flags)"),
  );
  const commands = commandsWith({
    resolve: () => Effect.flatMap(root, resolveFixture),
  });
  return root.pipe(Command.withSubcommands([...commands]));
}

/** The SAME projection over a transport that CANNOT PUSH — `streaming: false`.
 *
 *  What it proves is a subtraction: no `watch` command is mounted and no
 *  `--follow` is declared, so a caller finds out from `--help` rather than from
 *  a subscription that ends after one frame. The seam still dials the same live
 *  socket, because the point is the PROJECTION's shape and not the link's — a
 *  fixture that also broke the link could not tell a missing command from a dead
 *  endpoint. */
export function fixtureRootOneShot() {
  return Command.make("demo").pipe(
    Command.withDescription("the surface-cli fixture host (one-shot endpoint)"),
    Command.withSubcommands([
      ...commandsWith({
        flags: endpointFlags,
        resolve: resolveFixture,
        streaming: false,
      }),
    ]),
  );
}

/** The same projection WITH a help page — the parent's description is the page,
 *  and the verbs are unlisted because the page has already listed them. */
export function fixtureRootWithHelp() {
  return Command.make("demo").pipe(
    Command.withDescription(
      surfaceHelp({
        surface,
        expose: EXPOSE,
        verbs: VERBS,
        endpoint: { flags: endpointFlags, resolve: resolveFixture },
        annotate: ANNOTATE,
        help: HELP,
        info: { name: "demo" },
      }),
    ),
    Command.withSubcommands([
      ...commandsWith({ flags: endpointFlags, resolve: resolveFixture }, HELP),
    ]),
  );
}

/** A projection whose endpoint RESOLUTION refuses — the arm an app with a
 *  resolution order that can come up empty needs ("no `$DEMO_SOCKET`, no runtime
 *  dir, nothing to dial"). `how` picks the two ways a host can say it, because
 *  they must land on the SAME code: a typed failure, and a bare throw out of the
 *  seam — which is a defect the runtime would otherwise exit on with a number
 *  the matrix means something else by. */
export function fixtureRootWithUnresolvableEndpoint(how: "fail" | "throw") {
  const because = new Error("no $DEMO_SOCKET, and no runtime dir");
  const commands = commandsWith({
    flags: endpointFlags,
    resolve: () => {
      if (how === "throw") throw because;
      return Effect.fail(because);
    },
  });
  return Command.make("demo").pipe(
    Command.withDescription("the surface-cli fixture host (no endpoint)"),
    Command.withSubcommands([...commands]),
  );
}
