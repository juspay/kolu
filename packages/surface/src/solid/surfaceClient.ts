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

import { type Accessor, createMemo } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { type StreamingProcedure, streamCall } from "../client";
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
import type { ReactiveSubscriptionOptions } from "./createReactiveSubscription";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";
import {
  createSurfaceHealthRegistry,
  type HealthSource,
  type SurfaceHealth,
} from "./health";
import { type UseCellResult, useCell } from "./useCell";
import { type UseCollectionResult, useCollection } from "./useCollection";
import { type UseEventOptions, useEvent } from "./useEvent";
import { useStream } from "./useStream";

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
 *  reach for `app.rpc.surface.<key>.{upsert,delete}` from event handlers. */
export interface BoundCollectionResult<K, T> extends UseCollectionResult<K, T> {
  upsert: (key: K, value: T) => Promise<void>;
  delete: (key: K) => Promise<void>;
  /** The DEFAULT keys subscription's own reactive, self-clearing error — the
   *  failure that turns `keys()` into a silent empty/stale set. `undefined`
   *  while healthy AND when the caller supplies its own `keys` (then the caller
   *  owns that subscription's error). Read it where you read `byKey(id).error()`
   *  so a keys-stream 500 surfaces instead of collapsing the collection to `[]`
   *  with no visible error. Self-clearing like every `createSubscription` error:
   *  it disappears the instant the keys stream re-delivers. */
  keysError: Accessor<Error | undefined>;
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
   *  keys-stream + per-key, streams) enrol automatically; this is the escape
   *  hatch for a raw `streamCall` that owns its loop + error state (Leak A), so
   *  even a hand-driven stream's failure reaches `health()` instead of a private
   *  `console.error`. Returns a disposer; also auto-drops via `onCleanup`. */
  enroll(name: string, source: HealthSource): () => void;
}

// ── Builder ────────────────────────────────────────────────────────────

/** Build the Solid client-side bundle for a surface over a **link** — any
 *  member of the link family (`websocketLink`, `stdioLink`, `directLink`),
 *  i.e. a `ContractRouterClient`. Walks the spec once and pre-binds each
 *  primitive to its oRPC procedure refs, producing `.use(policy)` hooks that
 *  drop the wire-identity args from the per-call signature.
 *
 *  ```ts
 *  const app = surfaceClient(surface, websocketLink<typeof contract>(ws));
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
     *  reactive answer. Defaults to a constant `true`: a direct/stdio link can't
     *  be silently half-open, so it is live by construction. The socket
     *  transports (`@kolu/surface-app`'s `connectSurface`) thread the real
     *  signal in; `health()` originates the per-subscription FACT either way. */
    live?: Accessor<boolean>;
  },
): SurfaceClient<S, Rpc> {
  const spec = surface.spec;
  // The per-client subscription-health registry. Every `.use()` below enrols its
  // subscription, so `health()` folds a TOTAL picture (a partial registry behind
  // a confident gate is worse than no gate — `./health`).
  const registry = createSurfaceHealthRegistry(opts?.live ?? (() => true));

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
    cells[key] = {
      use: (boundOpts) => {
        // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
        const opts: any = boundOpts ?? {};
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
        // The default keys subscription's own self-clearing error, surfaced on
        // the result so a consumer can read it the same way it reads
        // `byKey(id).error()`. A caller-supplied `keys` owns its own error, so
        // there is no internal sub to observe — `keysError` is a constant
        // `undefined`. Without this, a failing default keys stream silently
        // collapses `keys()` to `[]` (the `sub() ?? []` fallback) and the
        // collection reads as an empty set with NO visible error.
        let keysError: Accessor<Error | undefined> = () => undefined;
        // Default keys: subscribe to the server's keys stream and lift
        // it to a SolidJS accessor. The `.use()` runs inside a Solid
        // owner so the subscription disposes with the component.
        const keys =
          opts?.keys ??
          (() => {
            const sub = createSubscription<unknown[]>(
              () => streamCall(ns.keys, undefined),
              { onError },
            );
            keysError = sub.error;
            // Leak B: enrol the keys-stream itself. A failing keys stream
            // collapses `keys()` to `[]` (the `sub() ?? []` fallback), so the
            // collection reads as a healthy EMPTY set — without this, `health()`
            // reports `ready` over a dead collection. (The bespoke `keysError`
            // accessor above predates `health()` and is now subsumed by it.)
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
        return { ...view, keysError, upsert, delete: del };
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

  return {
    rpc: link,
    cells: cells as BoundCellsFor<S>,
    collections: collections as BoundCollectionsFor<S>,
    streams: streams as BoundStreamsFor<S>,
    events: events as BoundEventsFor<S>,
    health: registry.health,
    enroll: registry.enroll,
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
): SurfaceClients<E> {
  return Object.fromEntries(
    Object.entries(entries).map(([k, surface]) => [
      k,
      surfaceClient(surface, {
        surface: link.surface[k],
        // biome-ignore lint/suspicious/noExplicitAny: scoped link slice is dynamic; the per-surface spec carries call-site safety.
      } as any),
    ]),
  ) as SurfaceClients<E>;
}
