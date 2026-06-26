/**
 * `surfaceClient` — typed client-side surface generated from a `Surface`.
 *
 * Walks `surface.descriptors` once and pre-binds each Cell/Collection/Stream/Event
 * to its typed oRPC procedure refs, exposing a `.use(policy)` hook per
 * primitive that drops `source` / `mutate` / `valueSource` / `keyToInput`
 * from the per-call args. Imperative procedures stay accessible via
 * `client.rpc.<ns>.<verb>(...)`.
 *
 * Type narrowing for `useCell` (server- vs local-authority discriminator)
 * is preserved across the bind: the bound `.use()` accepts the same
 * `UseCellOptions` union, just with `source` / `mutate` already filled in.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
} from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { type StreamingProcedure, unenrolledStreamCall } from "../client";
import type {
  CellHasPatchVerb,
  CellIsMutable,
  CellSpec,
  CollectionSpec,
  EventSpec,
  StreamSpec,
  Surface,
  SurfaceSpec,
} from "../define";
import { resolveCellVerbs } from "../define";
import { isHalfOpenLink } from "../links/websocket";
import { isLiveSignalHandle, type LiveSignalHandle } from "./liveSignal";
import type { ReactiveSubscriptionOptions } from "./createReactiveSubscription";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";
import {
  createSurfaceHealthRegistry,
  type HealthSource,
  mergeSurfaceHealth,
  type SurfaceHealth,
} from "./health";
import { type UseCellResult, useCell } from "./useCell";
import { type UseCollectionResult, useCollection } from "./useCollection";
import { type UseEventOptions, useEvent } from "./useEvent";
import { useStream } from "./useStream";

/** Resolve the transport argument `surfaceClient`/`surfaceClients` were handed into
 *  the `{ link, live }` the bundle is built over — collapsing the pair at the API so
 *  there is nothing to re-prove at runtime:
 *
 *   - A {@link LiveSignalHandle} (the only honest shape over a half-openable
 *     websocket): read `.link` and `.live` straight off it. They were minted together
 *     by `createLiveSignal` (which builds the link over the socket it watches and
 *     wires the watchdog first), so the live↔link pairing holds BY CONSTRUCTION — the
 *     "watch ws1, build over ws2" forge is unspellable because no caller supplies a
 *     separate link.
 *   - A bare half-openable `websocketLink`: CRASH. A WebSocket can half-open silently
 *     (the socket stays `open` while no bytes flow), so its `health().live` is a LIE
 *     unless a watchdog probes it — and the watchdog rides on the handle. Passing the
 *     bare link drops the watchdog, so refuse it: pass the `LiveSignalHandle`
 *     `createLiveSignal`/`connectSurface`/`connectSurfaces` returns instead.
 *   - A bare in-process link (`directLink`/`stdioLink`): can't half-open, so it is
 *     never recorded in the half-open set; its transport leg is constant-`true`,
 *     honest by construction.
 *
 *  Fail-fast per the repo's "no silent fallback / crash loudly" philosophy: the
 *  half-open-blind transport leg is UNSPELLABLE over a websocket — there is no
 *  `{ live }` knob to pass a blind accessor through (the #1564 lie, one seam
 *  upstream of the dot). */
function resolveTransport(transport: unknown): {
  link: unknown;
  live: Accessor<boolean>;
} {
  if (isLiveSignalHandle(transport)) {
    return { link: transport.link, live: transport.live };
  }
  if (isHalfOpenLink(transport)) {
    throw new Error(
      "surfaceClient: a websocket link can silently half-open, so its transport " +
        "liveness must be a watchdog-backed `LiveSignalHandle`, not a bare link. " +
        "Build the client through `connectSurface`/`connectSurfaces` — or, for a " +
        "hand-built client, use `createLiveSignal(ws)` from `@kolu/surface/solid` and " +
        "pass the WHOLE handle it returns: it builds the link over `ws` itself (so " +
        "the watchdog probes the socket it reconnects via a real `system.live` " +
        "round-trip) AND wires the watchdog, with `link` and `live` paired on one " +
        "object; the handle has no other minter. A bare `() => true` or an " +
        "open/close-only `() => socketStatus() === 'live'` is half-open-blind — it " +
        "would paint a green/ready dot over a dead backend↔remote link (#1564).",
    );
  }
  // In-process link (directLink/stdioLink): live by construction.
  return { link: transport, live: () => true };
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
  upsert: (key: K, value: T) => Promise<void>;
  delete: (key: K) => Promise<void>;
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
  /** Imperative wire mutations. Available outside any component
   *  lifecycle — call from command handlers, route loaders, anywhere. */
  upsert(key: K, value: T): Promise<void>;
  delete(key: K): Promise<void>;
}

export interface BoundStream<I, T> {
  use(
    inputFn: () => I | null,
    opts?: ReactiveSubscriptionOptions,
  ): Subscription<T>;
}

export interface BoundEvent<I, T> {
  use(
    inputFn: () => I | null,
    handler: (value: T) => void,
    opts: UseEventOptions,
  ): void;
}

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
    infer P
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
  >[K] extends CollectionSpec<infer K2, infer T>
    ? BoundCollection<K2, T>
    : never;
};

type BoundStreamsFor<S extends SurfaceSpec> = {
  [K in keyof S["streams"] & string]: NonNullable<
    S["streams"]
  >[K] extends StreamSpec<infer I, infer T>
    ? BoundStream<I, T>
    : never;
};

type BoundEventsFor<S extends SurfaceSpec> = {
  [K in keyof S["events"] & string]: NonNullable<
    S["events"]
  >[K] extends EventSpec<infer I, infer T>
    ? BoundEvent<I, T>
    : never;
};

export interface SurfaceClient<S extends SurfaceSpec, Rpc = unknown> {
  /** The typed oRPC client — the link this bundle was built over. Use it for
   *  imperative procedures (`client.rpc.surface.notes.create(...)`) and for
   *  any verb the bound `.use()` shape can't model.
   *
   *  Typing note: `Rpc` is inferred from the link passed in rather than
   *  computed from `S`, because TS's union-resolution budget can't expand
   *  both `SurfaceContractFor<S>` and oRPC's `ContractRouterClient<...>`
   *  mapped types in the same evaluation pass. The link constructor
   *  (`websocketLink<typeof contract>(ws)`) pins the contract concretely at
   *  the call site, so the bundle just carries that type through. */
  readonly rpc: Rpc;
  readonly cells: BoundCellsFor<S>;
  readonly collections: BoundCollectionsFor<S>;
  readonly streams: BoundStreamsFor<S>;
  readonly events: BoundEventsFor<S>;
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
   *  page-lifetime cached client (pulam-web/drishti per-host) never needs to call
   *  it; the `connectSurface`/`connectSurfaces` seams fold it into THEIR dispose
   *  so a torn-down socket doesn't leak its readiness consume loop. */
  dispose(): void;
}

// ── Builder ────────────────────────────────────────────────────────────

/** Build the Solid client-side bundle for a surface over a **transport** — either
 *  a {@link LiveSignalHandle} (a half-openable `websocketLink` plus the watchdog
 *  that makes its liveness honest, as ONE object) OR a bare in-process link
 *  (`directLink`/`stdioLink`, which can't half-open). Walks the spec once and
 *  pre-binds each primitive to its oRPC procedure refs, producing `.use(policy)`
 *  hooks that drop the wire-identity args from the per-call signature.
 *
 *  ```ts
 *  // Direct/stdio link (can't half-open) — pass the bare link:
 *  const app = surfaceClient(surface, directLink(server));
 *
 *  // Websocket link (CAN half-open) — pass the watchdog-backed handle WHOLE.
 *  // Reach for `connectSurface` (`@kolu/surface-app`), which wires it for you; or,
 *  // hand-built, use `createLiveSignal`, which BUILDS the link over `ws` (so the
 *  // watchdog probes the socket it reconnects) and returns the handle:
 *  const transport = createLiveSignal<typeof contract>(ws, {});
 *  const app = surfaceClient(surface, transport);
 *  ```
 *
 *  Collapsing link+live into ONE handle argument is what makes the pairing hold by
 *  construction: there is no separate `{ live }` seam to pass a half-open-blind
 *  accessor through, and no way to pair a live with a DIFFERENT, self-rolled link.
 *
 *  This is the unification: the bundle no longer bakes in the WebSocket transport —
 *  it consumes whatever transport it's handed, so the same hooks work over a socket,
 *  a subprocess, or an in-process direct link. `Rpc` flows from the handle's contract
 *  `C` (or the bare link's type) through to `.rpc`. */
export function surfaceClient<
  const S extends SurfaceSpec,
  C extends AnyContractRouter,
>(
  surface: Surface<S>,
  handle: LiveSignalHandle<C>,
): SurfaceClient<S, ContractRouterClient<C, ClientRetryPluginContext>>;
export function surfaceClient<const S extends SurfaceSpec, Rpc = unknown>(
  surface: Surface<S>,
  link: Rpc,
): SurfaceClient<S, Rpc>;
export function surfaceClient<const S extends SurfaceSpec>(
  surface: Surface<S>,
  transport: unknown,
): SurfaceClient<S, unknown> {
  // Collapse the transport to its `{ link, live }` — a `LiveSignalHandle` carries
  // both (paired by construction); a bare half-openable link CRASHES here; a bare
  // in-process link gets a constant-`true` leg (sound — it can't half-open).
  const { link, live } = resolveTransport(transport);
  return buildSurfaceClient(surface, link, live);
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
): { standing: ReadOnlyUseCellResult<unknown>; dispose: () => void } {
  const liveWhen = cellSpec.liveWhen as (value: unknown) => boolean;
  let standing!: ReadOnlyUseCellResult<unknown>;
  const dispose = createRoot((disposeRoot) => {
    const s = useCell(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.cells as any)[key],
      { source, authority: "server" },
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
  link: unknown,
  registry: ReturnType<typeof createSurfaceHealthRegistry>,
  surface: Surface<S>,
): { cell: BoundCell<unknown, unknown>; disposeRoot?: () => void } {
  // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the typed client
  const ns = (link as any).surface[key];
  const source: StreamingProcedure<undefined, unknown> = ns.get;
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
    ? openReadinessLeg(key, cellSpec, source, registry, surface)
    : undefined;
  const standing = leg?.standing;
  const cell: BoundCell<unknown, unknown> = {
    use: (boundOpts) => {
      // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
      const opts: any = boundOpts ?? {};
      // A read-only `liveWhen` cell SHARES its eager standing subscription. Forward
      // `onError` as a reactive observer of the shared (self-clearing) error, so the
      // read-only `.use({onError})` contract still fires.
      const shared = readOnly ? standing : undefined;
      if (shared) {
        if (opts.onError) {
          const cb = opts.onError as (err: Error) => void;
          createEffect(() => {
            const e = shared.error();
            if (e) cb(e);
          });
        }
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
        const cell = useCell(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
          (surface.descriptors.cells as any)[key],
          // Thread the caller's `onError` (the only `ReadOnlyBoundCellOptions` field)
          // into the server-authority subscription so a get-only cell's stream failure
          // reaches callback-based error handling, not just the `error()` signal —
          // `useCellServer` forwards it to `createSubscription`.
          { source, authority: "server", onError: opts.onError },
        );
        // Enrol the cell's self-clearing error()/pending() into health() — rides this
        // `.use()`'s consumer owner, so it drops when the component unmounts.
        registry.enroll(key, { pending: cell.pending, error: cell.error });
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
      const cell = useCell(
        // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
        (surface.descriptors.cells as any)[key],
        merged,
      );
      registry.enroll(key, { pending: cell.pending, error: cell.error });
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
 *  @internal Package-private: exported for the relative-import fold tests (which need
 *  a stub link AND a custom `live` together), NOT in the `@kolu/surface/solid` barrel
 *  — so no EXTERNAL consumer can supply a `live` paired with a separate link (the
 *  whole point of collapsing the pair into a `LiveSignalHandle` at the public API). */
export function buildSurfaceClient<const S extends SurfaceSpec, Rpc>(
  surface: Surface<S>,
  link: Rpc,
  live: Accessor<boolean>,
): SurfaceClient<S, Rpc> {
  const spec = surface.spec;
  // The per-client subscription-health registry. Every `.use()` below enrols its
  // subscription, so `health()` folds a TOTAL picture (a partial registry behind
  // a confident gate is worse than no gate — `./health`). The transport leg is the
  // resolved `live` — the watchdog-backed handle's `live` for a half-openable link,
  // else a constant `true` (sound only because `resolveTransport` already proved
  // this link can't half-open).
  const registry = createSurfaceHealthRegistry(live);

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
      link,
      registry,
      surface,
    );
    cells[key] = cell;
    if (disposeRoot) standingRoots.push(disposeRoot);
  }

  const collections: Record<string, BoundCollection<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.collections ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (link as any).surface[key];
    const upsert = (k: unknown, v: unknown) => ns.upsert({ key: k, value: v });
    const del = (k: unknown) => ns.delete({ key: k });
    collections[key] = {
      use: (opts) => {
        const onError = opts?.onError;
        // Default keys: subscribe to the server's keys stream and lift
        // it to a SolidJS accessor. The `.use()` runs inside a Solid
        // owner so the subscription disposes with the component.
        const keys =
          opts?.keys ??
          (() => {
            const sub = createSubscription<unknown[]>(
              () => unenrolledStreamCall(ns.keys, undefined),
              { onError },
            );
            // Leak B: enrol the keys-stream itself. A failing keys stream
            // collapses `keys()` to `[]` (the `sub() ?? []` fallback), so the
            // collection would otherwise read as a healthy EMPTY set — without
            // this, `health()` reports `ready` over a dead collection. This
            // enrolment is the keys-stream's ONLY error channel now (it subsumes
            // the former per-collection `keysError` accessor); a caller-supplied
            // `keys` owns its own subscription and so isn't enrolled here.
            registry.enroll(`${key}.keys`, sub);
            return createMemo<unknown[]>(() => sub() ?? []);
          })();
        const view = useCollection(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (surface.descriptors.collections as any)[key],
          {
            keys,
            valueSource: ns.get,
            keyToInput: (k) => ({ key: k }),
            onError,
            // Enrol each per-key value sub as `<key>[<id>]`. The callback runs
            // inside the `mapArray` per-key owner, so each enrolment drops when
            // its key leaves the set (the same owner disposal `useCollection`
            // already rides for the subscription itself).
            enroll: (k, sub) => registry.enroll(`${key}[${String(k)}]`, sub),
          },
        );
        return { ...view, upsert, delete: del };
      },
      upsert,
      delete: del,
    };
  }

  const streams: Record<string, BoundStream<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (link as any).surface[key];
    streams[key] = {
      use: (inputFn, streamOpts) => {
        const sub = useStream(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (surface.descriptors.streams as any)[key],
          inputFn,
          ns.get,
          streamOpts,
        );
        registry.enroll(key, sub);
        return sub;
      },
    };
  }

  const events: Record<string, BoundEvent<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (link as any).surface[key];
    events[key] = {
      use: (inputFn, handler, eventOpts) =>
        useEvent(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (surface.descriptors.events as any)[key],
          inputFn,
          ns.get,
          handler,
          eventOpts,
        ),
    };
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
    const ctl = new AbortController();
    onCleanup(() => ctl.abort());
    void (async () => {
      try {
        const stream = await unenrolledStreamCall(procedure, input, {
          signal: ctl.signal,
          onRetry: () => {
            // A reconnect: back to pending, drop the stale error, and let the
            // caller clear any derived view before the fresh snapshot lands.
            setPending(true);
            setError(undefined);
            opts.onRetry?.();
          },
        });
        for await (const item of stream) {
          // Self-clearing edge: each frame proves the stream is live, so a
          // transient failure heals the instant it re-delivers (no latch).
          if (pending()) setPending(false);
          if (error()) setError(undefined);
          opts.onItem(item);
        }
        // Clean completion (the server ended the stream): no longer pending.
        setPending(false);
      } catch (err) {
        if (ctl.signal.aborted || opts.isExpectedStop?.(err)) return;
        // A real failure: clear pending so an errored-on-first-frame sub reads
        // `degraded`, never a stuck `connecting`, then record the error.
        setPending(false);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return source;
  }

  return {
    rpc: link,
    cells: cells as BoundCellsFor<S>,
    collections: collections as BoundCollectionsFor<S>,
    streams: streams as BoundStreamsFor<S>,
    events: events as BoundEventsFor<S>,
    health: registry.health,
    enroll: registry.enroll,
    rawStream,
    dispose: () => {
      for (const disposeRoot of standingRoots) disposeRoot();
    },
  };
}

// ── surfaceClients — sibling surfaces over one link ─────────────────────

/** The per-key client bundle returned by `surfaceClients`. Each value is a
 *  full `SurfaceClient` for that key's surface, scoped to the key's slice of
 *  the combined link. */
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
 *  combined websocket (the watchdog-backed live and the combined link arrive as ONE
 *  object), or a bare combined in-process link for a direct/stdio transport. The
 *  combined link is shaped `{ surface: { <key>: innerLink } }` — i.e. the same
 *  `{ surface: { <key>: ... } }` namespacing `composeSurfaceContracts` produces. Each
 *  per-key client is built over a SCOPED link `{ surface: link.surface[key] }`, so the
 *  bundle's internal walk (`(link as any).surface[<prim>]`) resolves at
 *  `link.surface[key].<prim>` — i.e. the wire path `/surface/<key>/<prim>/<verb>`
 *  that `implementSurfaces` serves. The siblings ride ONE combined socket, so they
 *  share the handle's ONE watchdog-backed `live` — every sibling reports it, so
 *  `surfaceClientsHealth`'s AND-reduce flips the merged fact `live: false` when that
 *  socket dies.
 *
 *  Reaching a primitive through a returned client therefore goes through
 *  that client's `.rpc` (the scoped link), e.g. for a probe procedure under
 *  surface key `surfaceApp` with namespace `identity` and verb `info`:
 *
 *      clients.surfaceApp.rpc.surface.identity.info(...)
 *
 *  (NOT `clients.surfaceApp.rpc.surface.surfaceApp.identity.info` — the key
 *  is already consumed by the scope, so it does not reappear in the path.) */
export function surfaceClients<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  const E extends Record<string, Surface<any>>,
>(
  // biome-ignore lint/suspicious/noExplicitAny: a LiveSignalHandle over the combined websocket, or a dynamic combined ContractRouterClient; scoping is walk-by-string.
  transport: any,
  entries: E,
): SurfaceClients<E> {
  // Collapse the combined transport ONCE, at the public boundary: a
  // `LiveSignalHandle` yields the combined `link` and the shared watchdog-backed
  // `live` (paired by construction); a bare half-openable combined link CRASHES
  // (the green-over-dead-link lie for EVERY sibling); a bare in-process link gets a
  // constant-`true` leg. The per-sibling slices below are fresh `{ surface }`
  // wrappers that no longer carry the half-open marker, so each child is built via
  // the internal `buildSurfaceClient` with the shared `live` — no per-slice brand
  // check (the guard already ran here, on the combined transport).
  const { link, live } = resolveTransport(transport);
  return Object.fromEntries(
    Object.entries(entries).map(([k, surface]) => [
      k,
      buildSurfaceClient(
        surface,
        {
          // biome-ignore lint/suspicious/noExplicitAny: scoped link slice is dynamic; the per-surface spec carries call-site safety.
          surface: (link as any).surface[k],
          // biome-ignore lint/suspicious/noExplicitAny: scoped link slice is dynamic; the per-surface spec carries call-site safety.
        } as any,
        live,
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
