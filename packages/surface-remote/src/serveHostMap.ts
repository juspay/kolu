/**
 * `serveHostMap` — serve a `@kolu/surface-map` `SurfaceMap` over a warm host pool.
 *
 * The pool ({@link buildRemotePool}) is the membership + session source; the app
 * supplies each host's re-served entry-surface link (the re-serve POLICY is
 * app-specific, so `linkFor` is injected). This adapter's job is the framework glue
 * a hand-rolled `MapRegistry` would otherwise repeat:
 *
 *  1. FUSE the pool's membership `subscribe` with each member session's own
 *     `onState`, so the map's `entries` collection republishes on BOTH a membership
 *     change AND a per-session STATUS transition (warming → connected → failed) — the
 *     latter is not a membership event, but it IS a change the UI must see.
 *  2. CACHE each session's latest `SessionState` (a `Session` has no synchronous state
 *     getter — only `onState`), so the map's `resolve()` answers `state` synchronously.
 *  3. PROJECT `SessionState` → the map's `EntryConnectionState` (a distinct target from
 *     the browser `ConnectionInfo` that `connectionPipe.projectConnection` builds),
 *     folding in the session's measured `clockOffset` for the `connected` state.
 *
 * Then it hands the composed registry to `serveSurfaceMap`.
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import type { SurfaceMap } from "@kolu/surface-map";
import {
  type EntryConnectionState,
  type EntryFault,
  type EntrySession,
  type MapRegistry,
  type ServeSurfaceMapResult,
  serveSurfaceMap,
} from "@kolu/surface-map/server";
import type { z } from "zod";
import type { RemotePool } from "./hostFanout";
import type { Session, SessionState } from "./session";

/** A session that carries a measured clock offset — required, so a session lacking one
 *  is a compile error rather than a silent forever-`connecting`. `null` means the offset
 *  has not been stamped yet (the admit handshake stamps it). */
type ClockableSession = Session & { clockOffset(): number | null };

/** Project a `SessionState` → the map's `EntryConnectionState`. NEW projection — NOT
 *  `connectionPipe.projectConnection` (which targets the 4-field browser
 *  `ConnectionInfo`). `connected` REQUIRES the measured clock offset: until the admit
 *  handshake has stamped one, the entry honestly reads as still `connecting`
 *  (offset-at-hello is the contract — a `0` placeholder would be a lie). */
export function projectState(
  s: SessionState | undefined,
  clockOffset: number | null,
): EntryConnectionState {
  if (s === undefined) return { kind: "connecting" };
  switch (s.connection) {
    case "copying":
      return { kind: "copying" };
    case "connecting":
      return { kind: "connecting" };
    case "connected":
      return clockOffset === null
        ? { kind: "connecting" }
        : { kind: "connected", clockOffset };
    case "disconnected":
      return { kind: "disconnected", reason: s.lastError ?? "disconnected" };
    case "failed":
      return { kind: "failed", reason: s.lastError ?? "failed" };
  }
}

export interface ServeHostMapOptions<K, S> {
  /** The re-served entry-surface CLIENT for one host — a `directLink` over the host's
   *  `reServeSurface(...).router` (the re-serve POLICY is app-specific, hence
   *  injected). Called once per host; the result is cached here and evicted on
   *  removal, so a re-serve mirror is never built twice for a host. */
  linkFor: (host: K, session: S) => unknown;
  /** The non-provisioning (local/endpoint) key, if this pool has one. A local
   *  session is a `makeSession<_, never>` arm typed WITHOUT the provisioning phase
   *  `"copying"` (juspay/kolu#1716), so it can NEVER legitimately project a
   *  `copying`/`warming` status. This is the runtime BELT for the map's W4-new
   *  reachability: if the local key ever projects `"copying"`, `resolve` throws LOUD
   *  rather than paint a lying "warming" chip. Omit when every host provisions. */
  localKey?: K;
}

/** The pool surface `serveHostMap` consumes — a slice of {@link RemotePool} (it never
 *  adds/removes; the app's root RPCs do). */
export type MembershipPool<S extends Session> = Pick<
  RemotePool<S, unknown>,
  "hosts" | "has" | "getSession" | "subscribe"
>;

/** Serve a `SurfaceMap` over a warm host pool. Returns the same shape
 *  `serveSurfaceMap` does; `dispose()` tears down the map, the membership
 *  subscription, and every per-member `onState`. */
export function serveHostMap<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  S extends ClockableSession,
>(
  map: SurfaceMap<KS, ES>,
  pool: MembershipPool<S>,
  opts: ServeHostMapOptions<z.infer<KS>, S>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;

  const latestState = new Map<K, SessionState>();
  const stateSubs = new Map<K, () => void>();
  const links = new Map<K, unknown>();
  const changeListeners = new Set<() => void>();

  const fire = (): void => {
    for (const l of [...changeListeners]) l();
  };
  const members = (): K[] => pool.hosts() as K[];
  const has = (k: K): boolean => pool.has(k as unknown as string);
  const sessionOf = (k: K): S | undefined =>
    pool.getSession(k as unknown as string);

  // Attach a per-member `onState` — cache the latest state, and fire the fused change
  // signal on every transition so `entries` republishes the new `EntryStatus` WITHOUT
  // a membership change. `onState` is snapshot-then-delta, so this also seeds the cache
  // synchronously.
  const attach = (k: K): void => {
    if (stateSubs.has(k)) return;
    const session = sessionOf(k);
    if (session === undefined) return;
    const off = session.onState((s) => {
      latestState.set(k, s);
      fire();
    });
    stateSubs.set(k, off);
  };
  const detach = (k: K): void => {
    stateSubs.get(k)?.();
    stateSubs.delete(k);
    latestState.delete(k);
    links.delete(k);
  };
  // Reconcile per-member `onState` subs (and dropped links) against membership.
  const reconcile = (): void => {
    const current = new Set(members());
    for (const k of current) attach(k);
    for (const k of [...stateSubs.keys()]) if (!current.has(k)) detach(k);
  };
  reconcile();

  // Membership change → reconcile the per-member subs, then fire. `pool.subscribe`
  // fires only after `hosts()`/`has()` reflect the change (ordering), so the fused
  // signal is never ahead of the snapshot the republish reads.
  const offMembership = pool.subscribe(() => {
    reconcile();
    fire();
  });

  const linkFor = (k: K, session: S): unknown => {
    let link = links.get(k);
    if (link === undefined) {
      link = opts.linkFor(k, session);
      links.set(k, link);
    }
    return link;
  };

  const registry: MapRegistry<K> = {
    members,
    has,
    subscribe(onChange) {
      changeListeners.add(onChange);
      return () => {
        changeListeners.delete(onChange);
      };
    },
    resolve(k): EntrySession | EntryFault {
      const session = sessionOf(k);
      if (session === undefined)
        return { failed: `unknown host: ${String(k)}` };
      const offset = session.clockOffset();
      const state = projectState(latestState.get(k), offset);
      // BELT (juspay/kolu#1716): the local/endpoint arm is a non-provisioning session
      // typed WITHOUT "copying", so it can never legitimately reach the provisioning
      // phase. If the local key ever projects "copying", a non-provisioning session
      // illegitimately entered it — fail LOUD rather than paint a lying "warming" chip.
      if (
        opts.localKey !== undefined &&
        k === opts.localKey &&
        state.kind === "copying"
      ) {
        throw new Error(
          `local host "${String(k)}" projected a provisioning "copying" state it can ` +
            "never inhabit — a non-provisioning endpoint session must never enter " +
            "copying (see juspay/kolu#1716)",
        );
      }
      return {
        link: linkFor(k, session),
        state,
      };
    },
  };

  const served = serveSurfaceMap(map, registry);

  return {
    router: served.router,
    dispose() {
      served.dispose();
      offMembership();
      for (const off of stateSubs.values()) off();
      stateSubs.clear();
      latestState.clear();
      links.clear();
      changeListeners.clear();
    },
  };
}
