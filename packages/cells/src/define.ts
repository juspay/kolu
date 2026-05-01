/**
 * `defineMatrix` — declarative app-wide reactive surface.
 *
 * One spec value declares every Cell, Collection, Stream, and Event the app
 * exposes, plus an escape hatch for imperative oRPC procedures that don't
 * fit a descriptor shape. From this spec the matrix derives:
 *
 *   - `matrix.contract`: a typed `oc.router({...})` ready for
 *     `implement(matrix.contract)` (server) and
 *     `createCellsClient<typeof matrix.contract>(...)` (client).
 *   - `matrix.descriptors`: the underlying Cell/Collection/Stream/Event
 *     values keyed by matrix path. The manual primitives still work — the
 *     descriptor handles let consumers fall back to `cellHandlers` etc.
 *     when an entry needs to break out of the matrix defaults.
 *
 * Phase A delivers `.contract` + `.descriptors`. Phase B adds `.implement`
 * for server-side dep wiring; Phase C adds `.client` for client-side bound
 * hooks. Each phase is independently usable.
 *
 * Compose with raw oRPC: when an RPC has wire-level concerns the matrix
 * can't model (custom `onRetry`, binary framing, subscribe-before-yield),
 * keep it in a sibling `oc.router({...})` and merge:
 *
 *     const fullContract = oc.router({ ...matrix.contract, ...rawContract });
 */

import { type AnyContractRouter, eventIterator, oc } from "@orpc/contract";
import { z, type ZodType } from "zod";
import type { Cell, Collection, Event, Stream } from "./index";
import { cell, collection, event, stream } from "./index";

// ── Spec types ─────────────────────────────────────────────────────────

/** Subset of cell verbs the matrix exposes on the wire. Default is
 *  `["get", "patch"]` when `patchSchema` is set, else `["get", "set"]`.
 *  `test__set` is opt-in (production contracts shouldn't leak the test
 *  reset procedure). */
export type CellVerb = "get" | "set" | "patch" | "test__set";

/** Subset of collection verbs the matrix exposes. Default
 *  `["keys", "get", "update", "delete"]`. `test__set` is opt-in. */
export type CollectionVerb = "keys" | "get" | "update" | "delete" | "test__set";

export interface CellSpec<T = unknown, P = T> {
  schema: ZodType<T>;
  default: T;
  /** When set, `patch` becomes the canonical mutation verb and `set` is
   *  suppressed unless explicitly listed in `expose`. The matching
   *  `applyPatch` deps go to `matrix.implement` (Phase B). */
  patchSchema?: ZodType<P>;
  expose?: readonly CellVerb[];
  /** Override the auto-derived publish channel name. Default is
   *  `"<key>:changed"` (e.g. matrix key `"prefs"` → `"prefs:changed"`).
   *  Use this when migrating off hand-named channels — renaming a matrix
   *  key would otherwise silently rename the channel and break consumers
   *  with persisted subscriptions. Phase B/D concern. */
  channelName?: string;
  /** Override the store key passed to persistence adapters. Default is
   *  the matrix key. Use this to keep `confStore("activityFeed")` working
   *  after renaming the matrix key. Phase B/D concern. */
  storeKey?: string;
}

export interface CollectionSpec<K = unknown, T = unknown> {
  keySchema: ZodType<K>;
  schema: ZodType<T>;
  expose?: readonly CollectionVerb[];
  /** Override channel name fns. Defaults: `keys = "<key>:keys"`,
   *  `perKey(k) = "<key>:" + String(k)`. Phase B concern. */
  channelNames?: { keys?: string; perKey?: (k: K) => string };
}

export interface StreamSpec<I = unknown, T = unknown> {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}

export interface EventSpec<I = unknown, T = unknown> {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
  /** Override the auto-derived per-input channel name. Default
   *  `(i) => "<key>:" + String(i)`. Phase B concern. */
  channelName?: (i: I) => string;
}

export interface ProcedureSpec<I = unknown, O = unknown> {
  /** When omitted the procedure takes no input. */
  input?: ZodType<I>;
  /** When omitted the procedure returns void. */
  output?: ZodType<O>;
}

export interface MatrixSpec {
  cells?: Record<string, CellSpec<any, any>>;
  collections?: Record<string, CollectionSpec<any, any>>;
  streams?: Record<string, StreamSpec<any, any>>;
  events?: Record<string, EventSpec<any, any>>;
  /** Imperative escape hatch — non-descriptor RPC. Outer key is the
   *  namespace (typically the parent collection/cell name); inner key is
   *  the verb. Merged into the existing namespace so e.g. `notes.create`
   *  lives alongside `notes.{keys,get,update,delete}`. */
  procedures?: Record<string, Record<string, ProcedureSpec<any, any>>>;
}

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_CELL_VERBS_WITH_PATCH = ["get", "patch"] as const;
const DEFAULT_CELL_VERBS_WITHOUT_PATCH = ["get", "set"] as const;
const DEFAULT_COLLECTION_VERBS = ["keys", "get", "update", "delete"] as const;

// ── Per-primitive contract derivation ──────────────────────────────────

// Internal: returns a record of `oc` builders. Caller spreads into a
// namespace under `oc.router({...})`. Typing is loose — the matrix
// module hands the literal to `oc.router(...)` which re-types it
// precisely from the runtime shape, and consumers use `typeof
// matrix.contract` for end-to-end inference.

function cellContractEntries<T, P>(
  spec: CellSpec<T, P>,
): Record<string, unknown> {
  const verbs =
    spec.expose ??
    (spec.patchSchema
      ? DEFAULT_CELL_VERBS_WITH_PATCH
      : DEFAULT_CELL_VERBS_WITHOUT_PATCH);
  const entries: Record<string, unknown> = {};
  for (const v of verbs) {
    if (v === "get") {
      entries.get = oc.output(eventIterator(spec.schema));
    } else if (v === "set") {
      entries.set = oc.input(spec.schema).output(z.void());
    } else if (v === "patch") {
      if (!spec.patchSchema) {
        throw new Error(
          "cells matrix: cell exposes 'patch' but has no patchSchema",
        );
      }
      entries.patch = oc.input(spec.patchSchema).output(z.void());
    } else if (v === "test__set") {
      entries.test__set = oc.input(spec.schema).output(z.void());
    }
  }
  return entries;
}

function collectionContractEntries<K, T>(
  spec: CollectionSpec<K, T>,
): Record<string, unknown> {
  const verbs = spec.expose ?? DEFAULT_COLLECTION_VERBS;
  const keyShape = z.object({ key: spec.keySchema });
  const updateShape = z.object({ key: spec.keySchema, value: spec.schema });
  const entries: Record<string, unknown> = {};
  for (const v of verbs) {
    if (v === "keys") {
      entries.keys = oc.output(eventIterator(z.array(spec.keySchema)));
    } else if (v === "get") {
      entries.get = oc.input(keyShape).output(eventIterator(spec.schema));
    } else if (v === "update") {
      entries.update = oc.input(updateShape).output(z.void());
    } else if (v === "delete") {
      entries.delete = oc.input(keyShape).output(z.void());
    } else if (v === "test__set") {
      entries.test__set = oc.input(z.array(updateShape)).output(z.void());
    }
  }
  return entries;
}

function streamContractEntries<I, T>(
  spec: StreamSpec<I, T>,
): Record<string, unknown> {
  return {
    get: oc.input(spec.inputSchema).output(eventIterator(spec.outputSchema)),
  };
}

function eventContractEntries<I, T>(
  spec: EventSpec<I, T>,
): Record<string, unknown> {
  return {
    get: oc.input(spec.inputSchema).output(eventIterator(spec.outputSchema)),
  };
}

function procedureContractEntry<I, O>(spec: ProcedureSpec<I, O>): unknown {
  const input = spec.input ?? z.void();
  const output = spec.output ?? z.void();
  return oc.input(input).output(output);
}

// ── Matrix value ────────────────────────────────────────────────────────

/** Descriptor handles produced by the matrix, keyed by matrix path. The
 *  manual primitives (`cellHandlers`, `useCell`, etc.) still accept these
 *  values directly — the matrix is opt-in, not exclusive. */
export interface MatrixDescriptors<S extends MatrixSpec> {
  cells: {
    [K in keyof S["cells"] & string]: S["cells"][K] extends CellSpec<
      infer T,
      infer _P
    >
      ? Cell<K, T>
      : never;
  };
  collections: {
    [K in keyof S["collections"] &
      string]: S["collections"][K] extends CollectionSpec<infer K2, infer T>
      ? Collection<K, K2, T>
      : never;
  };
  streams: {
    [K in keyof S["streams"] & string]: S["streams"][K] extends StreamSpec<
      infer I,
      infer T
    >
      ? Stream<K, I, T>
      : never;
  };
  events: {
    [K in keyof S["events"] & string]: S["events"][K] extends EventSpec<
      infer I,
      infer T
    >
      ? Event<K, I, T>
      : never;
  };
}

// `{}` (not `Record<string, never>`) — index-signature `never` collapses
// the merged property's value to `never` and oRPC's router-builder type
// checks reject `Lazy<never>` (`packages/cells-example` showed the issue
// before this fix). Empty object intersects cleanly with concrete record
// types.
type EmptyObj = NonNullable<unknown>;

/** Precise per-namespace contract shape derived from the spec. Each
 *  primitive's verb set is a mapped type over the spec's schemas — the
 *  result feeds into oRPC's existing `implement(...)` and
 *  `createCellsClient<typeof matrix.contract>` machinery, so consumers
 *  get end-to-end typed handlers and clients without hand-listing the
 *  router.
 *
 *  The runtime build uses `Object.entries` loops (which lose keys at the
 *  type level), so we cast at the boundary inside `defineMatrix`. The
 *  cast is intentional and the runtime shape matches this type exactly. */
export type MatrixContractFor<S extends MatrixSpec> = MergeContract<
  S["cells"] extends Record<string, CellSpec<any, any>>
    ? { [K in keyof S["cells"] & string]: CellContract<S["cells"][K]> }
    : EmptyObj,
  S["collections"] extends Record<string, CollectionSpec<any, any>>
    ? {
        [K in keyof S["collections"] & string]: CollectionContract<
          S["collections"][K]
        >;
      }
    : EmptyObj,
  S["streams"] extends Record<string, StreamSpec<any, any>>
    ? {
        [K in keyof S["streams"] & string]: StreamContract<S["streams"][K]>;
      }
    : EmptyObj,
  S["events"] extends Record<string, EventSpec<any, any>>
    ? {
        [K in keyof S["events"] & string]: EventContract<S["events"][K]>;
      }
    : EmptyObj,
  S["procedures"] extends Record<
    string,
    Record<string, ProcedureSpec<any, any>>
  >
    ? {
        [K in keyof S["procedures"] & string]: {
          [V in keyof S["procedures"][K] & string]: ProcedureContract<
            S["procedures"][K][V]
          >;
        };
      }
    : EmptyObj
>;

// Per-primitive contract shapes, computed via ReturnType against the
// internal helper functions whose generics flow schema types through.
type CellContract<S extends CellSpec<any, any>> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? ReturnType<typeof buildCellWithPatch<T, P>>
  : S extends { schema: ZodType<infer T> }
    ? ReturnType<typeof buildCellNoPatch<T>>
    : never;

type CollectionContract<S extends CollectionSpec<any, any>> = S extends {
  keySchema: ZodType<infer K>;
  schema: ZodType<infer T>;
}
  ? ReturnType<typeof buildCollection<K, T>>
  : never;

type StreamContract<S extends StreamSpec<any, any>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? ReturnType<typeof buildStream<I, T>>
  : never;

type EventContract<S extends EventSpec<any, any>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? ReturnType<typeof buildEvent<I, T>>
  : never;

type ProcedureContract<S extends ProcedureSpec<any, any>> = S extends {
  input: ZodType<infer I>;
  output: ZodType<infer O>;
}
  ? ReturnType<typeof buildProcedure<I, O>>
  : S extends { input: ZodType<infer I> }
    ? ReturnType<typeof buildProcedureNoOutput<I>>
    : S extends { output: ZodType<infer O> }
      ? ReturnType<typeof buildProcedureNoInput<O>>
      : ReturnType<typeof buildProcedureNoIO>;

// Merge five namespace records into one — last-key-wins semantics, with
// per-namespace verb-record union when the same key appears in multiple
// blocks (e.g. `notes` as both a collection and a procedure namespace).
type MergeContract<
  A extends Record<string, unknown>,
  B extends Record<string, unknown>,
  C extends Record<string, unknown>,
  D extends Record<string, unknown>,
  E extends Record<string, unknown>,
> = {
  [K in keyof A | keyof B | keyof C | keyof D | keyof E]: (K extends keyof A
    ? A[K]
    : EmptyObj) &
    (K extends keyof B ? B[K] : EmptyObj) &
    (K extends keyof C ? C[K] : EmptyObj) &
    (K extends keyof D ? D[K] : EmptyObj) &
    (K extends keyof E ? E[K] : EmptyObj);
};

// ── Strongly-typed builder helpers (used for type derivation only) ─────

// These exist primarily so `ReturnType<typeof buildX<...>>` gives the
// matrix contract its precise shape. The `defineMatrix` runtime calls
// the loose `*ContractEntries` helpers above and casts at the boundary.

function buildCellWithPatch<T, P>(opts: {
  schema: ZodType<T>;
  patchSchema: ZodType<P>;
}) {
  return {
    get: oc.output(eventIterator(opts.schema)),
    patch: oc.input(opts.patchSchema).output(z.void()),
  };
}

function buildCellNoPatch<T>(opts: { schema: ZodType<T> }) {
  return {
    get: oc.output(eventIterator(opts.schema)),
    set: oc.input(opts.schema).output(z.void()),
  };
}

function buildCollection<K, T>(opts: {
  keySchema: ZodType<K>;
  schema: ZodType<T>;
}) {
  const keyShape = z.object({ key: opts.keySchema });
  return {
    keys: oc.output(eventIterator(z.array(opts.keySchema))),
    get: oc.input(keyShape).output(eventIterator(opts.schema)),
    update: oc
      .input(z.object({ key: opts.keySchema, value: opts.schema }))
      .output(z.void()),
    delete: oc.input(keyShape).output(z.void()),
  };
}

function buildStream<I, T>(opts: {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}) {
  return {
    get: oc.input(opts.inputSchema).output(eventIterator(opts.outputSchema)),
  };
}

function buildEvent<I, T>(opts: {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}) {
  return {
    get: oc.input(opts.inputSchema).output(eventIterator(opts.outputSchema)),
  };
}

function buildProcedure<I, O>(opts: { input: ZodType<I>; output: ZodType<O> }) {
  return oc.input(opts.input).output(opts.output);
}

function buildProcedureNoOutput<I>(opts: { input: ZodType<I> }) {
  return oc.input(opts.input).output(z.void());
}

function buildProcedureNoInput<O>(opts: { output: ZodType<O> }) {
  return oc.input(z.void()).output(opts.output);
}

function buildProcedureNoIO() {
  return oc.input(z.void()).output(z.void());
}

export interface Matrix<S extends MatrixSpec = MatrixSpec> {
  readonly contract: MatrixContractFor<S>;
  readonly spec: S;
  readonly descriptors: MatrixDescriptors<S>;
}

/** Build a matrix from a spec. The returned `.contract` is ready to feed
 *  into `implement(...)` (server) and `createCellsClient<typeof matrix.contract>(...)`
 *  (client). For wire-level concerns the matrix can't model (custom
 *  `onRetry`, binary framing), keep the procedure in a sibling
 *  `oc.router({...})` and merge namespaces:
 *
 *      export const contract = oc.router({
 *        ...matrix.contract,
 *        terminal: rawTerminalContract,
 *      });
 */
export function defineMatrix<const S extends MatrixSpec>(spec: S): Matrix<S> {
  // Collect contract entries by namespace, merging typed primitives with
  // imperative procedures sharing a namespace.
  const namespaces: Record<string, Record<string, unknown>> = {};
  const merge = (key: string, entries: Record<string, unknown>): void => {
    namespaces[key] = { ...(namespaces[key] ?? {}), ...entries };
  };

  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    merge(key, cellContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.collections ?? {})) {
    merge(key, collectionContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.streams ?? {})) {
    merge(key, streamContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.events ?? {})) {
    merge(key, eventContractEntries(s));
  }
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    const procEntries: Record<string, unknown> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      procEntries[verb] = procedureContractEntry(ps);
    }
    merge(ns, procEntries);
  }

  // Descriptor handles for the manual escape hatch.
  const descriptors = {
    cells: {} as Record<string, unknown>,
    collections: {} as Record<string, unknown>,
    streams: {} as Record<string, unknown>,
    events: {} as Record<string, unknown>,
  };
  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    descriptors.cells[key] = cell({
      name: key,
      schema: s.schema,
      default: s.default,
    });
  }
  for (const [key, s] of Object.entries(spec.collections ?? {})) {
    descriptors.collections[key] = collection({
      name: key,
      keySchema: s.keySchema,
      schema: s.schema,
    });
  }
  for (const [key, s] of Object.entries(spec.streams ?? {})) {
    descriptors.streams[key] = stream({
      name: key,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    });
  }
  for (const [key, s] of Object.entries(spec.events ?? {})) {
    descriptors.events[key] = event({
      name: key,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    });
  }

  return {
    contract: oc.router(
      namespaces as unknown as AnyContractRouter,
    ) as unknown as MatrixContractFor<S>,
    spec,
    descriptors: descriptors as unknown as MatrixDescriptors<S>,
  };
}
