/**
 * The one-click "Restart kaval" action (B3.2 — supervised restart).
 *
 * A module-level singleton so the two affordances that trigger it — the kaval
 * rail dialog (a running or degraded daemon) and the DegradedCanvas (a dead one)
 * — share one in-flight guard and one toast. The handler is deliberately thin:
 * it fires the `padiSurface` `lifecycle.recycleKaval` procedure and reports the
 * outcome. padi does the session-preserving work host-side (snapshot → drain →
 * recycle kaval, padi itself staying up); the restore itself is the existing
 * card, which reappears once the fresh kaval is connected and the canvas is
 * honestly empty with the preserved session. The daemon's live
 * `restarting`→`connected` state rides the `daemonStatus` surface, so the rail
 * and canvas reflect progress without this hook tracking it.
 */

import type { DaemonStatus } from "@kolu/padi/surface";
// The declared-error narrowing verbs come from the surface receptacle (its
// `@kolu/surface/solid` re-export), never from `@orpc/client` directly — the
// transport vendor stays encapsulated behind the surface boundary.
import { isDefinedError, safe } from "@kolu/surface/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createEffect, createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { activeHost, activePadiRpc, client } from "../wire";
import {
  daemonChannelLive,
  daemonConnected,
  liveWarming,
} from "./useDaemonStatus";

// True from the click until the restart RPC settles — closes the visible click
// window immediately (before the surface state flips) so a double-click can't
// fire a second recycle (the server coalesces too). Module-private: the shared
// `restartInFlight` predicate below is the one every affordance reads.
// HOST-SCOPING: host-INDEPENDENT by design — a sub-second local click echo; the
// durable "is this host's daemon restarting" fact rides `liveWarming` off the
// host-scoped `daemonStatus`, which re-keys correctly on `activeHost`.
const [restarting, setRestarting] = createSignal(false);

/** The one "a restart is underway, disable the button" predicate, read by every
 *  affordance that triggers `restartDaemon`. In flight while the local click is
 *  being serviced (the module `restarting` signal) OR while the daemon surface is
 *  mid-transition ({@link liveWarming} — `restarting`/`connecting`, FLOORED on
 *  transport liveness) — the latter arm catches a restart another client kicked
 *  off, which the local signal can't see. Both the kaval dialog and the
 *  DegradedCanvas disable on this, so the two buttons can't disagree on what
 *  counts as in flight.
 *
 *  The `liveWarming(status?.state, daemonChannelLive())` arm is exactly
 *  `daemonWarming()`'s body (both project from the shared `liveWarming`, so both
 *  inherit the SAME transport-liveness floor: over a dead/half-open link the
 *  warming claim reads false, and the button can't stick disabled beside the grey
 *  "unknown" dot the dot/canvas already paint). The extra leading `restarting()`
 *  arm is the local-click signal the daemon surface can't yet see — transport-
 *  independent (it closes the click window before the state flips). So
 *  `restartInFlight` is again exactly `daemonWarming()` plus the local click — the
 *  stronger gate — and the three consumers that read the weaker `daemonWarming()`
 *  (App.tsx, useTerminalCrud, commands) are the ones without their own click
 *  signal to fold in. */
export function restartInFlight(status: DaemonStatus | undefined): boolean {
  return restarting() || liveWarming(status?.state, daemonChannelLive());
}

/** Restart the local kaval daemon, preserving the session. Safe to call from
 *  multiple affordances; re-entrant calls while one is in flight are ignored. */
export async function restartDaemon(): Promise<void> {
  if (restarting()) return;
  setRestarting(true);
  const id = toast.loading("Restarting kaval…");
  // The bound face carries the DECLARED error union as its rejection phantom
  // (SK6), and `safe()` — not try/catch, whose binding erases it to `unknown`
  // — is what surfaces it: `isDefinedError` then narrows to the declared
  // `{ code, data }`, so both versions arrive TYPED (a schema rename here is a
  // compile error, never a toast printing `undefined`).
  const { error } = await safe(activePadiRpc.lifecycle.recycleKaval());
  if (!error) {
    toast.success("kaval restarted — your session is offered for restore", {
      id,
    });
  } else if (isDefinedError(error) && error.code === "KAVAL_CONTRACT_SKEW") {
    // Surface the server's own message (the versions ride it, typed —
    // toast-conventions.md: never swallow `err.message`) AND the guidance the
    // typed skew lets us add: a restart can't fix a contract skew, so point at
    // the recovery the `incompatible` daemon state surfaces beside this toast
    // (the skew card / dialog's "Update & restart kaval").
    toast.error(
      `Couldn’t restart kaval: ${error.message} — restarting can’t fix that. Use “Update & restart kaval”.`,
      { id },
    );
  } else {
    toast.error(`Couldn’t restart kaval: ${error.message}`, { id });
  }
  setRestarting(false);
}

// The hosts with a renew in flight, from click until the drain RPC settles —
// the renew twin of `restarting` above (same double-fire guard; a second
// drain queued behind the first is never useful). KEYED BY HOST: renew is a
// per-host, multi-second operation, so one host's in-flight renew must not
// disable (or swallow) another host's button.
const [renewingHosts, setRenewingHosts] = createSignal<ReadonlySet<string>>(
  new Set(),
);

/** The "an update-&-restart is underway on THIS host" predicate — gates the
 *  `UpdateKavalButton` the way `restartInFlight` gates the Restart button. */
export function renewInFlight(host: HostKey): boolean {
  return renewingHosts().has(encodeHostKey(host));
}

// Hosts where a renew has SETTLED (its drain RPC returned) this session but the
// daemon has NOT since reached `connected`. Set when `renewDaemon` resolves;
// CLEARED the moment that host connects (the convergence the renew was waiting
// for). It is the one bit the skew card reads to stop repainting the hopeful
// first-time copy over a renew the user already watched loop (see
// `renewVerdict.ts`). Keyed by host, like `renewingHosts`.
const [renewSettledHosts, setRenewSettledHosts] = createSignal<
  ReadonlySet<string>
>(new Set());

/** True once a renew for THIS host has SETTLED and the host has not since
 *  reconnected — i.e. the last update did not converge. Read by the skew card
 *  (via {@link skewRenewVerdict}) to switch from the first-time "updating starts
 *  a correct-version kaval" copy to the honest "renew did not converge" copy. */
export function renewSettledUnconverged(host: HostKey): boolean {
  return renewSettledHosts().has(encodeHostKey(host));
}

// Clear the ACTIVE host's settled-marker when its KAVAL has CONVERGED — a healthy,
// connected kaval ({@link daemonConnected}, which reads FALSE on `incompatible` and is
// floored on channel liveness), NOT merely a live ssh/padi LINK. This is the load-bearing
// distinction: a skewed kaval sits behind a connected link, so clearing on link-up would
// drop the marker while the host is STILL `incompatible`, and the honest "renew did not
// converge" copy — the whole point of move 4 — would never show. Keyed on `activeHost`
// and driven by `daemonConnected` (both reactive on the active host): the effect also
// re-fires on SWITCH-TO, so a host that converged while BACKGROUNDED clears its marker the
// instant you switch to it (its status becomes readable and healthy). Rooted so the effect
// owns itself at module scope (the same `createRoot` shape `localDaemonStatus` uses).
createRoot(() => {
  createEffect(() => {
    if (!daemonConnected()) return;
    const key = encodeHostKey(activeHost());
    setRenewSettledHosts((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  });
});

/** Update & restart a host's daemon stack — the CONTRACT-SKEW recovery (SK5,
 *  D1: the ONE action for `incompatible`, on BOTH local and remote hosts).
 *  Calls `hosts.renewDaemon`: the binder drains that host's padi (session
 *  persisted), the reconnect loop re-dials — re-realising the CURRENT closure
 *  on the host — and the fresh padi's converge policy recycles the old kaval
 *  from its new build. Re-entrant calls while one is in flight are ignored. */
export async function renewDaemon(host: HostKey): Promise<void> {
  const key = encodeHostKey(host);
  if (renewingHosts().has(key)) return;
  setRenewingHosts((s) => new Set(s).add(key));
  const id = toast.loading("Updating & restarting kaval…");
  try {
    await client.hosts.renewDaemon({ host });
    // HONEST at resolve time: the RPC resolves when the DRAIN takes (the old
    // padi persisted + exited) — the re-provision + fresh kaval land
    // asynchronously via the binder's reconnect loop, and the daemon-status
    // chrome (the same surface that raised the skew card) narrates that
    // convergence live. Claiming "restarted at the current build" here would
    // assert an outcome this call never waits for.
    //
    // Record that a renew SETTLED for this host — cleared the instant it
    // reconnects (the clear-on-`daemonConnected` effect above). Until then, a
    // skew card that RE-APPEARS for this host means the renew did not converge,
    // and the card reads that via `renewSettledUnconverged` to drop the hopeful
    // first-time copy for the honest one — instead of looping the promise below.
    setRenewSettledHosts((s) => new Set(s).add(key));
    toast.success(
      "Host daemon drained — re-provisioning the current build; kaval reconnects shortly",
      { id },
    );
  } catch (err) {
    toast.error(`Couldn’t update kaval: ${(err as Error).message}`, { id });
  } finally {
    setRenewingHosts((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }
}
