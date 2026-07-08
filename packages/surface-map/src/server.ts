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
import type { EntryStatus, SurfaceMap } from "./define";
import { unfoldInput, unfoldKeyField } from "./envelope";

// ── The resolver / membership seam ──────────────────────────────────────

/** A session's connection state — the map DERIVES {@link EntryStatus} from it (a
 *  projection, never a second writer). `copying`/`connecting` project to
 *  `warming`; `connected` carries the serving process's own-clock offset at
 *  hello; `disconnected`/`failed` project to `failed(reason)`.
 *
 *  `Prov` mirrors `@kolu/surface-remote/session`'s `SessionState<Prov extends
 *  ProvisioningPhase>` split (juspay/kolu#1716) ONE LAYER UP: `"copying"` is the
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
 *  `Cause` mirrors {@link EntryStatus}'s own failure-cause discriminant, ONE layer
 *  earlier (the session's raw connection state, before {@link projectStatus}
 *  projects it onto the published `EntryStatus`). It is OPTIONAL here (unlike
 *  `EntryStatus.cause`, which is required) — a generic registry (e.g.
 *  `@kolu/surface-remote`'s `serveHostMap`, which projects a bare `SessionState`
 *  with no domain knowledge of `Cause`) may have nothing to set it to; a caller
 *  that DOES know the domain cause (padi's binders) sets it, and `projectStatus`
 *  below falls back to `"other"` when it is absent — so `EntryStatus.cause` stays
 *  honestly required (never invented text, always at least the honest catch-all). */
export type EntryConnectionState<
  Prov extends "copying" | never = "copying",
  Cause extends string = string,
> =
  | { kind: Prov }
  | { kind: "connecting" }
  | { kind: "connected"; clockOffset: number }
  | { kind: "disconnected"; reason: string; cause?: Cause }
  | { kind: "failed"; reason: string; cause?: Cause };

/** A resolved, serveable entry. Carries what the map needs to (a) FORWARD calls
 *  (a live entry-surface oRPC client/link to proxy to) and (b) observe status
 *  (the session's connection state). */
export interface EntrySession<
  Prov extends "copying" | never = "copying",
  Cause extends string = string,
> {
  /** The entry-surface oRPC client/link the map forwards member calls to
   *  (`link.surface.<member>.<verb>(input)`). */
  readonly link: unknown;
  /** The session's current connection state — read fresh on each publish; the
   *  registry re-fires `subscribe` when it changes so `entries` re-projects. */
  readonly state: EntryConnectionState<Prov, Cause>;
}

/** A terminal, no-session entry — a structural fault (no drv for arch, a bogus
 *  host) or the mock harness's failed member. Publishes `failed(reason)`
 *  directly. */
export interface EntryFault {
  readonly failed: string;
}

/** The membership + resolution seam. ONE writer (the pool / the harness).
 *
 *  - CLAUSE 1 (ordering): `onChange` fires only AFTER `members()`/`has()` reflect
 *    the change.
 *  - CLAUSE 2 (snapshot): `members()` and `has()` answer from ONE consistent view.
 *  - Status is DERIVED from the resolved session's state (projection). */
export interface MapRegistry<
  K,
  Prov extends "copying" | never = "copying",
  Cause extends string = string,
> {
  members(): K[];
  subscribe(onChange: () => void): () => void;
  has(key: K): boolean;
  resolve(key: K): EntrySession<Prov, Cause> | EntryFault;
}

function isFault(r: EntrySession | EntryFault): r is EntryFault {
  return "failed" in r;
}

/** Project a session's connection state onto the published {@link EntryStatus}.
 *  `state.cause` is OPTIONAL ({@link EntryConnectionState}'s doc) — a registry with
 *  no domain cause to set falls back to `"other"`, the ONE `Cause` member every
 *  domain instantiation is expected to carry as its catch-all (see
 *  `EntryFailedCause` in `kolu-common/surfacesWithPadi`) — so `EntryStatus.cause`
 *  stays honestly required (never invented text) without forcing every session
 *  producer to classify a cause it may not know. Extra fields `state` carries
 *  beyond `reason`/`cause` (padi's D2 typed `running`/`expected` version pair on
 *  `contract-skew-refused`) ride through via the spread — this generic layer
 *  doesn't need to know their shape to preserve them. */
function projectStatus<Cause extends string = string>(
  state: EntryConnectionState<"copying", Cause>,
): EntryStatus<Cause> {
  switch (state.kind) {
    case "copying":
    case "connecting":
      return { kind: "warming" };
    case "connected":
      return { kind: "connected", clockOffset: state.clockOffset };
    case "disconnected":
    case "failed": {
      const { kind: _kind, cause, ...rest } = state;
      return { kind: "failed", cause: cause ?? ("other" as Cause), ...rest };
    }
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
   *  and `surface.entries.{keys,get}` (the membership projection). */
  readonly router: unknown;
  /** Tear down the membership republish subscription. */
  dispose(): void;
}

/** Serve a `SurfaceMap` over a `MapRegistry`. `Cause` is INFERRED from `map`'s own
 *  type — a domain map (`SurfaceMap<KS, ES, PadiEntryFailedCause>`) forces
 *  `registry` to resolve into that SAME narrowed `Cause`, so a registry that only
 *  ever emits the generic default can't silently serve a domain map (and vice
 *  versa). */
export function serveSurfaceMap<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Cause extends string = string,
>(
  map: SurfaceMap<KS, ES, Cause>,
  registry: MapRegistry<z.infer<KS>, "copying", Cause>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;
  const keySchema = map.keySchema;
  const has = (k: K) => registry.has(k);
  const resolve = (k: K) => registry.resolve(k);
  const members = () => registry.members();

  // A structural fault (no session at all — an unknown host, the mock harness's
  // failed member) has no domain cause to report; `"other"` is the ONE `Cause`
  // member every domain instantiation is expected to carry as its catch-all (see
  // `EntryConnectionState`'s doc on the same fallback one layer up).
  const statusOf = (mapKey: K): EntryStatus<Cause> => {
    const r = resolve(mapKey);
    return isFault(r)
      ? { kind: "failed", reason: r.failed, cause: "other" as Cause }
      : projectStatus<Cause>(r.state);
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
        throw new ORPCError("MAP_ENTRY_FAILED", { message: resolved.failed });
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
    channel<EntryStatus<Cause>>(collectionKeyChannel("entries", encoded));

  const entriesDeps: CollectionHandlerDeps<string, EntryStatus<Cause>> = {
    readAll: () =>
      new Map(
        members().map(
          (k) =>
            [map.codec.encode(k), statusOf(k)] as [string, EntryStatus<Cause>],
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
  const entriesDescriptor = collection<"entries", string, EntryStatus<Cause>>({
    name: "entries",
    keySchema: map.entriesSpec.keySchema,
    schema: map.entriesSpec.schema,
  });
  const entriesHandlers = collectionHandlers(entriesDescriptor, entriesDeps);
  inner.entries = {
    keys: t.surface.entries.keys.handler(entriesHandlers.keys),
    get: t.surface.entries.get.handler(entriesHandlers.get),
  };

  // One writer publishes membership + status together — fire on every registry
  // change (add/remove membership AND per-session status transitions).
  const unsubRepublish = registry.subscribe(() => {
    const ks = members();
    const encoded = ks.map((k) => map.codec.encode(k));
    keysBus.publish(encoded);
    for (const k of ks) perKeyBus(map.codec.encode(k)).publish(statusOf(k));
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
