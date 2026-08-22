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
import { buildSurfaceFace } from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import type { SurfaceClientCallable, SurfaceVerb } from "@kolu/surface/verbs";
import { type SurfaceCliConnection, surfaceCommands } from "@kolu/surface-cli";
import { Command, Flag } from "effect/unstable/cli";
// #endregion imports
import { Effect } from "effect";
import { surface } from "./surface";

// #region endpoint
// WHERE to dial is the app's policy, so the app owns all three parts: the flags
// a user spells it with, the sentence that names it when the dial fails, and the
// dial itself. Nothing in `surface-cli` knows what a socket is.
const endpointFlags = {
  socket: Flag.string("socket").pipe(
    Flag.withDefault(
      getRuntimeSocketPath({ app: "example", file: "surface.sock" }),
    ),
  ),
};

const describe = (values: { readonly socket: string }): string => values.socket;

const connect = async (values: {
  readonly socket: string;
}): Promise<SurfaceCliConnection> => {
  const link = await unixSocketLink({
    group: surface.group,
    socketPath: values.socket,
  });
  return {
    client: buildSurfaceFace(surface, link.dispatch) as SurfaceClientCallable,
    // Required, not optional: a CLI dials, does one thing and exits, and the one
    // failure that costs a user something is a socket left open in a shell loop.
    dispose: () => link.dispose(),
  };
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
  endpoint: { flags: endpointFlags, describe, connect },
  // CLI-only ergonomics, BESIDE the verb table rather than inside it: `pid`
  // becomes an argv position, so it is `proc_kill 4321`, not `--pid 4321`.
  annotate: { proc_kill: { positional: ["pid"] } },
  info: { name: "example", version: "1.0.0" },
});
// #endregion project

// #region mount
// The host binary mounts them beside its own faces and keeps the run edge —
// `surfaceCommands` returns values and runs no program.
export const cli = Command.make("example").pipe(
  Command.withSubcommands([...commands]),
);
// #endregion mount
