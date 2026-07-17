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
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { activePadiRpc, client } from "../wire";
import { daemonChannelLive, liveWarming } from "./useDaemonStatus";

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
    // toast-conventions.md: never swallow `err.message`). A plain restart that
    // STILL skews means the host's own build is stale (a fresh kaval from that
    // closure is skewed too) — the daemon flips to `incompatible`, whose card
    // offers the recovery (restart, and a host re-provision if that still skews).
    toast.error(
      `Couldn’t restart kaval: ${error.message} — the host’s build itself is stale. See the incompatible card to recover.`,
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

/** The `incompatible` (contract-skew) recovery (SK5, D1: the ONE action for
 *  `incompatible`, on BOTH local and remote hosts). It is the SAME session-
 *  preserving kaval RECYCLE as `restartDaemon` — stop the old skewed kaval, spawn
 *  a fresh one from padi's CURRENT closure (which now takes the rendezvous socket
 *  from any orphaned old kaval squatting it — the supervisor's gate is the
 *  single-instance authority, so a fresh kaval reclaims the path), and park the
 *  session for restore. NOT a whole-padi drain: padi already realises the current
 *  closure (an `incompatible` card means padi is HEALTHY and serving — only its
 *  kaval is skewed), so recycling the kaval is all that is needed and it comes up
 *  the correct version.
 *
 *  Re-entrant calls while one is in flight are ignored. Keyed on `host` for the
 *  in-flight marker even though the recycle runs on `activePadiRpc`: the skew card
 *  is active-host-only by the mount convention, so `host === activeHost()` here.
 *
 *  A recycle that STILL skews (the rare case where padi's OWN closure genuinely
 *  bakes an old kaval, not merely an orphaned survivor) throws `KAVAL_CONTRACT_SKEW`
 *  — recycling can't fix that, only re-provisioning the host's closure can — so we
 *  offer that heavier {@link drainReprovisionDaemon} as the honest escalation. */
export async function restartIncompatibleKaval(host: HostKey): Promise<void> {
  const key = encodeHostKey(host);
  if (renewingHosts().has(key)) return;
  setRenewingHosts((s) => new Set(s).add(key));
  const id = toast.loading("Restarting kaval…");
  // `safe()` (not try/catch) preserves the DECLARED error union so
  // `KAVAL_CONTRACT_SKEW` arrives TYPED (SK6) — see `restartDaemon`.
  const { error } = await safe(activePadiRpc.lifecycle.recycleKaval());
  if (!error) {
    toast.success(
      "kaval restarted from the host’s current build — your session is offered for restore",
      { id },
    );
  } else if (isDefinedError(error) && error.code === "KAVAL_CONTRACT_SKEW") {
    // The recycle proved padi's OWN closure is stale (a fresh spawn STILL skews),
    // not just an orphaned old kaval — so re-provisioning the host is the recovery
    // that works. Offer it as an action rather than dead-ending (toast-conventions:
    // persistent action toast), and never swallow the server's typed message.
    toast.error(
      `Couldn’t converge kaval: ${error.message} — the host’s build itself is stale, so a restart brings back the same version. Re-provision the host to fix it.`,
      {
        id,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Re-provision host",
          onClick: () => void drainReprovisionDaemon(host),
        },
      },
    );
  } else {
    toast.error(`Couldn’t restart kaval: ${(error as Error).message}`, { id });
  }
  setRenewingHosts((s) => {
    const next = new Set(s);
    next.delete(key);
    return next;
  });
}

/** The heavier ESCALATION for a genuinely-stale host closure (offered from
 *  `restartIncompatibleKaval`'s skew branch): drain THIS host's padi via the
 *  binder-owned `hosts.renewDaemon` — padi persists + exits, the reconnect loop
 *  re-dials and re-realises the CURRENT closure on the host, and the fresh padi's
 *  converge policy recycles the old kaval from its new build. One seam for local
 *  and remote alike (D1). Module-private: reached only through the skew toast's
 *  action above. Re-entrant calls while one is in flight are ignored. */
async function drainReprovisionDaemon(host: HostKey): Promise<void> {
  const key = encodeHostKey(host);
  if (renewingHosts().has(key)) return;
  setRenewingHosts((s) => new Set(s).add(key));
  const id = toast.loading("Re-provisioning host…");
  try {
    await client.hosts.renewDaemon({ host });
    // HONEST at resolve time: the RPC resolves when the DRAIN takes (the old padi
    // persisted + exited) — the re-provision + fresh kaval land asynchronously via
    // the binder's reconnect loop, which the daemon-status chrome narrates live.
    toast.success(
      "Host daemon drained — re-provisioning the current build; kaval reconnects shortly",
      { id },
    );
  } catch (err) {
    toast.error(`Couldn’t re-provision host: ${(err as Error).message}`, {
      id,
    });
  } finally {
    setRenewingHosts((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }
}
