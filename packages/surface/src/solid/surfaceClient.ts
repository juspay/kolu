/**
 * `surfaceClient` — typed client-side surface generated from a `Surface`.
 *
 * Walks `surface.descriptors` once and pre-binds each Cell/Collection/Stream/Event
 * to its typed oRPC procedure refs, exposing a `.use(policy)` hook per
 * primitive that drops `source` / `mutate` / `valueSource` / `keyToInput`
 * from the per-call args. Declared imperative procedures are bound and typed at
 * `client.procedures.<ns>.<verb>(...)`; `client.rpc` remains for the reserved
 * framework procedures (`system.*`) and the link-root escape hatch.
 *
 * Type narrowing for `useCell` (server- vs local-authority discriminator)
 * is preserved across the bind: the bound `.use()` accepts the same
 * `UseCellOptions` union, just with `source` / `mutate` already filled in.
 */

import { Effect } from "effect";
import {
  type Accessor,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
} from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import {
  buildSurfaceFace,
  type StreamingProcedure,
  type SurfaceCallFailure,
  type SurfaceFace,
  type UnaryEffect,
  unenrolledStreamCall,
} from "../client";
import type {
  CellHasPatchVerb,
  CellIsMutable,
  CellSpec,
  CollectionDeltasMsg,
  CollectionSpec,
  CollectionVerbsOf,
  EventSpec,
  ProcedureSpec,
  ProcedureSpecError,
  StreamSpec,
  Surface,
  SurfaceSpec,
  WireSchemaAny,
} from "../define";
import {
  collectionHasDeltas,
  resolveCellVerbs,
  scopeSiblingTag,
} from "../define";
import { isHalfOpenDispatch, type SurfaceDispatch } from "../link";
import { runStreamScoped } from "../runStream";
import type { ReactiveSubscriptionOptions } from "./createReactiveSubscription";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
  wireSubscriptionError,
} from "./createSubscription";
import {
  createSurfaceHealthRegistry,
  type HealthSource,
  mergeSurfaceHealth,
  type SurfaceHealth,
} from "./health";
import {
  createKeyedSubscriptionCache,
  type KeyedSubscriptionCache,
  runUnderOwner,
  stableOptsKey,
} from "./keyedSubscriptionCache";
import { isLiveSignalHandle, type LiveSignalHandle } from "./liveSignal";
import { type UseCellResult, useCell } from "./useCell";
import {
  type UseCollectionResult,
  useCollection,
  useCollectionDeltas,
} from "./useCollection";
import { type UseEventOptions, useEvent } from "./useEvent";
import { useStream } from "./useStream";

/** The ORIGIN-FREE client error interpreter — the seam the app registers so a
 *  spec-declared `client.onError` policy (see `ClientCellPolicy` /
 *  `ClientCollectionPolicy` in `../define`) reaches app code when a member's
 *  client subscription fails. `policy` is the OPAQUE, app-typed value the member
 *  declared (the framework never inspects it); `err` is the subscription error.
 *
 *  Base @kolu/surface is DELIBERATELY origin-free — `origin` (a `{ key }`) is a
 *  surface-map concept, injected in `@kolu/surface-map`'s `connectSurfaceMap` by
 *  wrapping THIS interpreter per key (design §B/§C). So this base type never
 *  names a key; a keyed map's per-key builder closes the key over the wrapper it
 *  hands to `buildSurfaceClient`. */
export type OnClientError = (policy: unknown, err: Error) => void;

/** Resolve the transport argument `surfaceClient`/`surfaceClients` were handed into
 *  the `{ dispatch, live }` the bundle is built over — collapsing the pair at the API
 *  so there is nothing to re-prove at runtime:
 *
 *   - A {@link LiveSignalHandle} (the only honest shape over a half-openable wire):
 *     read `.dispatch` and `.live` straight off it. They were minted together by
 *     `createLiveSignal`, which refuses any pairing a wire link factory did not mint
 *     and wires the watchdog before branding, so the live↔dispatch pairing holds BY
 *     CONSTRUCTION — the "watch wire A, dispatch over wire B" forge is unspellable
 *     because no caller supplies a separate dispatch.
 *   - A bare half-openable WIRE dispatch (websocket, stdio, unix socket): CRASH. Any
 *     wire transport can half-open silently (a websocket socket stays `open` with no
 *     bytes flowing; a stdio/ssh pipe wedges or partitions with no FIN), so its
 *     `health().live` is a LIE unless a watchdog probes it — and the watchdog rides
 *     on the handle. Passing the bare dispatch drops the watchdog, so refuse it: pass
 *     the `LiveSignalHandle` `createLiveSignal`/`connectSurface`/`connectSurfaces`
 *     returns instead. (The brand is applied at the ONE seam every wire link crosses,
 *     so a future wire link is refused too.)
 *   - Any dispatch NOT branded half-open: constant-`true`. The honest member is the
 *     in-process `directDispatch` (no transport, can't half-open) — honest by
 *     construction, and positively branded as such. This branch is reached BY
 *     EXCLUSION, though, so it also covers any other unbranded value: a test stub
 *     dispatch, or — discouraged — a hand-rolled foreign dispatch over a websocket
 *     (one that bypasses the link factories and so skips the brand). That last
 *     spelling is a deliberate, documented RESIDUAL (#1580): every blessed link
 *     factory brands via the one chokepoint, so no realistic consumer reaches this
 *     with a half-openable dispatch; closing it structurally (accepting ONLY a
 *     direct-branded dispatch) would refuse the legitimate stub-dispatch health-fold
 *     tests consumers build over `surfaceClient` — whose only other build path,
 *     `buildSurfaceClient`, is deliberately framework-composition-only — so it stays
 *     a by-exclusion fallback the chokepoint plus convention discourage.
 *
 *  Fail-fast per the repo's "no silent fallback / crash loudly" philosophy: a
 *  half-open-blind transport leg is unspellable over every wire dispatch built through
 *  the blessed factories — there is no `{ live }` knob to pass a blind accessor
 *  through (the #1564 lie, one seam upstream of the dot). */
export function resolveTransport(transport: unknown): {
  dispatch: SurfaceDispatch;
  live: Accessor<boolean>;
} {
  if (isLiveSignalHandle(transport)) {
    return { dispatch: transport.dispatch, live: transport.live };
  }
  if (isHalfOpenDispatch(transport)) {
    throw new Error(
      "surfaceClient: this dispatch crosses a wire transport that can silently " +
        "half-open (a websocket socket stays `open` with no bytes flowing; a stdio " +
        "or unix-socket pipe wedges or partitions with no FIN), so its transport " +
        "liveness must be a watchdog-backed `LiveSignalHandle`, not a bare dispatch. " +
        "For a WEBSOCKET, build the client through `connectSurface`/`connectSurfaces` " +
        "— or, hand-built, use `createLiveSignal(transport)` from `@kolu/surface/solid` " +
        "and pass the WHOLE handle it returns: it probes the reserved `system/live` " +
        "member over the very dispatch it guards AND wires the watchdog, with " +
        "`dispatch` and `live` paired on one object; the handle has no other minter. " +
        "For a STDIO/UNIX-SOCKET dispatch, wire a `createHeartbeat` + " +
        "`probeSurfaceLive` watchdog over `system/live` as `surface-remote`'s " +
        "`hostSession.startLiveness` does. A bare `() => true` or an open/close-only " +
        "`() => wireStatus() === 'open'` is half-open-blind — it would paint a " +
        "green/ready dot over a dead backend↔remote link (#1564).",
    );
  }
  // Unbranded as half-open: the honest member is the in-process `directDispatch` (no
  // wire transport, a microtask-deferred handler call), whose constant-`true` leg is
  // honest by construction. Reached BY EXCLUSION, so it also covers any other
  // unbranded value (a test stub dispatch); see the docstring's residual note.
  return { dispatch: transport as SurfaceDispatch, live: () => true };
}

// ── Bound-primitive option shapes ──────────────────────────────────────

/** Cell `.use()` options — same shape as `UseCellOptions` minus the
 *  `source` and `mutate` refs (the surface supplies them). The
 *  authority/initial/applyPatch discriminator is preserved verbatim. */
export type BoundCellOptions<T, P = T> = T extends object
  ?
      | { authority?: "server"; onError?: (err: Error) => void }
      | {
          authority: "local";
          initial: T;
          applyPatch?: (current: T, patch: P) => T;
          mergeIntoStore?: (setStore: SetStoreFunction<T>, patch: P) => void;
          coalesceMs?: number;
          onError?: (err: Error) => void;
        }
  : { authority?: "server"; onError?: (err: Error) => void };

export interface BoundCell<T, P = T> {
  use(opts?: BoundCellOptions<T, P>): UseCellResult<T, P>;
}

/** `.use()` options for a READ-ONLY cell (`verbs: ["get"]`) — server
 *  subscription only. No `authority: "local"` branch: a get-only cell has no
 *  wire mutation verb, so the local-authority path (which `set`s back to the
 *  server) would resolve to a `mutate` the contract router doesn't carry. */
export interface ReadOnlyBoundCellOptions {
  onError?: (err: Error) => void;
}

/** The reactive view a read-only cell yields — value/pending/error/sub WITHOUT
 *  `set` / `patch`. The runtime dual: `surfaceClient` binds no `mutate` for a
 *  get-only cell, so a `set`/`patch` would throw "no mutate handler" anyway;
 *  hiding them at the type keeps the client API honest about the wire contract
 *  (the client-side half of {@link CellVerbsOf} honoring `verbs`). */
export interface ReadOnlyUseCellResult<T>
  extends Pick<
    UseCellResult<T, never>,
    "value" | "pending" | "error" | "sub"
  > {}

export interface ReadOnlyBoundCell<T> {
  use(opts?: ReadOnlyBoundCellOptions): ReadOnlyUseCellResult<T>;
}

/** Bound collection result — `useCollection`'s reactive view augmented
 *  with imperative mutations (`upsert`, `delete`) so consumers don't
 *  reach for `app.rpc.surface.<key>.{upsert,delete}` from event handlers.
 *
 *  The default keys-stream's own error is NOT re-exposed here: it is enrolled
 *  into `client.health()` as `"<key>.keys"` (Leak B), so a keys-stream 500 —
 *  which collapses `keys()` to a silent empty set — surfaces through the one
 *  health FACT alongside every per-key sub's error, instead of a parallel
 *  per-collection accessor a consumer has to remember to read. */
export interface BoundCollectionResult<K, T> extends UseCollectionResult<K, T> {
  upsert: (key: K, value: T) => Effect.Effect<void, unknown>;
  delete: (key: K) => Effect.Effect<void, unknown>;
}

export interface BoundCollection<K, T> {
  /** Reactive view. `keys` defaults to a subscription on the server's
   *  `keys` stream — pass it explicitly only to filter or derive (e.g.
   *  Kolu's `useTerminalMetadata` derives keys from the terminal list).
   *
   *  Result re-exposes `upsert` / `delete` for ergonomic in-component
   *  handler closures; the same fns live on this `BoundCollection`
   *  itself for lifecycle-free call sites. */
  use(opts?: {
    keys?: Accessor<K[]>;
    onError?: SubscriptionOptions<unknown>["onError"];
  }): BoundCollectionResult<K, T>;
  /** Imperative wire mutations, as `Effect`s. Available outside any component
   *  lifecycle — compose them into a command handler's program, a route loader,
   *  anywhere. A Solid event handler runs one at its own UI edge (kolu spells that
   *  `runAction`), which is where the Effect→DOM boundary belongs. */
  upsert(key: K, value: T): Effect.Effect<void, unknown>;
  delete(key: K): Effect.Effect<void, unknown>;
}

/** The raw keys-stream ref for a DELIBERATELY UN-ENROLLED reach —
 *  `unenrolledStreamCall(client.collections.<key>.unenrolledKeys, undefined,
 *  { signal })`.
 *
 *  `.use()` is the DEFAULT: it opens the keys stream (plus a value stream per
 *  key) and enrols them into `client.health()`. Reach for `.unenrolledKeys` ONLY
 *  when the key list must be watched OUTSIDE the health fact — the #1591 carve-out
 *  where the keys stream drives a retained per-host view and its re-subscribe must
 *  not flicker the gate; the raw list is then fed back as the explicit `keys`
 *  accessor of a `.use({ keys })` so the per-key value subs still enrol. Typed
 *  from the declaration — no cast.
 *
 *  STRUCTURALLY PRESENT only when the collection actually declares the `keys`
 *  verb (see {@link BoundCollectionsFor}): a collection whose `verbs` omit `keys`
 *  has NO keys stream on the wire, so exposing `unenrolledKeys` would type a
 *  callable that resolves to `undefined` at runtime — the collection dual of
 *  {@link CellIsMutable} gating `.set`/`.patch`. */
export interface UnenrolledKeys<K> {
  readonly unenrolledKeys: StreamingProcedure<undefined, K[]>;
}

/** The raw batched `deltas`-stream ref for a DELIBERATELY UN-ENROLLED reach —
 *  `unenrolledStreamCall(client.collections.<key>.unenrolledDeltas, undefined,
 *  { signal })`. The `deltas` twin of {@link UnenrolledKeys} (SR5), added for the
 *  IDENTICAL reason SR2 added `unenrolledKeys`: the deliberately no-health carve-out
 *  ([#1591](https://github.com/juspay/kolu/issues/1591)) must be expressible in the
 *  batched deltas protocol too.
 *
 *  `.use()` is the DEFAULT: for a `deltas`-declaring collection it opens the ONE
 *  coalesced snapshot-then-delta stream and enrols it into `client.health()`. Reach
 *  for `.unenrolledDeltas` ONLY when the whole set must be watched OUTSIDE the health
 *  fact — a per-host view whose re-subscribe must not flicker the gate, whose dead
 *  feed surfaces via the subscription's OWN reactive `error()`. The raw
 *  `CollectionDeltasMsg<K, T>` frames are then folded by the consumer (same protocol
 *  the framework's `foldCollectionDeltas` uses). Typed from the declaration — no cast.
 *
 *  STRUCTURALLY PRESENT only when the collection actually declares the `deltas` verb
 *  (see {@link BoundCollectionsFor}): a collection whose `verbs` omit `deltas` has NO
 *  deltas stream on the wire, so exposing `unenrolledDeltas` would type a callable
 *  that resolves to `undefined` at runtime — exactly as {@link UnenrolledKeys} gates
 *  on the `keys` verb. */
export interface UnenrolledDeltas<K, T> {
  readonly unenrolledDeltas: StreamingProcedure<
    undefined,
    CollectionDeltasMsg<K, T>
  >;
}

/** A READ-ONLY bound collection — the mutation verbs (`upsert`/`delete`) are
 *  STRUCTURALLY ABSENT, both at the top level and on the `.use()` result. A consumer of
 *  a server-authored, one-writer collection (a surface-map `entries` membership
 *  authority) therefore cannot even EXPRESS a client mutation the wire would reject:
 *  `entries.upsert(...)` is a type error, not a runtime rejection. The collection
 *  analogue of `ReadOnlyBoundCell`. */
export type ReadOnlyBoundCollectionResult<K, T> = UseCollectionResult<K, T>;
export interface ReadOnlyBoundCollection<K, T> {
  use(opts?: {
    keys?: Accessor<K[]>;
    onError?: SubscriptionOptions<unknown>["onError"];
  }): ReadOnlyBoundCollectionResult<K, T>;
}

export interface BoundStream<I, T> {
  use(
    inputFn: () => I | null,
    opts?: ReactiveSubscriptionOptions,
  ): Subscription<T>;
  /** The raw streaming-procedure ref for a DELIBERATELY UN-ENROLLED reach —
   *  `unenrolledStreamCall(client.streams.<key>.unenrolled, input, { signal })`.
   *
   *  `.use()` is the DEFAULT: it drives the stream AND enrols its `pending`/`error`
   *  into `client.health()`, so the transport-health gate sees it. Reach for
   *  `.unenrolled` ONLY for the narrow carve-out class that must NOT flicker that
   *  gate — a stream whose transient re-subscribe is normal and self-healing (a
   *  terminal re-attach, #1591; a change-pulse that drives a requery) and so must
   *  stay OUT of the health fact. The `unenrolled` name (matched by
   *  `unenrolledStreamCall`) keeps that health carve-out legible at the call site;
   *  it is not a casual bypass of `.use()`. Typed from the declaration — no cast,
   *  no full-contract client copy. */
  readonly unenrolled: StreamingProcedure<I, T>;
}

export interface BoundEvent<I, T> {
  use(
    inputFn: () => I | null,
    handler: (value: T) => void,
    opts: UseEventOptions,
  ): void;
}

/** The bound face's declared-FAILURE type: the decoded union of the spec's
 *  `error` schema, or `never` when the procedure declares no failures (define.ts's
 *  shared {@link ProcedureSpecError} extractor resolves `Schema.Never` there). A
 *  declared error travels as a `Schema.TaggedError` INSTANCE — `_tag` and data
 *  intact across every hop — so a caller narrows it with `Effect.catchTag`, a `_tag`
 *  switch or an `instanceof`, never a magic-code compare. */
type BoundProcedureError<S> = ProcedureSpecError<S>["Type"];

/** A bound procedure's result — an `Effect` carrying the spec's declared error
 *  union in a real channel the compiler tracks through every `catchTag`,
 *  `catchAll` and `orDie`.
 *
 *  `E` is the spec's DECLARED union alone; {@link SurfaceCallFailure} — Effect
 *  RPC's transport error plus the framework's own tagged vocabulary — is unioned
 *  in here, because a call CAN fail that way and a channel that omitted it would
 *  let a consumer believe `catchTag`-ing its declared tags left nothing to handle.
 *  A caller that genuinely wants "any failure is fatal" writes `Effect.orDie`, and
 *  says so. */
export type ProcedureEffect<T, E> = Effect.Effect<T, E | SurfaceCallFailure>;

/** A bound imperative procedure — a declaration-typed callable at
 *  `client.procedures.<ns>.<verb>(input)`. It IS the member call at the wire tag
 *  `surface/<ns>/<verb>`, re-exposed so the bound face is symmetric with
 *  `cells`/`collections`/`streams`/`events`. Input/output are inferred from the
 *  {@link ProcedureSpec} schemas — absent `input` ⇒ input-less, absent `output` ⇒
 *  `Effect<void>` — the exact arms the runtime `Rpc` derivation resolves through
 *  `ProcedureInputSchema`/`ProcedureOutputSchema`, so the bound signature and the
 *  wire shape can't drift. Deliberately a NARROW mapped type: recovering the
 *  callable shape by hand is what lets a generically-`unknown` map-entry face gain
 *  a typed procedure surface WITHOUT tripping the TS2590 "union too complex" a wide
 *  client type does under a generic entry spec. `effectProcedure.test-d.ts` pins the
 *  ladder against `SurfaceRpcsFor` — the type-level image of the runtime `Rpc` walk
 *  — so the two cannot drift.
 *
 *  **The input arm is the ENCODED side (`Schema["Encoded"]`), the success arm the
 *  DECODED side (`Schema["Type"]`)** — D2/#13. A schema carrying a decoding default
 *  makes a key OMITTABLE on the wire but REQUIRED after decode, and a transforming
 *  schema changes the type across the parse; typing the input decoded would demand
 *  arguments the wire does not need and reject the raw ones it does. The face
 *  decodes the argument at its edge (`buildSurfaceFace`), which is exactly where
 *  zod's `.parse`-at-input used to run.
 *
 *  There is no second `options` argument. A unary call carries no `signal` under
 *  Effect (cancellation is fiber interruption, D10/#18) and no retry context (a
 *  write is never retried), so the only honest signature is `(input) => …`.
 *
 *  This is the face a caller COMPOSES with: a deadline, a race, a
 *  supersede-on-new-input or a Ctrl-C are combinators here, where the Promise-shaped
 *  row this replaced needed a hand-rolled `AbortController` alongside it that an
 *  `await` could not honour anyway. */
export type EffectProcedure<
  // biome-ignore lint/suspicious/noExplicitAny: mirrors `BoundProcedure`'s constraint — the concrete arms below narrow via `infer`.
  S extends ProcedureSpec<any, any>,
> = S extends {
  input: infer In extends WireSchemaAny;
  output: infer Out extends WireSchemaAny;
}
  ? (
      input: In["Encoded"],
    ) => ProcedureEffect<Out["Type"], BoundProcedureError<S>>
  : S extends { input: infer In extends WireSchemaAny }
    ? (input: In["Encoded"]) => ProcedureEffect<void, BoundProcedureError<S>>
    : S extends { output: infer Out extends WireSchemaAny }
      ? (
          input?: undefined,
        ) => ProcedureEffect<Out["Type"], BoundProcedureError<S>>
      : (input?: undefined) => ProcedureEffect<void, BoundProcedureError<S>>;

type EffectProceduresFor<S extends SurfaceSpec> = {
  [NS in keyof S["procedures"] & string]: {
    [V in keyof NonNullable<S["procedures"]>[NS] & string]: EffectProcedure<
      NonNullable<S["procedures"]>[NS][V]
    >;
  };
};

/** Options for `client.rawStream` — the structural raw-stream path. */
export interface RawStreamOptions<O> {
  /** Called for each frame the stream yields. */
  onItem: (item: O) => void;
  /** Called before each transparent re-subscribe (reconnect), mirroring
   *  `unenrolledStreamCall`'s `onRetry` — clear any derived view that would
   *  otherwise double-paint. The stream returns to `pending` for the gap. */
  onRetry?: () => void;
  /** Classify an error as an EXPECTED stop (a deliberate teardown / cleanup
   *  abort) that must NOT register as a health error — e.g. xterm's
   *  `isExpectedCleanupError`. The owner's own abort is always treated as
   *  expected. */
  isExpectedStop?: (err: unknown) => boolean;
}

// ── Bundle type — mapped over the surface spec ──────────────────────────

type BoundCellsFor<S extends SurfaceSpec> = {
  [K in keyof S["cells"] & string]: NonNullable<S["cells"]>[K] extends CellSpec<
    infer T,
    infer P,
    unknown
  >
    ? // A get-only cell (no wire mutation verb) gets a read-only bound type —
      // no `.set` / `.patch` / local-authority path the contract router lacks.
      CellIsMutable<NonNullable<S["cells"]>[K]> extends false
      ? ReadOnlyBoundCell<T>
      : // A cell that mutates via `patch` carries the `patchSchema` payload `P`,
        // so its bound shape is `BoundCell<T, P>` (`.set(T)` + `.patch(P)`). A
        // cell that mutates via `set` alone has NO `P`-shaped wire procedure —
        // even if it declares a `patchSchema`, the only mutation endpoint is the
        // full-value `set`. Collapse its client patch shape to `T` so `.patch`
        // posts a full value (sound against `set`), never a partial `P` the
        // `set` endpoint would reject.
        CellHasPatchVerb<NonNullable<S["cells"]>[K]> extends true
        ? BoundCell<T, P>
        : BoundCell<T, T>
    : never;
};

type BoundCollectionsFor<S extends SurfaceSpec> = {
  [K in keyof S["collections"] & string]: NonNullable<
    S["collections"]
  >[K] extends CollectionSpec<infer K2, infer T, unknown>
    ? // `unenrolledKeys` / `unenrolledDeltas` are each added ONLY when their verb is
      // declared — the raw ref has nothing to point at otherwise (the contract router
      // binds no such stream), so a collection missing the verb must not type an
      // `undefined`-resolving callable. The two gate independently and compose (a
      // collection may declare both, one, or neither).
      BoundCollection<K2, T> &
        ("keys" extends CollectionVerbsOf<NonNullable<S["collections"]>[K]>
          ? UnenrolledKeys<K2>
          : // biome-ignore lint/complexity/noBannedTypes: the empty intersection for an absent gate.
            {}) &
        ("deltas" extends CollectionVerbsOf<NonNullable<S["collections"]>[K]>
          ? UnenrolledDeltas<K2, T>
          : // biome-ignore lint/complexity/noBannedTypes: the empty intersection for an absent gate.
            {})
    : never;
};

// A stream's / event's INPUT is the one position on these two primitives that is a
// pure ARGUMENT — the client never holds it, only forwards it — so it is typed on
// the ENCODED side and decoded at the face edge (D2/#13), exactly like a
// procedure's input. The OUTPUT is decoded: it is the value the consumer renders.
type BoundStreamsFor<S extends SurfaceSpec> = {
  [K in keyof S["streams"] & string]: NonNullable<
    S["streams"]
    // biome-ignore lint/suspicious/noExplicitAny: the spec constraint erases the decoded input type; the encoded side is read off the schema instead.
  >[K] extends StreamSpec<any, infer T>
    ? BoundStream<NonNullable<S["streams"]>[K]["inputSchema"]["Encoded"], T>
    : never;
};

type BoundEventsFor<S extends SurfaceSpec> = {
  [K in keyof S["events"] & string]: NonNullable<
    S["events"]
    // biome-ignore lint/suspicious/noExplicitAny: see BoundStreamsFor.
  >[K] extends EventSpec<any, infer T>
    ? BoundEvent<NonNullable<S["events"]>[K]["inputSchema"]["Encoded"], T>
    : never;
};

export interface SurfaceClient<S extends SurfaceSpec> {
  /** The nested member face this bundle was built over — `rpc.surface.<ns>.<verb>`.
   *  Reserved for the RESERVED framework members (`system.live` / `system.identity`
   *  / `system.clockNow`, which the three probes walk structurally) and as the
   *  escape hatch for a member the bound shapes can't model. DECLARED imperative
   *  procedures ride the bound `.procedures.<ns>.<verb>(input)` face below (typed
   *  straight from the spec, no cast).
   *
   *  Typing note: this face is STRUCTURAL, not spec-derived — per-member precision
   *  lives in the bound `.cells`/`.collections`/`.streams`/`.events`/`.procedures`
   *  faces, which is D2's rule ("type the face from the spec"). Materialising a
   *  second precise mapped type over the same spec, in the same evaluation pass, is
   *  the union-budget blowup D2 exists to avoid. */
  readonly rpc: SurfaceFace;
  readonly cells: BoundCellsFor<S>;
  readonly collections: BoundCollectionsFor<S>;
  readonly streams: BoundStreamsFor<S>;
  readonly events: BoundEventsFor<S>;
  /** The declared imperative procedures, bound to the link and typed from the
   *  declaration — `client.procedures.<ns>.<verb>(input)`, each a composable
   *  `Effect` carrying the spec's DECLARED error union (plus the framework's own
   *  {@link SurfaceCallFailure}) in a channel the compiler tracks. The typed dual
   *  of the reactive `.use()` primitives for the surface's non-descriptor RPCs: a
   *  consumer reaches a declared procedure here WITHOUT casting the raw `.rpc`
   *  client or copying its callable shape.
   *
   *  Because the call is a description rather than a running promise, everything a
   *  consumer used to hand-roll around it is a combinator: a deadline, a fold over
   *  several members, a request superseded by the next one, a Ctrl-C that must
   *  actually stop the wait.
   *
   *  Reserved framework procedures (`system.live` / `system.identity`) are
   *  contract-only — never in `spec.procedures` — so they do NOT appear here; reach
   *  them (and the link-root escape hatch) through `.rpc`. */
  readonly procedures: EffectProceduresFor<S>;
  /** The subscription-health FACT — the `system.live` twin (`./health`). Reads
   *  every enrolled subscription's self-clearing `error()`/`pending()` plus the
   *  transport `live`, so a consumer reads ONE fact instead of hand-folding the
   *  per-sub errors (the fold that latched in #1564). A reactive accessor: read
   *  it inside a tracking scope (a memo, JSX, `<SurfaceGate>`). Policy — what
   *  "ready" means — is the consumer's, not this fact's. */
  health(): SurfaceHealth;
  /** Enrol an owner-managed subscription's OWN `pending`/`error` into this
   *  client's health fact. The framework birth sites (cells, collection
   *  keys-stream + per-key, streams) enrol automatically, and `rawStream` enrols
   *  for you; this lower-level hook is for a subscription that already owns its
   *  `pending`/`error` signals (a derived/composed sub) and just needs to JOIN the
   *  fact. Returns a disposer; also auto-drops via `onCleanup`. */
  enroll(name: string, source: HealthSource): () => void;
  /** Drive a raw streaming procedure with its health enrolled STRUCTURALLY — the
   *  blessed path for a surface-scoped stream that doesn't fit a Cell/Collection/
   *  Stream descriptor (a bulk snapshot feed, a binary attach). Unlike a bare
   *  `unenrolledStreamCall`, this CANNOT bypass `health()`: it owns the `pending`/`error`
   *  signals, enrols them under `name`, runs the consume loop (self-clearing on
   *  each frame, recording on failure — the same edge `createSubscription` has),
   *  and ties an `AbortController` to the owner. It THROWS if called outside a
   *  reactive owner — the enrolment must auto-dispose, so a no-owner call is a
   *  structural error (mirroring `createSubscription`'s `reduce`-without-`initial`
   *  throw), never a silent leak. Returns the same `{ pending, error }` it enrols,
   *  for the caller's own per-stream UI. The one way to drive a raw stream and
   *  still be in `health()`; the bare `unenrolledStreamCall`
   *  (`@kolu/surface/client`) is the low-level primitive for a stream that is NOT
   *  a surface subscription (a root RPC), where you enrol by hand or deliberately
   *  carve it out — its name flags the absence of enrolment at the call site. */
  rawStream<I, O>(
    name: string,
    procedure: StreamingProcedure<I, O>,
    input: I,
    opts: RawStreamOptions<O>,
  ): HealthSource;
  /** Tear down the client's BUILD-TIME standing subscriptions — the eager
   *  `liveWhen`-cell readiness subs `surfaceClient` opens so the mirror-liveness
   *  leg folds into `health().live` by construction (not at `.use()` time). A
   *  client with no `liveWhen` cell opens none, so `dispose()` is a no-op. A
   *  page-lifetime cached client (drishti's per-host) never needs to call
   *  it; the `connectSurface`/`connectSurfaces` seams fold it into THEIR dispose
   *  so a torn-down socket doesn't leak its readiness consume loop. */
  dispose(): void;
}

// ── Builder ────────────────────────────────────────────────────────────

/** Read one member's verb map off the nested face, or CRASH.
 *
 *  The face is built by `buildSurfaceFace` from the SAME `surface.spec` these
 *  binds walk, so an absent member cannot be a runtime condition — it can only mean
 *  the two walks disagree, i.e. a framework bug. Fail loudly rather than hand back
 *  `undefined` and surface it three frames later as "ns.get is not a function".
 *  (The oRPC-era binds deferred this deref behind lazy getters so a hand-built
 *  PARTIAL mock link was tolerated; the face is no longer caller-supplied, so there
 *  is nothing partial to tolerate — a test stubs the DISPATCH, one layer down.) */
function memberOf(face: SurfaceFace, key: string): Record<string, unknown> {
  const ns = face.surface[key];
  if (ns === undefined) {
    throw new Error(
      `surfaceClient: the face carries no member "${key}", but ` +
        "the spec declares it — the face walk and the bind walk disagree, which " +
        "is a framework bug.",
    );
  }
  return ns;
}

/** Build the Solid client-side bundle for a surface over a **transport** — either
 *  a {@link LiveSignalHandle} (a half-openable wire dispatch plus the watchdog that
 *  makes its liveness honest, as ONE object) OR a bare in-process `directDispatch`
 *  (no transport, the ONE dispatch that can't half-open). A bare wire dispatch —
 *  websocket, stdio, unix socket — CAN half-open and is REFUSED bare (it throws:
 *  pass the handle, or hand-wire a watchdog as `surface-remote`'s
 *  `hostSession.startLiveness` does). Walks the spec once and pre-binds each
 *  primitive to its member refs, producing `.use(policy)` hooks that drop the
 *  wire-identity args from the per-call signature.
 *
 *  ```ts
 *  // In-process dispatch (no transport, can't half-open) — pass it bare:
 *  const app = surfaceClient(surface, directDispatch(served));
 *
 *  // Websocket (CAN half-open) — pass the watchdog-backed handle WHOLE.
 *  // Reach for `connectSurface` (`@kolu/surface-app`), which wires it for you; or,
 *  // hand-built, use `createLiveSignal`, which validates the `{dispatch, wire}`
 *  // pairing a link factory minted and returns the handle:
 *  const transport = createLiveSignal(websocketTransport, {});
 *  const app = surfaceClient(surface, transport);
 *  ```
 *
 *  Collapsing dispatch+live into ONE handle argument is what makes the pairing hold
 *  by construction: there is no separate `{ live }` seam to pass a half-open-blind
 *  accessor through, and no way to pair a live with a DIFFERENT, self-rolled
 *  dispatch.
 *
 *  This is the unification: the bundle no longer bakes in the WebSocket transport —
 *  it consumes whatever transport it's handed, so the same hooks work over a socket,
 *  a subprocess, or an in-process dispatch. */
export function surfaceClient<const S extends SurfaceSpec>(
  surface: Surface<S>,
  transport: LiveSignalHandle | SurfaceDispatch,
): SurfaceClient<S> {
  // Collapse the transport to its `{ dispatch, live }` — a `LiveSignalHandle` carries
  // both (paired by construction); a bare half-openable dispatch CRASHES here; a bare
  // in-process dispatch gets a constant-`true` leg (sound — it can't half-open).
  const { dispatch, live } = resolveTransport(transport);
  return buildSurfaceClient(surface, dispatch, live);
}

/** Open the eager `liveWhen` readiness leg for a mirror-shaped cell — the
 *  self-contained detached-root concern. In a `createRoot` (`buildSurfaceClient`
 *  itself runs outside any owner) it opens the cell's server subscription NOW and
 *  (a) `enroll`s its pending/error so the cell's own stream-health is TOTAL in `subs`
 *  even with zero `.use()`, and (b) `enrollReadiness`es the predicate over its live
 *  value so `health().live` AND-folds the mirror state BY CONSTRUCTION. This is the
 *  client-side symmetry to `pumpRemoteSurface` auto-wiring the server WRITE: composing
 *  the cell entails the fold, so the green-over-dead-mirror lie has no
 *  `.use()`-conditional escape (a dot-only viewer that never mounts the cell still
 *  reads the complete fact). Returns the standing result (shared by a read-only
 *  `.use()`) and the root disposer (run by `client.dispose()`). */
function openReadinessLeg<S extends SurfaceSpec>(
  key: string,
  cellSpec: CellSpec<unknown, unknown>,
  source: StreamingProcedure<undefined, unknown>,
  registry: ReturnType<typeof createSurfaceHealthRegistry>,
  surface: Surface<S>,
  policyOnError: ((err: Error) => void) | undefined,
): { standing: ReadOnlyUseCellResult<unknown>; dispose: () => void } {
  const liveWhen = cellSpec.liveWhen as (value: unknown) => boolean;
  let standing!: ReadOnlyUseCellResult<unknown>;
  const dispose = createRoot((disposeRoot) => {
    const s = useCell(
      // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
      (surface.descriptors.cells as any)[key],
      // Route a spec-declared `client.onError` policy for a read-only `liveWhen` cell
      // through its ONE standing subscription — the sub a read-only `.use()` shares, so
      // the policy fires once per subscription (design §F/m6). Threaded via `onError`
      // (design §E's single funnel), inside this root so it disposes with the leg.
      { source, authority: "server", onError: policyOnError },
    );
    registry.enroll(key, { pending: s.pending, error: s.error });
    registry.enrollReadiness(key, () =>
      liveWhen(s.value() ?? cellSpec.default),
    );
    standing = s as ReadOnlyUseCellResult<unknown>;
    return disposeRoot;
  });
  return { standing, dispose };
}

/** The read-only `.use()` projection — `value/pending/error/sub` WITHOUT `set`/`patch`
 *  (absent at runtime, matching {@link ReadOnlyUseCellResult}). Both get-only branches
 *  of {@link bindCell} (the shared standing sub, and the server-authority cell) return
 *  it, so the shape AND the one cast that bridges the walk-by-string `BoundCell<unknown>`
 *  map live here once (`BoundCellsFor` already narrows a get-only cell to
 *  `ReadOnlyBoundCell` at the type level). */
function readOnlyCellView(src: {
  value: unknown;
  pending: unknown;
  error: unknown;
  sub: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: read-only projection (no set/patch) over the BoundCell<unknown> map type
}): any {
  return {
    value: src.value,
    pending: src.pending,
    error: src.error,
    sub: src.sub,
  };
}

/** Bind ONE cell to its `BoundCell` — the per-cell concern, lifted out of the
 *  cells loop so each step (verb resolution, read-only detection, the readiness leg,
 *  ordinary `.use()` enrolment) reads as one named thing instead of one fused body.
 *  Returns the bound cell plus, for a `liveWhen` cell, the standing-root disposer the
 *  caller threads into `client.dispose()`. */
function bindCell<S extends SurfaceSpec>(
  key: string,
  cellSpec: CellSpec<unknown, unknown>,
  face: SurfaceFace,
  registry: ReturnType<typeof createSurfaceHealthRegistry>,
  subs: KeyedSubscriptionCache,
  surface: Surface<S>,
  onClientError?: OnClientError,
): { cell: BoundCell<unknown, unknown>; disposeRoot?: () => void } {
  const ns = memberOf(face, key);
  const source = ns.get as StreamingProcedure<undefined, unknown>;
  // The OPAQUE, app-declared client error policy for this cell (design §B), reified
  // into a `useCell` `onError` handler. Read the policy as `unknown` — the value is
  // app-typed and the framework never inspects it, only threads it to `onClientError`.
  // Threading it through `useCell`'s `onError` (NOT `wireSubscriptionError` on the
  // sub) is load-bearing for design §E: that single funnel carries BOTH the
  // subscription-drop edge AND a local-authority cell's coalesced write-FLUSH failure
  // (`useCell.ts` fires `options.onError` from the mutate catch — write-time, per
  // failure), so the ONE declared policy knowingly serves both clocks. Passed into the
  // SHARED slot's `useCell` (once per slot), so it fires once per underlying
  // subscription (the "interpret per subscription" rule, §F/m6) — never once per
  // consumer. The construction-throw in `buildSurfaceClient` already guaranteed
  // `onClientError` is present whenever a policy is declared, so the guard here is a
  // type-narrowing formality, not a second fallback.
  const cellPolicy: unknown = (cellSpec as CellSpec<unknown, unknown, unknown>)
    .client?.onError;
  const policyOnError: ((err: Error) => void) | undefined =
    cellPolicy !== undefined && onClientError
      ? (err) => onClientError(cellPolicy, err)
      : undefined;
  // Bind the cell's CLIENT mutation verb — the one the bound `.use()` mutate path
  // actually calls. Only `set`/`patch` qualify; `test__set` is the e2e reset
  // procedure, never a consumer mutation, so a `["get", "test__set"]` cell (e.g.
  // `activityFeed` / `session`) stays read-only on the client.
  //
  // Resolve the EXPOSED verb through `resolveCellVerbs` — the SAME helper the
  // contract derivation (`cellContractEntries`) and the server handler walk call —
  // rather than re-spelling the patch/no-patch default here. This keeps the binding
  // aligned with `CellIsMutable` even for the legal `patchSchema` + explicit-`set`
  // cell — whose client patch shape the bound type (`CellHasPatchVerb`) collapses to
  // the full value `T`, so a `.patch` posts a full value to this `ns.set`, never a
  // partial the endpoint would reject. It also leaves `mutate` undefined for a
  // get-only cell so the read-only `.use()` type (no `set`/`patch`) keeps callers off
  // a mutate path the wire can't service.
  const verbs = resolveCellVerbs(cellSpec);
  const mutateVerb = verbs.includes("patch")
    ? "patch"
    : verbs.includes("set")
      ? "set"
      : undefined;
  const mutate = mutateVerb ? ns[mutateVerb] : undefined;
  // Spec-declared `patch` doubles as the default `applyPatch` for authority-`local`
  // cells, so server and client merge with the same function without the consumer
  // importing it twice.
  //
  // Inject it ONLY when the exposed client mutation verb is `patch` — i.e. when the
  // bound type carries the partial `P` (`BoundCell<T, P>`) and the local-authority
  // `.patch(P)` / coalesce path actually feeds a `P` to this merge. For the legal
  // `patchSchema` + explicit-`set` cell the bound type collapses to `BoundCell<T, T>`:
  // `.set(T)` / `.patch(T)` carry the full value, so `applyLocal` must full-replace,
  // NOT route through `cellSpec.patch` (which expects a partial `P`, not a `T`).
  // Skipping the inject here leaves `applyPatch` undefined, so `useCell`'s no-helper
  // branch treats `P` as `T` and replaces wholesale — sound against the full-value
  // `set` endpoint.
  const specPatch = mutateVerb === "patch" ? cellSpec.patch : undefined;
  // A get-only cell has NO client mutation verb. Make it read-only at RUNTIME, not
  // only at the TS surface: branch to a server-authority `useCell` and return ONLY
  // `{ value, pending, error, sub }` — no `set`/`patch` to call an absent `ns.<verb>`,
  // and no local store at all. A forced `authority: "local"` (a JS / `any` caller the
  // type can't stop) FAILS FAST in the `.use()` below, BEFORE `useCellLocal` would
  // seed a local store and let a `.set`/`.patch` mutate it ahead of discovering there
  // is no mutate handler. Fail-fast per the design philosophy: a read-only contract
  // that silently half-mutates a local store is the "graceful degradation" defect,
  // not a feature.
  const readOnly = mutateVerb === undefined;
  // A READINESS-GATE cell (`liveWhen`): open its eager standing subscription/readiness
  // leg now (the self-contained detached-root concern). A read-only `.use()` SHARES
  // this `standing` — no second `.get` stream, no duplicate member in `subs`.
  const leg = cellSpec.liveWhen
    ? openReadinessLeg(key, cellSpec, source, registry, surface, policyOnError)
    : undefined;
  const standing = leg?.standing;
  const cell: BoundCell<unknown, unknown> = {
    use: (boundOpts) => {
      // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
      const opts: any = { ...(boundOpts ?? {}) };
      // SR11: SOURCE the spec-declared `client.authority` / `client.coalesceMs` (the
      // discriminated {@link ClientCellPolicy} local-authority arm) so a BARE
      // `.use()` inherits them — the policy is DECLARED once on the member spec, not
      // repeated at every use-site. A use-site value still wins (explicit override),
      // but every kolu use-site is now bare, so a local-authority cell (preferences)
      // gets its `authority: "local"` + coalesce window FROM the spec rather than a
      // hand-passed bag — without this the declared authority would be dead data and
      // the cell would silently fall back to server-authority. The local store still
      // seeds from the mandatory `CellSpec.default` (there is no `client.initial`).
      const specClient = cellSpec.client as
        | { authority?: "server" | "local"; coalesceMs?: number }
        | undefined;
      if (specClient?.authority !== undefined && opts.authority === undefined)
        opts.authority = specClient.authority;
      if (specClient?.coalesceMs !== undefined && opts.coalesceMs === undefined)
        opts.coalesceMs = specClient.coalesceMs;
      // SR11: a local-authority cell has NO `client.initial` — it seeds its optimistic
      // store from the mandatory `CellSpec.default` (design: "seed from the default,
      // not a duplicate `initial`"). `useCellLocal` requires a synchronous `initial`,
      // so default it here from the spec when the (now-bare) use-site omits it — without
      // this a bare local-authority `.use()` seeds the store `undefined` and an
      // optimistic patch before the first server yield merges onto `undefined`.
      if (opts.authority === "local" && opts.initial === undefined)
        opts.initial = cellSpec.default;
      // A read-only `liveWhen` cell SHARES its eager standing subscription. Forward
      // `onError` as a reactive observer of the shared (self-clearing) error, so the
      // read-only `.use({onError})` contract still fires.
      const shared = readOnly ? standing : undefined;
      if (shared) {
        // Reuse the SAME edge-wiring `wireSubscriptionError` gives every other
        // `onError` in this file (lines below) — not a hand-rolled tracked
        // `createEffect`, which would re-subscribe to whatever `cb` itself reads
        // and can double-fire in a way the shared `on()`-based helper does not.
        if (opts.onError) wireSubscriptionError(shared, opts.onError);
        return readOnlyCellView(shared);
      }
      if (readOnly) {
        if (opts.authority === "local") {
          throw new Error(
            "surfaceClient: cell has no wire mutation verb (get-only) — " +
              '`authority: "local"` is rejected; there is no mutate handler ' +
              "to flush a local write to, so this cell is read-only.",
          );
        }
        // Share the get-only cell's upstream subscription across all consumers via the
        // keyed cache: N `.use()` calls fold to ONE `.get` stream, enrolled ONCE.
        const cell = subs.use(
          `cell:${key}`,
          (onComplete) =>
            useCell(
              // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
              (surface.descriptors.cells as any)[key],
              // `onError: policyOnError` threads the spec-declared policy into the SHARED
              // slot's ONE subscription (once per slot, never once per consumer).
              {
                source,
                authority: "server",
                onComplete,
                onError: policyOnError,
              },
            ),
          // Enrol the cell's self-clearing error()/pending() into health() ONCE inside
          // the shared slot (un-enrols on slot disposal), not once per consumer — which
          // would double-count the same fact in the `health()` fold.
          (c) => registry.enroll(key, { pending: c.pending, error: c.error }),
        );
        // Per-consumer `onError`: wire the caller's handler on the SHARED error signal
        // under THIS consumer's own owner (the shared slot carries no toast of its own),
        // so a get-only cell's stream failure still reaches callback-based handling.
        if (opts.onError) wireSubscriptionError(cell.sub, opts.onError);
        // Return ONLY the read-only projection (`set`/`patch` absent at runtime) — the
        // shared `readOnlyCellView` owns the shape + the single bridging cast.
        return readOnlyCellView(cell);
      }
      // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
      const merged: any = { ...opts, source, mutate };
      if (
        specPatch &&
        merged.authority === "local" &&
        merged.applyPatch === undefined &&
        merged.mergeIntoStore === undefined
      ) {
        merged.applyPatch = specPatch;
      }
      // `onError` is PER-CONSUMER — pull it out of the SHARED construction and wire it
      // on the shared sub below. Everything else (authority, applyPatch, and — for a
      // local-authority cell — the local store) is SHARED: N consumers of one cell
      // share ONE upstream sub and ONE local store, so a `.set` from one is seen by all
      // (this is what replaces the module-const `createSharedRoot` sharing idiom).
      const { onError: cellOnError, ...sharedOpts } = merged;
      // Fold the SHARED options into the cache key: two `.use()` sites with divergent
      // `authority`/`initial`/`coalesceMs`/`applyPatch` get DISTINCT slots (they ARE two
      // subscriptions — a local-authority coalesced store and a server-authority view are
      // different upstream subs), so a second caller can never silently inherit the first
      // caller's variant. Identical shared options still fold to one slot. `onError`
      // (per-consumer, pulled out above) is not in the key.
      //
      // `authority` is normalized to its DEFAULT-omitted spelling before keying:
      // `useCell` (and every other authority-consuming branch) treats an ABSENT
      // `authority` identically to explicit `authority: "server"` — the default the
      // `BoundCellOptions` type itself documents. Without this, `.use({})` and
      // `.use({ authority: "server" })` are semantically the SAME site (both
      // server-authority, otherwise-identical options) but keyed DIFFERENTLY —
      // `stableOptsKey` already drops `undefined` values, so setting `authority` to
      // `undefined` here (only for the KEY, not for `sharedOpts` itself — `useCell`
      // still gets whatever the caller actually wrote) folds both spellings onto ONE
      // slot instead of silently opening two upstream subscriptions for one logical
      // consumer.
      const keyOpts =
        sharedOpts.authority === "server"
          ? { ...sharedOpts, authority: undefined }
          : sharedOpts;
      const cell = subs.use(
        `cell:${key}:${stableOptsKey(keyOpts)}`,
        (onComplete) =>
          useCell(
            // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
            (surface.descriptors.cells as any)[key],
            // `onError: policyOnError` routes the spec-declared policy through the shared
            // subscription's ONE `useCell` funnel — covering BOTH the subscription drop
            // AND, for a local-authority cell, the coalesced write-FLUSH failure `useCell`
            // fires from its mutate catch (design §E: write-time, per-failure, but the
            // SAME declared policy). Divergent `authority`/`coalesceMs` options key
            // DISTINCT slots, so each honest subscription fires the policy once.
            { ...sharedOpts, onComplete, onError: policyOnError },
          ),
        (c) => registry.enroll(key, { pending: c.pending, error: c.error }),
      );
      if (cellOnError)
        wireSubscriptionError(cell.sub, cellOnError as (e: Error) => void);
      return cell;
    },
  };
  return { cell, disposeRoot: leg?.dispose };
}

/** The internal builder shared by `surfaceClient` (one transport) and
 *  `surfaceClients` (one combined transport sliced per sibling). It takes the
 *  ALREADY-resolved `link` and `live` — `surfaceClient` resolves them from a
 *  handle-or-bare-link via {@link resolveTransport}; `surfaceClients` reads them off
 *  the combined handle once and threads the shared `live` into each scoped slice (the
 *  slices are fresh non-half-open wrappers, so they need no brand check). The
 *  half-open guard lives at the PUBLIC boundary, not here.
 *
 *  Exposed in the `@kolu/surface/solid` barrel for FRAMEWORK COMPOSITION — a builder
 *  that needs to serve many clients over ONE resolved transport, threading its `live`
 *  into each. `@kolu/surface-map` is the case: it resolves the app's transport ONCE
 *  via {@link resolveTransport} (which applies the half-open guard) and builds each
 *  per-key client over a key-INJECTING wrapper of the resolved link paired with the
 *  SAME resolved `live` — so the live↔link pairing still holds by construction (both
 *  come from the one resolved handle), and a per-key chip floors on real transport
 *  liveness rather than a green-over-dead-link lie. The half-open guard lives at the
 *  PUBLIC boundary ({@link resolveTransport} / `surfaceClient`), not here; a caller
 *  reaching for this raw builder owns that guarantee, exactly as the `resolveTransport`
 *  by-exclusion fallback does (#1580). */
export function buildSurfaceClient<const S extends SurfaceSpec>(
  surface: Surface<S>,
  dispatch: SurfaceDispatch,
  live: Accessor<boolean>,
  onClientError?: OnClientError,
): SurfaceClient<S> {
  const spec = surface.spec;
  // Re-nest the flat tag namespace ONCE, here, so every bind below reads a member
  // the same way (`face.surface[key][verb]`) whether it is a cell's `get`, a
  // collection's `deltas` or a declared procedure — and so `.rpc` and the bound
  // faces hand out the SAME refs, never two walks that could disagree.
  const face = buildSurfaceFace(surface, dispatch);

  // FAIL-FAST (design §D / F5): a member that DECLARES a `client.onError` policy but
  // whose client was built with NO interpreter would route that policy nowhere — a
  // declared error handler that silently swallows, the exact `caught-error-must-not-
  // collapse-to-empty` defect. So scan the spec ONCE at construction and CRASH LOUDLY
  // if any cell/collection declares `client.onError` and `onClientError` is absent —
  // regardless of whether any consumer ever `.use()`s the member (the wiring below
  // fires only on subscribe; this check must not). Mirrors the loud-crash precedent
  // at `resolveTransport` (the half-open-blind transport). This runtime scan is the
  // SOLE enforcement: `onClientError` is an OPTIONAL field on both `connectSurfaces`
  // and `connectSurfaceMap` — their option types don't carry the surface's policy
  // type, so they can't make the interpreter type-*required* when a member declares a
  // non-`never` policy. So a policy-bearing surface connected with no interpreter is
  // caught HERE, at construction, not by the compiler.
  if (onClientError === undefined) {
    const policyMember =
      Object.entries(spec.cells ?? {}).find(
        ([, s]) =>
          (s as CellSpec<unknown, unknown, unknown>).client?.onError !==
          undefined,
      )?.[0] ??
      Object.entries(spec.collections ?? {}).find(
        ([, s]) =>
          (s as CollectionSpec<unknown, unknown, unknown>).client?.onError !==
          undefined,
      )?.[0];
    if (policyMember !== undefined) {
      throw new Error(
        `buildSurfaceClient: member "${policyMember}" declares a client.onError ` +
          "policy but no `onClientError` interpreter was threaded — the declared " +
          "policy would route nowhere (a silent swallow). Build this surface " +
          "through `connectSurfaces`/`connectSurfaceMap` with an `onClientError`, " +
          "which threads the interpreter to every internal `buildSurfaceClient`.",
      );
    }
  }
  // FAIL-FAST (F1): a `client.authority: "local"` cell drives `useCellLocal`, which
  // builds `createStore(default)` and writes patches back through a `set`/`patch` verb.
  // That path is sound ONLY for a non-null OBJECT value WITH a mutation verb. The type
  // CAN'T gate this: the `SurfaceSpec` constraint erases the cell value type to `any` at
  // the `defineSurfaceWithPolicy` spec-literal site (`[any] extends [object]` admits the
  // local arm), so a `[T] extends [object]` field gate wouldn't fire where the
  // declaration is written — the same erasure reason the missing-interpreter check above
  // is runtime. So assert BOTH dimensions once, here at construction, so a bad
  // local-authority declaration crashes loudly rather than failing (or silently never
  // writing) at subscribe.
  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    const cs = s as CellSpec<unknown, unknown, unknown>;
    if (cs.client?.authority !== "local") continue;
    const isObject = typeof cs.default === "object" && cs.default !== null;
    const verbs = resolveCellVerbs(cs);
    const mutable = verbs.includes("set") || verbs.includes("patch");
    if (!isObject || !mutable) {
      throw new Error(
        `buildSurfaceClient: cell "${key}" declares client.authority "local" but is ` +
          `${!isObject ? "not object-valued" : "get-only (no set/patch verb)"} — a ` +
          "local-authority store requires a non-null object value and a mutation verb.",
      );
    }
  }
  // The per-client subscription-health registry. Every `.use()` below enrols its
  // subscription, so `health()` folds a TOTAL picture (a partial registry behind
  // a confident gate is worse than no gate — `./health`). The transport leg is the
  // resolved `live` — the watchdog-backed handle's `live` for a half-openable link,
  // else a constant `true` (sound only because `resolveTransport` already proved
  // this link can't half-open).
  const registry = createSurfaceHealthRegistry(live);

  // The per-client subscription DEDUP cache. Every static-input `.use()` below routes
  // its construction through this, so N views of one `(proc, static-input)` share ONE
  // upstream subscription — ref-counted, torn down when the last consumer leaves. The
  // shared slots are owned by THIS client's owner (`getOwner()` here), NEVER by
  // whichever consumer subscribed first (a first-consumer owner is the leak class the
  // cache exists to kill). This replaces the module-const `createSharedRoot` "sharing
  // by convention" idiom — every consumer inherits sharing from the base client.
  const subs = createKeyedSubscriptionCache(getOwner());

  // The whole-collection dedup slot's per-consumer `onError` registry. A STATIC-input
  // `.use()` (no `keys`) dedups N consumer views onto ONE shared upstream subscription
  // (the dedup branch below); EVERY registered consumer's handler must fire on a
  // collection error — dropping one silently was the defect a now-retired THROW used to
  // guard by refusing a second, divergent handler outright. Keyed by `coll:<key>`; each
  // live slot maps to a `Map<handler, refcount>` — a refcount, not a bare `Set`, because
  // two consumers may legitimately share the IDENTICAL handler reference (e.g. one
  // shared exported const) and each registers/unregisters independently: a `Set` would
  // drop the shared entry on the FIRST consumer's disposal even though a second consumer
  // holding the same ref is still live.
  //
  // LIFETIME: this registry's lifetime is the CONSUMERS', never a dedup-slot
  // generation's. A typed-end eviction (a re-served collection) can rebuild the shared
  // slot — a NEW generation, new dispatcher — while consumers of the OLD generation are
  // still mounted and this SAME registry keeps serving both. Tying the entry's deletion
  // to a slot's own `onCleanup` (as an earlier version did) is exactly wrong: the dead
  // generation's disposal would delete the registry the LIVE generation's dispatcher
  // still reads, silently dropping every later-joining consumer's handler. So only a
  // CONSUMER's own unregister (below) ever deletes the entry — identity-guarded, and
  // only once it's empty — and `dispatchError` (below) reads it live, by key, at call
  // time, never a captured snapshot.
  const collOnError = new Map<string, Map<(err: Error) => void, number>>();

  // Build-time standing-root disposers for `liveWhen` cells (the readiness legs
  // `bindCell` → `openReadinessLeg` open EAGERLY, not at `.use()` time, so the
  // mirror-liveness leg folds into `health().live` by construction — independent of
  // whether any component ever mounts the cell). `dispose()` runs these roots.
  const standingRoots: Array<() => void> = [];

  const cells: Record<string, BoundCell<unknown, unknown>> = {};
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    const { cell, disposeRoot } = bindCell(
      key,
      cellSpec,
      face,
      registry,
      subs,
      surface,
      onClientError,
    );
    cells[key] = cell;
    if (disposeRoot) standingRoots.push(disposeRoot);
  }

  // The runtime object ALWAYS carries the `unenrolledKeys` lazy getter; the public
  // `BoundCollectionsFor` mapped type then narrows it OUT for a keys-less collection
  // (the getter is harmless there — nothing typed reaches it). So the local record
  // includes `UnenrolledKeys`, and the final `as BoundCollectionsFor<S>` gates it.
  const collections: Record<
    string,
    BoundCollection<unknown, unknown> &
      UnenrolledKeys<unknown> &
      UnenrolledDeltas<unknown, unknown>
  > = {};
  for (const [key, rawColl] of Object.entries(spec.collections ?? {})) {
    const ns = memberOf(face, key);
    // Whether this collection opted into batched `deltas` delivery — read from
    // the SPEC (the authoritative verb set the server also gates on), NEVER from
    // `(ns as any).deltas`: an oRPC wire client is a lazy Proxy whose every
    // property access returns a truthy callable, so a transport-level probe is
    // `true` for EVERY collection and would route a non-opted whole-collection
    // `.use()` into a `deltas` call the server never registered (the stream
    // would reject and the collection silently read empty). The server decides
    // identically — `walkSurface`'s `collVerbs.includes("deltas")`.
    const hasDeltas = collectionHasDeltas(
      rawColl as CollectionSpec<unknown, unknown>,
    );
    const upsertRef = ns.upsert as UnaryEffect<unknown, unknown, never>;
    const deleteRef = ns.delete as UnaryEffect<unknown, unknown, never>;
    const upsert = (k: unknown, v: unknown): Effect.Effect<void, unknown> =>
      Effect.asVoid(upsertRef({ key: k, value: v }));
    const del = (k: unknown): Effect.Effect<void, unknown> =>
      Effect.asVoid(deleteRef({ key: k }));
    // The OPAQUE, app-declared client error policy for this collection (design §B),
    // reified into an error handler that threads the declared value to `onClientError`.
    // Read as `unknown` — the framework never inspects it. A collection has no
    // write-flush clock (upsert/delete are direct RPCs), so its ONE funnel is the
    // subscription error: the whole-collection `dispatchError` (once per shared slot)
    // and each narrowed keyed subscription's `onError` (per-subscription, §F/m6). The
    // construction-throw already guaranteed `onClientError` when a policy is declared.
    const collPolicy: unknown = (
      rawColl as CollectionSpec<unknown, unknown, unknown>
    ).client?.onError;
    const collPolicyOnError: ((err: Error) => void) | undefined =
      collPolicy !== undefined && onClientError
        ? (err) => onClientError(collPolicy, err)
        : undefined;
    collections[key] = {
      use: (opts) => {
        const onError = opts?.onError;
        // Fold the spec-declared policy into a narrowed (keyed) subscription's error
        // handling alongside the per-consumer `onError` — both fire on a failure. A
        // keyed `.use()` is honestly its own subscription (no dedup), so the policy
        // fires per subscription (§F/m6), the acknowledged duplicate-toast case.
        const narrowedOnError =
          onError && collPolicyOnError
            ? (err: Error) => {
                // Both fire. GUARD the consumer's `onError` so a throw in it can't skip
                // the declared policy that follows; the policy fires LAST and UNGUARDED,
                // so its own fail-loud throw (an impossible origin regression) still
                // surfaces with nothing skipped.
                try {
                  onError(err);
                } catch (e) {
                  console.error("useCollection onError handler threw", e);
                }
                collPolicyOnError(err);
              }
            : (onError ?? collPolicyOnError);
        // A NARROWED subscription (explicit reactive `opts.keys` — the "watch this
        // subset" case) is ACCESSOR-input: two input accessors are honestly two
        // subscriptions, so it stays PER-CONSUMER (no dedup), unchanged. Its `.use()`
        // runs inside a Solid owner so each per-key sub disposes with the component.
        if (opts?.keys) {
          const view = useCollection(
            // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
            (surface.descriptors.collections as any)[key],
            {
              keys: opts.keys,
              valueSource: ns.get as StreamingProcedure<
                { key: unknown },
                unknown
              >,
              keyToInput: (k) => ({ key: k }),
              onError: narrowedOnError,
              enroll: (k, sub) => registry.enroll(`${key}[${String(k)}]`, sub),
            },
          );
          return { ...view, upsert, delete: del };
        }
        // WHOLE collection (STATIC input — watch every key) → DEDUP the whole result
        // via the keyed cache: N views share ONE set of upstream streams, ref-counted,
        // torn down when the last leaves, evicted on a typed end (a re-served
        // collection rebuilds). Per-consumer `onError` is wired through `collOnError`
        // (declared above): every consumer that supplies a handler is registered, and
        // ALL registered handlers fire on a collection error, in whatever order and
        // however many consumers there are — the silent-drop defect a now-retired THROW
        // used to guard is made unreachable by actually building the fan-out, not by
        // refusing a second handler. The shared subscription (built ONCE, below) is
        // wired to a STABLE DISPATCHER, built once alongside the slot, that reads the
        // CURRENT handler registry at CALL time (never a snapshot) — so a late-joining
        // consumer is covered without rebuilding the upstream streams. Each consumer
        // registers/unregisters HERE, in the CALLING owner (`.use()` runs inside the
        // consuming component's reactive scope), so a handler is removed the moment ITS
        // owner disposes — independent of the shared slot's own lifetime.
        const collKey = `coll:${key}`;
        let existingHandlers = collOnError.get(collKey);
        if (existingHandlers === undefined) {
          existingHandlers = new Map<(err: Error) => void, number>();
          collOnError.set(collKey, existingHandlers);
        }
        const handlers = existingHandlers;
        if (onError !== undefined) {
          // Registered under `runUnderOwner` — the SAME ownerless-owning-root
          // treatment `keyedSubscriptionCache`'s `read()` applies to the slot
          // ref-count. Called with a real reactive owner (a component's `.use()`),
          // this is identical to running inline. Called OWNERLESS (a DOM event
          // handler, no reactive scope — the caller class `read()`'s docblock
          // names), the increment+`onCleanup`+decrement below runs under a
          // throwaway `createRoot` instead and nets to zero in the SAME tick — so
          // an ownerless `.use({onError})` can never leave a dead handler standing
          // in `handlers` forever (Solid's `onCleanup` outside an owner warns and
          // no-ops, which would otherwise pair the increment with NO decrement:
          // the unguarded sibling of the slot ref-count leak `read()` exists to kill).
          runUnderOwner(() => {
            handlers.set(onError, (handlers.get(onError) ?? 0) + 1);
            onCleanup(() => {
              const n = handlers.get(onError);
              if (n === undefined) return; // already unregistered (e.g. slot reset)
              if (n <= 1) handlers.delete(onError);
              else handlers.set(onError, n - 1);
              // The registry's lifetime is this consumer's, never a dedup-slot
              // generation's (see the `collOnError` docblock above) — so ONLY a
              // consumer's own unregister ever deletes the entry, and ONLY once it's
              // empty. Identity-guarded: if a fresh registry already replaced this one
              // (this map was already emptied and dropped by an earlier consumer, then a
              // new first-consumer minted a new map under the same key), this stale
              // reference must never delete the LIVE one out from under it.
              if (
                handlers.size === 0 &&
                collOnError.get(collKey) === handlers
              ) {
                collOnError.delete(collKey);
              }
            });
          });
        }
        const view = subs.use(collKey, (onComplete) => {
          // Built ONCE per slot; fired on every upstream error. Reads the registry
          // LIVE, BY KEY, at call time — NEVER a captured `handlers` snapshot. A
          // typed-end eviction can rebuild this slot (a fresh generation) while the
          // registry above keeps accepting new consumers under the OLD generation's
          // map; a captured reference would silently stop matching the live map the
          // moment a later write moved on (the generation-torn defect this closure
          // must not reintroduce). No slot-generation code owns this registry's
          // lifetime or clears it — the per-consumer register/unregister above is the
          // only writer/deleter.
          const dispatchError = (err: Error): void => {
            // Fan out to every live per-consumer handler FIRST, each GUARDED so one
            // consumer throwing can't skip the rest of the fan-out or the policy. The
            // spec-declared policy fires ONCE per shared slot (never per consumer),
            // LAST and UNGUARDED, so its own fail-loud throw (an impossible origin
            // regression) still surfaces with no handler skipped.
            const live = collOnError.get(collKey);
            if (live)
              for (const h of live.keys()) {
                try {
                  h(err);
                } catch (e) {
                  console.error("useCollection onError handler threw", e);
                }
              }
            collPolicyOnError?.(err);
          };
          return hasDeltas
            ? // ONE coalesced `deltas` stream folded into a per-key store.
              useCollectionDeltas(
                // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
                (surface.descriptors.collections as any)[key],
                {
                  source: unenrolledStreamCall(
                    ns.deltas as StreamingProcedure<
                      undefined,
                      CollectionDeltasMsg<unknown, unknown>
                    >,
                    undefined,
                    { label: `${key}.deltas` },
                  ),
                  onError: dispatchError,
                  onComplete,
                  enroll: (sub) => registry.enroll(`${key}.deltas`, sub),
                },
              )
            : // The server keys stream + one value stream per key.
              (() => {
                const keysSub = createSubscription<unknown[]>(
                  unenrolledStreamCall(
                    ns.keys as StreamingProcedure<undefined, unknown[]>,
                    undefined,
                    { label: `${key}.keys` },
                  ),
                  { onError: dispatchError, onComplete },
                );
                // Leak B: enrol the keys-stream itself. A failing keys stream collapses
                // `keys()` to `[]` (the `sub() ?? []` fallback), so the collection would
                // otherwise read as a healthy EMPTY set — this is its ONLY error channel.
                registry.enroll(`${key}.keys`, keysSub);
                const keys = createMemo<unknown[]>(() => keysSub() ?? []);
                return useCollection(
                  // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
                  (surface.descriptors.collections as any)[key],
                  {
                    keys,
                    valueSource: ns.get as StreamingProcedure<
                      { key: unknown },
                      unknown
                    >,
                    keyToInput: (k) => ({ key: k }),
                    onError: dispatchError,
                    // Enrol each per-key value sub as `<key>[<id>]`; the callback runs in
                    // the `mapArray` per-key owner, so it drops when the key leaves.
                    enroll: (k, sub) =>
                      registry.enroll(`${key}[${String(k)}]`, sub),
                  },
                );
              })();
        });
        return { ...view, upsert, delete: del };
      },
      upsert,
      delete: del,
      // The raw keys-stream ref for the deliberately un-enrolled reach (see
      // BoundCollection docs) — the SAME `ns.keys` the enrolled `.use()` opens,
      // exposed for the #1591 carve-out to pass to `unenrolledStreamCall`. A LAZY
      // getter, like the `.use()`/`upsert` closures' own `ns` deref — so a partial
      // mock link (no `ns`) is tolerated until the ref is reached, never at build.
      get unenrolledKeys() {
        return ns.keys as StreamingProcedure<undefined, unknown[]>;
      },
      // The raw batched deltas-stream ref for the deliberately un-enrolled reach (see
      // BoundCollection docs) — the SAME `ns.deltas` the enrolled `.use()` opens for a
      // deltas-declaring collection, exposed for the #1591 carve-out to pass to
      // `unenrolledStreamCall`. A LAZY getter, like `unenrolledKeys` — so a partial
      // mock link (no `ns`) is tolerated until the ref is reached, never at build.
      get unenrolledDeltas() {
        return ns.deltas as StreamingProcedure<
          undefined,
          CollectionDeltasMsg<unknown, unknown>
        >;
      },
    };
  }

  const streams: Record<string, BoundStream<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.streams ?? {})) {
    const ns = memberOf(face, key);
    streams[key] = {
      use: (inputFn, streamOpts) => {
        const sub = useStream(
          // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
          (surface.descriptors.streams as any)[key],
          inputFn,
          ns.get as StreamingProcedure<unknown, unknown>,
          streamOpts,
        );
        registry.enroll(key, sub);
        return sub;
      },
      // The raw ref for the deliberately un-enrolled reach (see BoundStream docs) —
      // the SAME `ns.get` the enrolled `.use()` drives, exposed for a carve-out
      // consumer to pass to `unenrolledStreamCall` without a cast. A LAZY getter,
      // like `.use()`'s own `ns.get` deref — so a partial mock link (no `ns`) is
      // tolerated until the ref is actually reached, never at build.
      get unenrolled() {
        return ns.get as StreamingProcedure<unknown, unknown>;
      },
    };
  }

  const events: Record<string, BoundEvent<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    const ns = memberOf(face, key);
    events[key] = {
      use: (inputFn, handler, eventOpts) =>
        useEvent(
          // biome-ignore lint/suspicious/noExplicitAny: the descriptor types the hook; only its `name` is read at runtime
          (surface.descriptors.events as any)[key],
          inputFn,
          ns.get as StreamingProcedure<unknown, unknown>,
          handler,
          eventOpts,
        ),
    };
  }

  // The bound imperative procedures — the typed dual of the reactive primitives.
  // Each declared `procedures.<ns>.<verb>` IS the oRPC callable already sitting at
  // `link.surface.<ns>.<verb>`; we re-expose it off the `surface` prefix so a
  // consumer calls `client.procedures.<ns>.<verb>(input)` with the declaration's
  // types and never casts the raw `.rpc`. Pure structural walk-by-string, like the
  // primitive binds above — no `.use()` wrapper (a procedure is a one-shot call,
  // not a subscription), so nothing to enrol into `health()`.
  //
  const procedures: Record<string, Record<string, unknown>> = {};
  for (const [ns, verbs] of Object.entries(spec.procedures ?? {})) {
    const nsFace = memberOf(face, ns);
    const bound: Record<string, unknown> = {};
    for (const verb of Object.keys(verbs)) bound[verb] = nsFace[verb];
    procedures[ns] = bound;
  }

  // The STRUCTURAL raw-stream path (Leak A). A raw `unenrolledStreamCall` owns its
  // own loop and so escapes the framework's birth-site enrolment; this is the one blessed
  // way to drive one and stay in `health()`. It refuses to run outside a reactive
  // owner — the enrolment auto-disposes via `onCleanup`, so a no-owner call would
  // leak, and silently leaking is exactly the bug class we kill — mirroring
  // `createSubscription`'s `reduce`-without-`initial` throw.
  function rawStream<I, O>(
    name: string,
    procedure: StreamingProcedure<I, O>,
    input: I,
    opts: RawStreamOptions<O>,
  ): HealthSource {
    if (!getOwner()) {
      throw new Error(
        `surfaceClient.rawStream("${name}"): must run inside a reactive owner — ` +
          "it enrols into health() and auto-disposes via onCleanup, so a no-owner " +
          "call would leak the enrolment. Call it from a component (or createRoot). " +
          "For a stream that is NOT a surface subscription (a root RPC), use " +
          "`unenrolledStreamCall` from `@kolu/surface/client` and enrol by hand.",
      );
    }
    const [pending, setPending] = createSignal(true);
    const [error, setError] = createSignal<Error | undefined>(undefined);
    const source: HealthSource = { pending, error };
    // Owner asserted above, so this auto-drops when the owner unwinds.
    registry.enroll(name, source);
    onCleanup(
      runStreamScoped<O>(
        unenrolledStreamCall(procedure, input, {
          // The caller's enrolment name IS the label — one name for the health
          // fact and the liveness registry (kolu#2101 J2).
          label: name,
          onRetry: () => {
            // A reconnect: back to pending, drop the stale error, and let the
            // caller clear any derived view before the fresh snapshot lands.
            setPending(true);
            setError(undefined);
            opts.onRetry?.();
          },
        }),
        {
          onFrame: (item) => {
            // Self-clearing edge: each frame proves the stream is live, so a
            // transient failure heals the instant it re-delivers (no latch).
            if (pending()) setPending(false);
            if (error()) setError(undefined);
            opts.onItem(item);
          },
          // Clean completion (the server ended the stream): no longer pending.
          // An interruption (the owner unwound) reports nothing — `runStreamScoped`
          // holds that rule, so the old `ctl.signal.aborted` check is gone.
          onEnd: () => setPending(false),
          onFailure: (err) => {
            // A deliberate teardown the CALLER classifies (xterm's
            // `isExpectedCleanupError`) must not register as a health error. The
            // owner's own teardown is already silent one layer down.
            if (opts.isExpectedStop?.(err)) return;
            // A real failure: clear pending so an errored-on-first-frame sub reads
            // `degraded`, never a stuck `connecting`, then record the error.
            setPending(false);
            setError(err);
          },
        },
      ),
    );
    return source;
  }

  return {
    rpc: face,
    cells: cells as BoundCellsFor<S>,
    // The runtime object ALWAYS carries `unenrolledKeys` + `unenrolledDeltas`; the
    // public `BoundCollectionsFor` mapped type narrows each OUT for a collection that
    // doesn't declare its verb, so the concrete `& UnenrolledKeys & UnenrolledDeltas`
    // shape needs the `unknown` bridge (the gate is per-verb, not always-both).
    collections: collections as unknown as BoundCollectionsFor<S>,
    streams: streams as BoundStreamsFor<S>,
    events: events as BoundEventsFor<S>,
    procedures: procedures as EffectProceduresFor<S>,
    health: registry.health,
    enroll: registry.enroll,
    rawStream,
    dispose: () => {
      for (const disposeRoot of standingRoots) disposeRoot();
    },
  };
}

// ── surfaceClients — sibling surfaces over one dispatch ─────────────────

/** Scope a COMBINED dispatch to one sibling by splicing the sibling key into every
 *  tag: `surface/<member>/<verb>` → `surface/<key>/<member>/<verb>`.
 *
 *  This is the runtime dual of the deleted `scopeSibling(link, key)` link re-wrap,
 *  and it is what lets a sibling's face be built from the STANDALONE surface value
 *  (whose `tagPrefix` is the bare `surface/`) while still addressing the composed
 *  server. The face therefore never learns it is scoped — the same property the
 *  server side has, where `composeSurfaceContracts` re-walks each sibling through
 *  the same `buildSurface`, so a sibling's tags and a standalone surface's tags can
 *  never be derived by two different rules.
 *
 *  `scopeSiblingTag` THROWS on a non-surface tag, so a mis-scoped dispatch fails at
 *  this seam rather than 404-ing at the far end. */
function scopeSiblingDispatch(
  dispatch: SurfaceDispatch,
  key: string,
): SurfaceDispatch {
  return {
    unary: (tag, payload) => dispatch.unary(scopeSiblingTag(tag, key), payload),
    stream: (tag, payload) =>
      dispatch.stream(scopeSiblingTag(tag, key), payload),
  };
}

/** The per-key client bundle returned by `surfaceClients`. Each value is a
 *  full `SurfaceClient` for that key's surface, scoped to the key's slice of
 *  the combined dispatch. */
export type SurfaceClients<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
> = {
  [K in keyof E]: E[K] extends Surface<infer S> ? SurfaceClient<S> : never;
};

/** Build one `surfaceClient` per sibling surface over a single combined
 *  transport (the counterpart to `implementSurfaces` / `composeSurfaceContracts`).
 *
 *  Pass the WHOLE transport — a {@link LiveSignalHandle} for the half-openable
 *  combined wire (the watchdog-backed live and the combined dispatch arrive as ONE
 *  object), or a bare combined in-process dispatch. Each per-key client is built
 *  over a TAG-SCOPED dispatch ({@link scopeSiblingDispatch}), so the bundle's
 *  internal face walk mints STANDALONE tags (`surface/<member>/<verb>`) and the
 *  wrapper splices the key in (`surface/<key>/<member>/<verb>`) — exactly the tags
 *  `implementSurfaces` binds. The siblings ride ONE combined wire, so they share the
 *  handle's ONE watchdog-backed `live` — every sibling reports it, so
 *  `surfaceClientsHealth`'s AND-reduce flips the merged fact `live: false` when that
 *  wire dies.
 *
 *  Reaching a member through a returned client therefore goes through that client's
 *  `.rpc` (the scoped face), e.g. for a probe procedure under surface key
 *  `surfaceApp` with namespace `identity` and verb `info`:
 *
 *      clients.surfaceApp.rpc.surface.identity.info(...)
 *
 *  (NOT `clients.surfaceApp.rpc.surface.surfaceApp.identity.info` — the key
 *  is already consumed by the scope, so it does not reappear in the path.) */
export function surfaceClients<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  const E extends Record<string, Surface<any>>,
>(
  transport: LiveSignalHandle | SurfaceDispatch,
  entries: E,
  onClientError?: OnClientError,
): SurfaceClients<E> {
  // Collapse the combined transport ONCE, at the public boundary: a
  // `LiveSignalHandle` yields the combined `dispatch` and the shared watchdog-backed
  // `live` (paired by construction); a bare half-openable combined dispatch CRASHES
  // (the green-over-dead-link lie for EVERY sibling); a bare in-process dispatch gets
  // a constant-`true` leg. The per-sibling wrappers below are fresh unbranded
  // dispatches, so each child is built via the internal `buildSurfaceClient` with the
  // shared `live` — no per-wrapper brand check (the guard already ran here, on the
  // combined transport).
  const { dispatch, live } = resolveTransport(transport);
  return Object.fromEntries(
    Object.entries(entries).map(([k, surface]) => [
      k,
      buildSurfaceClient(
        surface,
        scopeSiblingDispatch(dispatch, k),
        live,
        // Threaded to EVERY sibling client — the app spells ONE interpreter at the
        // `connectSurfaces` seam, never re-registered per internal build (design §A/m4).
        onClientError,
      ),
    ]),
  ) as SurfaceClients<E>;
}

/** The combined health FACT across every sibling client `surfaceClients` built —
 *  the Leak D closure. `surfaceClients` hands back N INDEPENDENT clients, each
 *  with its OWN `health()`; without a fold a consumer that wants ONE "is the app
 *  healthy" answer has to hand-assemble them (and would likely forget one, the
 *  exact partial-gate hazard `client.health()` exists to kill). This merges them
 *  via {@link mergeSurfaceHealth}, prefixing each sub's name with its surface key
 *  (`<surfaceKey>/<sub>`) and AND-reducing `live`, so the result reads as ONE fact
 *  a single `<SurfaceGate health={() => surfaceClientsHealth(clients)}>` can gate
 *  on. Reactive — call it inside a tracking scope (or wrap in an accessor). */
export function surfaceClientsHealth(
  clients: Record<string, Pick<SurfaceClient<SurfaceSpec>, "health">>,
): SurfaceHealth {
  return mergeSurfaceHealth(
    Object.entries(clients).map(([key, client]) => [
      key,
      () => client.health(),
    ]),
  );
}
