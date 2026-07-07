/**
 * `defineSurfaceMap` — the CONTRACT half of a keyed map of remote surfaces.
 *
 * A `SurfaceMap` is one entry spec (`Surface<ES>`) typed ONCE, keyed at runtime
 * by a BRANDED key. The map keeps the entry surface's `Surface<ES>` verbatim (it
 * is the type the client subtree is generated from) and, alongside it, derives a
 * WIRE contract that folds the branded `mapKey` into EVERY entry-member
 * procedure's input — so a call carries its key in every frame by construction
 * (a subscription can't cross keys any more than it can cross procs).
 *
 * The branded key IS zod's `.brand()` on `keySchema` — the source of truth, not a
 * hand-rolled nominal type. `parseKey` (`keySchema.parse`, on the client) is the
 * sole producer of a branded key; a raw string is a type error wherever `Key` is
 * expected (P4 at the typed API). The wire handler re-validates via the same
 * `keySchema.parse` (P5 gate).
 *
 * Membership is published as ONE authoritative collection: `entries:
 * Collection<Key, EntryStatus>`. Absence = the key is not in the collection —
 * there is NO `absent` status variant. One writer (the server, from its
 * `MapRegistry`) publishes membership + status together.
 */

import type {
  CellSpec,
  CollectionSpec,
  EventSpec,
  ProcedureSpec,
  StreamSpec,
  Surface,
  SurfaceSpec,
} from "@kolu/surface/define";
import { resolveCellVerbs, resolveCollectionVerbs } from "@kolu/surface/define";
import { type AnyContractRouter, eventIterator, oc } from "@orpc/contract";
import { type ZodType, z } from "zod";

// ── Membership status ──────────────────────────────────────────────────

/** The published per-entry status — the value carried by the `entries`
 *  collection. Absence from the collection is "not a member"; there is no
 *  `absent` variant (dual-authority for membership is unconstructible at the
 *  source — one writer publishes membership + status together). `clockOffset`
 *  is the serving process's own-clock offset at hello (one named writer, P3). */
export type EntryStatus =
  | { kind: "warming" }
  | { kind: "connected"; clockOffset: number }
  | { kind: "failed"; reason: string };

/** The wire/zod schema for {@link EntryStatus}. Backs both the `entries`
 *  collection contract and the client-side bound collection value. */
export const entryStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("warming") }),
  z.object({ kind: z.literal("connected"), clockOffset: z.number() }),
  z.object({ kind: z.literal("failed"), reason: z.string() }),
]) satisfies ZodType<EntryStatus>;

// ── Key-fold contract builders (mirror @kolu/surface/define, +mapKey) ───
//
// Each mirrors a per-primitive builder in `@kolu/surface/define`, wrapping the
// member's input `S` as `z.object({ mapKey }).and(S)` before `oc.input(...)`; a
// member with NO input (`cell.get`, `collection.keys`, `collection.deltas`)
// takes just `z.object({ mapKey })`. Outputs are untouched. `.and(S)` assumes
// `S` is object-shaped (or void) — a primitive-valued `cell.set`/`patch` or a
// primitive stream/event/procedure input can't be intersected with an object;
// declare those inputs object-shaped.

type MapKeySchema = ZodType<unknown>;

/** `z.object({ mapKey }).and(inner)` — or just `z.object({ mapKey })` when the
 *  member has no input. The single home of the fold shape. */
function foldInput(keySchema: MapKeySchema, inner?: ZodType<unknown>): ZodType {
  const base = z.object({ mapKey: keySchema });
  return (inner ? base.and(inner) : base) as ZodType;
}

/** The `deltas` wire schema — replicated from `@kolu/surface/define`'s private
 *  `collectionDeltasSchema` (it is not exported). Kept tiny and local; only used
 *  when an entry collection opts into the `deltas` verb. */
function collectionDeltasSchema(
  keySchema: ZodType<unknown>,
  schema: ZodType<unknown>,
): ZodType {
  const entry = z.tuple([keySchema, schema]);
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("snapshot"), entries: z.array(entry) }),
    z.object({
      kind: z.literal("delta"),
      upserts: z.array(entry),
      removes: z.array(keySchema),
    }),
  ]) as ZodType;
}

function foldedCell(
  spec: CellSpec<unknown, unknown>,
  keySchema: MapKeySchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of resolveCellVerbs(spec)) {
    if (v === "get") {
      out.get = oc
        .input(foldInput(keySchema))
        .output(eventIterator(spec.schema));
    } else if (v === "set") {
      out.set = oc.input(foldInput(keySchema, spec.schema)).output(z.void());
    } else if (v === "patch") {
      if (!spec.patchSchema) {
        throw new Error(
          "defineSurfaceMap: cell exposes 'patch' but has no patchSchema",
        );
      }
      out.patch = oc
        .input(foldInput(keySchema, spec.patchSchema))
        .output(z.void());
    } else if (v === "test__set") {
      out.test__set = oc
        .input(foldInput(keySchema, spec.schema))
        .output(z.void());
    }
  }
  return out;
}

function foldedCollection(
  spec: CollectionSpec<unknown, unknown>,
  keySchema: MapKeySchema,
): Record<string, unknown> {
  const keyShape = z.object({ key: spec.keySchema });
  const upsertShape = z.object({ key: spec.keySchema, value: spec.schema });
  const out: Record<string, unknown> = {};
  for (const v of resolveCollectionVerbs(spec)) {
    if (v === "keys") {
      out.keys = oc
        .input(foldInput(keySchema))
        .output(eventIterator(z.array(spec.keySchema)));
    } else if (v === "get") {
      out.get = oc
        .input(foldInput(keySchema, keyShape))
        .output(eventIterator(spec.schema));
    } else if (v === "deltas") {
      out.deltas = oc
        .input(foldInput(keySchema))
        .output(
          eventIterator(collectionDeltasSchema(spec.keySchema, spec.schema)),
        );
    } else if (v === "upsert") {
      out.upsert = oc.input(foldInput(keySchema, upsertShape)).output(z.void());
    } else if (v === "delete") {
      out.delete = oc.input(foldInput(keySchema, keyShape)).output(z.void());
    } else if (v === "test__set") {
      out.test__set = oc
        .input(foldInput(keySchema, z.array(upsertShape)))
        .output(z.void());
    }
  }
  return out;
}

function foldedStream(
  spec: StreamSpec<unknown, unknown>,
  keySchema: MapKeySchema,
): Record<string, unknown> {
  return {
    get: oc
      .input(foldInput(keySchema, spec.inputSchema))
      .output(eventIterator(spec.outputSchema)),
  };
}

function foldedEvent(
  spec: EventSpec<unknown, unknown>,
  keySchema: MapKeySchema,
): Record<string, unknown> {
  return {
    get: oc
      .input(foldInput(keySchema, spec.inputSchema))
      .output(eventIterator(spec.outputSchema)),
  };
}

function foldedProcedure(
  spec: ProcedureSpec<unknown, unknown>,
  keySchema: MapKeySchema,
): unknown {
  const input = foldInput(keySchema, spec.input);
  const output = spec.output ?? z.void();
  return oc.input(input).output(output);
}

/** Walk the entry spec and produce the key-folded inner contract — one
 *  namespace per member, mirroring `defineSurface`'s spec walk. */
function foldedMembers(
  entry: SurfaceSpec,
  keySchema: MapKeySchema,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const claim = (key: string, entries: Record<string, unknown>): void => {
    if (key === "entries") {
      throw new Error(
        'defineSurfaceMap: an entry member named "entries" collides with the ' +
          "map's reserved membership collection — rename the member.",
      );
    }
    out[key] = { ...(out[key] ?? {}), ...entries };
  };
  for (const [key, s] of Object.entries(entry.cells ?? {})) {
    claim(key, foldedCell(s, keySchema));
  }
  for (const [key, s] of Object.entries(entry.collections ?? {})) {
    claim(key, foldedCollection(s, keySchema));
  }
  for (const [key, s] of Object.entries(entry.streams ?? {})) {
    claim(key, foldedStream(s, keySchema));
  }
  for (const [key, s] of Object.entries(entry.events ?? {})) {
    claim(key, foldedEvent(s, keySchema));
  }
  for (const [ns, procs] of Object.entries(entry.procedures ?? {})) {
    const procEntries: Record<string, unknown> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      procEntries[verb] = foldedProcedure(ps, keySchema);
    }
    claim(ns, procEntries);
  }
  return out;
}

/** The read-only `entries` membership collection contract — NOT folded (its key
 *  IS the map key). The client reads it (`keys`/`get`); the server is the sole
 *  writer (membership is published, not mutated over the wire). */
function entriesContract(keySchema: MapKeySchema): Record<string, unknown> {
  return {
    keys: oc.output(eventIterator(z.array(keySchema))),
    get: oc
      .input(z.object({ key: keySchema }))
      .output(eventIterator(entryStatusSchema)),
  };
}

// ── SurfaceMap value ────────────────────────────────────────────────────

/** The branded key of a `SurfaceMap` — `z.infer` of its `keySchema` (so the
 *  brand rides for free). */
export type Key<M> =
  M extends SurfaceMap<infer KS, SurfaceSpec> ? z.infer<KS> : never;

export interface SurfaceMap<
  KS extends ZodType,
  ES extends SurfaceSpec = SurfaceSpec,
> {
  /** The branded key schema — `keySchema.parse` is the sole producer of a
   *  branded key. */
  readonly keySchema: KS;
  /** The entry surface, kept verbatim — the type the client subtree is
   *  generated from, and the spec the server/client walk. */
  readonly entry: Surface<ES>;
  /** The key-folded WIRE contract: `{ surface: { <member>: {...folded},
   *  entries } }`. `mapKey` is folded into every entry-member input; `entries`
   *  is the membership collection (unfolded). */
  readonly contract: AnyContractRouter;
  /** The membership collection's spec — `Collection<Key, EntryStatus>`,
   *  read-only. Backs both the server's `entries` handlers and the client's
   *  bound collection. */
  readonly entriesSpec: CollectionSpec<z.infer<KS>, EntryStatus>;
}

/** Build a `SurfaceMap` from a branded key schema + an entry surface. */
export function defineSurfaceMap<
  KS extends ZodType,
  const ES extends SurfaceSpec,
>(keySchema: KS, entry: Surface<ES>): SurfaceMap<KS, ES> {
  const members = foldedMembers(entry.spec, keySchema as MapKeySchema);
  const contract = oc.router({
    surface: {
      ...members,
      entries: entriesContract(keySchema as MapKeySchema),
    },
  } as unknown as AnyContractRouter) as AnyContractRouter;

  const entriesSpec: CollectionSpec<z.infer<KS>, EntryStatus> = {
    keySchema: keySchema as unknown as ZodType<z.infer<KS>>,
    schema: entryStatusSchema,
    verbs: ["keys", "get"],
  };

  return { keySchema, entry, contract, entriesSpec };
}
