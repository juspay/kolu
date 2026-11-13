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
 * that name exists, it says HOW it joined ({@link FleetWatchJoin} — the server
 * reads an `asked` join as a baseline rather than as news), and the answer is
 * always the whole list plus the state the terminal was found in — an agent
 * that just watched something should not have to issue a second call to learn
 * what it is now watching, nor a third to learn what it is doing.
 *
 * The membership check is deliberate and is not a formality. "Watch this" with
 * a typo'd id, accepted silently, is a conductor that ends its turn believing a
 * worker will wake it and never hears anything again. A refusal naming the
 * mistake costs one turn; the silent version costs the whole run.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal } from "@kolu/padi-client/surface";
import { activeAgent } from "@kolu/padi-client/terminalVocab";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import { Effect, Schema } from "effect";
import { type FleetHosts, requireTerminal } from "./hosts.ts";
import { FleetTerminalRefSchema } from "./refSchema.ts";

/** HOW a terminal came to be watched — the fact the server's watcher needs to
 *  decide what its first observation means.
 *
 *   - `created` / `created-run` — the Conductor made this terminal, so the
 *     first reading is normally a bare shell and every later level is news.
 *     `created-run` additionally means a command was typed at that shell, so a
 *     terminal that runs it and comes back to the prompt with no agent ever
 *     seen is a bring-up that failed, not a terminal to wait on for ever.
 *   - `asked` — the Conductor asked for a terminal that was already there. Its
 *     first observation is a BASELINE, not news: an idle worker that was idle
 *     before anyone looked must not ring as if it had just stopped. The state
 *     it was found in is in `watch_terminal`'s answer instead. */
export type FleetWatchJoin = "created" | "created-run" | "asked";

/** The Conductor's watch list, as the fleet face reaches it. kolu-server owns
 *  it — this is only the door. */
export interface FleetWatchList {
  /** The watched fleet references, in the order they were added. */
  watched(): readonly string[];
  /** Watch `ref`, saying how it joined. Idempotent: watching what is already
   *  watched is not an error, keeps the existing entry (its `joined` included)
   *  and must not move it in the order. */
  watch(ref: string, joined: FleetWatchJoin): void;
  /** Stop watching `ref`; `false` when it was not watched. */
  unwatch(ref: string): boolean;
  /** The Conductor just spoke to the agent in this terminal (`agent_say`
   *  landed its keys). The news that terminal is holding is about a state the
   *  Conductor has now acted on, so the server withdraws it and re-baselines;
   *  a ref that is not watched is simply ignored. */
  said(ref: string): void;
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

/** The state a terminal was found in when it joined the list — the answer to
 *  "what am I actually watching", returned by `watch_terminal` so that joining
 *  does not have to be followed by a screen read to learn whether the worker
 *  is busy, idle, absent or asleep.
 *
 *  It exists for a second reason too: an `asked` join BASELINES on its first
 *  observation (it must not ring for a state that was already true when the
 *  Conductor looked), so the state that will NOT ring is told here, once,
 *  instead of being silently swallowed. */
export type WatchedFound =
  | { readonly kind: "asleep"; readonly state: string }
  | { readonly kind: "no-agent" }
  | { readonly kind: "agent"; readonly agent: string; readonly bucket: string };

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
): Effect.Effect<{ id: string; padi: PadiSurfaceClient }, ToolFailure> {
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
      (
        keys,
      ): Effect.Effect<{ id: string; padi: PadiSurfaceClient }, ToolFailure> =>
        keys.includes(id)
          ? Effect.succeed({ id, padi })
          : Effect.fail(
              new ToolFailure<WatchTerminalRefusal>(
                `${ref} is not a terminal on that host — nothing by that name is in its roster, so watching it would mean waiting for news that can never come. Read the terminals resource for the live list.`,
                { kind: "terminal-not-in-roster", id: ref },
              ),
            ),
    ),
  );
}

/** The record, read as the one sentence the answer carries. The SAME reading
 *  `agent_say` makes (padi's own `activeAgent` narrowing plus the shared
 *  bucket fold), so "what state is it in" has one answer across this face. */
function foundState(
  ref: string,
  id: string,
  padi: PadiSurfaceClient,
): Effect.Effect<WatchedFound, ToolFailure> {
  return Effect.map(
    Effect.mapError(
      firstFrameOrThrow(
        padi.surface.terminals.get({ key: id }),
        `${ref} is in the roster but answered no record, so what is running in it is unknown.`,
      ),
      (cause) =>
        new ToolFailure<WatchTerminalRefusal>(
          `could not read ${ref}'s record: ${String(cause)}`,
          { kind: "terminal-not-in-roster", id: ref },
        ),
    ),
    (frame): WatchedFound => {
      const record = frame as PadiTerminal;
      if (record.state !== "active") {
        return { kind: "asleep", state: record.state };
      }
      const agent = activeAgent(record);
      return agent === null
        ? { kind: "no-agent" }
        : {
            kind: "agent",
            agent: agent.kind,
            bucket: agentBucket(agent.state),
          };
    },
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
      "Watch this terminal: when its agent stops, asks you something, or the terminal dies, kolu starts a turn and tells you — so you end your turn instead of waiting on it. A terminal you created is watched already. Refused if nothing by that name is there, because a watch on a terminal that does not exist is silence you would read as calm. Answers the whole watch list AND the state the terminal was found in (`found`: the agent and its bucket, or `no-agent` / `asleep`) — that state is the BASELINE, so it will not be reported to you as news; anything after it will.",
    handler: (args, _bundle, _signal) => {
      const { id } = args as WatchArgs;
      return Effect.flatMap(requireInRoster(hosts, id), (terminal) =>
        Effect.map(foundState(id, terminal.id, terminal.padi), (found) => {
          // The watch is recorded AFTER the state is read, so the answer and
          // the entry describe the same moment: a terminal added first and read
          // second could ring for a change that happened in between while this
          // answer still called it idle.
          watchList.watch(id, "asked");
          return { watching: watchList.watched(), found };
        }),
      );
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
