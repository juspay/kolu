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
import { isLiveSignal } from "./liveSignal";
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

/** Crash if `link` can silently half-open (a `websocketLink`) but the `{ live }`
 *  supplied is not a watchdog-backed {@link LiveSignal}. A WebSocket can half-open
 *  silently (the socket stays `open` while no bytes flow), so its `health().live`
 *  is honest ONLY when a heartbeat actively probes it — and the only signal that
 *  PROVES a heartbeat backs it is a `LiveSignal`, minted by `@kolu/surface-app`'s
 *  `createLiveSignal` (which `connectSurface`/`connectSurfaces` wrap) THROUGH the
 *  watchdog it wires. So `!isLiveSignal(live)` rejects BOTH a missing `{ live }`
 *  AND a truthy-but-unbranded one — a bare `() => true` or an open/close-only
 *  `() => socketStatus() === "live"` is half-open-BLIND (it reads `live` forever
 *  over a silently dead link), and the brand is exactly what it lacks. An
 *  in-process link (`directLink`/`stdioLink`) can't half-open, so it is never
 *  recorded in the half-open set and any `{ live }` (or none) is honest there.
 *  Fail-fast per the repo's "no silent fallback / crash loudly" philosophy: the
 *  half-open-blind transport leg is now UNSPELLABLE over a websocket, not merely
 *  discouraged (the #1564 lie, one seam upstream of the dot). */
function requireTransportLive(
  link: unknown,
  live: Accessor<boolean> | undefined,
): void {
  if (!isLiveSignal(live) && isHalfOpenLink(link)) {
    throw new Error(
      "surfaceClient: a websocket link can silently half-open, so its transport " +
        "liveness must be a watchdog-backed `LiveSignal`, not a bare `{ live }`. " +
        "Build the client through `connectSurface`/`connectSurfaces` — or, for a " +
        "hand-built `surfaceClient + websocketLink`, mint the signal with " +
        "`createLiveSignal(ws, { probe })` from `@kolu/surface/solid` (it wires " +
        "the half-open heartbeat AND brands the live signal in one call — the brand " +
        "has no other minter). A bare " +
        "`() => true` or an open/close-only `() => socketStatus() === 'live'` is " +
        "half-open-blind — it would paint a green/ready dot over a dead " +
        "backend↔remote link (#1564).",
    );
  }
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

/** Build the Solid client-side bundle for a surface over a **link** — any
 *  member of the link family (`websocketLink`, `stdioLink`, `directLink`),
 *  i.e. a `ContractRouterClient`. Walks the spec once and pre-binds each
 *  primitive to its oRPC procedure refs, producing `.use(policy)` hooks that
 *  drop the wire-identity args from the per-call signature.
 *
 *  ```ts
 *  // Direct/stdio link (can't half-open) — no `{ live }` needed:
 *  const app = surfaceClient(surface, directLink(server));
 *
 *  // Websocket link (CAN half-open) — REQUIRES a watchdog-backed `{ live }`.
 *  // Reach for `connectSurface` (`@kolu/surface-app`), which wires it for you;
 *  // or, hand-built, mint it with `createLiveSignal` (NEVER a bare `() => true`):
 *  const link = websocketLink<typeof contract>(ws);
 *  const { live } = createLiveSignal(ws, { probe: () => probeSurfaceLive(link) });
 *  const app = surfaceClient(surface, link, { live });
 *  ```
 *
 *  This is the unification: the bundle no longer bakes in the WebSocket
 *  transport — it consumes whatever link it's handed, so the same hooks work
 *  over a socket, a subprocess, or an in-process direct link.
 *
 *  `Rpc` is inferred from the `link` argument and defaults to `unknown`, so
 *  pass a real link — the link constructor (`websocketLink<typeof contract>(ws)`)
 *  is what pins the contract type that flows through to `.rpc`. There's no
 *  separate transport option to forget; the link *is* the argument. */
export function surfaceClient<const S extends SurfaceSpec, Rpc = unknown>(
  surface: Surface<S>,
  link: Rpc,
  opts?: {
    /** Transport liveness for `health().live` — the socket/heartbeat watchdog's
     *  reactive answer. Omitted ONLY for a link that can't be silently half-open
     *  (a `directLink`/`stdioLink`), where it is live by construction; for a
     *  `websocketLink` it is REQUIRED and must be a watchdog-backed `LiveSignal`
     *  (minted by `createLiveSignal` / `connectSurface` / `connectSurfaces`) —
     *  omitting it OR passing a bare/open-close-only accessor crashes (see
     *  `requireTransportLive`) rather than silently defaulting the transport leg
     *  to a half-open-blind `true`. The seams thread the real signal in;
     *  `health()` originates the per-subscription FACT either way. */
    live?: Accessor<boolean>;
  },
): SurfaceClient<S, Rpc> {
  const spec = surface.spec;
  // FAIL FAST: a `websocketLink` can silently half-open, so its transport leg
  // MUST be supplied — defaulting it to constant-`true` would paint a
  // green/ready dot over a dead backend↔remote link (#1564), one seam upstream.
  requireTransportLive(link, opts?.live);
  // The per-client subscription-health registry. Every `.use()` below enrols its
  // subscription, so `health()` folds a TOTAL picture (a partial registry behind
  // a confident gate is worse than no gate — `./health`). The transport leg is
  // the supplied `live` for a half-openable link, else a constant `true` (sound
  // only because `requireTransportLive` already proved this link can't half-open).
  const registry = createSurfaceHealthRegistry(opts?.live ?? (() => true));

  // Build-time standing subscriptions for `liveWhen` cells (the readiness legs)
  // and their disposers. Created EAGERLY below (not at `.use()` time) so the
  // mirror-liveness leg folds into `health().live` by construction — independent
  // of whether any component ever mounts the cell. `dispose()` runs these roots.
  const standingRoots: Array<() => void> = [];
  const standingCells: Record<string, ReadOnlyUseCellResult<unknown>> = {};

  const cells: Record<string, BoundCell<unknown, unknown>> = {};
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the typed client
    const ns = (link as any).surface[key];
    const source: StreamingProcedure<undefined, unknown> = ns.get;
    // Bind the cell's CLIENT mutation verb — the one the bound `.use()` mutate
    // path actually calls. Only `set`/`patch` qualify; `test__set` is the e2e
    // reset procedure, never a consumer mutation, so a `["get", "test__set"]`
    // cell (e.g. `activityFeed` / `session`) stays read-only on the client.
    //
    // Resolve the EXPOSED verb through `resolveCellVerbs` — the SAME helper the
    // contract derivation (`cellContractEntries`) and the server handler walk
    // call — rather than re-spelling the patch/no-patch default here. This keeps
    // the binding aligned with `CellIsMutable` even for the legal `patchSchema`
    // + explicit-`set` cell — whose client patch shape the bound type
    // (`CellHasPatchVerb`) collapses to the full value `T`, so a `.patch` posts a
    // full value to this `ns.set`, never a partial the endpoint would reject. It
    // also leaves `mutate` undefined for a get-only cell so the read-only
    // `.use()` type (no `set`/`patch`) keeps callers off a mutate path the wire
    // can't service.
    const verbs = resolveCellVerbs(cellSpec);
    const mutateVerb = verbs.includes("patch")
      ? "patch"
      : verbs.includes("set")
        ? "set"
        : undefined;
    const mutate = mutateVerb ? ns[mutateVerb] : undefined;
    // Spec-declared `patch` doubles as the default `applyPatch` for
    // authority-`local` cells, so server and client merge with the same
    // function without the consumer importing it twice.
    //
    // Inject it ONLY when the exposed client mutation verb is `patch` — i.e.
    // when the bound type carries the partial `P` (`BoundCell<T, P>`) and the
    // local-authority `.patch(P)` / coalesce path actually feeds a `P` to this
    // merge. For the legal `patchSchema` + explicit-`set` cell the bound type
    // collapses to `BoundCell<T, T>`: `.set(T)` / `.patch(T)` carry the full
    // value, so `applyLocal` must full-replace, NOT route through `cellSpec.patch`
    // (which expects a partial `P`, not a `T`). Skipping the inject here leaves
    // `applyPatch` undefined, so `useCell`'s no-helper branch treats `P` as `T`
    // and replaces wholesale — sound against the full-value `set` endpoint.
    const specPatch = mutateVerb === "patch" ? cellSpec.patch : undefined;
    // A get-only cell has NO client mutation verb. Make it read-only at RUNTIME,
    // not only at the TS surface: branch to a server-authority `useCell` and
    // return ONLY `{ value, pending, error, sub }` — no `set`/`patch` to call an
    // absent `ns.<verb>`, and no local store at all. A forced `authority: "local"`
    // (a JS / `any` caller the type can't stop) FAILS FAST here, BEFORE
    // `useCellLocal` would seed a local store and let a `.set`/`.patch` mutate it
    // ahead of discovering there is no mutate handler. Fail-fast per the design
    // philosophy: a read-only contract that silently half-mutates a local store
    // is the "graceful degradation" defect, not a feature.
    const readOnly = mutateVerb === undefined;
    // A READINESS-GATE cell (`liveWhen`): open its server subscription NOW, in a
    // detached `createRoot` (surfaceClient itself runs outside any owner), and
    // (a) `enroll` its pending/error so the cell's own stream-health is TOTAL in
    // `subs` even with zero `.use()`, and (b) `enrollReadiness` the predicate over
    // its live value so `health().live` AND-folds the mirror state BY
    // CONSTRUCTION. This is the client-side symmetry to `pumpRemoteSurface`
    // auto-wiring the server WRITE: composing the cell entails the fold, so the
    // green-over-dead-mirror lie has no `.use()`-conditional escape (a dot-only
    // viewer that never mounts the cell still reads the complete fact).
    if (cellSpec.liveWhen) {
      const liveWhen = cellSpec.liveWhen as (value: unknown) => boolean;
      createRoot((disposeRoot) => {
        const standing = useCell(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
          (surface.descriptors.cells as any)[key],
          { source, authority: "server" },
        );
        registry.enroll(key, {
          pending: standing.pending,
          error: standing.error,
        });
        registry.enrollReadiness(key, () =>
          liveWhen(standing.value() ?? cellSpec.default),
        );
        standingCells[key] = standing as ReadOnlyUseCellResult<unknown>;
        standingRoots.push(disposeRoot);
      });
    }
    cells[key] = {
      use: (boundOpts) => {
        // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
        const opts: any = boundOpts ?? {};
        // A read-only `liveWhen` cell SHARES its eager standing subscription —
        // no second `.get` stream, no duplicate member in `subs`. Forward
        // `onError` as a reactive observer of the shared (self-clearing) error,
        // so the read-only `.use({onError})` contract still fires.
        const standing = readOnly ? standingCells[key] : undefined;
        if (standing) {
          if (opts.onError) {
            const cb = opts.onError as (err: Error) => void;
            createEffect(() => {
              const e = standing.error();
              if (e) cb(e);
            });
          }
          return {
            value: standing.value,
            pending: standing.pending,
            error: standing.error,
            sub: standing.sub,
            // biome-ignore lint/suspicious/noExplicitAny: read-only projection over the BoundCell<unknown> map type
          } as any;
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
            // Thread the caller's `onError` (the only `ReadOnlyBoundCellOptions`
            // field) into the server-authority subscription so a get-only cell's
            // stream failure reaches callback-based error handling, not just the
            // `error()` signal — `useCellServer` forwards it to `createSubscription`.
            { source, authority: "server", onError: opts.onError },
          );
          // Enrol the cell's self-clearing error()/pending() into health() — rides
          // this `.use()`'s consumer owner, so it drops when the component unmounts.
          registry.enroll(key, { pending: cell.pending, error: cell.error });
          // Return ONLY the read-only projection — `set`/`patch` are absent at
          // runtime, matching `ReadOnlyUseCellResult`. The cast bridges the
          // walk-by-string `BoundCell` map; the typed `BoundCellsFor` already
          // narrows a get-only cell to `ReadOnlyBoundCell`.
          return {
            value: cell.value,
            pending: cell.pending,
            error: cell.error,
            sub: cell.sub,
            // biome-ignore lint/suspicious/noExplicitAny: read-only projection over the BoundCell<unknown> map type
          } as any;
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
 *  link (the counterpart to `implementSurfaces` / `composeSurfaceContracts`).
 *
 *  The combined link is shaped `{ surface: { <key>: innerLink } }` — i.e.
 *  the same `{ surface: { <key>: ... } }` namespacing `composeSurfaceContracts`
 *  produces. Each per-key client is built over a SCOPED link
 *  `{ surface: link.surface[key] }`, so the bundle's internal walk
 *  (`(link as any).surface[<prim>]`) resolves at `link.surface[key].<prim>`
 *  — i.e. the wire path `/surface/<key>/<prim>/<verb>` that
 *  `implementSurfaces` serves.
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
  // biome-ignore lint/suspicious/noExplicitAny: combined link is a dynamic ContractRouterClient; scoping is walk-by-string.
  link: any,
  entries: E,
  /** Transport liveness for EVERY sibling's `health().live`. The siblings ride
   *  ONE combined socket, so they share ONE `live` — and over a websocket it must
   *  be a watchdog-backed `LiveSignal` (minted by `createLiveSignal` /
   *  `connectSurfaces`), not a bare `() => socketStatus(ws)() === "live"`: a
   *  half-open-blind accessor would read `live` forever over a dead combined
   *  socket. Every sibling reports it, so `surfaceClientsHealth`'s AND-reduce
   *  flips the merged fact `live: false` when that socket dies. Omit only for a
   *  direct/stdio link that can't be half-open (then it stays constant `true`). */
  opts?: { live?: Accessor<boolean> },
): SurfaceClients<E> {
  // Same fail-fast as `surfaceClient`, BEFORE scoping: the combined `link` is the
  // half-openable websocket (the per-sibling slices below are fresh wrappers that
  // no longer carry the marker), so a missing `{ live }` over it is the
  // green-over-dead-link lie for EVERY sibling. Crash here rather than let each
  // scoped client silently default its transport leg to constant-`true`.
  requireTransportLive(link, opts?.live);
  return Object.fromEntries(
    Object.entries(entries).map(([k, surface]) => [
      k,
      surfaceClient(
        surface,
        {
          surface: link.surface[k],
          // biome-ignore lint/suspicious/noExplicitAny: scoped link slice is dynamic; the per-surface spec carries call-site safety.
        } as any,
        opts,
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
