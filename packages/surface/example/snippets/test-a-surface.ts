/**
 * Testing the example surface in-process — the blocks the "How to test a
 * surface" page embeds. `directDispatch` takes the served surface and invokes
 * handlers in-process (no socket, no subprocess), so the client the test drives
 * is the exact face a socket consumer would hold.
 */

import {
  buildSurfaceFace,
  type StreamingProcedure,
  type UnaryProcedure,
} from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Effect, Option, Stream } from "effect";
import { expect } from "vitest";
import {
  type KillArgs,
  type Killed,
  type Load,
  type LogFrame,
  type NodeIdArg,
  type Pid,
  type Proc,
  surface,
  ZERO,
} from "./surface";

const table = new Map<Pid, Proc>();

// #region client
function makeTestClient() {
  const runtime = implementSurface(surface, {
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
            done: false,
          }),
      },
    },
    events: { autosave: {} },
    procedures: {
      proc: {
        kill: ({ input, ctx }) =>
          Effect.sync(() => {
            ctx.collections.processes.remove(input.pid);
            return { ok: true };
          }),
      },
    },
  });
  // The wire face, in-process. `implementSurface` already returns everything a
  // dispatch needs, so pass the runtime bare — `directDispatch` is the one
  // dispatch `surfaceClient` accepts without a watchdog.
  return buildSurfaceFace(surface, directDispatch(runtime));
}
// #endregion client

/** A snapshot-then-deltas member opens with its snapshot, so `runHead` IS the
 *  one-shot read — and it interrupts the subscription as soon as it lands. */
async function snapshot<T>(
  stream: Stream.Stream<T, unknown>,
  onEmpty: string,
): Promise<T> {
  const head = await Effect.runPromise(Stream.runHead(stream));
  if (Option.isNone(head)) throw new Error(onEmpty);
  return head.value;
}

const client = makeTestClient();
const loadGet = client.surface.load?.get as StreamingProcedure<undefined, Load>;
const keys = client.surface.processes?.keys as StreamingProcedure<
  undefined,
  readonly Pid[]
>;
const kill = client.surface.proc?.kill as UnaryProcedure<KillArgs, Killed>;
const nodeLog = client.surface.nodeLog?.get as StreamingProcedure<
  NodeIdArg,
  LogFrame
>;

// #region snapshot
const load = await snapshot(
  loadGet(undefined),
  "load cell yielded no snapshot frame — link failure",
);
expect(load).toEqual(ZERO);
// #endregion snapshot

// #region procedure
await kill({ pid: 4321 });

const alive = await snapshot(
  keys(undefined),
  "processes keys yielded no snapshot frame — link failure",
);
expect(alive).not.toContain(4321);
// #endregion procedure

// #region stream
const frames: LogFrame[] = [];
await Effect.runPromise(
  Stream.runForEach(
    // `takeUntil` ends the stream on the terminal frame, which finalizes the
    // subscription — the Stream-native `break`.
    Stream.takeUntil(nodeLog("node-1"), (frame) => frame.done),
    (frame) => Effect.sync(() => frames.push(frame)),
  ),
);
expect(frames[0]?.kind).toBe("snapshot");
// #endregion stream

export { client, frames, load };
