/**
 * The first link: `directLink` — in-process, no wire.
 *
 * Before any socket, the surface is consumable *in the same process*. Feed the
 * flattened router straight to `directLink` and you get the EXACT
 * `ContractRouterClient<typeof surface.contract>` a WebSocket or ssh consumer
 * would hold — byte-identical across a later transport swap. Every call invokes
 * the handler directly (microtask-deferred); streams come back as async
 * iterables, just as the wire links yield them.
 *
 * Run with `pnpm run inproc`. This is the honest "hello world" of the stack:
 * define → implement → consume, with the transport collapsed to nothing.
 */

import { directLink } from "@kolu/surface/links/direct";
import { surface } from "./common/surface";
import { createTop } from "./server/top";

/** A cell/collection `get`/`keys` verb yields snapshot-then-deltas as an async
 *  iterable (the same shape every wire link yields). In-process we only want the
 *  current value, so take the first frame — the snapshot. */
async function firstFrame<T>(
  source: AsyncIterable<T> | Promise<AsyncIterable<T>>,
): Promise<T> {
  for await (const frame of await source) return frame;
  throw new Error("stream closed before its snapshot frame");
}

async function main(): Promise<void> {
  const top = createTop();
  top.start();

  // `C` is load-bearing and must be passed explicitly — the router arg is typed
  // loosely, so an omitted generic silently degrades every call to `any`.
  const client = directLink<typeof surface.contract>(top.router);

  // Give the first poll a moment to land, then read the cells + collection —
  // each `get`/`keys` is a stream whose first frame is the current snapshot.
  await new Promise((r) => setTimeout(r, 100));

  const load = await firstFrame(client.surface.load.get({}));
  const memory = await firstFrame(client.surface.memory.get({}));
  const pids = await firstFrame(client.surface.processes.keys({}));

  process.stdout.write(
    `load ${load.avg.join(" ")} over ${load.cores} cores · ` +
      `mem ${(memory.used / 1e9).toFixed(1)}/${(memory.total / 1e9).toFixed(1)} GB · ` +
      `${pids.length} processes\n`,
  );

  top.dispose();
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
