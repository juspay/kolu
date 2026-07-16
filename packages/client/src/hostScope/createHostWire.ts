/** `createHostWire` — ONE host's retained per-host WIRE SUBSCRIPTIONS, born inside
 *  its `scopedByEntry` owner and RETAINED across switch-away (padi W9, completing
 *  W7's K1).
 *
 *  A sibling owner member to `createViewState` (selection + posture),
 *  `createHostPrefs`, `createCamera`, and `createSessionRestore`. Where THOSE hold
 *  cheap client-owned state, this one holds the host's live SUBSCRIPTIONS — the
 *  five per-host readouts that W7 consciously left keyed on `activeHost`:
 *
 *    - `terminalKeys`  — the `terminals.keys` stream (the tile order source);
 *    - `terminals`     — the composed `terminals` metadata collection (keyed off
 *      this host's own `terminalKeys`);
 *    - `session`       — the persisted saved-session cell;
 *    - `activityFeed`  — the MRU repos/agents cell;
 *    - `daemonStatus`  — the kaval status collection.
 *
 *  ── WHY per host, not per active-host (the W9 fix) ───────────────────────────
 *  W7 left these on `padiMap.useEntry(activeHost)`, whose contract is
 *  DISPOSE-ON-KEY-CHANGE: every host switch tore each readout down and reopened it
 *  from PENDING. Switch-BACK therefore reopened a host whose data the client held
 *  moments ago from `pending` — `daemonStatusPending()` flipped true and the
 *  composed `terminalCount` fell to 0, so `resolveCanvasMode` left `workspace` and
 *  `App.tsx`'s `<Switch>` unmounted the whole canvas arm (the ~1s rebuild). Opened
 *  instead inside this per-host owner — created LAZILY on first activation,
 *  RETAINED across every switch-away, DISPOSED only when the host leaves
 *  `padiMap.entries` — a switch-back has NO resubscribe at all, so no pending
 *  window can exist. The exported wire facades (`hostScope/activeWire.ts`) and the metadata /
 *  daemon readers (`useTerminalMetadata`, `useDaemonStatus`) become WINDOWS over
 *  `activeScope().wire`, reading whichever retained host is active.
 *
 *  ── The bytes stay active-host-only ─────────────────────────────────────────
 *  These are VALUE members (cells + collections + a keys stream) — cheap to hold
 *  open per visited host. xterm/WebGL and the terminal ATTACH byte stream are NOT
 *  here: they stay active-host-only (a sub-second re-attach paint remains, the one
 *  deliberate W9 exclusion), so no GL context is retained per host.
 *
 *  ── A sub error is surfaced, never dropped — toast if shown, else log ───────
 *  A retained BACKGROUND host's subscription now lives while you view another host,
 *  so a toast for it would be noise (an unlabeled error about a canvas you are not
 *  looking at). But `wireSubscriptionError` fires its error edge ONCE, so simply
 *  suppressing the toast would DISCARD a background failure permanently (no re-fire on
 *  switch-back). So the ONE `interpretClientError`'s `scopedSub` arm (SR11) splits by
 *  the GROUNDED-active host (`groundedActiveHost()` enc-compared to this entry's key):
 *  the shown host TOASTS (immediate feedback, exactly as the pre-W9 active-host-only
 *  readouts did); a backgrounded host LOGS to `console.error` (named by host) so the
 *  failure is never invisible — mirroring `watchByEntry`'s own default `onError` and the
 *  `caught-error-must-not-collapse-to-empty` rule. The four retained members declare
 *  their policies on `padiSurface` (session/activityFeed/terminals → `scopedSub`;
 *  daemonStatus → `hostToast`, the 4C ruling), so this owner opens them bare.
 *  Switching to a broken host then also
 *  shows its degraded state structurally (an errored `terminals`/`session` reads empty
 *  → the canvas's connecting/empty surface). */

import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  createReactiveSubscription,
  type Subscription,
} from "@kolu/surface/solid";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { interpretClientError, padiMap } from "../wire";

/** The map entry lens `createHostWire` opens its cells/collections through. Aliased
 *  only to NAME the retained members' result types on {@link HostWire} PORTABLY —
 *  through `padiMap` (a public import) rather than the surface package's internal
 *  result-type module paths, which `tsc` refuses to name across the package
 *  boundary (TS2883). */
type PadiEntry = ReturnType<typeof padiMap.entry>;

/** One host's retained wire subscriptions. Its members are read through
 *  `activeScope().wire` by the exported facades and the metadata/daemon readers. */
export interface HostWire {
  terminalKeys: Subscription<TerminalId[]>;
  terminals: ReturnType<PadiEntry["collections"]["terminals"]["use"]>;
  session: ReturnType<PadiEntry["cells"]["session"]["use"]>;
  activityFeed: ReturnType<PadiEntry["cells"]["activityFeed"]["use"]>;
  daemonStatus: ReturnType<PadiEntry["collections"]["daemonStatus"]["use"]>;
  /** Wall-clock ms this host's `daemonStatus` wait BEGAN — stamped ONCE when this
   *  retained scope is born (first activation / a re-add after membership exit) and
   *  held for the scope's whole life. `useDaemonStatus`'s `daemonStatusPendingTimedOut`
   *  measures the "kaval didn't start" ceiling from HERE. Because `daemonStatus` is now
   *  RETAINED per host (it does NOT re-subscribe on switch-back), the anchor must NOT
   *  reset on a switch either — a repeatedly-revisited wedged host would otherwise keep
   *  earning a fresh 30s grace and never surface the honest failure. Living in the
   *  retained scope gives it exactly the sub's lifetime: one anchor per pending run,
   *  discarded on membership exit, a fresh one only on a genuine re-add. */
  daemonPendingAnchorMs: number;
}

export function createHostWire(host: HostKey): HostWire {
  const entry = padiMap.entry(host);

  // Surface a retained sub's error WITHOUT dropping it: the shown host toasts; a
  // backgrounded host logs (a toast for a host you are not looking at is noise, but
  // `wireSubscriptionError`'s edge fires once — silently suppressing it would discard
  // the failure permanently). The split lives in the ONE `interpretClientError`
  // (SR11): the four RETAINED members declare their `scopedSub`/`hostToast` policies
  // ON THE SPEC (`padiSurface`) and route through the interpreter automatically (with
  // the map-injected `{ key }` origin); the `terminalKeys` STREAM is not a member
  // `.use()`, so it reuses the same interpreter by hand for behaviour parity.
  //
  // KNOWN LIMIT (recorded): the underlying `.use()` subs re-subscribe on transport
  // reconnect (STREAM_RETRY), but a sub that errors TERMINALLY on a BACKGROUND host is not
  // re-opened until this scope is rebuilt — i.e. the host leaves and rejoins `padiMap.entries`
  // (membership exit disposes the owner). There is no per-sub retry on switch-BACK: a
  // switched-to host reads its errored sub's floored-empty value until a reconnect or re-add
  // revives it. Acceptable today (a terminal sub error on a live link is rare and the empty
  // read is honest, not a false-success); revisit if it proves user-visible. */

  // The terminal-list keys stream — an UNENROLLED STREAM_RETRY stream (the #1591
  // health carve-out; a re-attach must never flicker the health gate). Keyed on
  // the FIXED `host` (a constant input, so `createReactiveSubscription` opens it
  // once and never re-keys) — the owner IS the host, so there is no `activeHost`
  // to capture and no re-key on switch: it stays live across switch-away. NOT a
  // member `.use()`, so it routes its error through the interpreter by hand (the
  // `scopedSub` arm, `{ key: host }` origin) to preserve the active-toasts /
  // background-logs behaviour the declared members get for free.
  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => host,
    (_h, signal) =>
      unenrolledStreamCall(
        entry.collections.terminals.unenrolledKeys,
        undefined,
        {
          signal,
        },
      ),
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "Terminal list error" },
          err,
          { key: host },
        ),
    },
  );

  // The composed `terminals` metadata collection, keyed off THIS host's own
  // `terminalKeys` — co-located with the keys stream that drives it, so both the
  // key list and the per-id records ride one retained owner. Its `scopedSub`
  // "Metadata error" policy rides the spec; the use-site keeps only `keys`.
  const keys = createMemo<TerminalId[]>(() => terminalKeys() ?? []);
  const terminals = entry.collections.terminals.use({ keys });

  // The persisted saved-session cell (host-owned, restore-relevant).
  const session = entry.cells.session.use();

  // The MRU activity feed (recent repos / agents — host-fs facts).
  const activityFeed = entry.cells.activityFeed.use();

  // The kaval daemon-status collection (this host's local kaval, keyed by its
  // local location). `useDaemonStatus` reads it through `activeScope().wire`. Its
  // `hostToast` "daemon status" policy (4C ruling) rides the spec; only `keys` stays.
  const daemonStatus = entry.collections.daemonStatus.use({
    keys: () => [encodeHostLocation(LOCAL_LOCATION)],
  });

  // Stamp the daemon-status pending-wait anchor ONCE, at scope birth (this host's
  // first activation, or a re-add after membership exit). Retained with the scope, so
  // a switch-BACK does NOT restart the "kaval didn't start" ceiling clock — the sub
  // it measures isn't re-subscribing either. See {@link HostWire.daemonPendingAnchorMs}.
  const daemonPendingAnchorMs = Date.now();

  return {
    terminalKeys,
    terminals,
    session,
    activityFeed,
    daemonStatus,
    daemonPendingAnchorMs,
  };
}
