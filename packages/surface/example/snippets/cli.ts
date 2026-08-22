/**
 * Projecting the example surface as argv — the blocks the `@kolu/surface-cli`
 * reference and the "How to expose a surface to a terminal" page embed.
 *
 * The same three inputs the MCP face takes (`surface`, `expose`, the verb
 * table), plus the one thing only a CLI needs: an endpoint seam, because a
 * command dials something and an in-process adapter does not. What comes back
 * is a VALUE — commands the host binary mounts beside its own.
 *
 * Typechecked, never executed.
 */

// #region imports
import {
  buildSurfaceFace,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import type { SurfaceVerb } from "@kolu/surface/verbs";
import {
  type EndpointSeam,
  runEdge,
  type SurfaceCliConnection,
  surfaceCommands,
} from "@kolu/surface-cli";
import { Command, Flag } from "effect/unstable/cli";
// #endregion imports
import { Cause, Effect } from "effect";
import { surface } from "./surface";

// #region endpoint
// WHERE to dial is the app's policy, so the app owns the resolution: the flags a
// user spells it with, and one step that reads them. Nothing in `surface-cli`
// knows what a socket is.
//
// ONE step, answering with the endpoint's NAME beside the thunk that opens it —
// the name is what a FAILED dial has to report, which is exactly when there is
// no connection left to ask. A separate `describe` beside a `connect` would walk
// the resolution order twice and could name one endpoint while dialling another.
const endpointFlags = {
  socket: Flag.string("socket").pipe(
    Flag.withDefault(
      getRuntimeSocketPath({ app: "example", file: "surface.sock" }),
    ),
  ),
};

// `values` is TYPED from the flag record above — nothing restates its shape, so
// renaming the flag is a compile error here rather than an `undefined` the app
// would dial as the string "undefined".
//
// `resolve` returns an Effect: a resolution order that can come up empty ("no
// $APP_SOCKET, no runtime dir") has somewhere to say so, and a host whose flags
// sit on its OWN parent (`Command.withSharedFlags`) reads them from the parent's
// context here instead — omit `flags` in that case and this face adds none.
const endpoint: EndpointSeam<typeof endpointFlags> = {
  flags: endpointFlags,
  resolve: (values) =>
    Effect.succeed({
      where: values.socket,
      open: async (): Promise<SurfaceCliConnection> => {
        const link = await unixSocketLink({
          group: surface.group,
          socketPath: values.socket,
        });
        return {
          client: buildSurfaceFace(
            surface,
            link.dispatch,
          ) as SurfaceClientCallable,
          // Required, not optional: a CLI dials, does one thing and exits, and
          // the one failure that costs a user something is a socket left open in
          // a shell loop.
          dispose: () => link.dispose(),
        };
      },
    }),
};
// #endregion endpoint

// #region verbs
// The SAME record `serveSurfaceAsMcp` takes as its `tools` — one table, two
// faces, one set of names.
const verbs: Record<string, SurfaceVerb> = {
  top: {
    description: "The busiest process right now.",
    mutates: false,
    handler: (_args, _client: SurfaceClientCallable) =>
      Effect.succeed({ pid: 1, command: "init" }),
  },
};
// #endregion verbs

// #region project
const commands = surfaceCommands({
  surface,
  // The default-deny map — the same one the MCP face and the wire faces read.
  expose: {
    load: "resource",
    processes: "resource",
    "proc.kill": "tool",
  },
  verbs,
  endpoint,
  // CLI-only ergonomics, BESIDE the verb table rather than inside it: `pid`
  // becomes an argv position, so it is `proc_kill 4321`, not `--pid 4321`.
  annotate: { proc_kill: { positional: ["pid"] } },
  info: { name: "example" },
});
// #endregion project

// #region mount
// The host binary mounts them beside its own faces and keeps the run edge —
// `surfaceCommands` returns values and runs no program.
//
// The catch is not optional garnish: it is what makes the published exit matrix
// true of a real binary. Every failure this face raises carries
// `Runtime.errorReported = false` (its line is its own, and Effect's pretty cause
// dump on top would be noise), so a host that re-fails without writing
// `runEdge`'s `stderr` exits with the right code and says NOTHING. And a refusal
// from the CLI *library* — a rejected flag, an unknown subcommand — carries no
// code of ours at all until `runEdge` gives it one.
const root = Command.make("example").pipe(
  Command.withSubcommands([...commands]),
);

export const cli = Command.run(root, { version: "1.0.0" }).pipe(
  // `catchCause`, not `catch`: a DEFECT is not a failure, so `catch` never sees
  // one — and the runtime then reports it itself, through the default logger,
  // which writes to STDOUT and drops a log line into the data channel. Catching
  // the CAUSE puts every arm through one door. An INTERRUPT passes through
  // untouched: that is Ctrl-C, and 130 is the runtime's own teardown.
  Effect.catchCause((cause) => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
    const { stderr, failure } = runEdge("example", Cause.squash(cause));
    if (stderr !== "") process.stderr.write(stderr);
    return Effect.fail(failure);
  }),
);
// #endregion mount
