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

import type { DaemonStatus } from "@kolu/padi-client/surface";
// The declared-error narrowing verbs come from the surface receptacle
// (`@kolu/surface/solid`, which now OWNS them — they were re-exports from
// `@orpc/client`): the transport vendor stays encapsulated behind the surface
// boundary, and there is no longer a vendor to reach for.
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
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
export function restartDaemon(): UiAction {
  return Effect.suspend(() => {
    if (restarting()) return Effect.void;
    setRestarting(true);
    const id = toast.loading("Restarting kaval…");
    // The DECLARED error union rides the effect's error channel (SK6/D4), so
    // `catchTag` IS the discriminant — and the compiler matches the tag against
    // the procedure's own union, so a rename in `@kolu/padi-client/surface` is a compile
    // error here rather than a toast printing `undefined`. What `catchTag` does NOT catch
    // is the framework's `SurfaceCallFailure` half, which is exactly right: a
    // transport drop is not the skew, and the residual arm below says so.
    return activePadiRpc.lifecycle.recycleKaval().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          toast.success(
            "kaval restarted — your session is offered for restore",
            {
              id,
            },
          );
        }),
      ),
      Effect.catchTag("KavalContractSkew", (skew) =>
        // Surface the server's own message (the versions ride it, typed —
        // toast-conventions.md: never swallow `err.message`) AND the guidance the
        // typed skew lets us add: a restart can't fix a contract skew, so point at
        // the recovery the `incompatible` daemon state surfaces beside this toast
        // (the skew card / dialog's "Update & restart kaval").
        Effect.sync(() => {
          toast.error(
            `Couldn’t restart kaval: ${skew.message} — restarting can’t fix that. Use “Update & restart kaval”.`,
            { id },
          );
        }),
      ),
      // Everything the procedure never promised — a transport drop, a keyed-map
      // rejection — normalised before its message is read.
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Couldn’t restart kaval: ${toError(err).message}`, {
            id,
          });
        }),
      ),
      Effect.ensuring(Effect.sync(() => setRestarting(false))),
    );
  });
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

/** Update & restart a host's daemon stack — the CONTRACT-SKEW recovery (SK5,
 *  D1: the ONE action for `incompatible`, on BOTH local and remote hosts).
 *  Calls `hosts.renewDaemon`: the binder drains that host's padi (session
 *  persisted), the reconnect loop re-dials — re-realising the CURRENT closure
 *  on the host — and the fresh padi's converge policy recycles the old kaval
 *  from its new build. Re-entrant calls while one is in flight are ignored. */
export function renewDaemon(host: HostKey): UiAction {
  return Effect.suspend(() => {
    const key = encodeHostKey(host);
    if (renewingHosts().has(key)) return Effect.void;
    setRenewingHosts((s) => new Set(s).add(key));
    const id = toast.loading("Updating & restarting kaval…");
    return client.hosts.renewDaemon({ host }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // HONEST at answer time: the RPC answers when the DRAIN takes (the old
          // padi persisted + exited) — the re-provision + fresh kaval land
          // asynchronously via the binder's reconnect loop, and the daemon-status
          // chrome (the same surface that raised the skew card) narrates that
          // convergence live. Claiming "restarted at the current build" here would
          // assert an outcome this call never waits for.
          toast.success(
            "Host daemon drained — re-provisioning the current build; kaval reconnects shortly",
            { id },
          );
        }),
      ),
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Couldn’t update kaval: ${toError(err).message}`, { id });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          setRenewingHosts((s) => {
            const next = new Set(s);
            next.delete(key);
            return next;
          });
        }),
      ),
    );
  });
}
