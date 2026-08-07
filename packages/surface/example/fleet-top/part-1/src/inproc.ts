/**
 * The first link: `directDispatch` — in-process, no wire.
 *
 * The wire links (`websocketLink`, `stdioLink`, `unixSocketLink`) SEPARATE the
 * serve side from the consume side. `directDispatch` FUSES them: it takes the
 * served handler record itself and calls handlers directly, so the face you hold
 * here is the exact face a WebSocket or ssh consumer holds — zero serialization,
 * in either direction, and `live` is constant-`true` honestly (there is no
 * transport that could half-open).
 *
 * `buildSurfaceFace` is the addressing layer: it re-nests the flat wire tags
 * (`surface/load/get`) into `face.surface.load.get`. Streaming verbs hand back a
 * lazy Effect `Stream`; unary verbs hand back a `Promise`. The face is
 * deliberately STRUCTURAL — per-member types live in the spec-derived bound
 * hooks `surfaceClient` builds (see `client/wire.ts`) — so a non-reactive reader
 * like this one names the member shape it is calling, once.
 *
 * Run with `pnpm run inproc`. This is the honest "hello world" of the stack:
 * define → implement → consume, with the transport collapsed to nothing.
 */

import {
  buildSurfaceFace,
  type StreamingProcedure,
} from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { Effect, Option, Stream } from "effect";
import type { Load, Memory, Pid } from "./common/surface";
import { surface } from "./common/surface";
import { createTop } from "./server/top";

/** A cell `get` and a collection `keys` both OPEN with the current snapshot,
 *  then stream deltas. In-process we only want that first frame, so run the
 *  stream's head — which interrupts the subscription the moment it lands. */
async function snapshot<T>(
  stream: Stream.Stream<T, unknown>,
  what: string,
): Promise<T> {
  const head = await Effect.runPromise(Stream.runHead(stream));
  if (Option.isNone(head)) {
    throw new Error(`${what}: stream closed before its snapshot frame`);
  }
  return head.value;
}

async function main(): Promise<void> {
  const top = createTop();
  top.start();

  // `directDispatch` takes the served surface (anything carrying `handlers`),
  // so the whole runtime goes in verbatim.
  const face = buildSurfaceFace(surface, directDispatch(top.runtime));
  const cell = <T>(name: "load" | "memory") =>
    face.surface[name]?.get as StreamingProcedure<undefined, T>;

  // Give the first poll a moment to land, then read the cells + collection.
  await new Promise((r) => setTimeout(r, 100));

  const load = await snapshot(cell<Load>("load")(undefined), "load");
  const memory = await snapshot(cell<Memory>("memory")(undefined), "memory");
  const pids = await snapshot(
    (face.surface.processes?.keys as StreamingProcedure<undefined, Pid[]>)(
      undefined,
    ),
    "processes.keys",
  );

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
