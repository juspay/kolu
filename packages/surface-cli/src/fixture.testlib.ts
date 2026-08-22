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
import { buildSurfaceFace } from "@kolu/surface/client";
import { defineSurface } from "@kolu/surface/define";
import { exposeFace, type ExposeMap } from "@kolu/surface/expose";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import type { SurfaceClientCallable, SurfaceVerb } from "@kolu/surface/verbs";
import { Effect, Schema, Stream } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import {
  type ProjectedCommand,
  surfaceCommands,
  type SurfaceCliConnection,
} from "./commands";

// ── The surface ──────────────────────────────────────────────────────────

const Load = Schema.Struct({
  one: Schema.Finite,
  five: Schema.Finite,
  fifteen: Schema.Finite,
});
export const ZERO: typeof Load.Type = { one: 0, five: 0, fifteen: 0 };

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

/** A DECLARED refusal — the exit-1 arm of the contract, as a real domain error
 *  rather than a fabricated one. */
export class NoSuchPid extends Schema.TaggedError<NoSuchPid>(
  "@kolu/surface-cli/test/NoSuchPid",
)("NoSuchPid", { pid: Schema.Int }) {
  override get message(): string {
    return `no process ${this.pid}`;
  }
}

const KillArgs = Schema.Struct({
  pid: Pid,
  /** An optional field, so the projection's omit-when-absent rule is driven. */
  signal: Schema.optionalKey(Schema.Literals(["TERM", "KILL"])),
  /** A repeatable scalar array and an open string record, so the two
   *  non-obvious flag shapes are driven. */
  because: Schema.optionalKey(Schema.Array(Schema.String)),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export const surface = defineSurface({
  cells: { load: { schema: Load, default: ZERO } },
  collections: {
    processes: {
      keySchema: Pid,
      schema: Proc,
      // `deltas` is not a default collection verb, and `watch` is the command
      // that projects it — so the fixture opts in, which is also what proves
      // the projection reads the member's OWN verbs rather than assuming.
      verbs: ["keys", "get", "deltas", "upsert", "delete"],
    },
  },
  streams: { nodeLog: { inputSchema: Schema.String, outputSchema: LogFrame } },
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
        output: Schema.Struct({ ok: Schema.Boolean }),
        error: NoSuchPid,
      },
      /** No input at all — the `Schema.Void` arm of the bridge. */
      count: { output: Schema.Struct({ n: Schema.Int }) },
    },
  },
});

/** What the CLI face offers. Read-only where it is genuinely read-only, so the
 *  `mutates` default is exercised in both directions. */
export const EXPOSE = {
  load: "resource",
  processes: "resource",
  nodeLog: "resource",
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
    input: Schema.String as unknown as Schema.Codec<
      unknown,
      unknown,
      never,
      never
    >,
    handler: (args, _client: SurfaceClientCallable) =>
      Effect.succeed({ said: args }),
  },
};

// ── Serving it ───────────────────────────────────────────────────────────

const TABLE = new Map<number, typeof Proc.Type>([
  [7, { command: "vitest", cpuPct: 12.5, memPct: 3 }],
  [42, { command: "node", cpuPct: 0.5, memPct: 1 }],
]);

/** The `{ group, handlers }` pair, plus the ctx a test mutates to make a
 *  `watch` produce a delta. */
export function buildRuntime() {
  const table = new Map(TABLE);
  return implementSurface(surface, {
    cells: { load: { store: inMemoryStore(ZERO) } },
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
    },
    streams: {
      nodeLog: {
        source: (nodeId) =>
          Stream.succeed({
            kind: "snapshot" as const,
            text: `opened ${nodeId}`,
          }),
      },
    },
    events: { autosave: {} },
    procedures: {
      proc: {
        kill: ({ input, ctx }) =>
          table.has(input.pid)
            ? Effect.sync(() => {
                ctx.collections.processes.remove(input.pid);
                return { ok: true };
              })
            : Effect.fail(new NoSuchPid({ pid: input.pid })),
        count: () => Effect.succeed({ n: table.size }),
      },
    },
  });
}

/** Serve the fixture on `socketPath`, with the agent face's own exposure — the
 *  second gate, so a test proves the CLI's table and the server's are separate
 *  decisions. */
export async function serveFixture(
  socketPath: string,
  log: Logger,
): Promise<{
  listener: UnixSocketListener;
  runtime: ReturnType<typeof buildRuntime>;
}> {
  const runtime = buildRuntime();
  const listener = await serveOverUnixSocket({
    socketPath,
    group: runtime.group,
    handlers: runtime.handlers,
    expose: exposeFace(surface, EXPOSE),
    log,
  });
  return { listener, runtime };
}

// ── Consuming it ─────────────────────────────────────────────────────────

/** The endpoint seam a host owns: one `--socket` flag, one sentence naming it,
 *  one dial. Exactly the shape `packages/server`'s `dialOlai` will have. */
export const endpointFlags = { socket: Flag.string("socket") };

export function dialFixture(values: {
  readonly socket: string;
}): Promise<SurfaceCliConnection> {
  return unixSocketLink({
    group: surface.group,
    socketPath: values.socket,
  }).then((link) => ({
    client: buildSurfaceFace(surface, link.dispatch) as SurfaceClientCallable,
    dispose: () => link.dispose(),
  }));
}

/** The projected commands, as the fixture host mounts them. */
export function fixtureCommands(): ReadonlyArray<ProjectedCommand> {
  return surfaceCommands({
    surface,
    expose: EXPOSE,
    verbs: VERBS,
    endpoint: {
      flags: endpointFlags,
      describe: (values: { readonly socket: string }) => values.socket,
      connect: dialFixture,
    },
    annotate: { proc_kill: { positional: ["pid"] } },
    info: { name: "demo", version: "0.0.0" },
  });
}

/** The whole binary's tree — a root with the projected verbs under it, the way
 *  `olai surface <verb>` mounts them. */
export function fixtureRoot() {
  return Command.make("demo").pipe(
    Command.withDescription("the surface-cli fixture host"),
    Command.withSubcommands([...fixtureCommands()]),
  );
}
