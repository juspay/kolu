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

/** The session role this adapter needs — just {@link Session}. The clock offset is
 *  NO LONGER a type BOUND on the session (`& { clockOffset() }`): that bound locked
 *  out any consumer whose session lacks the method, forcing drishti to hand-clone the
 *  whole registry (~90 lines) + a second `projectState`. It is now an INJECTED
 *  capability — `ServeHostMapOptions.offsetOf` — so a session that measures an offset
 *  passes its measurer and one that doesn't passes `() => 0`, and both reuse this one
 *  adapter. `Prov = string` (the phase-vocabulary TOP) so every session — a `never`
 *  endpoint, an ssh arm, any connector — is assignable by `Prov`-covariance. */
type MappableSession = Session<SurfaceClientLike, string>;

/** Thrown (PR4) when `resolve` is asked for a member that has NO session — `has(k)`
 *  true but `getSession(k)` undefined. Membership and sessions reconcile together, so
 *  this can't legitimately happen in steady state; rather than fabricate a catch-all
 *  failure for the race, the map fails loud. Named + typed + greppable so a field
 *  firing reads as exactly what it is: a genuine unclassified producer to classify. */
export class UnclassifiedHostSessionError extends Error {
  constructor(encodedKey: string) {
    super(
      `serveHostMap: host "${encodedKey}" is a member but has no session — a map ` +
        "member cannot enter a failed state without a schema-valid domain failure " +
        "(PR4, no fabricated fallback), and a member with no session is unreachable " +
        "in steady state. This is a defect to classify, never to bucket.",
    );
    this.name = "UnclassifiedHostSessionError";
  }
}

/** Thrown (PR4) at the classification seam when a session reaches a terminal
 *  `failed` state but the injected `failureOf` returns `null` — i.e. it declined
 *  to classify a genuinely-failed session. A map member cannot enter the `failed`
 *  state without a schema-valid domain failure (there is no fabricated fallback),
 *  so this names the TRUE producer defect: `failureOf` returned null for a terminal
 *  failed session. Named + typed + greppable so a firing reads as exactly what it
 *  is — a classifier to fix, never a state to bucket. */
export class UnclassifiedHostFailureError extends Error {
  constructor(encodedKey: string, transportError: string) {
    super(
      `serveHostMap: host "${encodedKey}" reached a terminal \`failed\` state, but ` +
        "`failureOf` returned null — a failed map member must carry a schema-valid " +
        "domain failure (PR4, no fabricated fallback). Classify this terminal " +
        `failure at the map's \`failureOf\`, never bucket it. Transport error was: ${transportError}`,
    );
    this.name = "UnclassifiedHostFailureError";
  }
}

/** {@link projectState}'s PRE-classification output: the phase only. The down arms
 *  (`disconnected`/`failed`) carry NO domain `failure` yet — classification happens
 *  at the map's `resolve` seam via the injected `failureOf`. This is the raw,
 *  domain-agnostic half of the split: a `failed` arm HERE has no failure, whereas
 *  the classified {@link EntryConnectionState.failed} REQUIRES one. Keeping the two
 *  roles as two types is what stops "failed with no failure" from being spellable
 *  on the published arm. */
type RawConnectionState =
  | { kind: "copying" }
  | { kind: "connecting" }
  | { kind: "connected"; clockOffset: number }
  | { kind: "disconnected" }
  | { kind: "failed" };

/** Project a `SessionState` → the map's `EntryConnectionState`. NEW projection — NOT
 *  `connectionPipe.projectConnection` (which targets the 4-field browser
 *  `ConnectionInfo`). `connected` REQUIRES the measured clock offset: until the admit
 *  handshake has stamped one, the entry honestly reads as still `connecting`
 *  (offset-at-hello is the contract — a `0` placeholder would be a lie). */
export function projectState<Prov extends string>(
  s: SessionState<Prov> | undefined,
  clockOffset: number | null,
): RawConnectionState {
  if (s === undefined) return { kind: "connecting" };
  if (s.phase === "disconnected" || s.phase === "failed") {
    // The RAW (pre-classification) down arms carry NO domain `failure` and no
    // transport `reason` — this projection is Failure-agnostic (it holds no domain
    // knowledge). `resolve` classifies the down state into the schema-valid domain
    // `failure` via the injected `failureOf`, reading the transport error off the
    // `SessionState` itself there.
    return s.phase === "failed" ? { kind: "failed" } : { kind: "disconnected" };
  }
  if (s.phase === "connected")
    return clockOffset === null
      ? { kind: "connecting" }
      : { kind: "connected", clockOffset };
  if (s.phase === "connecting") return { kind: "connecting" };
  // A connector-declared provisioning phase (ssh's `probing`/`copying`/`building`) —
  // the map's coarse "warming" bucket (its `EntryStatus` collapses them all to
  // `warming`; the fine phase rides the per-host `connection` cell, not this
  // projection).
  return { kind: "copying" };
}

export interface ServeHostMapOptions<K, S, Failure = unknown> {
  /** The re-served entry-surface CLIENT for one host — a `directLink` over the host's
   *  `reServeSurface(...).router` (the re-serve POLICY is app-specific, hence
   *  injected). Called once per host; the result is cached here and evicted on
   *  removal, so a re-serve mirror is never built twice for a host. */
  linkFor: (host: K, session: S) => unknown;
  /** The session's measured clock offset (remote-host ↔ serving-process, stamped at
   *  the admit handshake), folded into the `connected` `EntryStatus`. INJECTED — not
   *  a type bound on the session — so a consumer whose session measures one passes
   *  its measurer (`(s) => s.clockOffset()`) and one that doesn't passes `() => 0`;
   *  either way this ONE adapter serves both (the bound it replaces is exactly why
   *  drishti used to hand-clone the registry). REQUIRED, no silent default: a consumer
   *  must DECLARE its offset story — a forgotten `offsetOf` is a compile error, never a
   *  silent forever-`connecting`. `null` means "not yet stamped" → the entry reads
   *  `connecting` until it is (offset-at-hello is the contract; a `0` placeholder for a
   *  session that genuinely can't measure is that session's OWN honest declaration). */
  offsetOf: (session: S) => number | null;
  /** Classify a DOWN session into the map's schema-valid domain `failure` — this
   *  adapter is transport-only (it projects a bare `SessionState`, which carries
   *  only the transport-axis `failureCause`, "network" vs "remote"); a domain
   *  classification (padi's contract-skew-refused / unconverged / drv-unbaked /
   *  link-failed / … — a DIFFERENT axis, one layer up) is the app's own knowledge,
   *  so it is injected here rather than guessed. REQUIRED and TOTAL (PR4): a map
   *  member cannot enter the `failed` state without a schema-valid domain failure,
   *  so this classifier is not optional and there is no framework fallback cause.
   *
   *  Return value — a SINGLE-MEANING absent (PR4): `null` means "this down state
   *  is NOT a standing failure — keep the entry WARMING" (a live host's normal
   *  reconnect window). It is a classification VERDICT, never a fabrication. A
   *  non-`null` return is the schema-valid domain failure the `failed` arm
   *  publishes verbatim. A terminal `failed` session that yields `null` is a
   *  classification defect and fails loud at the classification seam ({@link
   *  UnclassifiedHostFailureError}), never a bucketed catch-all. (If a second
   *  meaning ever wants to ride that `null`, it becomes a discriminated union
   *  then — the no-overloaded-null boundary, recorded here.) */
  failureOf: (
    host: K,
    session: S,
    state: SessionState<string>,
  ) => Failure | null;
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
  S extends MappableSession,
  Failure = unknown,
>(
  map: SurfaceMap<KS, ES, Failure>,
  pool: MembershipPool<S>,
  opts: ServeHostMapOptions<z.infer<KS>, S, Failure>,
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
      // Cache the frame FIRST — the republish below must never lose it (d3).
      latestState.set(enc, s);
      try {
        fire();
      } catch (err) {
        // d3 — `fire()` drives the map's republish over EVERY member (resolve →
        // projectState → linkFor → belt). A throw for ONE member must NOT propagate out of
        // this `onState` consumer: that would end its consume loop and FREEZE `EntryStatus`
        // at its last value while the SIBLING connection-cell consumer keeps advancing — the
        // green-chip-frozen / "Building forever" divergence. Surface it LOUDLY and keep
        // consuming (never one-projection-dead); `latestState` is already updated, so the
        // next frame republishes.
        console.error(
          `[serveHostMap] entries republish threw for member ${enc}; status stream kept alive:`,
          err,
        );
      }
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

  const registry: MapRegistry<K, "copying", Failure> = {
    members,
    has,
    subscribe(onChange) {
      changeListeners.add(onChange);
      return () => {
        changeListeners.delete(onChange);
      };
    },
    resolve(k): EntrySession<"copying", Failure> | EntryFault<Failure> {
      const enc = encode(k);
      const session = sessionOf(k);
      if (session === undefined) {
        // A member with NO session — `has(k)` true but `getSession(k)` undefined.
        // Membership and sessions are reconciled together (CLAUSE 1/2), so this
        // can't legitimately happen in steady state. PR4: rather than fabricate a
        // catch-all failure for it, fail LOUD — a real firing means a genuine
        // unclassified producer appeared, a defect to classify then.
        throw new UnclassifiedHostSessionError(enc);
      }
      const offset = opts.offsetOf(session);
      const raw = latestState.get(enc);
      const projected = projectState(raw, offset);
      // Classify a DOWN state into the map's schema-valid domain `failure` via the
      // REQUIRED, TOTAL `failureOf` (PR4). `raw` is always defined and genuinely
      // down here (the only way `projectState` returns "disconnected"/"failed"), so
      // its transport `error` is real, not invented.
      let state: EntryConnectionState<"copying", Failure>;
      if (projected.kind === "disconnected" || projected.kind === "failed") {
        const failure = opts.failureOf(k, session, raw as SessionState<string>);
        if (projected.kind === "failed") {
          // A terminal `failed` session that yields NO domain failure is a producer
          // defect: the map's `failed` arm cannot exist without a schema-valid
          // domain failure (PR4, no fabricated fallback). Fail LOUD at this
          // classification seam — naming the TRUE producer (`failureOf` returned
          // null for a terminal failed session) — rather than construct a failed-
          // without-failure state the tightened published arm cannot even hold.
          if (failure === null)
            throw new UnclassifiedHostFailureError(
              enc,
              (raw as DownSessionState).error,
            );
          state = { kind: "failed", failure };
        } else {
          // `disconnected`: `null` = transient drop → keep `failure` ABSENT
          // (→ warming); a domain failure → attach it (a standing refuse → failed).
          state =
            failure !== null
              ? { kind: "disconnected", failure }
              : { kind: "disconnected" };
        }
      } else {
        state = projected as EntryConnectionState<"copying", Failure>;
      }
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
