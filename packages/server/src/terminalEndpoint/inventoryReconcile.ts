/**
 * Live inventory reconciliation (B3.5) — how a PTY created OUT-OF-BAND becomes a
 * tile in kolu while the server is already running.
 *
 * Boot adoption (`adoptSurvivingSession`) reconciles the daemon's live PTYs
 * against the saved session ONCE, at startup. It cannot see a PTY that appears
 * AFTER boot — a `kaval-tui create` against the very daemon kolu is a client of.
 * The daemon owns ONE inventory shared by every client; this subscribes to its
 * membership feed (`ptyHostSurface`'s `inventory` stream, contract 3.1) and
 * adopts anything kolu does not already track. So the daemon's `entries` map
 * stays the single source of truth for the live set, and kolu's terminal
 * registry is a continuous projection of it rather than a second, boot-synced
 * authority that drifts.
 *
 *   - **snapshot / created** — a PTY kolu does not track is adopted as an orphan
 *     (`adoptLocalOrphan`: metadata seeded from the live daemon snapshot, the
 *     provider DAG re-run against the surviving taps). A `created` for an id kolu
 *     ALREADY has is its own spawn echoing back — `spawnPty` registers
 *     synchronously before the daemon's `created` arrives — so the registry
 *     guard makes it a no-op: no double-register, no double-wire.
 *   - **exited** — a no-op. Every terminal kolu tracks has a per-id `exit` tap
 *     (`startAwarenessSensors`) that is the SINGLE authority for its teardown;
 *     acting here would be a second exit path. The delta exists for clients that
 *     do NOT wire per-id taps (kaval-tui, a future MCP face).
 *
 * The subscription re-subscribes across daemon recycles (a B3.2 restart, a
 * supervisor reconnect): the fresh subscription's snapshot re-converges
 * idempotently through the same registry guard, so live discovery survives a
 * recycle rather than silently stopping. It ends only when its signal aborts.
 */

import type { PtyHostInventoryEvent, PtyHostListEntry } from "kaval";
import type { TerminalId } from "kolu-common/surface";
import { log } from "../log.ts";
import { ptyHostClient } from "../ptyHost/index.ts";
import { getTerminal } from "../terminal-registry.ts";
import { adoptLocalOrphan, bridgeStream } from "./local.ts";

/** Delay before re-subscribing after the inventory stream ends (daemon recycle
 *  / reconnect). Long enough not to hot-loop while the daemon is down — its
 *  `dead` state is already surfaced via endpoint status — short enough that
 *  discovery resumes promptly once it returns. */
const RESUBSCRIBE_DELAY_MS = 2_000;

/** Start the live inventory reconciler for the process lifetime. Re-subscribes
 *  across daemon recycles until `signal` aborts. Fire-and-forget — the loop owns
 *  its own failures (a dropped stream re-subscribes; a per-event failure is
 *  fenced), so nothing here rejects to the caller. */
export function startInventoryReconciler(signal: AbortSignal): void {
  void runReconciler(signal);
}

async function runReconciler(signal: AbortSignal): Promise<void> {
  // The ONLY new mechanism here is the re-subscribe loop across daemon recycles
  // (a B3.2 restart, a supervisor reconnect): per-PTY taps die with their PTY
  // and never re-subscribe, so this loop is genuinely new. The inner consume —
  // await the stream, fence each event, treat an abort as expected teardown —
  // is the SAME contract the per-terminal taps carry, so it plugs into
  // `bridgeStream` (the one receptacle for that volatility) rather than being
  // re-derived here. `bridgeStream` resolves (never rejects) when the stream
  // ends or aborts; a non-abort end is a daemon drop, so we delay and re-subscribe.
  while (!signal.aborted) {
    await bridgeStream(
      ptyHostClient.surface.inventory.get({}, { signal }),
      signal,
      applyEvent,
    );
    if (signal.aborted) return;
    await delay(RESUBSCRIBE_DELAY_MS, signal);
  }
}

/** Decide which PTYs in an inventory frame kolu must adopt: the entries it does
 *  not already track. Pure — the caller supplies `isTracked` (the registry
 *  lookup) and does the adopting — so the routing is unit-testable without the
 *  registry or the daemon. `snapshot`/`created` adopt the UNKNOWN entries; a
 *  tracked id is kolu's own spawn echoing back (or one already adopted), so it
 *  is skipped — no double-register, no double-wire. `exited` is never an
 *  adoption (empty): every terminal kolu tracks has a per-id `exit` tap that is
 *  the single authority for its teardown (module doc). */
export function inventoryAdoptions(
  ev: PtyHostInventoryEvent,
  isTracked: (id: string) => boolean,
): PtyHostListEntry[] {
  const entries =
    ev.kind === "snapshot"
      ? ev.entries
      : ev.kind === "created"
        ? [ev.entry]
        : [];
  return entries.filter((entry) => !isTracked(entry.id));
}

/** Apply one inventory frame: adopt every untracked PTY it contributes. The
 *  per-event fence (a single failed adoption must not end the subscription and
 *  silence discovery for every later PTY) lives in `bridgeStream`, the same
 *  receptacle the per-terminal taps plug into — not re-derived here. */
function applyEvent(ev: PtyHostInventoryEvent): void {
  for (const entry of inventoryAdoptions(ev, isTrackedById)) {
    log.info(
      { terminal: entry.id, pid: entry.pid },
      "adopting out-of-band PTY from kaval inventory",
    );
    adoptLocalOrphan(entry);
  }
}

const isTrackedById = (id: string): boolean =>
  getTerminal(id as TerminalId) !== undefined;

/** Resolve after `ms`, or early if `signal` aborts — so a shutdown during the
 *  re-subscribe gap ends the loop promptly instead of after the full delay. */
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
