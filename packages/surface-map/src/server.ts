/**
 * `serveSurfaceMap` — the SERVER half. A router transform, not a transport
 * change: every entry-member call reads its folded `mapKey`, resolves membership
 * at call time, and FORWARDS to the resolved session's entry-surface link. An
 * unknown key is a typed rejection (one-shot calls) or an immediate typed end
 * (streams); a key that leaves membership mid-stream ends its live subscriptions
 * with a TYPED end BEFORE the session is destroyed (no socket-error frame after
 * a typed end).
 *
 * Membership + status live in ONE published collection (`entries`), driven by
 * the `MapRegistry` — the source-agnostic seam any session source backs (the
 * warm ssh pool, a mock harness). Status is DERIVED from the resolved session's
 * connection state (a projection, never a second writer).
 */

import { collection } from "@kolu/surface";
import {
  collectionKeyChannel,
  collectionKeysetChannel,
} from "@kolu/surface/channel-names";
import type { SurfaceSpec } from "@kolu/surface/define";
import { resolveCellVerbs, resolveCollectionVerbs } from "@kolu/surface/define";
import {
  type CollectionHandlerDeps,
  collectionHandlers,
  inMemoryChannelByName,
} from "@kolu/surface/server";
import { ORPCError } from "@orpc/client";
import { implement } from "@orpc/server";
import type { z } from "zod";
import type {
  EntryStatus,
  FailureEvidence,
  FailureRecord,
  MembershipId,
  SurfaceMap,
} from "./define";
import { MembershipIdSchema } from "./define";
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
 *  (a live entry-surface oRPC client/link to proxy to) and (b) observe status
 *  (the session's connection state). */
export interface EntrySession<
  Prov extends "copying" | never = "copying",
  Failure = unknown,
  Conn = unknown,
> {
  /** The sum tag — switch on this, never on bare field-presence. */
  readonly kind: "session";
  /** The entry-surface oRPC client/link the map forwards member calls to
   *  (`link.surface.<member>.<verb>(input)`). */
  readonly link: unknown;
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
  switch (state.kind) {
    case "copying":
    case "connecting":
      return { kind: "warming", membershipId, connection };
    case "connected":
      return {
        kind: "connected",
        membershipId,
        clockOffset: state.clockOffset,
        connection,
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
        ? { kind: "warming", membershipId, connection }
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

/** Resolve `link.surface.<...path>` to its leaf callable. */
function leafAt(
  link: unknown,
  path: readonly string[],
): (input: unknown, opts: unknown) => unknown {
  let node: unknown = (link as { surface: unknown }).surface;
  for (const p of path) node = (node as Record<string, unknown>)[p];
  return node as (input: unknown, opts: unknown) => unknown;
}

export interface ServeSurfaceMapResult {
  /** A finalized top-level oRPC router — hand it straight to `directLink` (or a
   *  wire serve path). Serves `surface.<member>.<verb>` (key-folded, forwarded)
   *  and `surface.entries.{keys,get}` (the membership projection). Typed as
   *  `{ surface: … }` (PR3) — not `unknown` — so a host that mounts this router as a
   *  sibling (`{ surface: { …, [name]: served.router.surface } }`) reaches `.surface`
   *  with NO `as any` cast; the cast is unspellable by type, not merely deleted. */
  readonly router: { readonly surface: Record<string, unknown> };
  /** Tear down the membership republish subscription. */
  dispose(): void;
}

/** Serve a `SurfaceMap` over a `MapRegistry`. `Failure` is INFERRED from `map`'s own
 *  type — a domain map (`SurfaceMap<KS, ES, PadiEntryFailure>`) forces `registry` to
 *  resolve into that SAME narrowed `Failure`, so a registry that only emits the
 *  generic default can't silently serve a domain map (and vice versa). */
export function serveSurfaceMap<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Failure = unknown,
  Conn = unknown,
>(
  map: SurfaceMap<KS, ES, Failure, Conn>,
  registry: MapRegistry<z.infer<KS>, "copying", Failure, Conn>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;
  const keySchema = map.keySchema;
  const has = (k: K) => registry.has(k);
  const resolve = (k: K) => registry.resolve(k);
  const members = () => registry.members();

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
      // other being the wire `entryStatusSchema` parse). `parse` brands the fresh
      // uuid; a non-empty uuid always clears `.min(1)`.
      id = MembershipIdSchema.parse(crypto.randomUUID());
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

  // ── Forward one streaming member call, ending TYPED on membership loss ──
  //
  // Race the upstream iterator against a "removed" signal. On removal the map
  // RETURNS (a typed end downstream) and then closes the upstream via
  // `it.return()` — so the client sees a graceful completion, never the
  // socket-error frame a mid-flight session teardown would raise. A real
  // upstream error still propagates.
  async function* forwardStream(
    mapKey: K,
    session: EntrySession,
    path: readonly string[],
    input: unknown,
  ): AsyncGenerator<unknown> {
    const leaf = leafAt(session.link, path);
    // Install the removal watcher BEFORE the dial await. The real pool removes
    // destroy→delete→notify, so a removal that lands WHILE the dial is in flight must be
    // observed here — otherwise the `has()` gate (upstream in makeStreamHandler) and this
    // watcher straddle the await and neither catches it, and a delta/fail-through member's
    // dial rejects into a raw stub error the client can't retry. `ended` resolves the
    // instant `mapKey` leaves membership, on the dial OR in the loop.
    // `removed` LATCHES the instant THIS forward's key leaves membership. A re-add (a host
    // flap = remove+add) makes `has(mapKey)` true again under a NEW session, but this
    // forward is bound to the session CAPTURED at dial — a re-add can never un-orphan it.
    // So every guard below tests `removed`, NOT the live `has()`: otherwise a remove+readd
    // during the dial leaves `has()` true when the (captured-session) dial rejects, the
    // guard is skipped, and a raw stub error escapes (+ a live cached slot the re-add
    // reuses). `ended` resolves off the same latch.
    let removed = false;
    let onEnd!: () => void;
    const ended = new Promise<void>((res) => {
      onEnd = res;
    });
    const unsub = registry.subscribe(() => {
      if (!has(mapKey)) {
        removed = true;
        onEnd();
      }
    });
    try {
      let upstream: AsyncIterable<unknown>;
      try {
        upstream = (await leaf(input, {})) as AsyncIterable<unknown>;
      } catch (e) {
        // The dial itself rejected. If THIS forward was removed while dialing (even if a
        // re-add has since re-populated the key under a NEW session), that is the captured
        // session's destroy fallout → typed end; a genuine dial fault propagates.
        if (removed) return;
        throw e;
      }
      // Removed while the (resolved) dial was in flight → typed end before the loop.
      if (removed) return;
      const it = upstream[Symbol.asyncIterator]();
      try {
        while (true) {
          const step = await Promise.race([
            it.next().then(
              (r) => ({ kind: "item" as const, r }),
              (e) => ({ kind: "error" as const, e }),
            ),
            ended.then(() => ({ kind: "end" as const })),
          ]);
          if (step.kind === "end") return; // removed mid-stream → typed end
          if (step.kind === "error") {
            // An upstream rejection is the captured session's destroy fallout, NOT a real
            // fault, when THIS forward was removed: end TYPED so a delta member never
            // delivers a raw stub ORPCError. A genuine error (still a member) propagates.
            if (removed) return;
            throw step.e;
          }
          if (step.r.done) return; // upstream ended → typed end
          yield step.r.value;
        }
      } finally {
        await it.return?.().catch(() => {});
      }
    } finally {
      unsub();
    }
  }

  // The wire `mapKey` is ALWAYS the canonical string {@link KeyCodec.encode} produces
  // (`define.ts`'s `foldInput` folds `z.string()`, never `keySchema`) — decode it back
  // to `K` through `map.codec`, then re-validate via `keySchema.parse` (P5): a foreign
  // string a client somehow smuggled onto the wire must fail here, not silently become
  // a trusted `K`. Decoding alone isn't enough: a LENIENT codec (one that trims/case-
  // folds/aliases on `decode`) could let a NON-canonical wire spelling pass `keySchema`
  // while still mapping to a real member — and the `entries` collection subscribes its
  // per-key channel on the caller's RAW wire string (`readOne` below) while the
  // republish loop always publishes on `codec.encode`'s CANONICAL spelling (below) — two
  // different channel names for the same member, so a non-canonical spelling's stream
  // holds open and never receives an update. Assert `encode(decode(wire)) === wire`
  // here so subscribe and publish can never disagree about a member's channel name.
  const decodeCanonicalWireKey = (wire: string): K => {
    const k = keySchema.parse(map.codec.decode(wire)) as K;
    const canonical = map.codec.encode(k);
    if (canonical !== wire) {
      throw new ORPCError("MAP_KEY_NON_CANONICAL", {
        message:
          `surface-map: wire key "${wire}" is not its own canonical encoding ` +
          `(expected "${canonical}") — the codec must be re-encode-stable so ` +
          "subscribe and publish agree on one channel name",
      });
    }
    return k;
  };

  const parseMapKey = (input: unknown): K =>
    decodeCanonicalWireKey(unfoldKeyField(input) as string);

  const makeStreamHandler = (path: readonly string[]) =>
    async function* (opts: { input?: unknown }): AsyncGenerator<unknown> {
      const mapKey = parseMapKey(opts.input);
      if (!has(mapKey)) return; // absent at subscribe → immediate typed end
      const resolved = resolve(mapKey);
      if (isFault(resolved)) return; // terminal fault → typed end
      yield* forwardStream(mapKey, resolved, path, unwrapInput(opts.input));
    };

  const makeUnaryHandler =
    (path: readonly string[]) =>
    async (opts: {
      input?: unknown;
      signal?: AbortSignal;
    }): Promise<unknown> => {
      const mapKey = parseMapKey(opts.input);
      if (!has(mapKey)) {
        // A one-shot call cannot end gracefully — reject typed.
        throw new ORPCError("MAP_KEY_UNKNOWN", {
          message: `surface-map: key "${map.codec.encode(mapKey)}" is not a member`,
        });
      }
      const resolved = resolve(mapKey);
      if (isFault(resolved)) {
        throw new ORPCError("MAP_ENTRY_FAILED", {
          message: `surface-map: entry "${map.codec.encode(mapKey)}" is failed: ${JSON.stringify(resolved.failure)}`,
        });
      }
      const leaf = leafAt(resolved.link, path);
      return await leaf(
        unwrapInput(opts.input),
        opts.signal ? { signal: opts.signal } : {},
      );
    };

  // ── Build the router ─────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: oRPC's implement chain is too dynamic for our runtime walk; the folded contract carries call-site safety.
  const t = implement(map.contract as any) as any;
  const inner: Record<string, Record<string, unknown>> = {};

  for (const [member, verbs] of entryMemberVerbs(map.entry.spec)) {
    // ACCUMULATE, don't reset: a member name shared by a non-procedure primitive
    // AND a procedure namespace (padi's `session` is a cell {get,test__set} AND a
    // procedure ns {restore,import,forfeit}) is emitted TWICE by entryMemberVerbs
    // (primitives first, procedures last). A bare `inner[member] = {}` on the second
    // tuple would DROP the first's verbs — the served router would 404 `session/get`
    // while the contract (which merges, define.ts) carries it, breaking session-restore
    // on every boot. Mirror implementSurface (surface/server.ts) which merges the same
    // collision with `?? {}`, so both verb sets land in one namespace.
    inner[member] = inner[member] ?? {};
    for (const { verb, streaming } of verbs) {
      const path = [member, verb] as const;
      inner[member][verb] = t.surface[member][verb].handler(
        streaming ? makeStreamHandler(path) : makeUnaryHandler(path),
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
  const keysBus = channel<string[]>(collectionKeysetChannel("entries"));
  const perKeyBus = (encoded: string) =>
    channel<EntryStatus<Failure, Conn>>(
      collectionKeyChannel("entries", encoded),
    );

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
      const k = decodeCanonicalWireKey(encoded);
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
    name: "entries",
    keySchema: map.entriesSpec.keySchema,
    schema: map.entriesSpec.schema,
  });
  const entriesHandlers = collectionHandlers(entriesDescriptor, entriesDeps);
  inner.entries = {
    keys: t.surface.entries.keys.handler(entriesHandlers.keys),
    get: t.surface.entries.get.handler(entriesHandlers.get),
  };

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
  // Structural equality over the PUBLISHED EntryStatus — a SHALLOW compare over the
  // union of both values' own keys, deliberately NOT a hand-written field list. A
  // hand-enumerated compare has to be edited every time an arm in `define.ts` grows a
  // field, and the failure mode of forgetting is SILENT: the new field's changes stop
  // republishing (exactly what happened when the `failed` arm gained `evidence`). Over
  // the key union the gate cannot miss a field it was never told about.
  //
  // `Object.is` is the right per-field test, but it only SUPPRESSES for a producer that
  // hands back stable references: `connection` is the cached `SessionState`
  // (`projectConnection` is identity), `evidence` is that same frame's retained `log`,
  // `kind`/`membershipId`/`clockOffset` are primitives, and a structural fault's
  // evidence is the shared `NO_EVIDENCE`. `failure` is the one field a DOMAIN builds,
  // so its stability is the producer's to provide, not this gate's to assume: kolu's
  // `padiFailureOf` mints a fresh literal per call, and `serveHostMap` holds the
  // classification against the frame it classified from precisely so this compare can
  // suppress. A producer that rebuilds an equal `failure` per tick merely RE-emits —
  // safe, but it re-emits every failed member on every sibling's frame, which is the
  // O(M²) the gate exists to avoid. The gate still never MISSES a real change, which is
  // the only direction that matters for correctness. A key present on one side only
  // (an arm gaining or losing an optional field) also re-emits, same safe direction.
  const samePublished = (
    a: EntryStatus<Failure, Conn>,
    b: EntryStatus<Failure, Conn>,
  ): boolean => {
    const ra = a as unknown as Record<string, unknown>;
    const rb = b as unknown as Record<string, unknown>;
    // The UNION of both values' own keys — computed, not assumed from a matching key
    // COUNT. A count guard is only sound while a given `kind` always yields a fixed key
    // set, which is the very assumption this rewrite exists to stop relying on: `{p, q}`
    // vs `{p, r}` (both `undefined`) compare equal under a count guard and unequal over
    // the union. Over the union the gate cannot skip a key present on only one side.
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    return [...keys].every((k) => Object.is(ra[k], rb[k]));
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

  // Same shape `implementSurface` returns: a `{ surface: <router> }` fragment.
  // `directLink`/`createRouterClient` walks it directly (`.surface.<member>.<verb>`),
  // and it spreads into a host `t.router({ ...fragment })` for a wire serve path.
  const router = { surface: t.router(inner) };

  return {
    router,
    dispose: () => {
      unsubRepublish();
    },
  };
}
