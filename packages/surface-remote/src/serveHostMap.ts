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
import type { SurfaceClientLike } from "@kolu/surface/project";
import type { z } from "zod";
import type { RemotePool } from "./hostFanout";
import type { DownSessionState, Session, SessionState } from "./session";

/** A session that carries a measured clock offset — required, so a session lacking one
 *  is a compile error rather than a silent forever-`connecting`. `null` means the offset
 *  has not been stamped yet (the admit handshake stamps it).
 *
 *  `Prov = string` (the TOP of the phase vocabulary), not the `never` default: this
 *  adapter is provisioning-vocabulary-agnostic, and `Session<_, Prov>` is COVARIANT
 *  in `Prov`, so `string` is the one receptacle every session — a `never` endpoint,
 *  an ssh `"copying" | "building"` arm, any future connector — is assignable to. */
type ClockableSession = Session<SurfaceClientLike, string> & {
  clockOffset(): number | null;
};

/** Project a `SessionState` → the map's `EntryConnectionState`. NEW projection — NOT
 *  `connectionPipe.projectConnection` (which targets the 4-field browser
 *  `ConnectionInfo`). `connected` REQUIRES the measured clock offset: until the admit
 *  handshake has stamped one, the entry honestly reads as still `connecting`
 *  (offset-at-hello is the contract — a `0` placeholder would be a lie). */
export function projectState<Prov extends string>(
  s: SessionState<Prov> | undefined,
  clockOffset: number | null,
): EntryConnectionState {
  if (s === undefined) return { kind: "connecting" };
  if (s.phase === "disconnected" || s.phase === "failed") {
    // A generic `Prov` defeats discriminated narrowing on the down arm; assert the
    // `Prov`-independent {@link DownSessionState}. `error` is REQUIRED on the down
    // arm (a down link always has a real reason), so there is no invented
    // `?? "disconnected"` fallback left to write.
    const down = s as DownSessionState;
    return down.phase === "failed"
      ? { kind: "failed", reason: down.error }
      : { kind: "disconnected", reason: down.error };
  }
  if (s.phase === "connected")
    return clockOffset === null
      ? { kind: "connecting" }
      : { kind: "connected", clockOffset };
  if (s.phase === "connecting") return { kind: "connecting" };
  // A connector-declared provisioning phase (ssh's `copying`/`building`) — the
  // map's coarse "warming" bucket (its `EntryStatus` collapses both to `warming`;
  // the fine phase rides the per-host `connection` cell, not this projection).
  return { kind: "copying" };
}

export interface ServeHostMapOptions<K, S, Cause extends string = string> {
  /** The re-served entry-surface CLIENT for one host — a `directLink` over the host's
   *  `reServeSurface(...).router` (the re-serve POLICY is app-specific, hence
   *  injected). Called once per host; the result is cached here and evicted on
   *  removal, so a re-serve mirror is never built twice for a host. */
  linkFor: (host: K, session: S) => unknown;
  /** Classify (and optionally ENRICH) a DOWN session's domain `cause` for the
   *  map's published `EntryStatus` — this adapter is transport-only (it projects a
   *  bare `SessionState`, which carries only the transport-axis `failureCause`,
   *  "network" vs "remote"); a domain classification (padi's
   *  contract-skew-refused / unconverged / drv-unbaked / link-failed / … —  a
   *  DIFFERENT axis, one layer up) is the app's own knowledge, so it is injected
   *  here rather than guessed. Return extra fields alongside `cause` (padi's D2
   *  typed `running`/`expected` version pair on `contract-skew-refused`) and they
   *  ride the wire untouched — `@kolu/surface-map`'s `EntryStatus` schema is a
   *  loose object precisely so a domain producer can attach them. Omitted →
   *  `EntryStatus.cause` falls back to `"other"` (`@kolu/surface-map`'s own
   *  fallback, `projectStatus`) — sound for a map that has no domain cause
   *  breakdown to report. */
  causeFor?: (
    host: K,
    session: S,
    state: SessionState<string>,
  ) => { cause: Cause } & Record<string, unknown>;
}

/** The pool surface `serveHostMap` consumes — a slice of {@link RemotePool} (it never
 *  adds/removes; the app's root RPCs do). */
export type MembershipPool<S extends Session<SurfaceClientLike, string>> = Pick<
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
  Cause extends string = string,
>(
  map: SurfaceMap<KS, ES, Cause>,
  pool: MembershipPool<S>,
  opts: ServeHostMapOptions<z.infer<KS>, S, Cause>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;
  // `pool` is ALWAYS string-keyed (the warm ssh pool's native key), while the map's
  // own `K` may be a non-primitive (kolu's `HostKey`). Every internal cache here
  // (state, subs, links) is therefore keyed by the pool's own STRING — `map.codec`
  // bridges to/from `K` only at the `MapRegistry<K>` boundary below, mirroring the
  // same string-space-internally/object-at-the-boundary shape `@kolu/surface-map`'s
  // own client/server halves use.
  const { encode, decode } = map.codec;

  const latestState = new Map<string, SessionState<string>>();
  const stateSubs = new Map<string, () => void>();
  const links = new Map<string, unknown>();
  const changeListeners = new Set<() => void>();

  const fire = (): void => {
    for (const l of [...changeListeners]) l();
  };
  const members = (): K[] => pool.hosts().map((h) => decode(h));
  const has = (k: K): boolean => pool.has(encode(k));
  const sessionOf = (k: K): S | undefined => pool.getSession(encode(k));

  // Attach a per-member `onState` — cache the latest state, and fire the fused change
  // signal on every transition so `entries` republishes the new `EntryStatus` WITHOUT
  // a membership change. `onState` is snapshot-then-delta, so this also seeds the cache
  // synchronously.
  const attach = (enc: string): void => {
    if (stateSubs.has(enc)) return;
    const session = pool.getSession(enc);
    if (session === undefined) return;
    const off = session.onState((s) => {
      latestState.set(enc, s);
      fire();
    });
    stateSubs.set(enc, off);
  };
  const detach = (enc: string): void => {
    stateSubs.get(enc)?.();
    stateSubs.delete(enc);
    latestState.delete(enc);
    links.delete(enc);
  };
  // Reconcile per-member `onState` subs (and dropped links) against membership.
  const reconcile = (): void => {
    const current = new Set(pool.hosts());
    for (const enc of current) attach(enc);
    for (const enc of [...stateSubs.keys()]) if (!current.has(enc)) detach(enc);
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
    const enc = encode(k);
    let link = links.get(enc);
    if (link === undefined) {
      link = opts.linkFor(k, session);
      links.set(enc, link);
    }
    return link;
  };

  const registry: MapRegistry<K, "copying", Cause> = {
    members,
    has,
    subscribe(onChange) {
      changeListeners.add(onChange);
      return () => {
        changeListeners.delete(onChange);
      };
    },
    resolve(k): EntrySession<"copying", Cause> | EntryFault {
      const enc = encode(k);
      const session = sessionOf(k);
      if (session === undefined)
        return { kind: "fault", failed: `unknown host: ${enc}` };
      const offset = session.clockOffset();
      const raw = latestState.get(enc);
      const projected = projectState(raw, offset);
      // Attach the DOMAIN cause (+ any extra typed detail, e.g. padi's D2
      // running/expected pair) onto a DOWN state only — `opts.causeFor` is app
      // knowledge this transport-only adapter doesn't have; omitted, the state
      // rides through cause-less and `@kolu/surface-map`'s own `projectStatus`
      // falls back to `"other"`. `raw` is always defined and genuinely down here
      // (that's the only way `projectState` returns "disconnected"/"failed"), so
      // its `failureCause`/`lastError` are real, not invented.
      const state: EntryConnectionState<"copying", Cause> =
        (projected.kind === "disconnected" || projected.kind === "failed") &&
        opts.causeFor
          ? {
              ...projected,
              ...opts.causeFor(k, session, raw as SessionState<string>),
            }
          : // `projectState` never sets `cause` itself (untouched, Cause-agnostic —
            // see its own doc); this cast reflects that invariant, not a real widen.
            (projected as EntryConnectionState<"copying", Cause>);
      // BELT (juspay/kolu#1716): a non-provisioning session (`session.provisions ===
      // false` — a `makeSession<_, never>` arm typed WITHOUT "copying") can NEVER
      // legitimately reach the provisioning phase. Checked per-SESSION (the runtime
      // twin of its `Prov` type, not an app-nominated "the local one" key), so a pool
      // with any number of non-provisioning members is covered, not just one. If it
      // ever projects "copying" anyway, fail LOUD rather than paint a lying "warming"
      // chip.
      if (!session.provisions && state.kind === "copying") {
        throw new Error(
          `host "${enc}" projected a provisioning "copying" state its session can ` +
            "never inhabit — a non-provisioning session must never enter copying " +
            "(see juspay/kolu#1716)",
        );
      }
      return {
        kind: "session",
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
