/**
 * `defineSurfaceMap` — the CONTRACT half of a keyed map of remote surfaces.
 *
 * A `SurfaceMap` is one entry spec (`Surface<ES>`) typed ONCE, keyed at runtime by a
 * `keySchema`-validated key `K` (`Key<M>`, `z.infer<KS>`) — a plain string in the
 * common case, but not required to be one (kolu's own `HostKey` is a discriminated
 * sum object). The map keeps the entry surface's `Surface<ES>` verbatim (it is the
 * type the client subtree is generated from) and, alongside it, derives a WIRE
 * contract that folds a key into EVERY entry-member procedure's input — so a call
 * carries its key in every frame by construction (a subscription can't cross keys
 * any more than it can cross procs).
 *
 * `K` can be ANY `keySchema`-validated value, but the WIRE `mapKey` field, the
 * `entries` membership collection's key, and every channel name the server derives
 * from a key are ALWAYS a plain STRING — matching `@kolu/surface`'s own per-key
 * channel/dedup machinery (`collectionKeyChannel(name, String(k))`, i.e.
 * `${name}:key:${String(k)}`; see `@kolu/surface/channel-names`), which a
 * non-primitive `K` would silently corrupt (`String({...})` →
 * `"[object Object]"`, collapsing every entry onto one channel). The REQUIRED
 * {@link KeyCodec} bridges the two: `encode` produces that canonical wire string
 * (also the channel-name/dedup key), `decode` inverts it. For a `K` that is already
 * a plain string, the codec is the identity pair.
 *
 * `keySchema.parse` (paired with `codec.decode`, on the client's `parseKey` and the
 * server's wire handler) is the sole producer of a validated `K` from a wire string —
 * a raw unvalidated value is a type error wherever `Key` is expected (P4 at the typed
 * API); the wire handler re-validates via the same `keySchema.parse` (P5 gate).
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
import {
  collectionDeltasSchema,
  resolveCellVerbs,
  resolveCollectionVerbs,
} from "@kolu/surface/define";
import { type AnyContractRouter, eventIterator, oc } from "@orpc/contract";
import { type ZodType, z } from "zod";
import { INPUT_FIELD, MAP_KEY_FIELD } from "./envelope";

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

/** The total state of an entry lens — the published {@link EntryStatus} when the key IS a
 *  member, plus the explicit `not-a-member` value the client fold returns when it is not. It
 *  lives HERE (the contract module, solid-free), not in the client, so a NODE consumer that
 *  re-exports it type-only through `index.ts` never drags the Solid/DOM client into its
 *  typecheck (surface-remote would otherwise fail on onWake's `window`/`document`). */
export type EntryState = EntryStatus | { kind: "not-a-member" };

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
// member's input `S` in a UNIFORM ENVELOPE — `z.object({ mapKey, input: S })` —
// before `oc.input(...)`; a member with NO input carries `input: z.void()`.
// Outputs are untouched. The envelope (not a spread merge) is deliberate: ONE
// wire shape for every proc regardless of `S` (object, primitive, or none — a
// primitive `terminalAttach`/`cell.set` input rides `input` verbatim), and,
// decisively, an entry input that itself carries a `mapKey` field cannot collide
// with the folded key (it is nested under `input`), so misroute-by-collision is
// UNCONSTRUCTIBLE (P4), not merely unlikely.
//
// The folded `mapKey` field is ALWAYS `z.string()` here — the canonical wire form
// {@link KeyCodec} produces — regardless of what the map's own `K` is. The server
// re-derives + re-validates the real `K` from it (`codec.decode` + `keySchema.parse`,
// the P5 gate); these builders never see `K` at all.

/** The fold envelope `z.object({ mapKey, input })` — `input` is the member's own
 *  input schema (or `z.void()` when it has none). The single home of the shape. */
function foldInput(inner?: ZodType<unknown>): ZodType {
  return z.object({
    [MAP_KEY_FIELD]: z.string(),
    [INPUT_FIELD]: inner ?? z.void(),
  }) as ZodType;
}

function foldedCell(spec: CellSpec<unknown, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of resolveCellVerbs(spec)) {
    if (v === "get") {
      out.get = oc.input(foldInput()).output(eventIterator(spec.schema));
    } else if (v === "set") {
      out.set = oc.input(foldInput(spec.schema)).output(z.void());
    } else if (v === "patch") {
      if (!spec.patchSchema) {
        throw new Error(
          "defineSurfaceMap: cell exposes 'patch' but has no patchSchema",
        );
      }
      out.patch = oc.input(foldInput(spec.patchSchema)).output(z.void());
    } else if (v === "test__set") {
      out.test__set = oc.input(foldInput(spec.schema)).output(z.void());
    }
  }
  return out;
}

function foldedCollection(
  spec: CollectionSpec<unknown, unknown>,
): Record<string, unknown> {
  const keyShape = z.object({ key: spec.keySchema });
  const upsertShape = z.object({ key: spec.keySchema, value: spec.schema });
  const out: Record<string, unknown> = {};
  for (const v of resolveCollectionVerbs(spec)) {
    if (v === "keys") {
      out.keys = oc
        .input(foldInput())
        .output(eventIterator(z.array(spec.keySchema)));
    } else if (v === "get") {
      out.get = oc
        .input(foldInput(keyShape))
        .output(eventIterator(spec.schema));
    } else if (v === "deltas") {
      out.deltas = oc
        .input(foldInput())
        .output(
          eventIterator(collectionDeltasSchema(spec.keySchema, spec.schema)),
        );
    } else if (v === "upsert") {
      out.upsert = oc.input(foldInput(upsertShape)).output(z.void());
    } else if (v === "delete") {
      out.delete = oc.input(foldInput(keyShape)).output(z.void());
    } else if (v === "test__set") {
      out.test__set = oc
        .input(foldInput(z.array(upsertShape)))
        .output(z.void());
    }
  }
  return out;
}

function foldedStream(
  spec: StreamSpec<unknown, unknown>,
): Record<string, unknown> {
  return {
    get: oc
      .input(foldInput(spec.inputSchema))
      .output(eventIterator(spec.outputSchema)),
  };
}

function foldedEvent(
  spec: EventSpec<unknown, unknown>,
): Record<string, unknown> {
  return {
    get: oc
      .input(foldInput(spec.inputSchema))
      .output(eventIterator(spec.outputSchema)),
  };
}

function foldedProcedure(spec: ProcedureSpec<unknown, unknown>): unknown {
  const input = foldInput(spec.input);
  const output = spec.output ?? z.void();
  return oc.input(input).output(output);
}

/** Walk the entry spec and produce the key-folded inner contract — one
 *  namespace per member, mirroring `defineSurface`'s spec walk. */
function foldedMembers(
  entry: SurfaceSpec,
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
    claim(key, foldedCell(s));
  }
  for (const [key, s] of Object.entries(entry.collections ?? {})) {
    claim(key, foldedCollection(s));
  }
  for (const [key, s] of Object.entries(entry.streams ?? {})) {
    claim(key, foldedStream(s));
  }
  for (const [key, s] of Object.entries(entry.events ?? {})) {
    claim(key, foldedEvent(s));
  }
  for (const [ns, procs] of Object.entries(entry.procedures ?? {})) {
    const procEntries: Record<string, unknown> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      procEntries[verb] = foldedProcedure(ps);
    }
    claim(ns, procEntries);
  }
  return out;
}

/** The read-only `entries` membership collection contract — NOT folded (its key
 *  IS the map key). Its wire key is ALWAYS `z.string()` (the canonical encoded
 *  form; see the module doc) — the client reads it (`keys`/`get`) and decodes
 *  through {@link KeyCodec}; the server is the sole writer (membership is
 *  published, not mutated over the wire). */
function entriesContract(): Record<string, unknown> {
  return {
    keys: oc.output(eventIterator(z.array(z.string()))),
    get: oc
      .input(z.object({ key: z.string() }))
      .output(eventIterator(entryStatusSchema)),
  };
}

// ── SurfaceMap value ────────────────────────────────────────────────────

/** The branded key of a `SurfaceMap` — `z.infer` of its `keySchema`. */
export type Key<M> =
  M extends SurfaceMap<infer KS, SurfaceSpec> ? z.infer<KS> : never;

/** The string <-> key bridge every map needs: {@link encode} produces the
 *  canonical wire string a key is transmitted/channel-named as; {@link decode}
 *  inverts it. For a `K` that is already a plain string this is the identity
 *  pair; kolu's `HostKey` (a discriminated-sum object) passes its own
 *  `encodeHostKey`/`decodeHostKey`. `decode` is paired with `keySchema.parse` at
 *  every call site (the P5 re-validation gate) — it need not validate on its own. */
export interface KeyCodec<K> {
  encode(key: K): string;
  decode(wire: string): K;
}

export interface SurfaceMap<
  KS extends ZodType,
  ES extends SurfaceSpec = SurfaceSpec,
> {
  /** The key schema — `keySchema.parse` (paired with `codec.decode`) is the sole
   *  producer of a validated key from a wire string. */
  readonly keySchema: KS;
  /** The entry surface, kept verbatim — the type the client subtree is
   *  generated from, and the spec the server/client walk. */
  readonly entry: Surface<ES>;
  /** The key-folded WIRE contract: `{ surface: { <member>: {...folded},
   *  entries } }`. A canonical-string `mapKey` is folded into every entry-member
   *  input; `entries` is the membership collection (unfolded). */
  readonly contract: AnyContractRouter;
  /** The membership collection's spec — `Collection<string, EntryStatus>` on
   *  the wire (see the module doc for why the collection key is always a plain
   *  string), read-only. Backs both the server's `entries` handlers and the
   *  client's bound collection; both decode through {@link codec} at their own
   *  API boundary. */
  readonly entriesSpec: CollectionSpec<string, EntryStatus>;
  /** The string <-> key codec — see {@link KeyCodec}. */
  readonly codec: KeyCodec<z.infer<KS>>;
}

/** Build a `SurfaceMap` from a key schema, an entry surface, and the key's
 *  string codec (required — see {@link KeyCodec}; a plain-string `K` passes the
 *  identity pair). */
export function defineSurfaceMap<
  KS extends ZodType,
  const ES extends SurfaceSpec,
>(
  keySchema: KS,
  entry: Surface<ES>,
  codec: KeyCodec<z.infer<KS>>,
): SurfaceMap<KS, ES> {
  const members = foldedMembers(entry.spec);
  const contract = oc.router({
    surface: {
      ...members,
      entries: entriesContract(),
    },
  } as unknown as AnyContractRouter) as AnyContractRouter;

  const entriesSpec: CollectionSpec<string, EntryStatus> = {
    keySchema: z.string(),
    schema: entryStatusSchema,
    verbs: ["keys", "get"],
  };

  return { keySchema, entry, contract, entriesSpec, codec };
}
