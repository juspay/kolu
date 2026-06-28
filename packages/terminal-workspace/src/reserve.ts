/**
 * `mirrorTerminalWorkspace` — the shared mirror-fold core, lifted out of
 * pulam-web's `buildReServe` so kolu-server and pulam-web fold a mirrored
 * `terminalWorkspaceSurface` the SAME way (R9.0). It owns only the PUSH-primitive
 * fold — the `version` handshake, the per-key `awareness` writes, and the
 * `activity` live-set bus — and exposes:
 *
 *   - `sink(onFirstVersion?)` — the {@link SurfaceSink} to hand
 *     `mirrorRemoteSurface(terminalWorkspaceSurface, client, sink)`. Every remote
 *     frame folds INWARD: `version` (the first is the link-live handshake →
 *     `onFirstVersion`), `awareness` upsert/remove → the injected target, and
 *     `activity` → the local bus.
 *   - `activity` — the re-served {@link ActivityStreamDeps}: a snapshot-then-bus
 *     source the home plugs into its own surface (kolu's `serveTerminalWorkspace`
 *     `activity` dep; pulam-web's browser-facing `activity` stream).
 *   - `reset()` — drop the whole remote-derived fold on link death (the pump's
 *     `onLinkDown`): re-`remove` every awareness key folded so far AND publish an
 *     empty activity frame, so a reader subscribed ACROSS the reconnect sees the
 *     stale rows depart and the live dots go dark rather than pin stale state (the
 *     no-fallback convention) — the next mirror rebuilds from the remote snapshot.
 *
 * The two homes differ ONLY in the injected `awareness` target and what they do
 * with `activity`: pulam-web routes awareness through its in-memory cache + its
 * browser re-serve fragment (so the browser sees published deltas) and keeps its
 * own `version` store + procedure-forwarding wrapper on top; kolu-server routes
 * awareness into its registry entry (so its sleep/wake/persist readers stay
 * current) and ignores the mirrored `version` (it serves its own). Neither the
 * connection cell, the live holders, nor the procedure forwarding belong here —
 * those are the browser re-serve's concern and stay in pulam-web — so this core
 * depends only on `@kolu/surface`, with no node-host machinery.
 */

import type { SurfaceSink } from "@kolu/surface/mirror";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import type { ActivityStreamDeps } from "./serveTerminalWorkspace.ts";
import type { AwarenessValue, TerminalId, Version } from "./surface.ts";
import type { terminalWorkspaceSurface } from "./surface.ts";

/** The surface SPEC the {@link SurfaceSink} is generic over. */
type TerminalWorkspaceSpec = typeof terminalWorkspaceSurface.spec;

/** The `source`-bearing arm of {@link ActivityStreamDeps} — the live `activity`
 *  backing this fold produces (a snapshot-then-bus generator), as opposed to the
 *  `pollOnEvent` `{ read, install, … }` arm. Assignable to `ActivityStreamDeps`,
 *  so a home hands `mirror.activity` straight to `serveTerminalWorkspace`. */
type ActivitySourceDeps = Extract<ActivityStreamDeps, { source: unknown }>;

/** Where a mirrored `awareness` frame lands — the one point of variation between
 *  the two homes. pulam-web injects its re-serve fragment's published write (cache
 *  + channel fan-out); kolu-server injects its registry apply (mutate the entry +
 *  publish). `remove` may be a no-op for a home that owns terminal membership
 *  itself (kolu, whose own lifecycle drives departures). */
export interface AwarenessFoldTarget {
  upsert: (id: TerminalId, value: AwarenessValue) => void;
  remove: (id: TerminalId) => void;
}

export interface TerminalWorkspaceMirror {
  /** Build the mirror SINK for ONE freshly-(re)connected client. `onFirstVersion`
   *  fires on the first `version` frame — the link-live handshake (the session
   *  loop wires `markConnected`/a "mirror live" log into it). The sink folds only
   *  PUSH primitives and never reads the client, so it takes no client argument. */
  sink: (onFirstVersion?: () => void) => SurfaceSink<TerminalWorkspaceSpec>;
  /** The re-served `activity` backing — yields the current live set on subscribe
   *  (snapshot-then-delta, the streaming contract every reconnect relies on), then
   *  forwards each frame the mirror folded onto the local bus. */
  activity: ActivitySourceDeps;
  /** Drop the whole remote-derived fold (the pump's `onLinkDown`). */
  reset: () => void;
}

/** Build the shared mirror fold. `awareness` is the injected write target;
 *  `onVersion` lets a home that keeps its own `version` cell fold the mirrored
 *  value into it (kolu ignores it — it serves its own version). */
export function mirrorTerminalWorkspace(deps: {
  awareness: AwarenessFoldTarget;
  onVersion?: (value: Version) => void;
}): TerminalWorkspaceMirror {
  // A local bus the mirror's `activity` sink republishes each remote frame onto,
  // so the home-facing `activity` source forwards the same data without
  // re-subscribing to the remote. `activityLatest` caches the most-recent frame
  // so a reader that subscribes mid-stream gets the TRUE live set as its snapshot
  // — NOT every existing terminal (the live dot is the byte-tap, distinct from a
  // terminal merely existing). It starts `[]`: until the first real frame nothing
  // is moving.
  const activityBus: Channel<TerminalId[]> = inMemoryChannel<TerminalId[]>();
  let activityLatest: TerminalId[] = [];
  // The keys this fold has upserted, so `reset` can re-`remove` exactly them
  // (the next mirror rebuilds from the remote's authoritative snapshot).
  const liveKeys = new Set<TerminalId>();

  const sink = (
    onFirstVersion?: () => void,
  ): SurfaceSink<TerminalWorkspaceSpec> => {
    let firstVersionFrame = true;
    return {
      cells: {
        version: (value) => {
          if (firstVersionFrame) {
            firstVersionFrame = false;
            onFirstVersion?.();
          }
          deps.onVersion?.(value);
        },
      },
      collections: {
        awareness: {
          upsert: (key, value) => {
            liveKeys.add(key);
            deps.awareness.upsert(key, value);
          },
          remove: (key) => {
            liveKeys.delete(key);
            deps.awareness.remove(key);
          },
        },
      },
      streams: {
        activity: {
          input: {},
          // Cache the frame as the new snapshot BEFORE publishing, so a reader
          // subscribing immediately after sees this frame as its snapshot rather
          // than a stale one (publish reaches only already-subscribed consumers).
          onFrame: (frame) => {
            activityLatest = frame;
            activityBus.publish(frame);
          },
        },
      },
    };
  };

  const activity: ActivitySourceDeps = {
    source: async function* (_input, signal) {
      yield [...activityLatest];
      for await (const frame of activityBus.subscribe(signal)) {
        yield frame;
      }
    },
  };

  const reset = (): void => {
    // Snapshot the keys first: `remove` deletes from the set as it goes, so
    // iterating the live set directly would skip entries.
    for (const key of [...liveKeys]) {
      liveKeys.delete(key);
      deps.awareness.remove(key);
    }
    activityLatest = [];
    activityBus.publish([]);
  };

  return { sink, activity, reset };
}
