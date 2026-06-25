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
  CellIsMutable,
  CellSpec,
  CollectionSpec,
  EventSpec,
  StreamSpec,
  Surface,
  SurfaceSpec,
} from "../define";
import type { ReactiveSubscriptionOptions } from "./createReactiveSubscription";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";
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
      : BoundCell<T, P>
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
): SurfaceClient<S, Rpc> {
  const spec = surface.spec;

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
    // Resolve the EXPOSED verb directly from the cell's resolved verbs — the
    // same set `cellContractEntries` walks — rather than guessing from
    // `patchSchema`. Default verbs are `["get", "patch"]` when a `patchSchema`
    // is declared, else `["get", "set"]`; an explicit `verbs` lists whichever
    // it exposes. This keeps the binding aligned with `CellIsMutable` even for
    // the legal `patchSchema` + explicit-`set` cell — and leaves `mutate`
    // undefined for a get-only cell so the read-only `.use()` type (no
    // `set`/`patch`) keeps callers off a mutate path the wire can't service.
    const verbs =
      cellSpec.verbs ??
      (cellSpec.patchSchema ? ["get", "patch"] : ["get", "set"]);
    const mutateVerb = verbs.includes("patch")
      ? "patch"
      : verbs.includes("set")
        ? "set"
        : undefined;
    const mutate = mutateVerb ? ns[mutateVerb] : undefined;
    // Spec-declared `patch` doubles as the default `applyPatch` for
    // authority-`local` cells, so server and client merge with the same
    // function without the consumer importing it twice.
    const specPatch = cellSpec.patch;
    cells[key] = {
      use: (boundOpts) => {
        // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
        const merged: any = { ...(boundOpts ?? {}), source, mutate };
        if (
          specPatch &&
          merged.authority === "local" &&
          merged.applyPatch === undefined &&
          merged.mergeIntoStore === undefined
        ) {
          merged.applyPatch = specPatch;
        }
        return useCell(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
          (surface.descriptors.cells as any)[key],
          merged,
        );
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
              () => streamCall(ns.keys, undefined),
              { onError },
            );
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
      use: (inputFn, streamOpts) =>
        useStream(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (surface.descriptors.streams as any)[key],
          inputFn,
          ns.get,
          streamOpts,
        ),
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
