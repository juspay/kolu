/** `perHostPolledQuery` — a {@link createPolledQuery} scoped PER HOST, for instant
 *  Code-tab switch-back (padi W9's Code-tab half, completing W7's K1).
 *
 *  ── The problem, and why OWNERSHIP not keep-last ────────────────────────────
 *  A single `createPolledQuery` whose input carries the host BLANKS the Code tab on
 *  every genuine host change (its value-key is `(input, host)`, and a switch changes
 *  the host leg). The note's cure is "scope the query per host" — OWNERSHIP: each
 *  host's query state lives in that host's owned scope, so switch-BACK finds it
 *  already there. A per-`(input,host)` value cache would only BOUND the blank (evicted
 *  keys blank again) — the same "expressible per readout" shape W7 was built to kill,
 *  merely capped. This builds the ownership shape instead.
 *
 *  ── The shape ───────────────────────────────────────────────────────────────
 *  ONE `createPolledQuery` per host, born inside the `scopedByEntry` owner (the same
 *  retained-per-key receptacle the wire subs ride), with `active = ctx.isActive`:
 *   - built LAZILY on a host's first activation, RETAINED across switch-away, and
 *     DISPOSED when the host leaves `padiMap.entries` — its pulse torn down with it;
 *   - `active` is TRUE only while its host is the shown one, so the instance POLLS
 *     while shown and PAUSES (pulse torn down — no background polling — value held)
 *     while backgrounded, RESUMING from its held value on switch-BACK with no blank.
 *  Because an instance is active EXACTLY when its host is the active host, its shared
 *  `input` / `query` / `pulseProc` closures (which read the active projection and call
 *  `activePadiRpc`) are only ever consulted for THIS instance's own host — the caller's
 *  call sites stay unchanged, and no background metadata projection is needed. The
 *  defect class is UNREPRESENTABLE (no cache, no LRU, no key enumeration), symmetric
 *  with the retained wire subs, not merely bounded.
 *
 *  The returned handle is a STABLE facade over the ACTIVE host's instance
 *  (`scopes.active()`) — it re-keys on switch and floors the removal-race `undefined`
 *  (the active host left the pool; `wire.ts`'s reconcile re-points `activeHost` a tick
 *  later) to a pre-first-value sub, so a consumer holding it is unaffected by a switch. */

import { scopedByEntry } from "@kolu/surface-map/client";
import type { Subscription } from "@kolu/surface/solid";
import { windowedSub } from "../hostScope/windowedSub.ts";
import { activeHost, padiMap } from "../wire";
import { createPolledQuery, type PolledQueryConfig } from "./createPolledQuery";

export function perHostPolledQuery<Input, PulseInput, Pulse, Result>(
  config: Omit<
    PolledQueryConfig<Input, PulseInput, Pulse, Result>,
    "active" | "live" | "pulseHost"
  >,
): Subscription<Result> {
  // `active`, `live`, and `pulseHost` are NOT caller knobs — they all derive from the
  // SAME ownership authorities this adapter hardwires (`padiMap` / `activeHost`), so
  // injecting them here (rather than accepting them) rules out an incoherent config
  // whose ownership, liveness, and pulse host come from three different sources. `live`
  // is the active host's transport liveness (an instance polls only while ITS host is
  // active, so `padiMap.live()` is exactly its own host's) and `pulseHost` is `activeHost`
  // (the pulse follows the active host, i.e. this instance's host while it runs).
  const scopes = scopedByEntry(padiMap, activeHost, (_host, ctx) =>
    createPolledQuery({
      ...config,
      live: () => padiMap.live(),
      pulseHost: activeHost,
      active: ctx.isActive,
    }),
  );
  // A stable facade over the active host's retained query instance, via the shared
  // `windowedSub` floor helper. `undefined` during the removal race floors to a
  // pre-first-value sub (pending, no value).
  return windowedSub(
    () => scopes.active(),
    (v) => v,
    undefined,
  );
}
