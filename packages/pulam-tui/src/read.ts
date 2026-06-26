/**
 * The data side of the CLI — reading the `terminalWorkspaceSurface` from a
 * connected client, factored out of `main.ts` so it is testable against a real
 * pulam over a real socket with no tty (see the integration test). Two reads: a
 * one-shot `snapshotAwareness` for `status`, and a live `watchAwareness` for
 * `watch` (the `awareness` collection + the `activity` live-dot stream, driven
 * by `mirrorRemoteSurface`).
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  type AwarenessValue,
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import type { PulamClient } from "./connect.ts";

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

/** Follow the awareness collection live until the link closes (the caller
 *  disposes on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives both
 *  the `awareness` collection (the rows) and the `activity` stream (the live
 *  dot): the activity frame updates a local live-set the upsert handler reads,
 *  so a printed line reflects whether that terminal was moving bytes at the time.
 *  Resolves when the mirror settles (every subscription ended = link closed).
 *
 *  `log` is the diagnostic sink for NON-abort upstream failures (a dropped link,
 *  a protocol error). Without it `mirrorRemoteSurface` would default to a no-op
 *  and a real connection loss would look like a clean stop — so `watch` passes a
 *  stderr sink and treats an un-aborted settle as a failure (see `cmdWatch`). */
export async function watchAwareness(
  client: PulamClient,
  handlers: WatchHandlers,
  signal?: AbortSignal,
  log?: (line: string) => void,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving
  // bytes right now. Updated on each frame; read (not re-emitted) by upserts.
  //
  // Seed it from the activity stream's CURRENT snapshot before the mirror opens,
  // so the initial awareness rows already know which terminals are live. The
  // mirror starts the awareness collection and the activity stream concurrently
  // with no ordering guarantee, so the keys-snapshot upserts can otherwise race
  // ahead of the activity stream's first frame and paint an already-active
  // terminal as idle until some later awareness change happens to re-emit it.
  // The mirror re-applies the same snapshot on its first activity frame (and
  // every delta after), so this only fills the startup gap.
  const live = new Set<TerminalId>();
  const seedAbort = new AbortController();
  try {
    const seed = await firstFrameOrUndefined(
      await client.surface.activity.get({}, { signal: seedAbort.signal }),
    );
    for (const id of seed ?? []) live.add(id);
  } finally {
    seedAbort.abort();
  }
  await mirrorRemoteSurface(
    terminalWorkspaceSurface,
    client,
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
    { signal, log },
  ).done;
}
