/**
 * `serveHostMap` — serve a `@kolu/surface-map` `SurfaceMap` over a warm host pool.
 *
 * The pool ({@link buildRemotePool}) is the membership + session source; the app
 * supplies each host's re-served entry-surface link (the re-serve POLICY is
 * app-specific, so `linkFor` is injected). This adapter's job is the PROJECTION and
 * the codec bridge — the framework glue a hand-rolled `MapRegistry` would otherwise
 * repeat is now owned, once, by `@kolu/surface`'s {@link reactiveFamily}:
 *
 *  1. FUSE the pool's membership `subscribe` with each member session's own
 *     `onState`, so the map's `entries` collection republishes on BOTH a membership
 *     change AND a per-session STATUS transition (warming → connected → failed) — the
 *     latter is not a membership event, but it IS a change the UI must see.
 *  2. CACHE each session's latest `SessionState` so the map's `resolve()` answers `state`
 *     synchronously — the family caches the last frame each session's `onState`
 *     subscription delivers and fuses that with the membership stream, multicasting ONE
 *     collection. (`Session.currentState()` — the synchronous point-read — is a separate
 *     capability this adapter deliberately does NOT adopt here; a recorded follow-up.)
 *  3. PROJECT `SessionState` → the map's `EntryConnectionState` (a distinct target from
 *     the browser `ConnectionInfo` that `connection.projectConnection` builds),
 *     folding in the session's measured `clockOffset` for the `connected` state.
 *
 * `reactiveFamily` owns (1) the membership diff, (2) the last-frame hold, plus per-key
 * disposal and per-member error isolation; this file keeps only the PROJECTION (clause
 * 3 — `projectState` + the injected `failureOf` + the #1716 belt) and the `map.codec`
 * bridge at the `MapRegistry<K>` boundary. It then hands the composed registry (via
 * `derived.registry`, the pull-face exit) to `serveSurfaceMap`.
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import { derived, reactiveFamily, source } from "@kolu/surface/reactor";
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
 *  NOT a type BOUND on the session, NOR an injected `offsetOf` option: it now rides
 *  the session's OWN `connected` {@link SessionState} arm (`makeSession` measures it
 *  off the framework-reserved `system.clockNow` at admit — see
 *  `@kolu/surface/clock-now`), so this adapter reads it straight off the cached state
 *  with nothing to inject and no consumer left to hand-clone the registry.
 *  `Prov = string` (the phase-vocabulary TOP) so every session — a `never` endpoint,
 *  an ssh arm, any connector — is assignable by `Prov`-covariance. */
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

/** Thrown (SR9) when a connection-bearing map's coarse dot and fine word DISAGREE on
 *  connected-ness for one member — the drishti#102 divergence ("green dot + permanent
 *  connecting"). Both are projected from the SAME `SessionState` frame in one `resolve`, so
 *  a well-behaved `connection.project` never trips this; a firing means the injected
 *  projection contradicts `projectState` (a producer defect). serveHostMap fails loud
 *  BEFORE publication so the mismatched pair can never reach the wire — one authority,
 *  enforced at the seam, not by convention. */
export class ConnectionAuthorityMismatchError extends Error {
  constructor(
    encodedKey: string,
    dotConnected: boolean,
    wordConnected: boolean,
  ) {
    super(
      `serveHostMap: host "${encodedKey}" — the coarse dot and the fine connection word ` +
        `disagree on connected-ness (dot connected=${dotConnected}, word ` +
        `connected=${wordConnected}). Both derive from ONE SessionState frame, so a ` +
        "divergence is a producer defect in `connection.project`/`isConnected` — failing " +
        "loud before publication rather than shipping the drishti#102 dot-vs-word split.",
    );
    this.name = "ConnectionAuthorityMismatchError";
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
  | { kind: "connected"; clockOffset: number | null }
  | { kind: "disconnected" }
  | { kind: "failed" };

/** Project a `SessionState` → the map's `EntryConnectionState`. NEW projection — NOT
 *  `connection.projectConnection` (which targets the 4-field browser
 *  `ConnectionInfo`). Readiness is LINK liveness, NOT clock-measured: a connected
 *  session projects to `connected` REGARDLESS of whether the clock offset has landed.
 *  The offset is a SEPARATE fact riding the session's own `connected` arm
 *  (`makeSession` stamps it off the reserved `system.clockNow` at admit): `null` is a
 *  legal, single-meaning "not-yet-measured" value carried THROUGH on the connected arm
 *  — it does NOT demote the entry to `connecting` (that was the old, wrongly-coupled
 *  behaviour). A number is the measured offset; the reader renders "—" for null. */
export function projectState<Prov extends string>(
  s: SessionState<Prov> | undefined,
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
  if (s.phase === "connected") {
    // A generic `Prov` defeats TS's discriminated-union narrowing (`Prov` could be
    // `"connected"`, so the union's first arm structurally admits a `{ phase: "connected" }`
    // that carries NO `clockOffset`), so read `clockOffset` off the connected shape
    // explicitly. `makeSession` ALWAYS stamps the field on a connected frame (`null` at
    // connect, a number once the probe lands). Readiness is LINK liveness: a connected
    // session is `connected` either way — `null` (honest not-yet-measured) is carried
    // THROUGH, not demoted to `connecting`. A MISSING (`undefined`) offset is the
    // type-only illegal inhabitant no producer of ours constructs — FAIL LOUD rather
    // than silently degrade it (the funnel `fire()` rethrows this out-of-band as the
    // invariant it is), so a future producer that forgets to stamp the field is caught.
    const clockOffset = (s as Extract<SessionState, { phase: "connected" }>)
      .clockOffset;
    if (clockOffset === undefined) {
      throw new Error(
        "[serveHostMap] connected SessionState carries no clockOffset — makeSession must " +
          "stamp it (null at connect, a number once the system.clockNow probe lands). A " +
          "missing field is a producer defect; failing loud rather than degrading it.",
      );
    }
    return { kind: "connected", clockOffset };
  }
  if (s.phase === "connecting") return { kind: "connecting" };
  // A connector-declared provisioning phase (ssh's `probing`/`provisioning`) —
  // the map's coarse "warming" bucket (its `EntryStatus` collapses them all to
  // `warming`; the fine phase rides the entry's own `SessionState`, which the browser
  // now reads off the entry directly — no separate `connection` cell).
  return { kind: "copying" };
}

export interface ServeHostMapOptions<K, S, Failure = unknown, Conn = unknown> {
  /** The re-served entry-surface CLIENT for one host — a `directLink` over the host's
   *  `reServeSurface(...).router` (the re-serve POLICY is app-specific, hence
   *  injected). Called once per host; the result is cached here and evicted on
   *  removal, so a re-serve mirror is never built twice for a host. */
  linkFor: (host: K, session: S) => unknown;
  /** SR9 — the FINE connection payload the entry publishes (padi's `ConnectionInfo`: the
   *  rich phase + log tail + elapsed the coarse `EntryStatus.kind` folds away), plus its
   *  connected-discriminant. Injected because the fine connection's TYPE is domain
   *  knowledge (`@kolu/surface-remote` is transport-only — the same reason `failureOf` is
   *  injected). Omit for a map that carries no fine connection (the entry then has no
   *  `connection` field).
   *
   *  Both halves are called on the SAME `raw` frame, in the SAME `resolve`, as the coarse
   *  projection, and serveHostMap ASSERTS they agree: `project` yields the word, and if the
   *  coarse dot (`kind === "connected"`) and the fine word (`isConnected(word)`) ever
   *  disagree, `resolve` fails loud ({@link ConnectionAuthorityMismatchError}) BEFORE the
   *  entry is published — so a half-updated dot/word pair (the drishti#102 divergence) has
   *  no construction path that reaches the wire, not merely a convention. */
  connection?: {
    /** Project the session's cached frame → the fine connection payload. `raw` is
     *  `undefined` only pre-first-frame (a member seen before its first `onState`); return
     *  a gate-closed "connecting" payload then, matching the coarse `connecting`. */
    project: (raw: SessionState<string> | undefined) => Conn;
    /** Whether the fine payload represents a CONNECTED link — the map's own connected
     *  discriminant (padi: `c.phase === "connected"`). The invariant serveHostMap enforces
     *  against the coarse dot. */
    isConnected: (connection: Conn) => boolean;
  };
  /** Classify a DOWN session into the map's schema-valid domain `failure` — this
   *  adapter is transport-only (it projects a bare {@link DownSessionState}, which
   *  carries only the transport-axis `cause`, "network" vs "remote"); a domain
   *  classification (padi's contract-skew-refused / unconverged / agent-source-unbaked /
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
  failureOf: (host: K, session: S, state: DownSessionState) => Failure | null;
}

/** The pool surface `serveHostMap` consumes — a slice of {@link RemotePool} (it never
 *  adds/removes; the app's root RPCs do). */
export type MembershipPool<S extends Session<SurfaceClientLike, string>> = Pick<
  RemotePool<S, unknown>,
  "hosts" | "has" | "getSession" | "subscribe"
>;

/** Serve a `SurfaceMap` over a warm host pool. Returns the same shape
 *  `serveSurfaceMap` does; `dispose()` tears down the map and, through the reactive
 *  family, the membership subscription and every per-member `onState`. */
export function serveHostMap<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  S extends MappableSession,
  Failure = unknown,
  Conn = unknown,
>(
  map: SurfaceMap<KS, ES, Failure, Conn>,
  pool: MembershipPool<S>,
  opts: ServeHostMapOptions<z.infer<KS>, S, Failure, Conn>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;
  // `pool` is ALWAYS string-keyed (the warm ssh pool's native key), while the map's
  // own `K` may be a non-primitive (kolu's `HostKey`). The reactive family below is
  // keyed by the pool's own STRING; `map.codec` bridges to/from `K` only at the
  // `MapRegistry<K>` boundary, mirroring the same string-space-internally/
  // object-at-the-boundary shape `@kolu/surface-map`'s own client/server halves use.
  const { encode, decode } = map.codec;

  // The re-served entry-surface link per host, memoised and evicted on host exit (the
  // re-serve POLICY is app-specific, hence injected). The ONE hand-held cache that
  // survives the reshape — its eviction now rides the family's `onEvict`.
  const links = new Map<string, unknown>();

  // Per-member classification cache, keyed by the FRAME the value was classified from.
  //
  // `failureOf` is a domain classifier this transport-only adapter does not control, and
  // the real one (kolu's `padiFailureOf`) mints a FRESH object literal per call. Nothing
  // downstream memoises: `derived.registry.resolve` re-runs `resolveEntry` on every read,
  // and `serveSurfaceMap`'s republish loop calls `statusOf` for EVERY member on EVERY
  // member's session frame. So without this the map's republish gate (`samePublished`,
  // `Object.is` per field) saw a new `failure` reference every tick and re-published every
  // failed member on every sibling's frame — O(M) wire frames per frame, O(M²) across a
  // pool, on the arm most likely to sit occupied for hours (a standing refuse redialing).
  //
  // Keyed by the frame itself, so this is identity-preserving rather than a staleness
  // window: the same `raw` classifies to the same value by definition, and a new frame
  // re-classifies by construction. That gives `failure` exactly the per-frame reference
  // stability `evidence` (`raw.log`) and `connection` (`project`, identity on the frame)
  // already had — which is what the gate's comment claims and, before this, only assumed.
  const classified = new Map<
    string,
    { frame: DownSessionState; failure: Failure }
  >();
  const classifyOnce = (
    enc: string,
    k: K,
    session: S,
    down: DownSessionState,
  ): Failure | null => {
    const hit = classified.get(enc);
    if (hit !== undefined && Object.is(hit.frame, down)) return hit.failure;
    const failure = opts.failureOf(k, session, down);
    if (failure !== null) classified.set(enc, { frame: down, failure });
    else classified.delete(enc);
    return failure;
  };

  // The ONE membership+state source. `reactiveFamily` fuses the pool's membership
  // `subscribe` with each session's own `onState` and owns — once, for the framework —
  // the membership diff, the last-frame hold (it caches the frames each session's `onState`
  // subscription delivers, so `resolve()` answers synchronously; `Session.currentState()`
  // is a separate point-read this adapter deliberately does not use here), per-key disposal,
  // and per-member error isolation. What was
  // ~60 lines of hand-held `latestState`/`stateSubs`/`attach`/`detach`/`reconcile`/`fire`
  // here (including the shared funnel's fail-loud-but-isolated republish catch) is now
  // the primitive's job; the fail-loud republish doctrine rides its `subscribe`.
  const family = reactiveFamily<string, SessionState<string>>({
    // One occurrence per membership transition — `pool.subscribe` fires only after
    // `hosts()`/`has()` reflect the change (the pool's ordering clause), so the family's
    // reconcile is never ahead of the snapshot the republish reads, and a remove/re-add
    // are two transitions (never coalesced — the map's clause-3 the `membershipId` mint
    // rests on).
    members: source(
      (emit) => pool.subscribe(() => emit(pool.hosts())),
      pool.hosts(),
    ),
    // `onState` is snapshot-then-delta, so this seeds the member's state synchronously.
    // A member present with NO session yet (the documented reconcile race — membership and
    // sessions reconcile together, so this is transient) returns `undefined`: the family then
    // does NOT mark it attached and RETRIES on the next membership frame, exactly as the old
    // hand-rolled `attach` did. This preserves the self-heal — NEVER a no-op disposer that
    // would freeze the member un-seeded (a resolve reading the now-present session finds a
    // live handle but a `latest` of `undefined`, publishing a permanent "connecting").
    attach: (enc, set) => pool.getSession(enc)?.onState(set),
    // Tie the re-serve link's eviction to the family's per-key disposal — the ONE detach
    // seam (it mirrored the old `detach`'s `links.delete`), so a departed host's link is
    // never left behind.
    onEvict: (enc) => {
      links.delete(enc);
      classified.delete(enc);
    },
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

  // PROJECT one member's cached `SessionState` → its serveable `EntrySession` (or fail
  // loud). The pure classification the reshape keeps: `projectState` + the injected
  // `failureOf` + the #1716 belt, composed. `raw` is the family's last-frame hold —
  // `undefined` only pre-first-frame (`projectState(undefined)` → connecting).
  const resolveEntry = (
    enc: string,
    raw: SessionState<string> | undefined,
  ): EntrySession<"copying", Failure, Conn> | EntryFault<Failure> => {
    const session = pool.getSession(enc);
    if (session === undefined) {
      // A member with NO session — `has(k)` true but `getSession(k)` undefined.
      // Membership and sessions are reconciled together (CLAUSE 1/2), so this can't
      // legitimately happen in steady state. PR4: rather than fabricate a catch-all
      // failure for it, fail LOUD — a real firing means a genuine unclassified producer
      // appeared, a defect to classify then.
      throw new UnclassifiedHostSessionError(enc);
    }
    const k = decode(enc);
    const projected = projectState(raw);
    // Classify a DOWN state into the map's schema-valid domain `failure` via the
    // REQUIRED, TOTAL `failureOf` (PR4). `raw` is always defined and genuinely down here
    // (the only way `projectState` returns "disconnected"/"failed"), so its transport
    // `error` is real, not invented.
    let state: EntryConnectionState<"copying", Failure>;
    if (projected.kind === "disconnected" || projected.kind === "failed") {
      // Inside this guard `raw` is guaranteed a genuinely-down frame — reuse the
      // canonical {@link DownSessionState} receptacle (not a hand-rolled `as { error }`)
      // so the injected classifier AND the seam throw read `error` off the narrowed
      // shape the type author intended.
      const down = raw as DownSessionState;
      // BELT — symmetric with the connected-arm `clockOffset` guard in `projectState`:
      // the erased `SessionState<string>` seam this map serves over (`Prov = string`, the
      // phase top) structurally admits a down frame MISSING its REQUIRED `error`. No
      // producer of ours constructs one — `makeSession` ALWAYS stamps `error`+`cause` on
      // a down frame — but a future producer that forgot would otherwise reach the
      // injected `failureOf` reading `undefined`; on a `disconnected` frame `padiFailureOf`
      // returns `null` without touching `error` and the map would publish the malformed
      // frame SILENTLY as warming. Fail LOUD here instead (the sanctioned pattern, not a
      // silent degrade), so the down seam is as fail-loud as the connected one.
      if (typeof down.error !== "string") {
        throw new Error(
          `[serveHostMap] down SessionState for host "${enc}" carries no \`error\` — a ` +
            "down frame (disconnected/failed) MUST carry a real transport error " +
            "(makeSession always stamps error+cause). A missing field is a producer " +
            "defect; failing loud rather than publishing a malformed down state as warming.",
        );
      }
      const failure = classifyOnce(enc, k, session, down);
      if (projected.kind === "failed") {
        // A terminal `failed` session that yields NO domain failure is a producer
        // defect: the map's `failed` arm cannot exist without a schema-valid domain
        // failure (PR4, no fabricated fallback). Fail LOUD at this classification seam —
        // naming the TRUE producer (`failureOf` returned null for a terminal failed
        // session) — rather than construct a failed-without-failure state the tightened
        // published arm cannot even hold.
        if (failure === null)
          throw new UnclassifiedHostFailureError(enc, down.error);
        // EVIDENCE, stapled here: the session's retained log tail off the SAME `raw`
        // frame `failureOf` just classified — pinned at classification, so the failure
        // record carries a post-mortem of the episode that produced it rather than a
        // live view that a dead browser link would later floor away. `raw.log` is the
        // existing source of truth (`SessionState.log`, carried forward into the failed
        // arm by `session.ts`'s `setDown`) — passed straight through, never a second
        // evidence pipe. `[]` here means the episode genuinely retained no lines.
        state = { kind: "failed", failure, evidence: down.log };
      } else {
        // `disconnected`: `null` = transient drop → keep the `refuse` record ABSENT
        // (→ warming); a domain failure → attach the whole record (a standing refuse →
        // failed), reason and evidence in one value. A standing refuse is published as
        // `failed`, so it gets exactly the same stapling as a terminal give-up.
        state =
          failure !== null
            ? {
                kind: "disconnected",
                refuse: { failure, evidence: down.log },
              }
            : { kind: "disconnected" };
      }
    } else {
      // An up arm (copying/connecting/connected) — no `failure` field, so it's a
      // structural subset of `EntryConnectionState<"copying", Failure>` and assigns
      // directly.
      state = projected;
    }
    // BELT (juspay/kolu#1716): a non-provisioning session (`session.provisions === false`
    // — a `makeSession<_, never>` arm typed WITHOUT "copying") can NEVER legitimately
    // reach the provisioning phase. Checked per-SESSION (the runtime twin of its `Prov`
    // type, not an app-nominated "the local one" key), so a pool with any number of
    // non-provisioning members is covered. If it ever projects "copying" anyway, fail
    // LOUD rather than paint a lying "warming" chip.
    if (!session.provisions && state.kind === "copying") {
      throw new Error(
        `host "${enc}" projected a provisioning "copying" state its session can ` +
          "never inhabit — a non-provisioning session must never enter copying " +
          "(see juspay/kolu#1716)",
      );
    }
    // SR9 — the FINE connection payload (the word), projected from the SAME `raw` frame
    // that produced `state` (the dot) above, in this SAME `resolve`. Absent when no
    // `connection` option is injected (a map that carries no fine connection).
    const connection = opts.connection?.project(raw);
    // Enforce the one-authority invariant STRUCTURALLY, at the producer: the coarse dot and
    // the fine word MUST agree on connected-ness. `projectState`/`state.kind` and the
    // injected `project` both read the SAME `raw`, so for a well-behaved projection they
    // agree by construction — but a divergent `project` (or a future edit) could construct
    // a "connected dot, connecting word" pair (the drishti#102 divergence). Fail LOUD here,
    // BEFORE publication, so that pair can never reach the wire — not a convention, a seam.
    if (opts.connection !== undefined) {
      const dotConnected = state.kind === "connected";
      const wordConnected = opts.connection.isConnected(connection as Conn);
      if (dotConnected !== wordConnected) {
        throw new ConnectionAuthorityMismatchError(
          enc,
          dotConnected,
          wordConnected,
        );
      }
    }
    return {
      kind: "session",
      link: linkFor(k, session),
      state,
      connection,
    };
  };

  // The pull-face exit over the family: resolves each member's entry on demand from its
  // cached state, and fires the republish `subscribe` on every family change (membership
  // OR status). A republish throw (an invariant/producer defect) is contained + rethrown
  // out-of-band by the family — the old shared-funnel `fire()` doctrine, framework-owned.
  const reg = derived.registry(family, resolveEntry);

  // Bridge the family's STRING key space to the map's `K` at the `MapRegistry<K>`
  // boundary (the only place the codec is needed).
  const registry: MapRegistry<K, "copying", Failure, Conn> = {
    members: () => reg.members().map(decode),
    subscribe: (onChange) => reg.subscribe(onChange),
    has: (k) => reg.has(encode(k)),
    resolve: (k) => reg.resolve(encode(k)),
  };

  const served = serveSurfaceMap(map, registry);

  return {
    router: served.router,
    dispose() {
      served.dispose();
      // Tears down the family (the membership subscription and every per-member
      // `onState`), running each member's `onEvict` (which drops its link).
      reg.dispose();
      links.clear();
    },
  };
}
