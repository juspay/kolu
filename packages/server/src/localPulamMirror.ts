/**
 * kolu-server's awareness backing — a MIRROR of its own supervised local pulam
 * (R9.0, "kolu consumes a local pulam"). kolu no longer runs the awareness
 * sensors in-process; instead it spawns ONE ephemeral local pulam (which dials
 * kolu's kaval, runs the one sensor set, and serves `terminalWorkspaceSurface`
 * over a unix socket) and mirrors it here. The arrow points **→ pulam** — kolu
 * never serves awareness itself — with no cross-reach: pulam-web keeps its OWN
 * pulam, so the `connectTerminalWorkspace` coupling R9a fought never arises.
 *
 * Two halves:
 *
 *   - `pulamMirror` — the SHARED mirror fold (`@kolu/terminal-workspace/reserve`,
 *     the very one pulam-web uses): each mirrored `awareness` frame is applied to
 *     the matching registry entry (so kolu's persist/sleep/wake readers stay
 *     current) and published on the served `awareness` collection; the `activity`
 *     live-set rides the fold's bus, which `surface.ts` plugs into
 *     `serveTerminalWorkspace`'s `activity` backing — so the live byte-tap kolu
 *     lacked in-process (it served an empty activity set before R9.0) now arrives
 *     over the mirror.
 *
 *   - `startLocalPulamMirror` — the supervise-and-mirror LOOP: bring the local
 *     pulam up through the R2 supervisor spine (EPHEMERAL — `adoptOrEnsure` finds
 *     no gate/survivor, so it always *ensures*, never adopts), mirror it until the
 *     link dies, then clear the live-set and re-ensure. This is the LOCAL arm of
 *     the SAME backing R9.3 will point at a REMOTE pulam — one mirror code path.
 */

import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  createEndpoint,
  type EndpointStatus,
} from "@kolu/surface-daemon-supervisor";
import { mirrorTerminalWorkspace } from "@kolu/terminal-workspace/reserve";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import { log } from "./log.ts";
import {
  connectPulam,
  type PulamDaemonClient,
} from "./ptyHost/connectPulam.ts";
import { kavalSocketPath } from "./ptyHost/localDriver.ts";
import {
  localPulamDriver,
  pulamGatePath,
  pulamLocalSocketPath,
} from "./ptyHost/localPulamDriver.ts";
import { applyMirroredAwareness } from "./terminalEndpoint/metadata.ts";

/** This endpoint's daemon-status key — INTERNAL: the mirror's health surfaces
 *  indirectly through awareness freshness, not the UI's kaval-host daemon list. */
const PULAM_HOST_ID = "local-pulam";

/** How long to wait before re-mirroring after a dropped pulam link. */
const REMIRROR_DELAY_MS = 2_000;

/** The shared mirror fold. `awareness.upsert` applies each frame to the registry
 *  entry + publishes; `remove` is a NO-OP because kolu owns terminal MEMBERSHIP
 *  (its own lifecycle drives departures via `dropAwareness`) — pulam supplies the
 *  awareness CONTENT for terminals kolu already has, not which terminals exist.
 *  kolu serves its OWN `version` cell, so the mirrored version is ignored. */
export const pulamMirror = mirrorTerminalWorkspace({
  awareness: {
    upsert: (id, value) => applyMirroredAwareness(id, value),
    remove: () => {},
  },
});

/** Resolve after `ms`, or early if `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Bring up the local pulam and mirror it as kolu's awareness backing, for the
 *  life of the process. Fire-and-forget AFTER kaval's endpoint is up (pulam dials
 *  kaval's socket): the mirror is best-effort, so a slow/failed pulam leaves
 *  awareness briefly absent (re-derived on the next cycle) rather than blocking
 *  the server boot — the worst case on the local awareness path is a briefly
 *  stale badge, never lost work. */
export function startLocalPulamMirror(opts: { port: number }): void {
  const pulamSocket = pulamLocalSocketPath(opts.port);
  const kavalSocket = kavalSocketPath(opts.port);
  const onStatus = (
    hostId: string,
    status: EndpointStatus<undefined>,
  ): void => {
    log.debug({ hostId, state: status.state }, "local pulam endpoint status");
  };
  const endpoint = createEndpoint<PulamDaemonClient, undefined>({
    hostId: PULAM_HOST_ID,
    gatePath: pulamGatePath(pulamSocket),
    socketPath: pulamSocket,
    driver: localPulamDriver(pulamSocket, kavalSocket),
    connect: () => connectPulam(pulamSocket),
    log,
    onStatus,
  });

  // Process-lifetime signal — never aborted today (no shutdown hook; the kaval
  // inventory reconciler runs the same way).
  const signal = new AbortController().signal;

  void (async () => {
    while (!signal.aborted) {
      try {
        // Ephemeral: `adoptOrEnsure` finds no gate/survivor → always spawns a
        // fresh pulam and connects (the driver self-recycles its prior child).
        await endpoint.adoptOrEnsure();
        const conn = endpoint.current();
        if (conn) {
          // Mirror until the link dies (pulam exit → socket close → streams end).
          await mirrorRemoteSurface(
            terminalWorkspaceSurface,
            conn.client,
            pulamMirror.sink(() => log.info("local pulam mirror live")),
            { signal },
          ).done;
        }
      } catch (err) {
        if (signal.aborted) return;
        log.warn({ err }, "local pulam mirror cycle failed — retrying");
      }
      // Link down (or ensure failed): the byte-tap is gone, so clear the live
      // activity set (awareness rows persist on the registry as last-known); the
      // next cycle re-mirrors from pulam's fresh snapshot.
      pulamMirror.reset();
      if (signal.aborted) return;
      await delay(REMIRROR_DELAY_MS, signal);
    }
  })();
}
