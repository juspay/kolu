/**
 * `serveSurfaceMap` — the SERVER half. A HANDLER transform, not a transport
 * change: every entry-member call reads its folded `mapKey`, resolves membership
 * at call time, and FORWARDS to the resolved session's entry-surface dispatch. An
 * unknown key is a typed rejection (one-shot calls) or an immediate typed end
 * (streams); a key that leaves membership mid-stream ends its live subscriptions
 * with a TYPED end BEFORE the session is destroyed (no error frame after a typed
 * end).
 *
 * Membership + status live in ONE published collection (`entries`), driven by
 * the `MapRegistry` — the source-agnostic seam any session source backs (the
 * warm ssh pool, a mock harness). Status is DERIVED from the resolved session's
 * connection state (a projection, never a second writer).
 *
 * What the map hands back is the SAME pair `implementSurface` does — `{ group,
 * handlers }` (W2 S2) — so a host merges them into its own served surface and a
 * test drives them through `directDispatch`. `map.tagPrefix` decides the tags,
 * so a mounted map's handlers are already keyed under its sibling name and the
 * host has nothing to re-prefix.
 */

import { collection } from "@kolu/surface";
import {
  collectionKeyChannel,
  collectionKeysetChannel,
} from "@kolu/surface/channel-names";
import type { SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import {
  resolveCellVerbs,
  resolveCollectionVerbs,
  surfaceTag,
} from "@kolu/surface/define";
import {
  MapEntryFailed,
  MapKeyNonCanonical,
  MapKeyUnknown,
} from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  type CollectionHandlerDeps,
  collectionHandlers,
  inMemoryChannelByName,
  type SurfaceHandler,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import { dequal } from "dequal";
import { Effect, Schema, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type {
  EntryStatus,
  FailureEvidence,
  FailureRecord,
  MembershipId,
  SurfaceMap,
} from "./define";
import { decodeMembershipId, ENTRIES_MEMBER } from "./define";
import { unfoldInput, unfoldKeyField } from "./envelope";

// ── The resolver / membership seam ──────────────────────────────────────

/** A session's connection state — the map DERIVES {@link EntryStatus} from it (a
 *  projection, never a second writer). `copying`/`connecting` project to
 *  `warming`; `connected` carries the serving process's own-clock offset at
 *  hello (`number | null`, where `null` = not-yet-measured — readiness is
 *  link-liveness, so a connected session projects to `connected` regardless);
 *  `disconnected`/`failed` project to `failed(failure)`.
 *
 *  `Prov` mirrors `@kolu/surface-remote/session`'s `SessionState<Prov extends
 *  string>` split (juspay/kolu#1716) ONE LAYER UP: `"copying"` is the
 *  nix-closure-PROVISIONING phase, a remote-only fact a LOCAL (non-provisioning)
 *  session can never reach. Before this parameter, a non-provisioning entry could
 *  still TYPE its state as `{ kind: "copying" }` here — only a runtime belt
 *  (`serveHostMap`'s `session.provisions === false && state.kind === "copying"`
 *  throw) caught it landing. Default `Prov = "copying"` keeps every existing
 *  (mixed / provisioning) registry's type unchanged; a registry that resolves
 *  ONLY local entries names itself `MapRegistry<K, never>` (or `EntrySession<never>`
 *  directly), and a `"copying"` literal becomes a compile error there — see
 *  `entryConnectionState.test-d.ts`.
 *
 *  A type audit asked for MORE: per-entry local≠copying narrowing INSIDE one
 *  mixed `Map<K, EntryStatus>` (`Prov = "copying"`, the shared default) — e.g. a
 *  key-dependent type that says "entry `local-host`'s state can never be
 *  `copying`" while a sibling key's can. That is dependent typing a generic
 *  container shouldn't encode (the value type would have to vary BY KEY, which
 *  `Map<K, V>` structurally cannot express) — refused, not merely deferred. The
 *  guarantee already holds two OTHER ways, composed:
 *   1. **At the producer.** A local entry is only ever resolved from a session
 *      built over `makeSession<_, never>` (`Prov = never`) — the copying-
 *      unrepresentable split (juspay/kolu#1716) makes that session's OWN state
 *      type unable to construct `{ kind: "copying" }` in the first place. So the
 *      local entry's projected value can never BE `copying`: not because this
 *      generic container narrows it, but because nothing upstream can hand it
 *      one.
 *   2. **The belt, if (1) is ever violated by a future bug.** `serveHostMap`'s
 *      `resolve()` (`packages/surface-remote/src/serveHostMap.ts`, the `if
 *      (!session.provisions && state.kind === "copying") throw` guard) checks
 *      PER-SESSION, at runtime, and fails loud rather than paint a lying
 *      "warming" chip — pinned by `packages/surface-remote/src/
 *      serveHostMap.test.ts`'s "serveHostMap belt — a non-provisioning session
 *      can never project 'copying' (juspay/kolu#1716)" suite (the "BELT: … throws
 *      LOUD instead of a lying 'warming' chip" case).
 *  Producer-unrepresentable + a runtime belt is the honest form for a fact a
 *  generic container's type can't carry per-key — not a type change here.
 *
 *  `Failure` mirrors {@link EntryStatus}'s own domain failure value, ONE layer
 *  earlier (the session's raw connection state, before {@link projectStatus}
 *  projects it onto the published `EntryStatus`). Its optionality is PER-ARM, and
 *  the two down arms differ because their lifecycles do:
 *    - `disconnected.refuse` is OPTIONAL and is a whole {@link FailureRecord} — a
 *      transient drop legitimately carries NONE (still coming back → projects to
 *      `warming`); a standing refuse carries one (→ `failed`). Presence IS the
 *      warming-vs-failed discriminant, and because the record is ONE value the
 *      reason can never arrive without the evidence that explains it.
 *    - `failed` IS a `FailureRecord` — a terminal give-up is ALWAYS a real failure,
 *      so "failed with no failure" is an illegal state made UNCONSTRUCTIBLE at the
 *      type, not caught by a runtime throw. The optionality a transient
 *      `disconnected` legitimately needs does NOT bleed onto `failed` (independent
 *      union members carry their own optionality).
 *  A generic transport-only registry (`@kolu/surface-remote`'s `serveHostMap`)
 *  obtains the value from an injected, REQUIRED `failureOf` classifier (domain
 *  knowledge it doesn't itself hold), and fails loud at its OWN classification
 *  seam when a terminal `failed` session yields none — so the illegal state is
 *  refused at the producer, never represented here.
 *
 *  {@link FailureRecord} carries that same argument one field further: a domain failure
 *  and the retained output tail that EVIDENCES it are ONE record with one name, so they
 *  travel as one VALUE rather than as two correlated fields.
 *    - `failed` IS a {@link FailureRecord} (a terminal give-up always has a reason, and
 *      the episode that produced it always retained SOME tail — `[]` when it genuinely
 *      produced none).
 *    - `disconnected` carries an OPTIONAL `refuse` record: present = a standing refuse,
 *      absent = a transient drop. Presence of the RECORD is the discriminant, so a
 *      reason without its evidence (and evidence without a reason) is unspellable at
 *      the shape level rather than pinned by a hand-written predicate, and
 *      `state.refuse !== undefined` narrows it by ordinary optional-property narrowing
 *      — no dependence on `Failure` being a usable discriminant. */
export type EntryConnectionState<
  Prov extends "copying" | never = "copying",
  Failure = unknown,
> =
  | { kind: Prov }
  | { kind: "connecting" }
  | { kind: "connected"; clockOffset: number | null }
  | { kind: "disconnected"; refuse?: FailureRecord<Failure> }
  | ({ kind: "failed" } & FailureRecord<Failure>);

/** A resolved, serveable entry. Carries what the map needs to (a) FORWARD calls
 *  (a live entry-surface {@link SurfaceDispatch} to proxy to) and (b) observe status
 *  (the session's connection state). */
export interface EntrySession<
  Prov extends "copying" | never = "copying",
  Failure = unknown,
  Conn = unknown,
> {
  /** The sum tag — switch on this, never on bare field-presence. */
  readonly kind: "session";
  /** The entry-surface DISPATCH the map forwards member calls to. Was an oRPC
   *  nested-proxy `link` walked by `leafAt(link, [member, verb])`; the wire namespace
   *  is flat now, so the map forwards by TAG (`surfaceTag(map.entry.tagPrefix, member,
   *  verb)`) over the erased `{ unary, stream }` seam. Whatever minted it — a wire
   *  link, `directDispatch`, a mirror — the map never learns. */
  readonly dispatch: SurfaceDispatch;
  /** The session's current COARSE connection state (the dot) — read fresh on each
   *  publish; the registry re-fires `subscribe` when it changes so `entries`
   *  re-projects. */
  readonly state: EntryConnectionState<Prov, Failure>;
  /** SR9: the FINE connection payload (the word) — the rich per-host connection state
   *  the coarse `state` folds away, carried opaquely onto the published `EntryStatus`.
   *  Produced by the SAME per-frame projection as `state`, from the SAME `SessionState`
   *  frame (never a second pipe), so the dot and the word can never disagree. Absent for
   *  a map that carries no fine connection. */
  readonly connection?: Conn;
}

/** A terminal, no-session entry — a structural fault (the mock harness's failed
 *  member) that has a domain `failure` to publish but no live session behind it.
 *  Publishes `failed(failure)` directly. PR4: it carries the SAME schema-valid
 *  domain `failure` as a session-backed failed entry — there is no framework
 *  fabrication, so a registry that has no domain failure to report has no
 *  business minting an `EntryFault` at all (it fails loud instead).
 *
 *  Carries NO evidence. A fault has no session, hence no retained output tail — that is
 *  a STRUCTURAL fact of the shape, not a value a producer could know better, so the one
 *  seam that knows it (`statusOf`) states it once. It is the same class of fact as the
 *  `kind` and the `membershipId` this seam already supplies for a fault rather than
 *  demanding them back; asking every mint site to restate a constant its own type fixes
 *  is a convention, not a guarantee. (The defect this design removes was a READER
 *  defaulting missing data away — `connection?.log ?? []`. A producer stating a value
 *  its type determines is not that.) */
export interface EntryFault<Failure = unknown> {
  /** The sum tag — the discriminant `isFault` switches on. */
  readonly kind: "fault";
  readonly failure: Failure;
}

/** The membership + resolution seam. ONE writer (the pool / the harness).
 *
 *  - CLAUSE 1 (ordering): `onChange` fires only AFTER `members()`/`has()` reflect
 *    the change.
 *  - CLAUSE 2 (snapshot): `members()` and `has()` answer from ONE consistent view.
 *  - CLAUSE 3 (per-transition, non-coalescing): every membership transition is
 *    OBSERVABLE — a key's departure and its re-add are never coalesced into one
 *    `onChange` that leaves `members()` showing the key continuously present. A key
 *    that leaves must be absent from `members()` on the notification that reports its
 *    departure BEFORE any re-add is reported. This is the law the per-add
 *    `membershipId` mint (a departed key's id is pruned on its departure notification,
 *    so the re-add mints a FRESH one) AND the client's per-key root lifecycle
 *    (`scoped.ts`'s `keyArray`, disposed on exit / rebuilt on entry) both rely on: a
 *    registry that atomically swaps a same-key session without an observable departure
 *    would reuse the stale id and strand the old subscription. The pool registries
 *    satisfy this by construction (each add/remove fires its own synchronous notify).
 *  - Status is DERIVED from the resolved session's state (projection). */
export interface MapRegistry<
  K,
  Prov extends "copying" | never = "copying",
  Failure = unknown,
  Conn = unknown,
> {
  members(): K[];
  subscribe(onChange: () => void): () => void;
  has(key: K): boolean;
  resolve(key: K): EntrySession<Prov, Failure, Conn> | EntryFault<Failure>;
}

/** The evidence a structural fault publishes — see `statusOf`. One module-level value
 *  so it is reference-stable across resolves. */
const NO_EVIDENCE: FailureEvidence = [];

function isFault<Failure, Conn>(
  r: EntrySession<"copying", Failure, Conn> | EntryFault<Failure>,
): r is EntryFault<Failure> {
  return r.kind === "fault";
}

/** Project a session's connection state onto the published {@link EntryStatus}.
 *
 *  THE CONTRACT the three published arms mean (not an implementation note — this is
 *  what every consumer, kolu's host-down card AND drishti's `entryStatusTone`, is
 *  entitled to rely on):
 *    - `warming`   = IN MOTION — coming up, or coming back on its own. No user
 *                    action needed; wait.
 *    - `connected` = live.
 *    - `failed`    = NOT PROCEEDING WITHOUT INTERVENTION — a STANDING refuse
 *                    (cross-supervisor / contract-skew-refused / unconverged: it will
 *                    not resolve by redialing) OR a TERMINAL give-up. Carries the
 *                    schema-valid domain `failure` so the host-down card can say what
 *                    to DO about it, AND that failure's `evidence` (the episode's
 *                    retained output tail) so it can SHOW what happened — one record,
 *                    so no consumer can hold the reason while the evidence went
 *                    missing.
 *
 *  The warming-vs-failed discriminant is the PRESENCE of a `refuse` record on a
 *  `disconnected` state (PR4) — no magic `"other"` sentinel: a transient reconnect
 *  carries none (→ warming), a standing refuse carries one (→ failed). A terminal
 *  `failed` state ALWAYS carries a real failure — the arm is typed to REQUIRE it,
 *  so "failed with no failure" is unconstructible, refused loud at the producer's
 *  classification seam (`serveHostMap`) rather than here. */
function projectStatus<Failure, Conn>(
  state: EntryConnectionState<"copying", Failure>,
  membershipId: MembershipId,
  // SR9: the FINE connection payload, carried onto EVERY arm. `projectStatus` is the ONE
  // place the coarse `kind` is decided, so threading the fine `connection` THROUGH it
  // (rather than a second assembly site) is what keeps the dot and the word co-produced
  // from one frame — the drishti#102 divergence has no construction path.
  connection?: Conn,
): EntryStatus<Failure, Conn> {
  // SPREAD `connection` onto every live arm, never spell it (#17). The field is
  // `Schema.optionalKey` on the published union (see `entryStatusSchema`), which
  // accepts an ABSENT key and REJECTS a present-`undefined` one — where zod's
  // `.optional()` took either. The argument is genuinely optional (a registry
  // entry's `connection?: Conn`, and a map with no `connection` option supplies
  // none), so a plain `connection,` writes the key present-with-`undefined` on
  // every arm, and the encode that publishes the entry rejects it. One binding,
  // spread three times, so the three arms cannot drift apart on the discipline.
  const conn = connection === undefined ? {} : { connection };
  switch (state.kind) {
    case "copying":
    case "connecting":
      return { kind: "warming", membershipId, ...conn };
    case "connected":
      return {
        kind: "connected",
        membershipId,
        clockOffset: state.clockOffset,
        ...conn,
      };
    // `disconnected` is OVERLOADED (see `@kolu/surface-remote`'s session machine):
    //   - a TRANSIENT reconnect-backoff — the link dropped and the loop is
    //     redialing; the classifier reported NO standing failure (absent `refuse`).
    //     This is the P4 case: a live host's normal reconnect window must read
    //     WARMING (coming back up), never a red "failed" chip indistinguishable
    //     from a dead host.
    //   - a STANDING degraded REFUSE — cross-supervisor / contract-skew-refused /
    //     unconverged: `session.ts`'s refuse path "holds degraded, does NOT
    //     reconnect", and the domain classified a SPECIFIC failure. Project it to
    //     `failed(failure)` so the host-down card renders what to do about it.
    // The discriminant is the PRESENCE of the `refuse` record, not cause-specificity.
    case "disconnected": {
      // The whole record, spread as one value — never two fields read separately, so
      // the reason and its evidence cannot be split apart on the way to the arm. The
      // live `connection` is deliberately NOT carried onto `failed` (that arm has no
      // such field; see {@link FailureEvidence}).
      const refuse = state.refuse;
      return refuse === undefined
        ? { kind: "warming", membershipId, ...conn }
        : { kind: "failed", membershipId, ...refuse };
    }
    // A terminal give-up (the reconnect loop stopped for good) — always a red
    // `failed` chip carrying the domain failure the arm is now typed to REQUIRE
    // (the illegal "failed with no failure" is unconstructible; the producer's
    // classification seam in `serveHostMap` fails loud before it can arise here).
    case "failed":
      return {
        kind: "failed",
        membershipId,
        failure: state.failure,
        evidence: state.evidence,
      };
  }
}

// ── serveSurfaceMap ─────────────────────────────────────────────────────

/** The verbs an entry member exposes, tagged streaming vs unary — the server's
 *  dual of the contract-side fold walk. */
interface MemberVerb {
  verb: string;
  streaming: boolean;
}

function entryMemberVerbs(
  entrySpec: SurfaceSpec,
): Array<[member: string, verbs: MemberVerb[]]> {
  const out: Array<[string, MemberVerb[]]> = [];
  for (const [key, s] of Object.entries(entrySpec.cells ?? {})) {
    out.push([
      key,
      resolveCellVerbs(s).map((verb) => ({ verb, streaming: verb === "get" })),
    ]);
  }
  for (const [key, s] of Object.entries(entrySpec.collections ?? {})) {
    out.push([
      key,
      resolveCollectionVerbs(s).map((verb) => ({
        verb,
        streaming: verb === "keys" || verb === "get" || verb === "deltas",
      })),
    ]);
  }
  for (const key of Object.keys(entrySpec.streams ?? {})) {
    out.push([key, [{ verb: "get", streaming: true }]]);
  }
  for (const key of Object.keys(entrySpec.events ?? {})) {
    out.push([key, [{ verb: "get", streaming: true }]]);
  }
  for (const [ns, procs] of Object.entries(entrySpec.procedures ?? {})) {
    out.push([
      ns,
      Object.keys(procs).map((verb) => ({ verb, streaming: false })),
    ]);
  }
  return out;
}

/** Extract the entry surface's own input from the wire envelope `{ mapKey, input }`
 *  — the EXACT value the consumer passed (object, primitive, or undefined). No
 *  key-stripping heuristic: the key lives in its own `mapKey` field, so an entry
 *  input that itself has a `mapKey` field survives untouched (it rode `input`). */
function unwrapInput(wire: unknown): unknown {
  return unfoldInput(wire);
}

export interface ServeSurfaceMapResult {
  /** The map's flat wire group — exactly `map.group`, handed back so a host merges
   *  ONE value pair (`group` + `handlers`) into its own served surface, the same
   *  shape `implementSurface` returns. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The bound handlers, keyed by FULL wire tag (`<map.tagPrefix><member>/<verb>`).
   *  Feed them to `directDispatch` for an in-process client, or merge them into a
   *  host's handler record for a wire serve path. A tag carries its own route, so
   *  there is nothing to re-prefix at the mount site. */
  readonly handlers: SurfaceHandlers;
  /** Tear down the membership republish subscription. */
  dispose(): void;
}

/** Serve a `SurfaceMap` over a `MapRegistry`. `Failure` is INFERRED from `map`'s own
 *  type — a domain map (`SurfaceMap<KS, ES, PadiEntryFailure>`) forces `registry` to
 *  resolve into that SAME narrowed `Failure`, so a registry that only emits the
 *  generic default can't silently serve a domain map (and vice versa). */
export function serveSurfaceMap<
  KS extends WireSchemaAny,
  ES extends SurfaceSpec,
  Failure = unknown,
  Conn = unknown,
>(
  map: SurfaceMap<KS, ES, Failure, Conn>,
  registry: MapRegistry<KS["Type"], "copying", Failure, Conn>,
): ServeSurfaceMapResult {
  type K = KS["Type"];
  const decodeKeyValue = Schema.decodeUnknownSync(map.keySchema);
  const has = (k: K) => registry.has(k);
  const resolve = (k: K) => registry.resolve(k);
  const members = () => registry.members();
  /** The tag a forwarded call carries on the ENTRY surface — the map's own prefix is
   *  stripped by construction (the entry face and the entry server both speak the
   *  entry surface's own tags). Read off `map.entry.tagPrefix`, so a scoped entry
   *  surface would forward at its own tags without this walk knowing. */
  const entryTag = (member: string, verb: string) =>
    surfaceTag(map.entry.tagPrefix, member, verb);

  // ── Opaque per-add membership identity (PR3) ─────────────────────────
  //
  // A fresh `crypto.randomUUID()` stamped when a key ENTERS membership, dropped
  // when it leaves, published on EVERY status arm. Minted LAZILY (`membershipIdFor`)
  // — a present member always resolves to one, so a per-key snapshot read
  // (`readOne`, no membership change to hang minting on) never lacks an id — and
  // PRUNED on every membership change (`pruneDepartedIds`, fired from the republish
  // subscription below, which CLAUSE 1 guarantees fires with the departed key
  // ALREADY gone). Prune-on-departure is what makes a same-key remove/re-add mint a
  // FRESH id: the removal drops the old id, so the re-add lazily mints a new one. An
  // authority restart is a fresh `serveSurfaceMap` over a fresh registry — an empty
  // id map — so every member mints anew; ids are never reused across a restart by
  // construction. The client keys every cached owner on `{encodedKey, membershipId}`,
  // so both paths rebuild subscriptions without any hand-rolled generation rearm.
  const membershipIds = new Map<string, MembershipId>();
  const membershipIdFor = (enc: string): MembershipId => {
    let id = membershipIds.get(enc);
    if (id === undefined) {
      // The MINT — one of the only two producers of a branded `MembershipId` (the
      // other being the wire `entryStatusSchema` decode). `decodeMembershipId` brands
      // the fresh uuid; a non-empty uuid always clears the `isMinLength(1)` check.
      id = decodeMembershipId(crypto.randomUUID());
      membershipIds.set(enc, id);
    }
    return id;
  };
  const pruneDepartedIds = (currentEncs: readonly string[]): void => {
    const present = new Set(currentEncs);
    for (const enc of [...membershipIds.keys()]) {
      if (!present.has(enc)) membershipIds.delete(enc);
    }
  };

  // A structural fault (no live session — the mock harness's failed member)
  // publishes the SAME schema-valid domain `failure` a session-backed failed
  // entry does (PR4 — no `"other"` fabrication); the registry that mints the
  // fault owns classifying it. `resolve` that cannot classify a fault has no
  // business minting one — it fails loud instead (see `serveHostMap`).
  const statusOf = (mapKey: K): EntryStatus<Failure, Conn> => {
    const membershipId = membershipIdFor(map.codec.encode(mapKey));
    const r = resolve(mapKey);
    // A structural fault has NO session, so no fine `connection` (the harness's failed
    // member — never `connected`, so the joint invariant holds trivially). A session-
    // backed entry threads its co-produced fine `connection` through `projectStatus`.
    return isFault(r)
      ? {
          kind: "failed",
          membershipId,
          failure: r.failure,
          // A fault has NO session, so there is no retained tail to staple: `[]` is what
          // this shape structurally MEANS, not a fallback for "we couldn't see it".
          // Stated here — the one seam that knows a fault has no session — exactly like
          // the `kind` and the `membershipId` this same seam supplies. A SHARED const,
          // so a re-resolve of an unchanged fault hands the republish gate the same
          // reference rather than a fresh empty array on every family fire.
          evidence: NO_EVIDENCE,
        }
      : projectStatus<Failure, Conn>(r.state, membershipId, r.connection);
  };

  // The wire `mapKey` is ALWAYS the canonical string {@link KeyCodec.encode} produces
  // (`define.ts`'s `foldInput` folds `Schema.String`, never `keySchema`) — decode it
  // back to `K` through `map.codec`, then re-validate through `keySchema` (P5): a
  // foreign string a client somehow smuggled onto the wire must fail here, not silently
  // become a trusted `K`. Decoding alone isn't enough: a LENIENT codec (one that
  // trims/case-folds/aliases on `decode`) could let a NON-canonical wire spelling pass
  // the key schema while still mapping to a real member — and the `entries` collection
  // subscribes its per-key channel on the caller's RAW wire string (`readOne` below)
  // while the republish loop always publishes on `codec.encode`'s CANONICAL spelling
  // (below) — two different channel names for the same member, so a non-canonical
  // spelling's stream holds open and never receives an update. Assert
  // `encode(decode(wire)) === wire` here so subscribe and publish can never disagree
  // about a member's channel name.
  //
  // A NON-canonical key is a DECLARED failure (`MapKeyNonCanonical`, D4) — every folded
  // member declares it, so it crosses the wire with its `_tag` and both keys intact
  // rather than collapsing into an opaque defect. A key the SCHEMA rejects outright
  // stays a DEFECT (the decode throws), exactly as the zod `.parse` did: a smuggled
  // foreign string is a caller bug, not a condition to branch on.
  const decodeCanonicalWireKey = (
    wire: string,
  ): Effect.Effect<K, MapKeyNonCanonical> =>
    Effect.suspend(() => {
      const k = decodeKeyValue(map.codec.decode(wire)) as K;
      const canonical = map.codec.encode(k);
      return canonical === wire
        ? Effect.succeed(k)
        : Effect.fail(
            new MapKeyNonCanonical({ wireKey: wire, canonicalKey: canonical }),
          );
    });

  const mapKeyOf = (payload: unknown): Effect.Effect<K, MapKeyNonCanonical> =>
    decodeCanonicalWireKey(unfoldKeyField(payload) as string);

  // ── Forward one streaming member call, ending TYPED on membership loss ──
  //
  // The upstream member stream, guarded by a "removed" latch. On removal the map's
  // stream simply ENDS (a typed completion downstream) instead of failing — the client
  // sees a graceful end, never the error frame a mid-flight session teardown would
  // raise. A real upstream error still propagates.
  //
  // The membership watcher is acquired as a SCOPED RESOURCE of this stream, BEFORE the
  // upstream is subscribed. The real pool removes destroy→delete→notify, so a removal
  // landing WHILE the upstream subscribe is in flight must be observed here — otherwise
  // the `has()` gate (upstream in the stream handler) and this watcher straddle the
  // subscribe and neither catches it, and a delta/fail-through member's failure escapes
  // as a raw error the client can't retry.
  //
  // The latch is what every guard tests, NOT the live `has()`. A re-add (a host flap =
  // remove+add) makes `has(mapKey)` true again under a NEW session, but this forward is
  // bound to the session CAPTURED at resolve — a re-add can never un-orphan it. So a
  // remove+readd during the subscribe must still end this forward TYPED.
  function forwardStream(
    mapKey: K,
    session: EntrySession<"copying", Failure, Conn>,
    tag: string,
    input: unknown,
  ): Stream.Stream<unknown, unknown> {
    return Stream.unwrap(
      Effect.gen(function* () {
        const latch: { removed: boolean; onRemoved?: () => void } = {
          removed: false,
        };
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            registry.subscribe(() => {
              if (!latch.removed && !has(mapKey)) {
                latch.removed = true;
                latch.onRemoved?.();
              }
            }),
          ),
          (unsub) =>
            Effect.sync(() => {
              unsub();
            }),
        );
        // Removed between the membership gate and the watcher's installation → end
        // typed before anything upstream is touched.
        if (latch.removed || !has(mapKey)) return Stream.empty;
        const removed = Effect.callback<void>((resume) => {
          if (latch.removed) {
            resume(Effect.void);
            return Effect.void;
          }
          latch.onRemoved = () => resume(Effect.void);
          return Effect.sync(() => {
            latch.onRemoved = undefined;
          });
        });
        return Stream.interruptWhen(
          Stream.catch(session.dispatch.stream(tag, input), (e) =>
            // An upstream failure is the captured session's destroy fallout, NOT a real
            // fault, when THIS forward was removed: end TYPED so a delta member never
            // delivers a raw stub error. A genuine failure (still a member) propagates.
            latch.removed ? Stream.empty : Stream.fail(e),
          ),
          removed,
        );
      }),
    );
  }

  const streamHandler =
    (member: string, verb: string): SurfaceHandler =>
    (payload) =>
      Stream.unwrap(
        Effect.map(mapKeyOf(payload), (mapKey) => {
          if (!has(mapKey)) return Stream.empty; // absent at subscribe → typed end
          const resolved = resolve(mapKey);
          if (isFault(resolved)) return Stream.empty; // terminal fault → typed end
          return forwardStream(
            mapKey,
            resolved,
            entryTag(member, verb),
            unwrapInput(payload),
          );
        }),
      );

  const unaryHandler =
    (member: string, verb: string): SurfaceHandler =>
    (payload) =>
      Effect.flatMap(mapKeyOf(payload), (mapKey) => {
        const enc = map.codec.encode(mapKey);
        if (!has(mapKey)) {
          // A one-shot call cannot end gracefully — reject typed.
          return Effect.fail(new MapKeyUnknown({ mapKey: enc }));
        }
        const resolved = resolve(mapKey);
        if (isFault(resolved)) {
          return Effect.fail(
            new MapEntryFailed({
              mapKey: enc,
              // The fault's own shape is app-owned and must not leak into the
              // framework's wire union, so it is RENDERED here (D4).
              failure: JSON.stringify(resolved.failure),
            }),
          );
        }
        return resolved.dispatch.unary(
          entryTag(member, verb),
          unwrapInput(payload),
        );
      });

  // ── Bind the handlers ────────────────────────────────────────────────
  //
  // Null prototype for the same reason `implementSurface`'s record has one (W2 S2):
  // member names are arbitrary strings, so a member named `toString` must not collide
  // with an inherited property.
  const handlers: SurfaceHandlers = Object.create(null);
  const bind = (tag: string, handler: SurfaceHandler): void => {
    if (handlers[tag] !== undefined) {
      throw new Error(
        `serveSurfaceMap: duplicate handler bound at wire tag "${tag}".`,
      );
    }
    handlers[tag] = handler;
  };

  for (const [member, verbs] of entryMemberVerbs(map.entry.spec)) {
    // A member name shared by a non-procedure primitive AND a procedure namespace
    // (padi's `session` is a cell {get, test__set} AND a procedure ns {restore,
    // import, forfeit}) is emitted TWICE by `entryMemberVerbs` (primitives first,
    // procedures last). On a FLAT tag namespace each verb has its own tag, so both
    // sets simply bind — the old "accumulate, don't reset" hazard (a second
    // `inner[member] = {}` dropping the first pass's verbs, 404-ing `session/get` on
    // every boot) is unspellable here: there is no per-member object to reset.
    for (const { verb, streaming } of verbs) {
      bind(
        surfaceTag(map.tagPrefix, member, verb),
        streaming ? streamHandler(member, verb) : unaryHandler(member, verb),
      );
    }
  }

  // ── The `entries` membership collection ──────────────────────────────
  // Channel names + the collection's own key are the CANONICAL STRING
  // (`map.codec.encode`), never the raw `K` — matching `map.entriesSpec`'s
  // string-keyed wire shape (define.ts) and `@kolu/surface`'s own per-key
  // channel-naming assumption (a non-primitive `K` would collapse every entry's
  // channel onto the literal `"entries:key:[object Object]"`). Minted through
  // the SAME `@kolu/surface/channel-names` helpers `walkSurface` mints every
  // OTHER collection's channels from — so an encoded key literally equal to
  // `"keys"` or `"deltas"` still can't alias the keyset channel (the `key:`
  // infix makes it structurally impossible, not just here by convention).
  const channel = inMemoryChannelByName();
  const keysBus = channel<string[]>(collectionKeysetChannel(ENTRIES_MEMBER));
  const perKeyBus = (encoded: string) =>
    channel<EntryStatus<Failure, Conn>>(
      collectionKeyChannel(ENTRIES_MEMBER, encoded),
    );

  /** The THROWING half of the canonical-key gate, for the snapshot reads inside the
   *  collection handlers. The typed `MapKeyNonCanonical` failure is raised one layer
   *  up, at the bound `entries/get` handler, so the wire sees a declared rejection;
   *  reaching this throw means the gate above was bypassed, which is a framework bug. */
  const decodeCanonicalWireKeyUnsafe = (wire: string): K =>
    Effect.runSync(decodeCanonicalWireKey(wire));

  const entriesDeps: CollectionHandlerDeps<
    string,
    EntryStatus<Failure, Conn>
  > = {
    // The snapshot is built ONLY from the current `members()`, so a departed id in
    // `membershipIds` can never enter it; and the republish subscription below prunes on
    // EVERY membership change (CLAUSE 1 fires synchronously after a departure), so the id
    // map is already bounded to current members by the time any `readAll` runs. No belt
    // prune needed here.
    readAll: () =>
      new Map(
        members().map(
          (k) =>
            [map.codec.encode(k), statusOf(k)] as [
              string,
              EntryStatus<Failure, Conn>,
            ],
        ),
      ),
    readOne: (encoded) => {
      const k = decodeCanonicalWireKeyUnsafe(encoded);
      return has(k) ? statusOf(k) : undefined;
    },
    upsert: () => {}, // read-only on the wire; the registry is the sole writer
    remove: () => {},
    perKeyBus,
    keysBus,
  };
  const entriesDescriptor = collection<
    "entries",
    string,
    EntryStatus<Failure, Conn>
  >({
    name: ENTRIES_MEMBER,
    keySchema: map.entriesSpec.keySchema,
    schema: map.entriesSpec.schema,
  });
  const entriesHandlers = collectionHandlers(entriesDescriptor, entriesDeps);
  bind(
    surfaceTag(map.tagPrefix, ENTRIES_MEMBER, "keys"),
    entriesHandlers.keys as SurfaceHandler,
  );
  bind(surfaceTag(map.tagPrefix, ENTRIES_MEMBER, "get"), (payload) =>
    // Gate the wire key through the DECLARED canonical check first, so a lenient
    // codec's non-canonical spelling is a typed `MapKeyNonCanonical` rejection rather
    // than an opaque defect from the snapshot read.
    Stream.unwrap(
      Effect.map(decodeCanonicalWireKey((payload as { key: string }).key), () =>
        entriesHandlers.get(payload as { key: string }),
      ),
    ),
  );

  // The served handler set and the advertised group must be the SAME tag set, or the
  // map serves a route nobody answers (a 404 at the far end) or answers a route the
  // group never minted (dead code). Both are boot crashes — the map's own twin of
  // `implementSurface`'s `assertHandlersMatchGroup` (D1).
  assertHandlersMatchMapGroup(map.group, handlers);

  // One writer publishes membership + status together, fired on every registry
  // change (add/remove membership AND per-session status transitions). But a
  // registry change is COARSE — it says "something changed", not WHICH member —
  // and SR9 folds the fine connection onto the entry, so the family now fires on
  // EVERY session frame of EVERY member. Publishing all members every time would
  // re-emit an unchanged entry on a sibling's frame: O(M) wire frames per frame,
  // O(M²) across a pool all streaming. So gate each re-emit on a real change of
  // the PUBLISHED value ("honest cost"): the keyset only on a membership change,
  // a per-key status only when that member's own EntryStatus actually changed.
  let lastKeyset: readonly string[] | undefined;
  const lastPublished = new Map<string, EntryStatus<Failure, Conn>>();
  // Equality over the PUBLISHED EntryStatus, generic in BOTH directions:
  //
  //  - over FIELDS: every own key of both values, deliberately NOT a hand-written list.
  //    A hand-enumerated compare has to be edited every time an arm in `define.ts` grows
  //    a field, and the failure mode of forgetting is SILENT: the new field's changes
  //    stop republishing (exactly what happened when the `failed` arm gained `evidence`).
  //  - over VALUES: STRUCTURAL, not reference. `connection` is the cached `SessionState`
  //    (`projectConnection` is identity), `evidence` is that same frame's retained `log`,
  //    `kind`/`membershipId`/`clockOffset` are primitives and a structural fault's
  //    evidence is the shared `NO_EVIDENCE` — all of which `dequal`'s leading `===`
  //    settles in one comparison. `failure` is the one field a DOMAIN builds, and a
  //    domain classifier naturally mints a fresh literal per call (kolu's
  //    `padiFailureOf` does). Comparing it by REFERENCE would make stability an
  //    UNENFORCED contract on every `MapRegistry`: a producer that rebuilds an equal
  //    `failure` per tick re-emits every failed member on every sibling's frame — the
  //    O(M²) this gate exists to avoid — with no compile error and no signal to go build
  //    a per-frame cache of its own. So the gate pays for the guarantee itself, once,
  //    for producers that don't exist yet.
  //
  // `dequal` (not a hand-rolled walk) because `Failure`/`Conn` are values this package
  // deliberately never enumerates: a domain's schema-validated failure may hold a `Date`
  // or a `Map` as legitimately as a string, and a JSON-only comparator would quietly get
  // those wrong. It is also allocation-light and short-circuits on `===` before touching
  // anything, which matters — this runs per member per fire.
  const samePublished = (
    a: EntryStatus<Failure, Conn>,
    b: EntryStatus<Failure, Conn>,
  ): boolean => {
    const ra = a as unknown as Record<string, unknown>;
    const rb = b as unknown as Record<string, unknown>;
    const ka = Object.keys(ra);
    const kb = Object.keys(rb);
    // Same key COUNT plus `k in rb` per key — together exactly the key-UNION test, at two
    // array allocations. The count alone would be unsound (`{p, q}` vs `{p, r}`, both
    // `undefined`, have equal counts), which is why the membership check is there; with
    // it, a key present on only one side (an arm gaining or losing an optional field)
    // re-emits. Re-emitting is always the safe direction — the gate must never MISS a
    // real change, and that is the only direction correctness depends on.
    return (
      ka.length === kb.length &&
      ka.every((k) => k in rb && dequal(ra[k], rb[k]))
    );
  };
  const unsubRepublish = registry.subscribe(() => {
    const ks = members();
    const encoded = ks.map((k) => map.codec.encode(k));
    // Prune BEFORE publishing: CLAUSE 1 guarantees a departed key is already gone
    // from `members()` here, so dropping its id now means the next re-add lazily
    // mints a FRESH one (the same-key remove/re-add → new-membershipId path).
    pruneDepartedIds(encoded);
    // Keyset: publish ONLY on a real membership change (member order is stable
    // across a status-only frame — the family never coalesces a remove/re-add — so
    // a positional compare never spuriously re-emits the same keyset).
    //
    // This is a VALUE gate, and it must not be replaced by (or folded into) the
    // per-tick keyset coalescer `@kolu/surface`'s `walkSurface` puts in front of
    // an `implementSurface` collection. That one collapses a whole tick's
    // membership edges into the tick-final set, which is safe for a collection
    // whose consumers only reconcile against whatever arrives — and NOT safe
    // here: CLAUSE 3 requires every membership transition to stay observable,
    // because `scoped.ts`'s `keyArray` disposes and rebuilds a per-key reactive
    // root on a departure, and a fresh `membershipId` is minted on the re-add.
    // A coalescer would hide a same-tick remove/re-add entirely, and the key
    // would keep a root and an id it is supposed to have lost. This map serves
    // its own `keysBus` (it never goes through `walkSurface`), so the two gates
    // are independent by construction; keep them that way.
    if (
      lastKeyset === undefined ||
      lastKeyset.length !== encoded.length ||
      encoded.some((e, i) => e !== lastKeyset?.[i])
    ) {
      lastKeyset = encoded;
      keysBus.publish(encoded);
    }
    // Forget departed members so a re-add re-emits its (fresh-membershipId) status.
    const present = new Set(encoded);
    for (const enc of [...lastPublished.keys()])
      if (!present.has(enc)) lastPublished.delete(enc);
    // Per-key: publish a member ONLY when its own published EntryStatus changed, so
    // a sibling's session frame never re-emits an unchanged entry (a new member has
    // no cached prior → its first status always publishes).
    for (const k of ks) {
      const enc = map.codec.encode(k);
      const st = statusOf(k);
      const prev = lastPublished.get(enc);
      if (prev === undefined || !samePublished(prev, st)) {
        lastPublished.set(enc, st);
        perKeyBus(enc).publish(st);
      }
    }
  });

  return {
    group: map.group,
    handlers,
    dispose: () => {
      unsubRepublish();
    },
  };
}

/** Route-set identity for a served map (D1 / review #16). A dynamically assembled
 *  `RpcGroup` carries no type-level guarantee that the handlers match it, so the
 *  match is asserted at boot, in BOTH directions. */
function assertHandlersMatchMapGroup(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
): void {
  const advertised = new Set(group.requests.keys());
  const bound = new Set(Object.keys(handlers));
  const unanswered = [...advertised].filter((t) => !bound.has(t));
  const unadvertised = [...bound].filter((t) => !advertised.has(t));
  if (unanswered.length > 0 || unadvertised.length > 0) {
    throw new Error(
      "serveSurfaceMap: the served handler set and the map's group disagree — " +
        `advertised-but-unbound: [${unanswered.join(", ")}]; ` +
        `bound-but-unadvertised: [${unadvertised.join(", ")}].`,
    );
  }
}
