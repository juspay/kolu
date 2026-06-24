/**
 * `defineSurface` — declarative app-wide reactive surface.
 *
 * One spec value declares every Cell, Collection, Stream, Event, and
 * imperative procedure the app's typed reactive layer exposes. From the
 * spec the surface derives:
 *
 *   - `surface.contract`: a typed `oc.router({ surface: { … } })`. Every
 *     entry lives under a single top-level `surface` namespace so the
 *     surface composes cleanly with hand-written raw oRPC for procedures
 *     that don't fit a primitive — host contracts spread
 *     `{ ...surface.contract, terminal: rawTerminalRouter, … }` without
 *     namespace collisions.
 *   - `surface.descriptors`: the underlying Cell/Collection/Stream/Event
 *     values, keyed by surface path. Available as an escape hatch — the
 *     manual primitives (`cellHandlers` etc.) still accept these.
 *
 * The framework owns publish channel naming: cells use `"<key>:changed"`,
 * collections use `"<key>:keys"` and `"<key>:" + String(k)`, events use
 * `"<key>:" + String(input)`. There are no per-entry overrides — if you
 * need a different on-disk persistence key (e.g. to land an existing
 * `Conf` store), use the consumer's `Conf` migration ladder, not a
 * framework override.
 *
 * Compose with raw oRPC: `oc.router({ ...surface.contract, terminal:
 * rawTerminal, git: rawGit })`. Same on the server: `implementSurface`
 * returns a router fragment for the surface entries; spread alongside
 * `t.terminal.handler(...)` etc.
 */

import { type AnyContractRouter, eventIterator, oc } from "@orpc/contract";
import { type ZodType, z } from "zod";
import type { Cell, Collection, Event, Stream } from "./index";
import { cell, collection, event, stream } from "./index";
import {
  LIVENESS_NAMESPACE,
  LIVENESS_VERB,
  livenessContractEntry,
  type ReservedLivenessContract,
} from "./liveness";

// ── Spec types ─────────────────────────────────────────────────────────

/** Subset of cell verbs the surface exposes on the wire. Default is
 *  `["get", "patch"]` when `patchSchema` is set, else `["get", "set"]`.
 *  `test__set` is opt-in (production contracts shouldn't leak the test
 *  reset procedure). */
export type CellVerb = "get" | "set" | "patch" | "test__set";

/** Subset of collection verbs the surface exposes. Default
 *  `["keys", "get", "upsert", "delete"]`. `test__set` is opt-in. */
export type CollectionVerb = "keys" | "get" | "upsert" | "delete" | "test__set";

export interface CellSpec<T = unknown, P = T> {
  schema: ZodType<T>;
  default: T;
  /** When set, `patch` becomes the canonical mutation verb and `set` is
   *  suppressed unless explicitly listed in `verbs`. */
  patchSchema?: ZodType<P>;
  /** Pure merge `(current, patch) => next`. When `patchSchema` is set,
   *  the framework needs this to apply partial updates. Used by **both**
   *  sides:
   *
   *    - `implementSurface` plugs it into `cellHandlers`' patch path so
   *      server-side mutations apply it before persist+publish.
   *    - `surfaceClient` plugs it into `useCell`'s `applyPatch` so
   *      authority-`local` cells apply patches optimistically with the
   *      same merge function the server uses.
   *
   *  Declared once on the spec so server and client can't drift. The
   *  consumer can override per-side via `implementSurface`'s deps or
   *  `useCell`'s `applyPatch` when a side legitimately needs a different
   *  merge (rare). */
  patch?: (current: T, patch: P) => T;
  /** Optional equality predicate. When supplied, `set` / `patch` /
   *  `test__set` and the server-internal `ctx.cells.<key>.set` skip the
   *  store write and bus publish if `equals(prev, next)` returns true.
   *
   *  Defaults to no dedup (every mutation publishes), which preserves
   *  the legacy "writer's intent = publish" contract. Opt in when a
   *  cell's value comes from a source that re-serializes the same
   *  content on every write (e.g. test harness re-POSTing the same
   *  fixture, or a server-side write loop firing on every dirty tick)
   *  and downstream consumers do work on each publish that would
   *  otherwise be wasted — most importantly, SolidJS keyed `<Show>`
   *  remounts driven by reactive object-identity changes. The
   *  predicate runs on every mutation, so keep it cheap for hot cells
   *  (terminalList et al. don't need it). */
  equals?: (a: T, b: T) => boolean;
  verbs?: readonly CellVerb[];
}

export interface CollectionSpec<K = unknown, T = unknown> {
  keySchema: ZodType<K>;
  schema: ZodType<T>;
  verbs?: readonly CollectionVerb[];
}

export interface StreamSpec<I = unknown, T = unknown> {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}

export interface EventSpec<I = unknown, T = unknown> {
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}

export interface ProcedureSpec<I = unknown, O = unknown> {
  /** When omitted the procedure takes no input. */
  input?: ZodType<I>;
  /** When omitted the procedure returns void. */
  output?: ZodType<O>;
}

export interface SurfaceSpec {
  cells?: Record<string, CellSpec<any, any>>;
  collections?: Record<string, CollectionSpec<any, any>>;
  streams?: Record<string, StreamSpec<any, any>>;
  events?: Record<string, EventSpec<any, any>>;
  /** Imperative escape hatch — non-descriptor RPCs that should still
   *  travel through the surface. Inner key is the verb. Lives under the
   *  same `<surface-key>.<verb>` namespace as the typed primitives, so
   *  `procedures.notes.create` ends up at `surface.notes.create` on the
   *  wire — alongside `surface.notes.{keys,get,upsert,delete}` from the
   *  matching `collections.notes` entry. RPCs that don't fit a primitive
   *  *or* a request/response procedure (bidirectional binary streams,
   *  custom retry plumbing) stay outside the surface as raw oRPC. */
  procedures?: Record<string, Record<string, ProcedureSpec<any, any>>>;
}

// ── Defaults ────────────────────────────────────────────────────────────

/** Default verb sets — exported so server-side `implementSurface` derives
 *  handler verbs from the same source as `defineSurface`'s contract entries.
 *  Drift between contract and handlers is a wire-shape break. */
export const DEFAULT_CELL_VERBS_WITH_PATCH = ["get", "patch"] as const;
export const DEFAULT_CELL_VERBS_WITHOUT_PATCH = ["get", "set"] as const;
export const DEFAULT_COLLECTION_VERBS = [
  "keys",
  "get",
  "upsert",
  "delete",
] as const;

// ── Per-primitive contract derivation ──────────────────────────────────

// Internal: returns a record of `oc` builders. Caller spreads into a
// namespace under `oc.router({ surface: {...} })`. Typing is loose —
// `defineSurface` hands the literal to `oc.router(...)` which re-types
// it precisely from the runtime shape; consumers use `typeof
// surface.contract` for end-to-end inference.

function cellContractEntries<T, P>(
  spec: CellSpec<T, P>,
): Record<string, unknown> {
  const verbs =
    spec.verbs ??
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
        throw new Error("surface: cell exposes 'patch' but has no patchSchema");
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
  const verbs = spec.verbs ?? DEFAULT_COLLECTION_VERBS;
  const keyShape = z.object({ key: spec.keySchema });
  const upsertShape = z.object({ key: spec.keySchema, value: spec.schema });
  const entries: Record<string, unknown> = {};
  for (const v of verbs) {
    if (v === "keys") {
      entries.keys = oc.output(eventIterator(z.array(spec.keySchema)));
    } else if (v === "get") {
      entries.get = oc.input(keyShape).output(eventIterator(spec.schema));
    } else if (v === "upsert") {
      entries.upsert = oc.input(upsertShape).output(z.void());
    } else if (v === "delete") {
      entries.delete = oc.input(keyShape).output(z.void());
    } else if (v === "test__set") {
      entries.test__set = oc.input(z.array(upsertShape)).output(z.void());
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

// ── Mapped types for `surface.contract` ────────────────────────────────

type EmptyObj = NonNullable<unknown>;

/** Wire shape for `defineSurface(spec).contract`: every entry lives
 *  under one `surface` namespace. The reserved `system.live` liveness proc
 *  (`./liveness`) is intersected in so it's present on every surface contract —
 *  the type counterpart to the runtime `claim` in `defineSurface`. */
export type SurfaceContractFor<S extends SurfaceSpec> = {
  surface: SurfaceInnerContract<S> & ReservedLivenessContract;
};

type SurfaceInnerContract<S extends SurfaceSpec> = MergeContract<
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

/** The verb set a cell exposes — the TYPE counterpart of the runtime resolution
 *  in {@link cellContractEntries}: `spec.verbs` when present, else the
 *  patch/no-patch default. Honoring `verbs` here is load-bearing, not cosmetic:
 *  a read-only cell (`verbs: ["get"]`, e.g. `@kolu/surface-nix-host`'s
 *  connection-health cell) must NOT type a `.set` the runtime contract router
 *  doesn't carry — otherwise a downstream consumer (kolu, drishti) sees a typed
 *  `surface.<cell>.set` that throws at runtime, an API-facing falsehood in the
 *  exact cell whose stale-health safety relies on `set` being absent. */
export type CellVerbsOf<S extends CellSpec<any, any>> = S extends {
  verbs: readonly CellVerb[];
}
  ? S["verbs"][number]
  : S extends { patchSchema: ZodType<any> }
    ? (typeof DEFAULT_CELL_VERBS_WITH_PATCH)[number]
    : (typeof DEFAULT_CELL_VERBS_WITHOUT_PATCH)[number];

/** Whether a cell's resolved verbs include ANY wire-mutation verb (`set` /
 *  `patch` / `test__set`). A get-only cell (`verbs: ["get"]`) resolves `false`,
 *  so the Solid client (`surfaceClient`) can type it as read-only: no `.set` /
 *  `.patch` / local-authority path the runtime contract router doesn't carry.
 *  This is the client-side dual of {@link CellVerbsOf} honoring `verbs` in the
 *  raw contract — both must agree, or a get-only cell regrows a phantom mutate
 *  API on one side. */
export type CellIsMutable<S extends CellSpec<any, any>> =
  CellVerbsOf<S> extends "get" ? false : true;

/** One contract entry per resolved verb — `get` streams the schema, `set` /
 *  `test__set` take the full value, `patch` takes the patch schema. Mirrors the
 *  runtime `entries[v] = …` switch in {@link cellContractEntries} 1:1. */
type CellVerbEntry<V extends CellVerb, T, P> = V extends "get"
  ? { get: ReturnType<typeof buildCellGet<T>> }
  : V extends "set"
    ? { set: ReturnType<typeof buildCellSet<T>> }
    : V extends "patch"
      ? { patch: ReturnType<typeof buildCellPatch<P>> }
      : V extends "test__set"
        ? { test__set: ReturnType<typeof buildCellSet<T>> }
        : EmptyObj;

type CellContract<S extends CellSpec<any, any>> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? UnionToIntersection<CellVerbEntry<CellVerbsOf<S>, T, P>>
  : S extends { schema: ZodType<infer T> }
    ? UnionToIntersection<CellVerbEntry<CellVerbsOf<S>, T, never>>
    : never;

/** Fold the per-verb entry union into one object type — the type-level dual of
 *  the runtime `entries` accumulation. */
type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
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

// ── Inferred runtime types from a spec ─────────────────────────────────

/** Map a `SurfaceSpec` to the runtime types its schemas describe — the
 *  `Note` you'd otherwise write `z.infer<typeof NoteSchema>` for. Lets a
 *  surface declaration be the single source of truth for both wire shape
 *  AND the domain types consumers render against.
 *
 *  Indexed-access usage (tRPC-style):
 *
 *      type SF = SurfaceTypes<typeof surface.spec>;
 *      type Note     = SF["collections"]["notes"]["Value"];
 *      type NoteId   = SF["collections"]["notes"]["Key"];
 *      type Prefs    = SF["cells"]["preferences"]["Value"];
 *      type PrefsP   = SF["cells"]["preferences"]["Patch"];   // never if no patchSchema
 *
 *  Re-export the per-domain aliases at the surface module so consumers
 *  `import { Note, NoteId } from "./surface"` (the universal pattern in
 *  Zod / Drizzle / tRPC ecosystems). */
export type SurfaceTypes<S extends SurfaceSpec> = {
  cells: S["cells"] extends Record<string, CellSpec<any, any>>
    ? {
        [K in keyof S["cells"] & string]: {
          Value: z.infer<S["cells"][K]["schema"]>;
          Patch: S["cells"][K]["patchSchema"] extends ZodType<infer P>
            ? P
            : never;
        };
      }
    : EmptyObj;
  collections: S["collections"] extends Record<string, CollectionSpec<any, any>>
    ? {
        [K in keyof S["collections"] & string]: {
          Key: z.infer<S["collections"][K]["keySchema"]>;
          Value: z.infer<S["collections"][K]["schema"]>;
        };
      }
    : EmptyObj;
  streams: S["streams"] extends Record<string, StreamSpec<any, any>>
    ? {
        [K in keyof S["streams"] & string]: {
          Input: z.infer<S["streams"][K]["inputSchema"]>;
          Output: z.infer<S["streams"][K]["outputSchema"]>;
        };
      }
    : EmptyObj;
  events: S["events"] extends Record<string, EventSpec<any, any>>
    ? {
        [K in keyof S["events"] & string]: {
          Input: z.infer<S["events"][K]["inputSchema"]>;
          Payload: z.infer<S["events"][K]["outputSchema"]>;
        };
      }
    : EmptyObj;
};

/** Drizzle-style flat helpers — secondary to `SurfaceTypes<S>` indexed
 *  access. Same result, one fewer indexing layer at the call site:
 *
 *      type Prefs = SurfaceCellValue<typeof surface.spec, "preferences">;
 *      type Note  = SurfaceCollectionValue<typeof surface.spec, "notes">;
 *
 *  Use whichever reads better at the call site; both are typo-safe. */
export type SurfaceCellValue<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["cells"] & string,
> = SurfaceTypes<S>["cells"][K] extends { Value: infer V } ? V : never;

export type SurfaceCellPatch<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["cells"] & string,
> = SurfaceTypes<S>["cells"][K] extends { Patch: infer P } ? P : never;

export type SurfaceCollectionKey<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["collections"] & string,
> = SurfaceTypes<S>["collections"][K] extends { Key: infer T } ? T : never;

export type SurfaceCollectionValue<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["collections"] & string,
> = SurfaceTypes<S>["collections"][K] extends { Value: infer T } ? T : never;

export type SurfaceStreamInput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["streams"] & string,
> = SurfaceTypes<S>["streams"][K] extends { Input: infer I } ? I : never;

export type SurfaceStreamOutput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["streams"] & string,
> = SurfaceTypes<S>["streams"][K] extends { Output: infer O } ? O : never;

export type SurfaceEventInput<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["events"] & string,
> = SurfaceTypes<S>["events"][K] extends { Input: infer I } ? I : never;

export type SurfaceEventPayload<
  S extends SurfaceSpec,
  K extends keyof SurfaceTypes<S>["events"] & string,
> = SurfaceTypes<S>["events"][K] extends { Payload: infer P } ? P : never;

// ── Type oracles for per-primitive contract entry shape ────────────────
//
// Each `build*` here is a runtime-dead type oracle: TypeScript reads
// its return shape via `ReturnType<typeof X<T>>` at the mapped types
// above (see `CellContract<S>` etc.) to compute the exact per-key
// contract entry. The bodies are never called — the actual contract
// entries are built by the lowercase `xxxContractEntries` functions
// above, which return `Record<string, unknown>` (precise typing
// happens at the call site through `oc.router(...)` re-typing).
//
// `noinline`-equivalent: tree-shaking removes the bodies because no
// runtime caller exists. Keeping them as real functions (rather than
// `declare function`) lets us reuse the lambda's inferred return type
// without spelling out oRPC's internal types — rewriting these as
// `declare function` would re-introduce the duplication this file
// avoids by having one source of truth for the contract shape.
//
// Drift watch: when adding a verb to the contract, edit both the
// runtime `xxxContractEntries` (above) AND the matching `build*`
// oracle (below).

// One oracle per cell VERB (was `buildCellNoPatch` / `buildCellWithPatch`,
// which baked the verb SET into the function): `CellContract<S>` now resolves
// the verb set from `S["verbs"]` and maps each verb to its entry, so a
// `verbs`-narrowed cell (`["get"]`) types exactly the verbs the runtime
// contract router carries — no phantom `set`. Mirrors the per-verb `entries[v]`
// switch in `cellContractEntries` 1:1 (drift watch above applies).
function buildCellGet<T>(opts: { schema: ZodType<T> }) {
  return oc.output(eventIterator(opts.schema));
}

function buildCellSet<T>(opts: { schema: ZodType<T> }) {
  return oc.input(opts.schema).output(z.void());
}

function buildCellPatch<P>(opts: { patchSchema: ZodType<P> }) {
  return oc.input(opts.patchSchema).output(z.void());
}

function buildCollection<K, T>(opts: {
  keySchema: ZodType<K>;
  schema: ZodType<T>;
}) {
  const keyShape = z.object({ key: opts.keySchema });
  return {
    keys: oc.output(eventIterator(z.array(opts.keySchema))),
    get: oc.input(keyShape).output(eventIterator(opts.schema)),
    upsert: oc
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

// ── Surface value ──────────────────────────────────────────────────────

/** Descriptor handles produced by the surface, keyed by surface path. */
export interface SurfaceDescriptors<S extends SurfaceSpec> {
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

export interface Surface<S extends SurfaceSpec = SurfaceSpec> {
  readonly contract: SurfaceContractFor<S>;
  readonly spec: S;
  readonly descriptors: SurfaceDescriptors<S>;
}

/** Build a surface from a spec. The returned `.contract` lives under a
 *  top-level `surface` namespace; spread alongside hand-listed raw
 *  `oc.router({...})` blocks at the host contract:
 *
 *      export const contract = oc.router({
 *        ...surface.contract,
 *        terminal: rawTerminalRouter,
 *        git: rawGitRouter,
 *      });
 *
 *  Consumers feed the result to `implement(contract)` (server) and a link —
 *  `websocketLink<typeof contract>(...)` / `stdioLink` / `directLink` (client). */
export function defineSurface<const S extends SurfaceSpec>(
  spec: S,
): Surface<S> {
  // Collect verb-records by surface key, merging cell/collection/stream/event
  // and procedure contributions to the same key. Throw on duplicate
  // (key, verb) claims so collisions surface at boot, not at request time.
  const inner: Record<string, Record<string, unknown>> = {};
  const claim = (key: string, entries: Record<string, unknown>): void => {
    const existing = inner[key] ?? {};
    for (const verb of Object.keys(entries)) {
      if (verb in existing) {
        throw new Error(
          `defineSurface: duplicate verb "${verb}" claimed at "${key}". ` +
            `Multiple primitives or procedures resolve to the same wire path.`,
        );
      }
    }
    inner[key] = { ...existing, ...entries };
  };

  for (const [key, s] of Object.entries(spec.cells ?? {})) {
    claim(key, cellContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.collections ?? {})) {
    claim(key, collectionContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.streams ?? {})) {
    claim(key, streamContractEntries(s));
  }
  for (const [key, s] of Object.entries(spec.events ?? {})) {
    claim(key, eventContractEntries(s));
  }
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    const procEntries: Record<string, unknown> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      procEntries[verb] = procedureContractEntry(ps);
    }
    claim(ns, procEntries);
  }
  // Reserve the framework liveness verb on EVERY surface (see ./liveness). It is
  // contract-only (never in `spec`, so `implementSurface`'s procedures walk never
  // demands a dep for it — it is auto-answered instead). `claim` merges it into
  // any app-owned `system` namespace and rejects only a duplicate `live` verb, so
  // it can't silently clobber an app procedure.
  claim(LIVENESS_NAMESPACE, { [LIVENESS_VERB]: livenessContractEntry() });

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

  // Wrap under the top-level `surface` namespace so consumers can spread
  // alongside raw `oc.router({...})` blocks without colliding on host
  // namespace keys. Ungrouped: a surface entry named "terminal" would
  // collide with a host's hand-written `terminal: { create, attach, ... }`.
  return {
    contract: oc.router({
      surface: inner,
    } as unknown as AnyContractRouter) as unknown as SurfaceContractFor<S>,
    spec,
    descriptors: descriptors as unknown as SurfaceDescriptors<S>,
  };
}

/** Whether a peer reporting contract version `reportedVersion` is
 *  wire-compatible with a consumer built against `expected` (both
 *  `major.minor` strings). Compatible when the majors match and the reported
 *  minor is >= the expected one — additive minor bumps (a new optional
 *  field / procedure / stream) stay backwards-compatible; a major mismatch
 *  is a breaking shape change. Tolerates a trailing patch/prerelease suffix
 *  on either side (only `major.minor` is load-bearing).
 *
 *  This is the standard handshake predicate for a surface served across a
 *  process boundary (a unix-socket daemon, an ssh agent): the server exposes
 *  its contract version via a `system.version`-style procedure, the client
 *  checks it with this BEFORE invoking anything else, and an incompatible
 *  skew becomes an honest "restart the other side" message instead of an
 *  opaque schema/procedure error from deep inside the RPC layer. */
export function isContractVersionCompatible(
  reportedVersion: string,
  expected: string,
): boolean {
  const parse = (v: string): [number, number] | null => {
    // Anchored so only `major.minor` with an OPTIONAL patch/prerelease suffix
    // parses — `2.1garbage` must be rejected, not silently truncated to 2.1.
    const m = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(reportedVersion);
  const b = parse(expected);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] >= b[1];
}

/** Compose a keyed map of surfaces into a single contract fragment of shape
 *  `{ surface: { <key>: innerContract } }` — the wire-level counterpart to
 *  `implementSurfaces`. A consumer spreads the result into their host
 *  contract (alongside raw oRPC procedures) AND types their `websocketLink`
 *  off `typeof composeSurfaceContracts(...)`.
 *
 *  Lives in `@kolu/surface/define` (not `/server`) because it only walks each
 *  surface's already-built `.contract` — it has no server-only dependency.
 *  Keeping it here lets a browser-reached common module value-import it
 *  without dragging `@orpc/server` into the client bundle. */
export function composeSurfaceContracts<
  const E extends Record<string, Surface<any>>,
>(
  entries: E,
): {
  surface: {
    [K in keyof E]: E[K] extends Surface<infer S>
      ? SurfaceContractFor<S>["surface"]
      : never;
  };
} {
  const surface: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(entries)) {
    surface[key] = (s.contract as any).surface;
  }
  return { surface } as {
    surface: {
      [K in keyof E]: E[K] extends Surface<infer S>
        ? SurfaceContractFor<S>["surface"]
        : never;
    };
  };
}
