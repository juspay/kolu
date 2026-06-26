/**
 * The data side of the CLI — reading the `terminalWorkspaceSurface` from a
 * connected client, factored out of `main.ts` so it is testable against a real
 * pulam over a real socket with no tty (see the integration test). Two reads: a
 * one-shot `snapshotAwareness` for `status`, and a live `watchAwareness` for
 * `watch` (the `awareness` collection + the `activity` live-dot stream, driven
 * by `mirrorRemoteSurface`).
 */

import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  terminalWorkspaceSurface,
  type AwarenessValue,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import type { Connection, PulamClient } from "./connect.ts";

/** Confirm the running pulam speaks a wire-compatible workspace contract before
 *  we read it — a newer pulam-tui against an older/different daemon would
 *  otherwise fail deep inside oRPC with an opaque schema error instead of an
 *  honest "restart it" line. The `version` cell ALWAYS opens with a snapshot
 *  frame, so an empty stream is a protocol/link failure, not a benign "no value
 *  yet" — `firstFrameOrUndefined` returning undefined is surfaced as such. */
export async function assertCompatible(client: PulamClient): Promise<string> {
  const version = await firstFrameOrUndefined(
    await client.surface.version.get({}),
  );
  if (version === undefined) {
    throw new Error(
      "pulam version cell yielded no snapshot frame — the surface stream ended empty (link or protocol failure).",
    );
  }
  if (
    !isContractVersionCompatible(
      version.contractVersion,
      TERMINAL_WORKSPACE_CONTRACT_VERSION,
    )
  ) {
    throw new Error(
      `workspace contract mismatch: the daemon speaks ${version.contractVersion}, pulam-tui needs ${TERMINAL_WORKSPACE_CONTRACT_VERSION}. Restart it (and pulam-tui) to the same build.`,
    );
  }
  return version.contractVersion;
}

/** A one-shot snapshot of the whole awareness collection: the current key set
 *  (the first frame of the `keys` snapshot-then-delta stream), then each key's
 *  current value (the first frame of its per-key stream). Per-key reads run
 *  concurrently; their streams are aborted once read. */
export async function snapshotAwareness(
  client: PulamClient,
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

/** Handlers a live `watch` reacts to. `live` is whether the terminal is moving
 *  bytes RIGHT NOW (the `activity` stream's current membership) at the instant
 *  of the awareness change — annotation only; an activity-only flip emits no
 *  line of its own (it pulses ~1s while bytes move, which would drown the feed),
 *  it just colours the next awareness line. */
export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: AwarenessValue, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
}

/** Follow the awareness collection live until the link closes (`conn.dispose()`
 *  on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives both the
 *  `awareness` collection (the rows) and the `activity` stream (the live dot):
 *  the activity frame updates a local live-set the upsert handler reads, so a
 *  printed line reflects whether that terminal was moving bytes at the time.
 *  Resolves when the mirror settles (every subscription ended = link closed). */
export async function watchAwareness(
  conn: Connection,
  handlers: WatchHandlers,
  signal?: AbortSignal,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving
  // bytes right now. Updated on each frame; read (not re-emitted) by upserts.
  const live = new Set<TerminalId>();
  await mirrorRemoteSurface(
    terminalWorkspaceSurface,
    conn.client,
    {
      collections: {
        awareness: {
          upsert: (id, value) => handlers.onUpsert(id, value, live.has(id)),
          remove: (id) => handlers.onRemove(id),
        },
      },
      streams: {
        activity: {
          input: {},
          onFrame: (ids) => {
            live.clear();
            for (const id of ids) live.add(id);
          },
        },
      },
    },
    { signal },
  ).done;
}
