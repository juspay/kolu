/**
 * Testing the example surface in-process — the blocks the "How to test a
 * surface" page embeds. `directLink` wraps the served router and invokes
 * handlers in-process (no socket, no subprocess), so the client the test drives
 * is the exact typed client a socket consumer would hold.
 */

import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { expect } from "vitest";
import { type LogFrame, type Pid, type Proc, surface, ZERO } from "./surface";

const table = new Map<Pid, Proc>();

// #region client
function makeTestClient() {
  const { router } = implementSurface(surface, {
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
        source: async function* (nodeId) {
          yield { kind: "snapshot", text: `opened ${nodeId}`, done: false };
        },
      },
    },
    events: { autosave: {} },
    procedures: {
      proc: {
        kill: async ({ input, ctx }) => {
          ctx.collections.processes.remove(input.pid);
          return { ok: true };
        },
      },
    },
  });
  // The raw typed client — the wire client, in-process. `implementSurface`
  // already returns a ready `{ router }`, so no re-wrap; pass it bare, because
  // directLink is the one link `surfaceClient` accepts without a watchdog.
  return directLink<typeof surface.contract>(router as never);
}
// #endregion client

// #region snapshot
const client = makeTestClient();
const load = await firstFrameOrThrow(
  await client.surface.load.get({}),
  "load cell yielded no snapshot frame — link failure",
);
expect(load).toEqual(ZERO);
// #endregion snapshot

// #region procedure
await client.surface.proc.kill({ pid: 4321 });

const alive = await firstFrameOrThrow(
  await client.surface.processes.keys({}),
  "processes keys yielded no snapshot frame — link failure",
);
expect(alive).not.toContain(4321);
// #endregion procedure

// #region stream
const frames: LogFrame[] = [];
for await (const frame of await client.surface.nodeLog.get({
  nodeId: "node-1",
})) {
  frames.push(frame);
  if (frame.done) break;
}
expect(frames[0]?.kind).toBe("snapshot");
// #endregion stream

export { client, frames, load };
