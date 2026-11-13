/**
 * The Conductor's WATCH LIST, as the fleet face reaches it — a port, and the
 * two tools that move it.
 *
 * kolu-server owns the list: it is persisted with the conversation, it is what
 * the server's watcher reads to decide which terminals can wake a turn, and it
 * outlives this MCP face entirely (a reconnecting conductor finds the same
 * list). So the face holds none of it — the same reasoning `FleetHosts` is
 * built on one file over, for the same reason: a second copy inside this
 * package is a copy that can be wrong.
 *
 * What the face DOES own is the vocabulary: a watched entry is a fleet
 * reference (`<host>/<id>`), it is refused before it is added if nothing by
 * that name exists, and the answer is always the whole list — an agent that
 * just watched something should not have to issue a second call to learn what
 * it is now watching.
 *
 * The membership check is deliberate and is not a formality. "Watch this" with
 * a typo'd id, accepted silently, is a conductor that ends its turn believing a
 * worker will wake it and never hears anything again. A refusal naming the
 * mistake costs one turn; the silent version costs the whole run.
 */

import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect, Schema } from "effect";
import { type FleetHosts, requireTerminal } from "./hosts.ts";
import { FleetTerminalRefSchema } from "./refSchema.ts";

/** The Conductor's watch list, as the fleet face reaches it. kolu-server owns
 *  it — this is only the door. */
export interface FleetWatchList {
  /** The watched fleet references, in the order they were added. */
  watched(): readonly string[];
  /** Watch `ref`. Idempotent: watching what is already watched is not an
   *  error, and must not move it in the order. */
  watch(ref: string): void;
  /** Stop watching `ref`; `false` when it was not watched. */
  unwatch(ref: string): boolean;
}

/** Why a watch was refused. `not-a-fleet-ref` / `unknown-host` /
 *  `host-not-connected` are `hosts.ts`'s own refusals, re-raised verbatim; this
 *  module adds only the last one. */
export interface WatchTerminalRefusal extends Record<string, unknown> {
  readonly kind: "terminal-not-in-roster";
  readonly id: string;
}

const WatchArgsSchema = Schema.Struct({
  id: FleetTerminalRefSchema,
});
type WatchArgs = typeof WatchArgsSchema.Type;

/** Refuse unless the host's roster actually holds this terminal RIGHT NOW.
 *
 *  The roster, not a record read: a `get` on an unknown key is a declared
 *  per-member error whose shape differs by arm, while "is it in the key set" is
 *  the exact question — does this host have a terminal by that name — and it is
 *  one frame. A dormant terminal PASSES: a sleeping worker is a thing a
 *  conductor legitimately watches (it wakes when the human wakes it), and this
 *  tool writes nothing into the terminal, so there is no live PTY to need. */
function requireInRoster(
  hosts: FleetHosts,
  ref: string,
): Effect.Effect<string, ToolFailure> {
  return Effect.flatMap(requireTerminal(hosts, ref), ({ id, padi }) =>
    Effect.flatMap(
      Effect.mapError(
        firstFrameOrThrow(
          padi.surface.terminals.keys(undefined),
          `the host behind ${ref} answered no roster — it is connected but said nothing, so whether that terminal exists is unknown.`,
        ),
        (cause) =>
          new ToolFailure<WatchTerminalRefusal>(
            `could not read the roster of the host behind ${ref}: ${String(cause)}`,
            { kind: "terminal-not-in-roster", id: ref },
          ),
      ),
      (keys): Effect.Effect<string, ToolFailure> =>
        keys.includes(id)
          ? Effect.succeed(ref)
          : Effect.fail(
              new ToolFailure<WatchTerminalRefusal>(
                `${ref} is not a terminal on that host — nothing by that name is in its roster, so watching it would mean waiting for news that can never come. Read the terminals resource for the live list.`,
                { kind: "terminal-not-in-roster", id: ref },
              ),
            ),
    ),
  );
}

/** `watch_terminal` — add a terminal to what the Conductor is woken by. */
export function watchTerminalTool(
  hosts: FleetHosts,
  watchList: FleetWatchList,
): BespokeTool {
  return {
    input: WatchArgsSchema,
    mutates: true,
    title: "Watch a terminal",
    description:
      "Watch this terminal: when its agent stops, asks you something, or the terminal dies, kolu starts a turn and tells you — so you end your turn instead of waiting on it. A terminal you created is watched already. Refused if nothing by that name is there, because a watch on a terminal that does not exist is silence you would read as calm. Answers the whole watch list.",
    handler: (args, _bundle, _signal) => {
      const { id } = args as WatchArgs;
      return Effect.map(requireInRoster(hosts, id), (ref) => {
        watchList.watch(ref);
        return { watching: watchList.watched() };
      });
    },
  };
}

/** `unwatch_terminal` — stop being woken by a terminal. */
export function unwatchTerminalTool(watchList: FleetWatchList): BespokeTool {
  return {
    input: WatchArgsSchema,
    mutates: true,
    title: "Stop watching a terminal",
    description:
      "Stop being woken by this terminal — its work is done, or the human asked you to drop it. Answers the whole watch list and whether this reference was in it (removed: false simply means it was not, which is not an error: a terminal that died has already dropped off by itself).",
    // No roster check, deliberately: the common reason to unwatch something is
    // that it is finished or gone, and refusing to forget a terminal because it
    // no longer exists would leave the list unable to shed exactly the entries
    // that should go.
    handler: (args, _bundle, _signal) =>
      Effect.sync(() => {
        const { id } = args as WatchArgs;
        const removed = watchList.unwatch(id);
        return { watching: watchList.watched(), removed };
      }),
  };
}
