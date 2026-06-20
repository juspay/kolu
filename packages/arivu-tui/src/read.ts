/**
 * Reading the `awareness` collection from a connected client — the pure
 * data-side of the CLI, factored out of `bin.ts` so it is testable against a
 * real arivu over a real socket with no tty (see the integration test).
 */

import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import type { ArivuClient } from "./connect.ts";

/** A one-shot snapshot of the whole awareness collection: the current key set
 *  (the first frame of the `keys` snapshot-then-delta stream), then each key's
 *  current value (the first frame of its per-key stream). Per-key reads run
 *  concurrently; their streams are aborted once read. */
export async function snapshotAwareness(
  client: ArivuClient,
): Promise<Array<[TerminalId, AwarenessValue]>> {
  const abort = new AbortController();
  try {
    const keys =
      (await firstFrameOrUndefined(await client.surface.awareness.keys({}))) ??
      [];
    const pairs = await Promise.all(
      keys.map(async (key): Promise<[TerminalId, AwarenessValue] | null> => {
        const value = await firstFrameOrUndefined(
          await client.surface.awareness.get({ key }, { signal: abort.signal }),
        );
        return value === undefined ? null : [key, value];
      }),
    );
    return pairs.filter((p): p is [TerminalId, AwarenessValue] => p !== null);
  } finally {
    abort.abort();
  }
}
