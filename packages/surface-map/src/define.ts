/**
 * `defineSurfaceMap` — the CONTRACT half of a keyed map of remote surfaces.
 *
 * A `SurfaceMap` is one entry spec (`Surface<ES>`) typed ONCE, keyed at runtime by a
 * `keySchema`-validated key `K` (`Key<M>`, `KS["Type"]`) — a plain string in the
 * common case, but not required to be one (kolu's own `HostKey` is a discriminated
 * sum object). The map keeps the entry surface's `Surface<ES>` verbatim (it is the
 * type the client subtree is generated from) and, alongside it, derives a WIRE
 * `RpcGroup` that folds a key into EVERY entry-member procedure's payload — so a call
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
 * `keySchema` decoding (paired with `codec.decode`, on the client's `decodeKey` and the
 * server's wire handler) is the sole producer of a validated `K` from a wire string —
 * a raw unvalidated value is a type error wherever `Key` is expected (P4 at the typed
 * API); the wire handler re-validates via the same schema (P5 gate).
 *
 * Membership is published as ONE authoritative collection: `entries:
 * Collection<Key, EntryStatus>`. Absence = the key is not in the collection —
 * there is NO `absent` status variant. One writer (the server, from its
 * `MapRegistry`) publishes membership + status together.
 *
 * ## The tag namespace (W2 / PLAN D1)
 *
 * The wire namespace is FLAT and slash-joined, exactly as `@kolu/surface`'s own is:
 * a map served standalone mints `surface/<member>/<verb>`; a map DECLARED with a
 * mount `name` mints `surface/<name>/<member>/<verb>` — the same tags
 * `composeSurfaceContracts` would give the sibling. {@link SurfaceMap.tagPrefix}
 * carries that decision as a VALUE, so the server (which binds handlers at those
 * tags) and the client (which re-tags the entry face onto them) read one authority
 * rather than each re-deriving it. Every assembly goes through {@link assembleMapGroup},
 * which claims each tag and then proves `group.requests.size` matches — `RpcGroup.make`
 * is a last-writer-wins `Map.set` with no collision detection (review #16).
 *
 * ## The #17 mapping law
 *
 * Every `.optional()` in this file is `Schema.optionalKey` — NEVER `Schema.optional`,
 * which round-trips an explicit `undefined` through `null` and so changes the bytes.
 * No `.default()` idiom exists here; if one is ever added it is
 * `Schema.withDecodingDefaultKey`.
 */

import type {
  CellSpec,
  ClientCollectionPolicy,
  CollectionSpec,
  EventSpec,
  ProcedureSpec,
  StreamSpec,
  Surface,
  SurfaceSpec,
  WireSchema,
  WireSchemaAny,
} from "@kolu/surface/define";
import {
  collectionDeltasSchema,
  resolveCellVerbs,
  resolveCollectionVerbs,
  siblingTagPrefix,
  SURFACE_TAG_PREFIX,
  surfaceTag,
} from "@kolu/surface/define";
import {
  MapEntryFailed,
  MapKeyNonCanonical,
  MapKeyUnknown,
  SurfaceRelayTransportLost,
  SurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { INPUT_FIELD, MAP_KEY_FIELD } from "./envelope";
import type { FailureEvidence } from "./evidence";
import { FailureEvidenceSchema } from "./evidence";

export {
  type EvidenceLine,
  EvidenceLineSchema,
  type FailureEvidence,
  FailureEvidenceSchema,
} from "./evidence";

// ── Membership identity (PR3) ───────────────────────────────────────────

/** The opaque per-add membership identity — a BRANDED string, so an id can be
 *  produced ONLY two ways: `serveSurfaceMap`'s mint (a fresh
 *  {@link decodeMembershipId} of `crypto.randomUUID()`) and the wire schema's
 *  `entryStatusSchema` decode (the one boundary a status is decoded through). A bare
 *  `string` — an empty `""` or a client-fabricated value — is NOT assignable to
 *  `MembershipId`, so the "spellable empty/fabricated id" gap is a COMPILE ERROR,
 *  not a runtime convention (P4: the illegal value is unrepresentable; pinned by
 *  `membershipId.test-d.ts`). `isMinLength(1)` is the paired RUNTIME guard at the
 *  decode boundary; the brand is erased at runtime (the value is the plain string),
 *  so keying/serialization are unchanged. */
export const MembershipIdSchema = Schema.String.check(
  Schema.isMinLength(1),
).pipe(Schema.brand("MembershipId"));
export type MembershipId = typeof MembershipIdSchema.Type;

/** The ONE decode of a {@link MembershipId} — the Effect-Schema successor of
 *  `MembershipIdSchema.parse`. Throws (`SchemaError`) on an empty string, which is
 *  the fail-fast semantic the old `.parse` had at exactly this boundary. */
export const decodeMembershipId: (value: unknown) => MembershipId =
  Schema.decodeUnknownSync(MembershipIdSchema);

/** The client-only PENDING membership marker (PR3) — the single sanctioned id for
 *  the transient pre-frame gap, where a key is seen in the membership keyset before
 *  its first per-key status frame lands. It is minted ONCE through the schema (never
 *  a bare literal), and is DISPLAY-ONLY: it rides the synthesized `warming` that
 *  `foldState` returns for the gap, which no consumer reads a `membershipId` off,
 *  and the per-key client keys off `membershipIdOf` (the RAW status, `undefined`
 *  here) — NEVER this marker — so it can never be keyed against or collide with a
 *  real minted id (a UUID). Replaced by the real id on the next frame. */
export const PENDING_MEMBERSHIP_ID: MembershipId =
  decodeMembershipId("pending");

// ── Failure evidence ───────────────────────────────────────────────────
//
// The vocabulary itself lives in the schema-only leaf `./evidence` (see its header for
// why), and is re-exported here so `define.ts` remains the one import site for a map's
// whole contract vocabulary.

/** A domain failure and the EVIDENCE for it — ONE record, with ONE name. Wherever a
 *  down state carries a reason it carries this whole record, so the pairing rule is a
 *  TYPE rather than a convention restated at each site: "a reason whose evidence went
 *  missing" (juspay/kolu#2007) has no spelling anywhere the record is used.
 *
 *  This is the type every site the pair travels through refers to — the session's
 *  `EntryConnectionState` (`failed`, and `disconnected`'s optional `refuse`), the
 *  published {@link EntryStatus} `failed` arm, and the test harness's helpers. Making
 *  its PRESENCE the discriminant on `disconnected` is what removes the old two-same-tag-
 *  member union and its hand-written narrowing predicate: one optional field has no pair
 *  to leave uncorrelated. */
export interface FailureRecord<Failure = unknown> {
  readonly failure: Failure;
  readonly evidence: FailureEvidence;
}

// ── Membership status ──────────────────────────────────────────────────

/** The published per-entry status — the value carried by the `entries`
 *  collection. Absence from the collection is "not a member"; there is no
 *  `absent` variant (dual-authority for membership is unconstructible at the
 *  source — one writer publishes membership + status together). Readiness is
 *  LINK liveness, NOT clock-measured: an entry is `connected` as soon as the link
 *  is live. `clockOffset` is a SEPARATE fact on the connected arm — the serving
 *  process's own-clock offset at hello (one named writer, P3) — and it is
 *  `number | null`, where `null` has ONE meaning: not-yet-measured (the probe has
 *  not landed; the reader renders "—"). A connected entry with `clockOffset: null`
 *  is fully `connected`, never demoted to `warming`.
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
 *  narrows it at its own map.
 *
 *  {@link FailureEvidence} is that reason's EVIDENCE, and the `failed` arm carries the
 *  whole {@link FailureRecord} — see `FailureEvidence`'s doc, which is the ONE home of
 *  the argument for why the tail rides the failure record rather than the live
 *  `connection`, and why that arm carries no `connection` at all.
 *
 *  `Conn` is the FINE connection payload carried on the LIVE arms (SR9) — `warming` and
 *  `connected`: the domain's rich per-host connection state (padi's `ConnectionInfo` —
 *  the phase + log tail + elapsed the coarse `kind` folds away). Parameterized exactly
 *  like `Failure` — `@kolu/surface-map` carries the value and validates it against the
 *  map's OWN `connection` schema, but never enumerates what a domain's connection states
 *  ARE (dependency-arrow-out). It is the ONE authority the coarse `kind` (the dot) and
 *  the fine word both derive from, so a "dot connected, word connecting" split
 *  (drishti#102) has no encoding: `serveHostMap` produces `kind` and `connection` from
 *  the SAME `SessionState` frame in one projection. Optional so a structural fault (no
 *  session) and a connection-less map (the harness) omit it. The `failed` arm does not
 *  carry it AT ALL — a live word is work-in-flight, and a failed entry has none; its
 *  post-mortem is the {@link FailureRecord} instead. */
export type EntryStatus<Failure = unknown, Conn = unknown> =
  | { kind: "warming"; membershipId: MembershipId; connection?: Conn }
  | {
      kind: "connected";
      membershipId: MembershipId;
      clockOffset: number | null;
      connection?: Conn;
    }
  // The whole {@link FailureRecord} — reason AND evidence, or neither. And note what
  // this arm does NOT carry: there is no `connection` here (see {@link FailureEvidence}
  // for why the tail rides the record instead).
  | ({ kind: "failed"; membershipId: MembershipId } & FailureRecord<Failure>);

/** "We cannot see the publisher" — the CLIENT-ONLY arm `floorOnLiveness` mints when OUR
 *  link to the map's publisher is dead, replacing the live claim it can no longer hear
 *  (#1568) with an honest statement about US.
 *
 *  It exists because the floor's demotion was LOSSY. Flooring a `connected` entry to
 *  `warming` collapsed two facts with OPPOSITE consequences into one value: "the publisher
 *  says this host is coming up" (a real, self-healing campaign, worth timing) and "we cannot
 *  see the publisher at all" (we know nothing, and may claim nothing). A consumer that merely
 *  SPINS is fine either way — {@link isSettling} is that consumer's one call. A consumer that
 *  TIMES the entry (a deadline, an escalation, a "failed to start" verdict) is not: kolu#2129
 *  is the recorded failure, where a backgrounded tab's dropped socket demoted a healthy local
 *  host to `warming` and a 30s boot deadline then certified a twelve-hour-old daemon dead.
 *  A separate arm makes that mistake a COMPILE ERROR at every `.exhaustive()` rather than a
 *  rule each future consumer must remember — the reason it is an ARM and not an optional flag
 *  on `warming`, which anyone could ignore without the build noticing.
 *
 *  Named for OUR epistemic state, not the host's condition. "Unreachable" would assert
 *  something about the host — repeating the very conflation, since the host is very often
 *  perfectly healthy and it is our socket that died (and kolu's host vocabulary already
 *  spends the word "unreachable" on a genuinely `failed` host).
 *
 *  It is NEVER paintable as connected/green: the arm carries no `clockOffset`, so the clock
 *  lens has nothing to reproject, and no `connection`, so a frozen live word cannot keep
 *  narrating work that is no longer live. `membershipId` rides through untouched — the floor
 *  is about liveness, not identity, so this is still the SAME membership, keyed the same way
 *  (PR3). `published` carries what the publisher's last frame actually said, so a consumer
 *  that wants the last-known shape has it WITHOUT the framework pretending the claim still
 *  holds; there is no `failed` inhabitant because {@link EntryStatus}'s `failed` arm passes
 *  the floor untouched (its record is a post-mortem, not a liveness claim).
 *
 *  It has no wire schema, and that is deliberate rather than an omission: it is a projection
 *  of the CONSUMER's own transport, meaningless to anyone else, so a floored value can never
 *  be republished — {@link entryStatusSchema} has no arm to encode it into. */
export type UnobservableEntry = {
  kind: "unobservable";
  membershipId: MembershipId;
  /** The last thing the publisher SAID, before we lost the ability to hear it. */
  published: "warming" | "connected";
};

/** What a client can honestly say about a MEMBER entry: the publisher's own
 *  {@link EntryStatus}, or {@link UnobservableEntry} when our link to that publisher is dead.
 *  This — not `EntryStatus` — is what the client's `entries` collection carries, because
 *  every value it hands out has already been through `floorOnLiveness`. `EntryStatus` stays
 *  the PUBLISHED (wire) type, unchanged and un-widened, so the floor's blast radius stops at
 *  the client. */
export type ObservedEntryStatus<Failure = unknown, Conn = unknown> =
  | EntryStatus<Failure, Conn>
  | UnobservableEntry;

/** The total state of an entry lens — the {@link ObservedEntryStatus} when the key IS a
 *  member, plus the explicit `not-a-member` value the client fold returns when it is not. It
 *  lives HERE (the contract module, solid-free), not in the client, so a NODE consumer that
 *  re-exports it type-only through `index.ts` never drags the Solid/DOM client into its
 *  typecheck (surface-remote would otherwise fail on onWake's `window`/`document`). */
export type EntryState<Failure = unknown, Conn = unknown> =
  | ObservedEntryStatus<Failure, Conn>
  | { kind: "not-a-member" };

/** "Should I show a spinner?" — the ONE call for the consumer that only wants to spin, so
 *  splitting {@link UnobservableEntry} off `warming` costs it nothing (a `kind === "warming"`
 *  test would have quietly stopped spinning over a dead link).
 *
 *  True for exactly the two unsettled arms — an observed campaign (`warming`) and a blind one
 *  (`unobservable`). Deliberately NOT a re-collapse of the distinction: it answers the
 *  question both arms genuinely share, and it is a `boolean`, so it can never be fed to
 *  anything that TIMES the entry — those consumers must still narrow the union themselves,
 *  which is the whole point. */
export function isSettling(state: EntryState): boolean {
  return state.kind === "warming" || state.kind === "unobservable";
}

/** The wire schema for {@link EntryStatus}, built from the map's OWN domain
 *  `failure` schema. Backs both the `entries` collection's `get` success and the
 *  client-side bound collection value. The `failed` arm carries `failure:
 *  <the map's domain schema>` — so the domain value is VALIDATED on the wire
 *  (PR4: the old loose `cause: z.string()` is gone; a domain's structural cause
 *  union, its `reason`, and any typed per-cause sidecar — padi's `running`/
 *  `expected` skew pair — are all validated by the domain schema itself, not
 *  waved through as unknown extras). A generic package can't know the domain's
 *  schema, so this is a FUNCTION of it rather than a module const. Every arm also
 *  carries `membershipId: MembershipIdSchema` (PR3) — the opaque per-add identity,
 *  BRANDED here so this decode is (with `serveSurfaceMap`'s mint) one of the only two
 *  producers of a `MembershipId`; a status decoded off the wire is branded by
 *  construction.
 *
 *  A `Schema.Union` of three `Schema.Struct`s, NOT a `Schema.TaggedUnion`: the
 *  discriminant is `kind`, not `_tag`, and the encoded bytes must stay exactly what
 *  the zod `z.discriminatedUnion("kind", …)` produced. */
export function entryStatusSchema<Failure, Conn = unknown>(
  failureSchema: WireSchema<Failure>,
  // SR9: the FINE connection payload's schema. Optional — a map that carries no fine
  // connection (the in-process harness) omits it and no arm carries a `connection`
  // field. When present, the LIVE arms (`warming`/`connected`) gain
  // `connection: Schema.optionalKey(<schema>)`; the `failed` arm below deliberately
  // does not, because a failed entry has no work in flight to narrate. The domain
  // provides the schema; this package validates against it, never enumerating it — the
  // same volatility-neutral posture as `failure`.
  //
  // `optionalKey`, never `optional` (#17): `Schema.optional` admits an EXPLICIT
  // `undefined` and JSON-encodes it as `null`, where the zod original simply omitted
  // the key. `optionalKey` is key-absent-only, which is byte-identical.
  connectionSchema?: WireSchema<Conn>,
): WireSchema<EntryStatus<Failure, Conn>> {
  // Annotated as `Struct.Fields` (not left to inference): the two branches would
  // otherwise UNION into `{ connection?: undefined } | { connection: … }`, whose spread
  // TypeScript reads as a field literally typed `undefined`.
  const conn: Schema.Struct.Fields =
    connectionSchema === undefined
      ? {}
      : { connection: Schema.optionalKey(connectionSchema) };
  return Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("warming"),
      membershipId: MembershipIdSchema,
      ...conn,
    }),
    Schema.Struct({
      kind: Schema.Literal("connected"),
      membershipId: MembershipIdSchema,
      // `null` = not-yet-measured (ONE meaning); readiness is link-liveness, so a
      // connected entry stays connected whether or not the offset has landed.
      clockOffset: Schema.NullOr(Schema.Number),
      ...conn,
    }),
    Schema.Struct({
      kind: Schema.Literal("failed"),
      membershipId: MembershipIdSchema,
      failure: failureSchema,
      // REQUIRED on the wire, not merely in TypeScript: a failed status without its
      // evidence FAILS this decode. Enforcement lives at the codec, so "reason without
      // evidence" cannot be decoded even from a hand-crafted frame.
      evidence: FailureEvidenceSchema,
      // No `...conn` — the failed arm carries no `connection` (see `EntryStatus`). The
      // wire must agree with the type or a hand-crafted frame could smuggle back the
      // duplicate live tail the type just removed.
    }),
  ]) as unknown as WireSchema<EntryStatus<Failure, Conn>>;
}

// ── The map's declared rejection vocabulary (D4) ────────────────────────

/** The three typed rejections a map hop can raise, as ONE declared error channel.
 *  They live in `@kolu/surface/errors`, not here (S1/D4): a map entry's call crosses
 *  the SAME re-serving parent hop as every other surface error, so both ends must
 *  have been built from one schema for `_tag` and data to survive
 *  serialize → deserialize → re-serialize. Location is structure — the shared wire
 *  vocabulary is a property of the wire, not of the package that happens to raise it.
 *
 *  Declared on EVERY folded member, streaming ones included: membership loss is a
 *  typed END, but a NON-CANONICAL wire key is a real rejection on any verb, and a
 *  stream whose error channel did not declare it would flatten it into a defect. */
export const MapRejectionSchema = Schema.Union([
  MapKeyNonCanonical,
  MapKeyUnknown,
  MapEntryFailed,
]);

/** The decoded union of {@link MapRejectionSchema}. */
export type MapRejection = typeof MapRejectionSchema.Type;

/** The transport deaths a folded call carries UP from the entry's own link.
 *
 *  A map hop does not only raise its own three rejections — it FORWARDS
 *  (`serveSurfaceMap`'s `unaryHandler` / `forwardStream` hand the call straight to
 *  `session.dispatch`), so whatever the entry's link fails with becomes this member's
 *  failure. That link is a stdio/unix leg (`SurfaceStdioTransportClosed`, e.g. the
 *  daemon behind the entry is respawning) or a re-serve relay
 *  (`SurfaceRelayTransportLost`), and BOTH are `@kolu/surface/errors` classes the far
 *  end was built from. Undeclared, they were encoded against a union that does not
 *  contain them and reached the caller as an OPAQUE STRING defect
 *  (`Expected MapKeyNonCanonical | MapKeyUnknown | MapEntryFailed, got
 *  SurfaceStdioTransportClosed …`) — precisely the flattening the D4 declaration
 *  exists to kill, and precisely what made a caller unable to tell a respawning
 *  daemon ("not yet") from a terminal fault ("never").
 *
 *  `SurfaceTransportRetired` is deliberately ABSENT: it is the BROWSER socket's own
 *  4001 retirement, raised by the consumer's link, never carried up through a
 *  forward. */
const ForwardedTransportDeathSchema = Schema.Union([
  SurfaceStdioTransportClosed,
  SurfaceRelayTransportLost,
]);

/** Everything the FRAMEWORK itself can put on a folded member's error channel: the
 *  map's own rejections ({@link MapRejectionSchema}) plus the transport deaths its
 *  forward relays ({@link ForwardedTransportDeathSchema}). */
const FoldedFrameworkErrorSchema = Schema.Union([
  MapRejectionSchema,
  ForwardedTransportDeathSchema,
]);

// ── Key-fold schema builders (mirror @kolu/surface/define, +mapKey) ─────
//
// Each mirrors a per-primitive Rpc emitter in `@kolu/surface/define`, wrapping the
// member's payload `S` in a UNIFORM ENVELOPE — `Schema.Struct({ mapKey, input: S })`
// — before `Rpc.make`; a member with NO input carries NO `input` field at all
// (`Schema.Struct({ mapKey })`), NOT `input: Schema.Void` (see `foldInput` / the
// envelope). Successes are untouched. The envelope (not a spread merge) is
// deliberate: ONE wire shape for every proc regardless of `S` (object, primitive, or
// none — a primitive `terminalAttach`/`cell.set` input rides `input` verbatim), and,
// decisively, an entry input that itself carries a `mapKey` field cannot collide
// with the folded key (it is nested under `input`), so misroute-by-collision is
// UNCONSTRUCTIBLE (P4), not merely unlikely.
//
// The folded `mapKey` field is ALWAYS `Schema.String` here — the canonical wire form
// {@link KeyCodec} produces — regardless of what the map's own `K` is. The server
// re-derives + re-validates the real `K` from it (`codec.decode` + a `keySchema`
// decode, the P5 gate); these builders never see `K` at all.

/** True for `Schema.Void` / `Schema.Undefined` — a member whose input carries no wire
 *  payload. Checked via the schema's own AST `_tag` (the Effect successor of zod's
 *  `.def.type` probe). Such a member's envelope OMITS the input field entirely (see
 *  {@link foldInput}), so validation never depends on the validator accepting a MISSING
 *  key for a void schema — a leniency zod tightened in >=4.3.7 (`z.object({ input:
 *  z.void() }).parse({})` throws "expected nonoptional") and which Effect Schema never
 *  granted at all (`Schema.Struct({ input: Schema.Void })` demands the key). Without
 *  this, every void-input fold over the wire would break. */
function isVoidInput(inner: WireSchemaAny): boolean {
  const tag = inner.ast._tag;
  return tag === "Void" || tag === "Undefined";
}

/** The fold envelope schema. For a member WITH input:
 *  `Schema.Struct({ mapKey, input })`. For a VOID member (no input, or an explicit
 *  `Schema.Void`/`Schema.Undefined`): `Schema.Struct({ mapKey })` with NO input field
 *  — `{ mapKey }` is the ONE valid wire shape, and a schema without an `input` field
 *  cannot reject its absence, so the fold is independent of the validator's
 *  missing-key policy (see `isVoidInput`). The single home of the shape. Exported for
 *  the round-trip pin. */
export function foldInput(inner?: WireSchemaAny): WireSchemaAny {
  if (inner === undefined || isVoidInput(inner)) {
    return Schema.Struct({
      [MAP_KEY_FIELD]: Schema.String,
    }) as unknown as WireSchemaAny;
  }
  return Schema.Struct({
    [MAP_KEY_FIELD]: Schema.String,
    [INPUT_FIELD]: inner,
  }) as unknown as WireSchemaAny;
}

/** A folded member's declared error channel: everything the FRAMEWORK can raise on
 *  this hop ({@link FoldedFrameworkErrorSchema} — the map's own three rejections plus
 *  the entry link's transport deaths the forward relays), plus the ENTRY's declared
 *  error union when it has one (SK6). Without threading each of those declarations
 *  through, the map hop would encode the failure against a union that does not contain
 *  it and flatten it into an opaque defect — exactly the collapse the declaration
 *  exists to kill. */
function foldedError(entryError?: WireSchemaAny): WireSchemaAny {
  return (entryError === undefined
    ? FoldedFrameworkErrorSchema
    : Schema.Union([
        FoldedFrameworkErrorSchema,
        entryError,
      ])) as unknown as WireSchemaAny;
}

function foldedCellRpcs(
  tagBase: string,
  spec: CellSpec<unknown, unknown, unknown>,
): Record<string, Rpc.Any> {
  const out: Record<string, Rpc.Any> = {};
  for (const v of resolveCellVerbs(spec)) {
    if (v === "get") {
      out.get = Rpc.make(`${tagBase}/get`, {
        payload: foldInput(),
        success: spec.schema,
        error: foldedError(),
        stream: true,
      });
    } else if (v === "set") {
      out.set = Rpc.make(`${tagBase}/set`, {
        payload: foldInput(spec.schema),
        error: foldedError(),
      });
    } else if (v === "patch") {
      if (!spec.patchSchema) {
        throw new Error(
          "defineSurfaceMap: cell exposes 'patch' but has no patchSchema",
        );
      }
      out.patch = Rpc.make(`${tagBase}/patch`, {
        payload: foldInput(spec.patchSchema),
        error: foldedError(),
      });
    } else if (v === "test__set") {
      out.test__set = Rpc.make(`${tagBase}/test__set`, {
        payload: foldInput(spec.schema),
        error: foldedError(),
      });
    }
  }
  return out;
}

function foldedCollectionRpcs(
  tagBase: string,
  spec: CollectionSpec<unknown, unknown, unknown>,
): Record<string, Rpc.Any> {
  const keyShape = Schema.Struct({ key: spec.keySchema });
  const upsertShape = Schema.Struct({
    key: spec.keySchema,
    value: spec.schema,
  });
  const out: Record<string, Rpc.Any> = {};
  for (const v of resolveCollectionVerbs(spec)) {
    if (v === "keys") {
      out.keys = Rpc.make(`${tagBase}/keys`, {
        payload: foldInput(),
        success: Schema.Array(spec.keySchema),
        error: foldedError(),
        stream: true,
      });
    } else if (v === "get") {
      out.get = Rpc.make(`${tagBase}/get`, {
        payload: foldInput(keyShape),
        success: spec.schema,
        error: foldedError(),
        stream: true,
      });
    } else if (v === "deltas") {
      out.deltas = Rpc.make(`${tagBase}/deltas`, {
        payload: foldInput(),
        success: collectionDeltasSchema(spec.keySchema, spec.schema),
        error: foldedError(),
        stream: true,
      });
    } else if (v === "upsert") {
      out.upsert = Rpc.make(`${tagBase}/upsert`, {
        payload: foldInput(upsertShape),
        error: foldedError(),
      });
    } else if (v === "delete") {
      out.delete = Rpc.make(`${tagBase}/delete`, {
        payload: foldInput(keyShape),
        error: foldedError(),
      });
    } else if (v === "test__set") {
      out.test__set = Rpc.make(`${tagBase}/test__set`, {
        payload: foldInput(Schema.Array(upsertShape)),
        error: foldedError(),
      });
    }
  }
  return out;
}

function foldedStreamRpcs(
  tagBase: string,
  spec: StreamSpec<unknown, unknown>,
): Record<string, Rpc.Any> {
  return {
    get: Rpc.make(`${tagBase}/get`, {
      payload: foldInput(spec.inputSchema),
      success: spec.outputSchema,
      error: foldedError(),
      stream: true,
    }),
  };
}

function foldedEventRpcs(
  tagBase: string,
  spec: EventSpec<unknown, unknown>,
): Record<string, Rpc.Any> {
  return {
    get: Rpc.make(`${tagBase}/get`, {
      payload: foldInput(spec.inputSchema),
      success: spec.outputSchema,
      error: foldedError(),
      stream: true,
    }),
  };
}

function foldedProcedureRpc(
  tag: string,
  spec: ProcedureSpec<unknown, unknown>,
): Rpc.Any {
  return Rpc.make(tag, {
    payload: foldInput(spec.input),
    success: spec.output ?? Schema.Void,
    // The entry's DECLARED error union rides the folded member too (SK6).
    error: foldedError(spec.error),
  });
}

/** The reserved membership member name. An entry member may not claim it. */
export const ENTRIES_MEMBER = "entries";

/** The read-only `entries` membership collection's Rpcs — NOT folded (its key IS the
 *  map key). Its wire key is ALWAYS `Schema.String` (the canonical encoded form; see
 *  the module doc) — the client reads it (`keys`/`get`) and decodes through
 *  {@link KeyCodec}; the server is the sole writer (membership is published, not
 *  mutated over the wire). Takes the ALREADY-built {@link entryStatusSchema} (derived
 *  ONCE in {@link defineSurfaceMap}) as the per-entry `get` success, so the same
 *  instance backs both this group and `entriesSpec.schema` rather than being computed
 *  twice.
 *
 *  Minted at exactly the tags `defineSurface({ collections: { entries: entriesSpec } })`
 *  would mint — that surface is what `connectSurfaceMap` builds the membership face
 *  from, so the two must agree. `mapGroup.test.ts` spells both key sets and compares
 *  them. */
function entriesRpcs(
  tagPrefix: string,
  statusSchema: WireSchemaAny,
): Record<string, Rpc.Any> {
  return {
    keys: Rpc.make(surfaceTag(tagPrefix, ENTRIES_MEMBER, "keys"), {
      success: Schema.Array(Schema.String),
      stream: true,
    }),
    get: Rpc.make(surfaceTag(tagPrefix, ENTRIES_MEMBER, "get"), {
      payload: Schema.Struct({ key: Schema.String }),
      success: statusSchema,
      error: foldedError(),
      stream: true,
    }),
  };
}

/** Walk the entry spec and produce the key-folded Rpcs, keyed by wire tag —
 *  mirroring `defineSurface`'s spec walk. */
function foldedMemberRpcs(
  tagPrefix: string,
  entry: SurfaceSpec,
): Array<[member: string, rpcs: Record<string, Rpc.Any>]> {
  const out: Array<[string, Record<string, Rpc.Any>]> = [];
  const claim = (key: string, rpcs: Record<string, Rpc.Any>): void => {
    if (key === ENTRIES_MEMBER) {
      throw new Error(
        'defineSurfaceMap: an entry member named "entries" collides with the ' +
          "map's reserved membership collection — rename the member.",
      );
    }
    out.push([key, rpcs]);
  };
  for (const [key, s] of Object.entries(entry.cells ?? {})) {
    claim(key, foldedCellRpcs(tagPrefix + key, s));
  }
  for (const [key, s] of Object.entries(entry.collections ?? {})) {
    claim(key, foldedCollectionRpcs(tagPrefix + key, s));
  }
  for (const [key, s] of Object.entries(entry.streams ?? {})) {
    claim(key, foldedStreamRpcs(tagPrefix + key, s));
  }
  for (const [key, s] of Object.entries(entry.events ?? {})) {
    claim(key, foldedEventRpcs(tagPrefix + key, s));
  }
  for (const [ns, procs] of Object.entries(entry.procedures ?? {})) {
    const procRpcs: Record<string, Rpc.Any> = {};
    for (const [verb, ps] of Object.entries(procs)) {
      procRpcs[verb] = foldedProcedureRpc(surfaceTag(tagPrefix, ns, verb), ps);
    }
    claim(ns, procRpcs);
  }
  return out;
}

/** Claim every tag and PROVE nothing was dropped (PLAN D1 / review #16).
 *  `RpcGroup.make` is `new Map(rpcs.map(r => [r._tag, r]))` — a colliding tag is
 *  silently overwritten, last writer wins — so the walk claims into a flat map that
 *  throws on a duplicate, and the assembled group's size is then compared against the
 *  claim count. Both halves are load-bearing: `claim` catches the collisions it can
 *  SEE, and the size assertion catches any the walk failed to. */
export function assembleMapGroup(
  entries: Iterable<readonly [member: string, rpcs: Record<string, Rpc.Any>]>,
): RpcGroup.RpcGroup<Rpc.Any> {
  const byTag = new Map<string, Rpc.Any>();
  for (const [member, rpcs] of entries) {
    for (const [verb, rpc] of Object.entries(rpcs)) {
      if (byTag.has(rpc._tag)) {
        throw new Error(
          `defineSurfaceMap: duplicate verb "${verb}" claimed at "${member}" (wire tag "${rpc._tag}"). ` +
            "Multiple folded primitives or procedures resolve to the same wire tag.",
        );
      }
      byTag.set(rpc._tag, rpc);
    }
  }
  const group = RpcGroup.make(...byTag.values());
  if (group.requests.size !== byTag.size) {
    throw new Error(
      `defineSurfaceMap: RpcGroup assembly dropped ${byTag.size - group.requests.size} tag(s) — ` +
        `claimed ${byTag.size}, group carries ${group.requests.size}.`,
    );
  }
  return group;
}

// ── SurfaceMap value ────────────────────────────────────────────────────

/** The branded key of a `SurfaceMap` — the decoded type of its `keySchema`. */
export type Key<M> =
  M extends SurfaceMap<infer KS, SurfaceSpec> ? KS["Type"] : never;

/** The string <-> key bridge every map needs: {@link encode} produces the
 *  canonical wire string a key is transmitted/channel-named as; {@link decode}
 *  inverts it. For a `K` that is already a plain string this is the identity
 *  pair; kolu's `HostKey` (a discriminated-sum object) passes its own
 *  `encodeHostKey`/`decodeHostKey`. `decode` is paired with a `keySchema` decode at
 *  every call site (the P5 re-validation gate) — it need not validate on its own.
 *
 *  Considered (and rejected) folding this into a bidirectional Schema transform — the
 *  obvious "reuse the ecosystem's own primitive" move; the same argument that ruled
 *  out zod 4's `z.codec` rules it out here. `encode` runs on an ALREADY-validated `K`
 *  at the hottest, most frequent call sites in this module (the per-key client-cache
 *  lookup on every `entry(key)`/`clientFor` call, the membership fold on every
 *  `entries` read, the server's per-tick republish loop over every member) — the
 *  module's own contract is "`decode` is paired with the key decode... it need not
 *  validate on its own", i.e. encode is meant to be a bare, cheap function call, not a
 *  full re-validation. Folding `keySchema` + `codec` into one transforming schema
 *  would also entangle two orthogonal generics: `KS` alone types `Key<M>`/
 *  `MapRegistry<K>` today, with no wire concern at all. The win only shows up on the
 *  DECODE leg (collapsing `decodeKey(codec.decode(wire))` into one decode) — adopting
 *  it there alone would mean maintaining two representations of the same transform,
 *  which is more surface, not less. */
export interface KeyCodec<K> {
  encode(key: K): string;
  decode(wire: string): K;
}

export interface SurfaceMap<
  KS extends WireSchemaAny,
  ES extends SurfaceSpec = SurfaceSpec,
  Failure = unknown,
  Conn = unknown,
> {
  /** The key schema — a decode through it (paired with `codec.decode`) is the sole
   *  producer of a validated key from a wire string. */
  readonly keySchema: KS;
  /** The entry surface, kept verbatim — the type the client subtree is
   *  generated from, and the spec the server/client walk. */
  readonly entry: Surface<ES>;
  /** The key-folded WIRE group: one `Rpc` per entry-member verb (with a canonical-string
   *  `mapKey` folded into its payload) plus the two unfolded `entries` membership
   *  members. A host that serves this map merges this group into its own; there is no
   *  second "fragment" value to splice, because a tag carries its own route. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The tag prefix every member of {@link group} carries — `"surface/"` for a map
   *  served standalone, `"surface/<name>/"` for one DECLARED with a mount
   *  {@link SurfaceMap.name}. Carried on the value (not re-derived by callers) so the
   *  server's handler keys and the client's re-tagging read ONE authority. */
  readonly tagPrefix: string;
  /** The map's mount NAME — the sibling key it is served under in a combined surface
   *  (kolu's `"padi"`, drishti's `"hosts"`). When set, every tag this map mints is
   *  scoped under it and `connectSurfaceMap` re-tags the entry face onto them, so the
   *  connection site carries no stringly sibling key (PR3 — "the key derives from the
   *  declaration"). Omitted for a map served standalone at the transport root (the
   *  in-process test harness), where nothing is scoped. */
  readonly name?: string;
  /** The membership collection's spec — `Collection<string, EntryStatus<Failure>>`
   *  on the wire (see the module doc for why the collection key is always a plain
   *  string), read-only. Backs both the server's `entries` handlers and the
   *  client's bound collection; both decode through {@link codec} at their own
   *  API boundary. */
  readonly entriesSpec: CollectionSpec<string, EntryStatus<Failure, Conn>>;
  /** The string <-> key codec — see {@link KeyCodec}. */
  readonly codec: KeyCodec<KS["Type"]>;
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
  KS extends WireSchemaAny,
  const ES extends SurfaceSpec,
  Failure,
  Conn = unknown,
  EP = never,
>(opts: {
  key: KS;
  entry: Surface<ES>;
  codec: KeyCodec<KS["Type"]>;
  failure: WireSchema<Failure>;
  /** The OPAQUE, app-typed client error policy for the membership `entries`
   *  collection (SR11). Threaded onto `entriesSpec.client` so a map-membership
   *  subscription failure reaches the app's registered `onClientError`
   *  (`connectSurfaceMap`) — otherwise a policy declared nowhere would route
   *  nowhere. `EP` INFERS from the value; omit it for a policy-free map (`EP =
   *  never`, every existing caller). The membership collection has no per-key
   *  origin, so its interpreter fires ORIGIN-FREE (design §C). */
  entriesClient?: ClientCollectionPolicy<EP>;
  /** The FINE connection payload schema (SR9) — the rich per-host connection state the
   *  coarse `EntryStatus.kind` folds away (padi's `ConnectionInfoSchema`). `Conn` is
   *  INFERRED from it, so a domain map that carries a fine connection needs no explicit
   *  type argument. Omit for a map that carries no fine connection (the in-process
   *  harness); its entries then have no `connection` field. Validated against on the
   *  wire, never enumerated here — the same volatility-neutral posture as `failure`. */
  connection?: WireSchema<Conn>;
  /** The sibling key this map is mounted under in a combined surface (see
   *  {@link SurfaceMap.name}). Omit for a standalone/at-root map. */
  name?: string;
}): SurfaceMap<KS, ES, Failure, Conn> {
  const { key: keySchema, entry, codec, failure, connection, name } = opts;
  // The tag prefix is decided ONCE, here, from the declaration — never re-derived by
  // the server or the client (both read it off the value).
  const tagPrefix =
    name === undefined ? SURFACE_TAG_PREFIX : siblingTagPrefix(name);
  // Build the EntryStatus schema from the map's `failure` (and, SR9, its `connection`)
  // ONCE, then thread the SAME instance to both homes that need it — the `entries.get`
  // success schema and the `entriesSpec` collection value — rather than deriving the
  // identical schema twice.
  const statusSchema = entryStatusSchema(failure, connection);
  const group = assembleMapGroup([
    ...foldedMemberRpcs(tagPrefix, entry.spec),
    [
      ENTRIES_MEMBER,
      entriesRpcs(tagPrefix, statusSchema as unknown as WireSchemaAny),
    ],
  ]);

  const entriesSpec: CollectionSpec<string, EntryStatus<Failure, Conn>> = {
    keySchema: Schema.String,
    schema: statusSchema,
    verbs: ["keys", "get"],
    // The app-typed membership error policy (SR11) — inert data the framework only
    // threads to the app's `onClientError`; without it the map-membership error would
    // route nowhere. `EP` typed the OPTS for the caller; here it rides the spec as the
    // base (policy-erased) `ClientCollectionPolicy<never>` shape — the same cast-through-
    // the-base move `defineSurfaceWithPolicy` makes — so the `SurfaceMap` type (and every
    // `SurfaceMap<KS,ES,Failure,Conn>` consumer: connect/serve) is unchanged by `EP`.
    client: opts.entriesClient as ClientCollectionPolicy<never> | undefined,
  };

  return {
    keySchema,
    entry,
    group,
    tagPrefix,
    entriesSpec,
    codec,
    name,
  };
}
