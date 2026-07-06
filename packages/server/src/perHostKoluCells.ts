/**
 * Per-host `kolu`-surface diagnostic cells (W4 "the switch", A1).
 *
 * `processStartedAt.padi` and `daemonInventory.boundPadi` are per-HOST facts — a tab
 * viewing host A must see A's padi uptime / build / convergence, not the boot default
 * host's. But the shared `koluSurfaceCtx` (surface.ts) serves ONE value for these
 * cells, spliced identically onto every host's router. So kolu-server samples them off
 * the DEFAULT session and every host reads the default's — the exact per-host lie A1
 * fixes.
 *
 * This builds a MINIMAL second `implementSurfaces` per pool entry — ONLY those two
 * cells, under the `kolu` key, over its OWN in-memory channel (isolated, the same
 * pattern `reServeSurface` uses per binding) — wired to THAT entry's `session`. The
 * two cell paths (`/surface/kolu/processStartedAt`, `/surface/kolu/daemonInventory`)
 * are byte-identical to the shared router's, so `hostPool` splices these two
 * sub-namespaces over `kolu` with NO contract change and the client's `kolu.cells.*`
 * reads untouched.
 *
 * The facts are ssh-FREE: `session.identity()` is a cached read (the async probe writes
 * it once per connect and republishes `onState`, so the subscription below refreshes
 * padi's uptime/version/commit the moment it lands) and `session.convergence()` is a
 * closure read. This adds NO periodic work per host (5a): the `daemonInventory` cell is
 * EVENT-DRIVEN — it re-publishes on a bind-state change + on the SHARED local-machine
 * scan's refresh, reading that scan's cached result rather than scanning per entry.
 */

import type { HostDaemonInventory } from "@kolu/padi/surface";
import { defineSurface } from "@kolu/surface/define";
import {
  implementSurfaces,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { LOCAL_HOST } from "kolu-common/contract";
import {
  type DaemonInventory,
  DEFAULT_DAEMON_INVENTORY,
  koluSurface,
  type ProcessStartedAt,
} from "kolu-common/surface";
import { enumerateDaemonInventoryOnce } from "./daemonInventory.ts";
import { serverStartedAt } from "./hostname.ts";
import { log } from "./log.ts";
import type { PadiSession } from "./padiSession.ts";

// The per-host slice of `koluSurface` — ONLY the two per-host cells. Cell specs are
// DERIVED from `koluSurface` (single-sourced schema/default/verbs), served under the
// `kolu` key so the wire paths match the shared router byte-for-byte.
const koluPerHostSurface = defineSurface({
  cells: {
    processStartedAt: koluSurface.spec.cells.processStartedAt,
    daemonInventory: koluSurface.spec.cells.daemonInventory,
  },
});

// `identity()` is CACHED (no ssh poll) — these are the three maps that used to live in
// index.ts, now bound to THIS host's session.
function padiStartedAt(session: PadiSession): number | null {
  const id = session.identity();
  return id.kind === "disconnected" ? null : id.startedAt;
}
function padiSurfaceVersion(session: PadiSession): string | null {
  const id = session.identity();
  return id.kind === "identified" ? id.baked.contractVersion : null;
}
function padiBuildCommit(session: PadiSession): string | null {
  const id = session.identity();
  return id.kind === "identified" && id.baked.commit.kind === "commit"
    ? id.baked.commit.sha
    : null;
}

export interface PerHostKoluCellsDeps {
  /** THIS pool entry's host (`local` or an ssh host). */
  host: string;
  /** THIS entry's bound padi session — the source of the per-host identity/convergence. */
  session: PadiSession;
  /** The SHARED local-machine daemon scan (host-INDEPENDENT — kolu-server's own box is the
   *  same for every remote entry). Read here for the remote-binding `localScan`; ONE owner
   *  scans, every per-host cell reads its cached result (5a). */
  getLocalScan: () => HostDaemonInventory | null;
  /** Subscribe to shared-scan updates so this cell re-publishes when the scan refreshes. */
  subscribeLocalScan: (onScan: () => void) => () => void;
}

export interface PerHostKoluCells {
  /** The router sub-namespace to splice over the shared `kolu.processStartedAt`. */
  processStartedAt: unknown;
  /** The router sub-namespace to splice over the shared `kolu.daemonInventory`. */
  daemonInventory: unknown;
  /** Stop this host's samplers (called when the host leaves the pool). */
  dispose: () => void;
}

/** Build + wire the per-host `kolu` diagnostic cell fragment for one pool entry. */
export function wirePerHostKoluCells(
  deps: PerHostKoluCellsDeps,
): PerHostKoluCells {
  const { host, session } = deps;

  const { router, ctx } = implementSurfaces(
    { kolu: koluPerHostSurface },
    {
      // A FRESH in-memory channel per host — publishes stay isolated to this entry's
      // sockets (the `reServeSurface` per-binding isolation pattern).
      channel: inMemoryChannelByName(),
      onStreamReadError: (err, info) =>
        log.error(
          { err: err instanceof Error ? err.message : String(err), ...info },
          "per-host kolu cell read failed",
        ),
    },
    {
      kolu: {
        cells: {
          processStartedAt: {
            store: inMemoryStore<ProcessStartedAt>({ server: 0, padi: null }),
            equals: (a: ProcessStartedAt, b: ProcessStartedAt) =>
              a.server === b.server && a.padi === b.padi,
          },
          daemonInventory: {
            store: inMemoryStore<DaemonInventory>(DEFAULT_DAEMON_INVENTORY),
            equals: (a: DaemonInventory, b: DaemonInventory) =>
              JSON.stringify(a) === JSON.stringify(b),
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: implementSurfaces any-specs its heterogeneous entry deps; the per-cell deps are checked structurally above.
    } as any,
  );
  // biome-ignore lint/suspicious/noExplicitAny: the built ctx is walked structurally (its cell writers).
  const cells = (ctx as any).kolu.cells;

  // processStartedAt: kolu-server's own boot (constant) + THIS host's padi boot time.
  // `onState` fires synchronously (a T+0 anchor) and re-fires on every transition AND
  // the identity-probe republish, so padi's uptime refreshes exactly as the default
  // driver did — now per host.
  const offStartedAt = session.onState(() =>
    cells.processStartedAt.set({
      server: serverStartedAt,
      padi: padiStartedAt(session),
    }),
  );

  // daemonInventory: EVENT-DRIVEN (5a) — no per-host interval or scan. The only per-host
  // work is assembling `{ binding, boundPadi }` from cached reads (THIS entry's identity +
  // the SHARED local-machine scan) and publishing it. Re-publish on a bind-state change
  // (`session.onState` — a (re)bind / adopt-stale / skew) AND on a shared-scan refresh, so
  // the cell stays live without owning a timer. `boundHost = null` for the local entry (no
  // `localScan`); a remote entry carries the shared scan as "this machine, not the bound
  // host".
  const publishInventory = (): void => {
    try {
      enumerateDaemonInventoryOnce({
        getLocalScan: deps.getLocalScan,
        activePadiSurfaceVersion: () => padiSurfaceVersion(session),
        activePadiBuildCommit: () => padiBuildCommit(session),
        activePadiConvergence: () => session.convergence(),
        boundHost: host === LOCAL_HOST ? null : host,
        // biome-ignore lint/suspicious/noExplicitAny: cell writer walked structurally.
        publish: (inv) => (cells.daemonInventory as any).set(inv),
      });
    } catch (err) {
      // The `publish` schema-validate is the only throw here (the scan is cached); keep the
      // cell's last value, log, and let the next event retry — matching the old sampler.
      log.error({ err, host }, "per-host daemon-inventory publish failed");
    }
  };
  publishInventory(); // T+0 anchor so the cell has a value before the first dialog open
  const offInventoryState = session.onState(publishInventory);
  const offSharedScan = deps.subscribeLocalScan(publishInventory);
  const disposeInventory = (): void => {
    offInventoryState();
    offSharedScan();
  };

  // biome-ignore lint/suspicious/noExplicitAny: router walked structurally by wire path.
  const koluNs = (router as any).surface.kolu;
  return {
    processStartedAt: koluNs.processStartedAt,
    daemonInventory: koluNs.daemonInventory,
    dispose: () => {
      offStartedAt();
      disposeInventory();
    },
  };
}
