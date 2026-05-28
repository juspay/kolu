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
import {
  createCellsClient,
  type StreamingProcedure,
  streamCall,
} from "../client";
import type {
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
          onError?: (err: Error) => void;
        }
  : { authority?: "server"; onError?: (err: Error) => void };

export interface BoundCell<T, P = T> {
  use(opts?: BoundCellOptions<T, P>): UseCellResult<T, P>;
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
    ? BoundCell<T, P>
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
  /** The typed oRPC client. Use this for imperative procedures
   *  (`client.rpc.surface.notes.create(...)`) and for any verb the bound
   *  `.use()` shape can't model.
   *
   *  Typing note: `Rpc` is supplied at the call site rather than computed
   *  from `S` because TS's union-resolution budget can't expand both
   *  `SurfaceContractFor<S>` and oRPC's `ContractRouterClient<...>` mapped
   *  types in the same evaluation pass — the call site narrows it cheaply
   *  via `typeof surface.contract`. See `surfaceClient`'s defaulted generic. */
  readonly rpc: Rpc;
  readonly cells: BoundCellsFor<S>;
  readonly collections: BoundCollectionsFor<S>;
  readonly streams: BoundStreamsFor<S>;
  readonly events: BoundEventsFor<S>;
}

// ── Builder ────────────────────────────────────────────────────────────

/** Build the client-side bundle for a surface. Walks the spec once and
 *  pre-binds each primitive to its oRPC procedure refs, producing
 *  `.use(policy)` hooks that drop the wire-identity args from the per-call
 *  signature. */
export function surfaceClient<const S extends SurfaceSpec, Rpc = unknown>(
  surface: Surface<S>,
  opts: { websocket: WebSocket },
): SurfaceClient<S, Rpc> {
  // Narrow `Rpc` at the call site: e.g.
  //   surfaceClient<typeof surface.spec, ContractRouterClient<typeof surface.contract, …>>(…)
  // Defaulting to `unknown` keeps the bundle's generic from triggering the
  // mapped-type union explosion that breaks `ReturnType<typeof createCellsClient<…>>`
  // when used as a default. Consumers typically reach for `bundle.rpc` only
  // for imperative procedures and get away with a one-line cast.
  // biome-ignore lint/suspicious/noExplicitAny: see comment on `Rpc` generic
  const rpc = createCellsClient<any>(opts) as Rpc;
  const spec = surface.spec;

  const cells: Record<string, BoundCell<unknown, unknown>> = {};
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the typed client
    const ns = (rpc as any).surface[key];
    const source: StreamingProcedure<undefined, unknown> = ns.get;
    const mutate = cellSpec.patchSchema ? ns.patch : ns.set;
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
    const ns = (rpc as any).surface[key];
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
    const ns = (rpc as any).surface[key];
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
    const ns = (rpc as any).surface[key];
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
    rpc,
    cells: cells as BoundCellsFor<S>,
    collections: collections as BoundCollectionsFor<S>,
    streams: streams as BoundStreamsFor<S>,
    events: events as BoundEventsFor<S>,
  };
}
