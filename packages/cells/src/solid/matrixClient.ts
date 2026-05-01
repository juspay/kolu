/**
 * `matrixClient` — client-side bundle generated from a matrix.
 *
 * Walks `matrix.descriptors` once and pre-binds each Cell/Collection/Stream/Event
 * to its typed oRPC procedure refs, exposing a `.use(policy)` hook per
 * primitive that drops `source` / `mutate` / `valueSource` / `keyToInput`
 * from the per-call args. Imperative procedures stay accessible via
 * `bundle.rpc.<ns>.<verb>(...)`.
 *
 * Type narrowing for `useCell` (server- vs local-authority discriminator)
 * is preserved across the bind: the bound `.use()` accepts the same
 * `UseCellOptions` union, just with `source` / `mutate` already filled in.
 */

import type { ZodType } from "zod";
import { createCellsClient, type StreamingProcedure } from "../client";
import type {
  CellSpec,
  CollectionSpec,
  EventSpec,
  Matrix,
  MatrixContractFor,
  MatrixSpec,
  StreamSpec,
} from "../define";
import type { ReactiveSubscriptionOptions } from "./createReactiveSubscription";
import type { Subscription, SubscriptionOptions } from "./createSubscription";
import { useCell, type UseCellResult } from "./useCell";
import { useCollection, type UseCollectionResult } from "./useCollection";
import { useEvent, type UseEventOptions } from "./useEvent";
import { useStream } from "./useStream";

// ── Bound-primitive option shapes ──────────────────────────────────────

/** Cell `.use()` options — same shape as `UseCellOptions` minus the
 *  `source` and `mutate` refs (the matrix supplies them). The
 *  authority/initial/applyPatch discriminator is preserved verbatim. */
export type BoundCellOptions<T, P = T> = T extends object
  ?
      | { authority?: "server"; onError?: (err: Error) => void }
      | {
          authority: "local";
          initial: T;
          applyPatch?: (current: T, patch: P) => T;
          mergeIntoStore?: (
            setStore: (...args: unknown[]) => void,
            patch: P,
          ) => void;
          onError?: (err: Error) => void;
        }
  : { authority?: "server"; onError?: (err: Error) => void };

export interface BoundCell<T, P = T> {
  use(opts?: BoundCellOptions<T, P>): UseCellResult<T, P>;
}

export interface BoundCollection<K, T> {
  use(opts: {
    keys: () => K[];
    onError?: SubscriptionOptions<unknown>["onError"];
  }): UseCollectionResult<K, T>;
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
    opts?: UseEventOptions,
  ): void;
}

// ── Bundle type — mapped over the matrix spec ──────────────────────────

type BoundCellsFor<S extends MatrixSpec> = {
  [K in keyof S["cells"] & string]: NonNullable<S["cells"]>[K] extends CellSpec<
    infer T,
    infer P
  >
    ? BoundCell<T, P>
    : never;
};

type BoundCollectionsFor<S extends MatrixSpec> = {
  [K in keyof S["collections"] & string]: NonNullable<
    S["collections"]
  >[K] extends CollectionSpec<infer K2, infer T>
    ? BoundCollection<K2, T>
    : never;
};

type BoundStreamsFor<S extends MatrixSpec> = {
  [K in keyof S["streams"] & string]: NonNullable<
    S["streams"]
  >[K] extends StreamSpec<infer I, infer T>
    ? BoundStream<I, T>
    : never;
};

type BoundEventsFor<S extends MatrixSpec> = {
  [K in keyof S["events"] & string]: NonNullable<
    S["events"]
  >[K] extends EventSpec<infer I, infer T>
    ? BoundEvent<I, T>
    : never;
};

export interface MatrixClientBundle<S extends MatrixSpec, Rpc = unknown> {
  /** The typed oRPC client. Use this for imperative procedures
   *  (`bundle.rpc.notes.create(...)`) and for any verb the bound `.use()`
   *  shape can't model.
   *
   *  Typing note: `Rpc` is supplied at the call site rather than computed
   *  from `S` because TS's union-resolution budget can't expand both
   *  `MatrixContractFor<S>` and oRPC's `ContractRouterClient<...>` mapped
   *  types in the same evaluation pass — the call site narrows it cheaply
   *  via `typeof matrix.contract`. See `matrixClient`'s defaulted generic. */
  readonly rpc: Rpc;
  readonly cells: BoundCellsFor<S>;
  readonly collections: BoundCollectionsFor<S>;
  readonly streams: BoundStreamsFor<S>;
  readonly events: BoundEventsFor<S>;
}

// ── Builder ────────────────────────────────────────────────────────────

/** Build the client-side bundle for a matrix. Walks the spec once and
 *  pre-binds each primitive to its oRPC procedure refs, producing
 *  `.use(policy)` hooks that drop the wire-identity args from the per-call
 *  signature. */
export function matrixClient<const S extends MatrixSpec, Rpc = unknown>(
  matrix: Matrix<S>,
  opts: { websocket: WebSocket },
): MatrixClientBundle<S, Rpc> {
  // Narrow `Rpc` at the call site: e.g.
  //   matrixClient<typeof matrix.spec, ContractRouterClient<typeof matrix.contract, …>>(…)
  // Defaulting to `unknown` keeps the bundle's generic from triggering the
  // mapped-type union explosion that breaks `ReturnType<typeof createCellsClient<…>>`
  // when used as a default. Consumers typically reach for `bundle.rpc` only
  // for imperative procedures and get away with a one-line cast.
  // biome-ignore lint/suspicious/noExplicitAny: see comment on `Rpc` generic
  const rpc = createCellsClient<any>(opts) as Rpc;
  const spec = matrix.spec;

  const cells: Record<string, BoundCell<unknown, unknown>> = {};
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the typed client
    const ns = (rpc as any)[key];
    const source: StreamingProcedure<undefined, unknown> = ns.get;
    const mutate = cellSpec.patchSchema ? ns.patch : ns.set;
    cells[key] = {
      use: (boundOpts) =>
        useCell(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
          (matrix.descriptors.cells as any)[key],
          // biome-ignore lint/suspicious/noExplicitAny: BoundCellOptions union is structurally the same as UseCellOptions sans source/mutate
          { ...(boundOpts ?? {}), source, mutate } as any,
        ),
    };
  }

  const collections: Record<string, BoundCollection<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.collections ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (rpc as any)[key];
    collections[key] = {
      use: ({ keys, onError }) =>
        useCollection(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (matrix.descriptors.collections as any)[key],
          {
            keys,
            valueSource: ns.get,
            keyToInput: (k) => ({ key: k }),
            onError,
          },
        ),
    };
  }

  const streams: Record<string, BoundStream<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (rpc as any)[key];
    streams[key] = {
      use: (inputFn, streamOpts) =>
        useStream(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (matrix.descriptors.streams as any)[key],
          inputFn,
          ns.get,
          streamOpts,
        ),
    };
  }

  const events: Record<string, BoundEvent<unknown, unknown>> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string
    const ns = (rpc as any)[key];
    events[key] = {
      use: (inputFn, handler, eventOpts) =>
        useEvent(
          // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only
          (matrix.descriptors.events as any)[key],
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
