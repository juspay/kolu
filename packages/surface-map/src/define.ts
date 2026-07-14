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
 * `keySchema.parse` (paired with `codec.decode`, on the client's `decodeKey` and the
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
 *  is the serving process's own-clock offset at hello (one named writer, P3).
 *
 *  `membershipId` (PR3) is an opaque, never-reused identity stamped by
 *  `serveSurfaceMap` on every ADD — a fresh `crypto.randomUUID()` when a key
 *  ENTERS membership, dropped when it leaves, and never reused across a
 *  map-server restart (the id map is in-process, so a fresh server mints fresh
 *  ids by construction). It rides EVERY arm so a client can key every cached
 *  owner on `{encodedKey, membershipId}`: a same-key remove/re-add mints a NEW
 *  id, and an authority restart mints new ids for every member, so a stale
 *  subscription can never resurrect against a fresh session — the rebuild
 *  happens by construction, not by a hand-rolled generation rearm. Membership is
 *  time: a key that leaves and returns is a *new member* even when its spelling
 *  is unchanged, and this id is that time made a fact.
 *
 *  `Failure` is the DOMAIN FAILURE VALUE carried on the `failed` arm — a whole,
 *  schema-validated domain value (padi's `PadiEntryFailure`: a discriminated
 *  union over a structural `cause`, its human `reason`, and any typed per-cause
 *  sidecar), NOT a bare string cause. `@kolu/surface-map` itself stays
 *  volatility-neutral (dependency-arrow-out): it carries the value and validates
 *  it against the map's OWN `failure` schema, but never enumerates what a
 *  domain's failures ARE. The failed arm can NEVER be entered without such a
 *  value — the framework has no fabricated fallback cause (PR4), so "failed with
 *  an invented reason" is unrepresentable, not merely discouraged. Defaults to
 *  `unknown` so generic library code carries the value opaquely; a domain
 *  narrows it at its own map. */
export type EntryStatus<Failure = unknown> =
  | { kind: "warming"; membershipId: string }
  | { kind: "connected"; membershipId: string; clockOffset: number }
  | { kind: "failed"; membershipId: string; failure: Failure };

/** The total state of an entry lens — the published {@link EntryStatus} when the key IS a
 *  member, plus the explicit `not-a-member` value the client fold returns when it is not. It
 *  lives HERE (the contract module, solid-free), not in the client, so a NODE consumer that
 *  re-exports it type-only through `index.ts` never drags the Solid/DOM client into its
 *  typecheck (surface-remote would otherwise fail on onWake's `window`/`document`). */
export type EntryState<Failure = unknown> =
  | EntryStatus<Failure>
  | { kind: "not-a-member" };

/** The wire/zod schema for {@link EntryStatus}, built from the map's OWN domain
 *  `failure` schema. Backs both the `entries` collection contract and the
 *  client-side bound collection value. The `failed` arm carries `failure:
 *  <the map's domain schema>` — so the domain value is VALIDATED on the wire
 *  (PR4: the old loose `cause: z.string()` is gone; a domain's structural cause
 *  union, its `reason`, and any typed per-cause sidecar — padi's `running`/
 *  `expected` skew pair — are all validated by the domain schema itself, not
 *  waved through as unknown extras). A generic package can't know the domain's
 *  schema, so this is a FUNCTION of it rather than a module const. Every arm also
 *  carries `membershipId: z.string()` (PR3) — the opaque per-add identity, on the
 *  wire so the client keys owners on `{encodedKey, membershipId}`. */
export function entryStatusSchema<Failure>(
  failureSchema: ZodType<Failure>,
): ZodType<EntryStatus<Failure>> {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("warming"), membershipId: z.string() }),
    z.object({
      kind: z.literal("connected"),
      membershipId: z.string(),
      clockOffset: z.number(),
    }),
    z.object({
      kind: z.literal("failed"),
      membershipId: z.string(),
      failure: failureSchema,
    }),
  ]) as unknown as ZodType<EntryStatus<Failure>>;
}

// ── Key-fold contract builders (mirror @kolu/surface/define, +mapKey) ───
//
// Each mirrors a per-primitive builder in `@kolu/surface/define`, wrapping the
// member's input `S` in a UNIFORM ENVELOPE — `z.object({ mapKey, input: S })` —
// before `oc.input(...)`; a member with NO input carries NO `input` field at all
// (`z.object({ mapKey })`), NOT `input: z.void()` (see `foldInput` / the envelope).
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

/** True for `z.void()` / `z.undefined()` — a member whose input carries no wire
 *  payload. Checked via zod v4's stable `.def.type`. Such a member's envelope
 *  OMITS the input field entirely (see {@link foldInput}), so validation never
 *  depends on zod accepting a MISSING key for `z.void()` — a leniency zod
 *  tightened in >=4.3.7 (`z.object({ input: z.void() }).parse({})` now throws
 *  "expected nonoptional"). Without this, a consumer's lockfile drifting onto a
 *  later zod patch silently breaks every void-input fold over the wire. */
function isVoidInput(inner: ZodType<unknown>): boolean {
  const type = (inner as { def?: { type?: string } }).def?.type;
  return type === "void" || type === "undefined";
}

/** The fold envelope schema. For a member WITH input: `z.object({ mapKey, input })`.
 *  For a VOID member (no input, or an explicit `z.void()`/`z.undefined()`):
 *  `z.object({ mapKey })` with NO input field — `{ mapKey }` is the ONE valid wire
 *  shape, and a schema without an `input` field cannot strict-reject its absence,
 *  so the fold is independent of zod's missing-key leniency (see `isVoidInput`).
 *  The single home of the shape. Exported for the round-trip pin. */
export function foldInput(inner?: ZodType<unknown>): ZodType {
  if (inner === undefined || isVoidInput(inner)) {
    return z.object({ [MAP_KEY_FIELD]: z.string() }) as ZodType;
  }
  return z.object({
    [MAP_KEY_FIELD]: z.string(),
    [INPUT_FIELD]: inner,
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
 *  published, not mutated over the wire). Takes the ALREADY-built
 *  {@link entryStatusSchema} (derived ONCE in {@link defineSurfaceMap}) as the
 *  per-entry `get` output, so the same instance backs both this contract and
 *  `entriesSpec.schema` rather than being computed twice. */
function entriesContract(statusSchema: ZodType): Record<string, unknown> {
  return {
    keys: oc.output(eventIterator(z.array(z.string()))),
    get: oc
      .input(z.object({ key: z.string() }))
      .output(eventIterator(statusSchema)),
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
 *  every call site (the P5 re-validation gate) — it need not validate on its own.
 *
 *  Considered (and rejected) folding this into zod 4's `z.codec` — a direct dep,
 *  and the obvious "reuse the ecosystem's own bidirectional-transform primitive"
 *  move. It doesn't fit here: `z.encode(codec, key)` re-validates `key` against
 *  `keySchema` on EVERY call (zod4's generic `z.encode`/`z.decode` always
 *  round-trip through both schemas), but `encode` runs on an ALREADY-validated
 *  `K` at the hottest, most frequent call sites in this module (the per-key
 *  client-cache lookup on every `entry(key)`/`clientFor` call, the membership
 *  fold on every `entries` read, the server's per-tick republish loop over every
 *  member) — the module's own contract is "`decode` is paired with
 *  `keySchema.parse`... it need not validate on its own", i.e. encode is meant to
 *  be a bare, cheap function call. Folding `keySchema` + `codec` into one
 *  `z.codec` schema would also entangle two orthogonal generics: `KS` alone
 *  types `Key<M>`/`MapRegistry<K>` today, with no wire concern at all. A `z.codec`
 *  win only shows up on the DECODE leg (collapsing `keySchema.parse(codec.decode(wire))`
 *  into one `.parse`) — adopting it there alone would mean maintaining two
 *  representations of the same transform, which is more surface, not less. */
export interface KeyCodec<K> {
  encode(key: K): string;
  decode(wire: string): K;
}

export interface SurfaceMap<
  KS extends ZodType,
  ES extends SurfaceSpec = SurfaceSpec,
  Failure = unknown,
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
  /** The `.surface` FRAGMENT of {@link contract} — `{ <member>: {...folded}, entries }`
   *  — exposed as a first-class field so a host that mounts this map as a sibling of its
   *  own surface (`{ surface: { ...ownSiblings, [name]: map.surfaceContract } }`) splices
   *  a TYPED value, never reaching into `contract` with an `as any`. The folded fragment
   *  is dynamically built, so its honest type is `AnyContractRouter` — the single
   *  library-side cast that lets EVERY connection site stay cast-free (PR3). */
  readonly surfaceContract: AnyContractRouter;
  /** The map's mount NAME — the sibling key it is served under in a combined surface
   *  (kolu's `"padi"`, drishti's `"hosts"`). When set, `connectSurfaceMap` derives the
   *  transport-slice key FROM it, so the connection site carries no stringly sibling key
   *  (PR3 — "the key derives from the declaration"). Omitted for a map served standalone
   *  at the transport root (the in-process test harness), where nothing is sliced. */
  readonly name?: string;
  /** The membership collection's spec — `Collection<string, EntryStatus<Failure>>`
   *  on the wire (see the module doc for why the collection key is always a plain
   *  string), read-only. Backs both the server's `entries` handlers and the
   *  client's bound collection; both decode through {@link codec} at their own
   *  API boundary. */
  readonly entriesSpec: CollectionSpec<string, EntryStatus<Failure>>;
  /** The string <-> key codec — see {@link KeyCodec}. */
  readonly codec: KeyCodec<z.infer<KS>>;
}

/** Build a `SurfaceMap` from a key schema, an entry surface, the key's string
 *  codec (required — see {@link KeyCodec}; a plain-string `K` passes the identity
 *  pair), and — REQUIRED (PR4) — the domain `failure` schema that validates the
 *  value on a failed entry. `Failure` is INFERRED from the `failure` schema, so a
 *  domain map needs no explicit type argument: `defineSurfaceMap({ key, codec,
 *  entry, failure: PadiEntryFailureSchema })` gives back a
 *  `SurfaceMap<…, PadiEntryFailure>` whose `failed` arm can only carry a
 *  schema-valid `PadiEntryFailure`. */
export function defineSurfaceMap<
  KS extends ZodType,
  const ES extends SurfaceSpec,
  Failure,
>(opts: {
  key: KS;
  entry: Surface<ES>;
  codec: KeyCodec<z.infer<KS>>;
  failure: ZodType<Failure>;
  /** The sibling key this map is mounted under in a combined surface (see
   *  {@link SurfaceMap.name}). Omit for a standalone/at-root map. */
  name?: string;
}): SurfaceMap<KS, ES, Failure> {
  const { key: keySchema, entry, codec, failure, name } = opts;
  const members = foldedMembers(entry.spec);
  // Build the EntryStatus schema from the map's `failure` ONCE, then thread the SAME
  // instance to both homes that need it — the `entries.get` contract output and the
  // `entriesSpec` collection value — rather than deriving the identical schema twice.
  const statusSchema = entryStatusSchema(failure);
  // Keep the `.surface` fragment as a named value so it backs BOTH the full `contract`
  // and the first-class `surfaceContract` field a host splices — one dynamic fragment,
  // one library-side cast, no `as any` at any connection site.
  const surfaceFragment = {
    ...members,
    entries: entriesContract(statusSchema),
  };
  const contract = oc.router({
    surface: surfaceFragment,
  } as unknown as AnyContractRouter) as AnyContractRouter;
  const surfaceContract = surfaceFragment as unknown as AnyContractRouter;

  const entriesSpec: CollectionSpec<string, EntryStatus<Failure>> = {
    keySchema: z.string(),
    schema: statusSchema,
    verbs: ["keys", "get"],
  };

  return {
    keySchema,
    entry,
    contract,
    surfaceContract,
    entriesSpec,
    codec,
    name,
  };
}
