/**
 * WHAT a `surface://` URI names, WHICH leg of the dialled bundle answers it, and
 * how a one-shot read of it produces a snapshot.
 *
 * ## Addressing and binding are two questions, so they are two functions
 *
 * {@link addressOf} is pure over `(uri, generation)`: it says what this
 * generation serves at that address, with no client in sight. {@link bind} takes
 * that address to a dialled bundle and says whether the call can actually be
 * placed. Splitting them is what lets `resources/subscribe` ask the first
 * question alone (it has no client and needs none), and what stops the second
 * from being asked twice.
 *
 * They used to be ONE function returning `ResolvedCall | undefined`, and FOUR
 * distinct facts left it through TWO channels:
 *
 *   - *no such address* → `undefined`;
 *   - *address served, client leg missing* → a resolved call whose `open()` fails,
 *     i.e. a value encoded as BEHAVIOUR: the function fabricated a failing stream
 *     purely to carry a sentence, so "what does this address resolve to" was
 *     complected with "what happens when you open it";
 *   - *address served, client present, its face has no such MEMBER* → `undefined`
 *     AGAIN, which is the exact silence the second arm had just been fixed for: a
 *     `resources/read` answered "unknown resource" (false — the resource is
 *     known) and a live subscription was dropped without a word, because
 *     `ResourcePusher.startStream` takes `undefined` to mean "nothing to stream";
 *   - a real call.
 *
 * The union below says four, so a reader cannot collapse two of them by accident,
 * and the two unreachable arms travel the same route: a failing stream for the
 * subscription (the pusher reports it through `onError`, detaches and retries, so
 * a host factory that catches up heals it) and a raised failure for the one-shot
 * read.
 *
 * ## One derivation, once
 *
 * The address is derived ONCE per request and carried. A second copy of the
 * same walk for subscriptions, and a collection-item reader that re-parsed the
 * URI, re-looked-up the template and re-decoded the key, were each a duplicated
 * derivation, not a safety net.
 *
 * ## What a URI is to a generation, in three outcomes
 *
 * {@link addressOf} answers SERVED (with the address), NOT A KEY (the URI falls
 * under a served collection and its name fails that collection's key schema,
 * with the schema's own sentence), or UNSERVED. {@link refusalOf} words the two
 * refusals, once, for both `resources/read` and `resources/subscribe`.
 */

import {
  clientAt,
  type RootedSurfaceClients,
  type SiblingKey,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  ITEM_READ_DEADLINE_MS,
} from "@kolu/surface/first-frame";
import { messageOf } from "@kolu/surface/errors";
import { decodeTextValue } from "@kolu/surface/verbs";
import { Effect, Result, Stream } from "effect";
import { match, P } from "ts-pattern";
import type { ResolvedBundle } from "./bundle";
import type { DepartedNames } from "./departed";
import {
  collectionUri,
  parseCollectionItem,
  type ResourceEntry,
} from "./expose";

/** WHAT one generation serves at one URI — resolved without a client.
 *
 *  Cells/streams/events are read via `.get(undefined)` (their input is either
 *  absent or `Schema.Void` — an empty `{}` is not that value); a collection's
 *  key-set via `.keys(undefined)`; a collection item via `.get({ key })`, where
 *  `key` is the item's name already decoded through the collection's key schema
 *  (so a `Schema.Finite` key addresses item `42`, not `"42"`). */
export type Address =
  | {
      readonly kind: ResourceEntry["kind"];
      readonly uri: string;
      readonly sibling: SiblingKey;
      readonly key: string;
      /** The member verb that opens it. */
      readonly verb: "get" | "keys";
      readonly mimeType: string;
    }
  | {
      readonly kind: "collection-item";
      readonly uri: string;
      readonly sibling: SiblingKey;
      readonly key: string;
      /** The member verb that opens it — an item is always the collection's
       *  `get`. Spelled on the arm rather than re-derived from `kind` at every
       *  reader: `bind` and {@link unreachableDetail} each used to ask
       *  `kind === "collection-item" ? "get" : address.verb` for the same fact. */
      readonly verb: "get";
      /** The item's name, decoded against the collection's key schema. Decoded
       *  HERE, once, and carried — the reader downstream used to decode it a
       *  second time from the same URI. */
      readonly itemKey: unknown;
      /** Does the COLLECTION declare a `keys` verb? The CONTRACT's answer
       *  (`resolveCollectionVerbs`, resolved once at expose time onto the
       *  template), not a duck-type of the dialled client — see
       *  {@link readCollectionItemSnapshot}. */
      readonly listable: boolean;
      readonly mimeType: string;
    };

/** What a URI is to one generation — see the module header. */
export type Resolution =
  | { readonly at: "served"; readonly address: Address }
  /** The URI falls under a served collection, and its name is not a key of it. */
  | {
      readonly at: "not-a-key";
      /** The collection's own address. */
      readonly collection: string;
      /** The key schema's own failure, verbatim. */
      readonly why: string;
    }
  | { readonly at: "unserved" };

/** Resolve a URI against one generation's tables. */
export function addressOf(uri: string, gen: ResolvedBundle): Resolution {
  const entry = gen.byUri.get(uri);
  if (entry !== undefined) {
    return {
      at: "served",
      address: {
        kind: entry.kind,
        uri,
        sibling: entry.sibling,
        key: entry.key,
        verb: entry.kind === "collection" ? "keys" : "get",
        mimeType: entry.mimeType,
      },
    };
  }
  // Looked up by COLLECTION address: keyed so, two siblings exposing the same
  // member key cannot answer for each other's items.
  const item = parseCollectionItem(uri, gen.templateByCollection);
  if (item === null) return { at: "unserved" };
  const { entry: template, name } = item;
  // A name that fails its key schema names nothing this generation can serve,
  // so `.get` is never called with a wrong-typed key — and the refusal carries
  // the schema's own sentence, which is where a consumer teaches what a name of
  // that collection looks like. The DECODED key is what the address carries:
  // the face's collection payloads are built from decoded keys (`client.ts`).
  const landed = decodeTextValue(template.keySchema, name);
  if (Result.isFailure(landed)) {
    return {
      at: "not-a-key",
      collection: collectionUri(template.sibling, template.key),
      why: messageOf(landed.failure),
    };
  }
  return {
    at: "served",
    address: {
      kind: "collection-item",
      uri,
      sibling: template.sibling,
      key: template.key,
      verb: "get",
      itemKey: landed.success.decoded,
      listable: template.listable,
      mimeType: "application/json",
    },
  };
}

/** Whether this generation serves `uri` — for a read and a subscription alike.
 *  The SAME derivation a read uses, asked without a client. */
export function servesAddress(uri: string, gen: ResolvedBundle): boolean {
  return addressOf(uri, gen).at === "served";
}

/** THE sentence for a URI this generation does not serve — one wording for
 *  `resources/read` and `resources/subscribe`, so the two cannot disagree.
 *
 *  Three answers: a name the collection's key schema refuses carries that
 *  schema's sentence; an address a departed sibling served says so
 *  (`./departed.ts`); anything else names every static resource and item
 *  template this generation serves, so the next request can be a right one.
 *  The list is not cut short: a cut list reads as a whole one. */
export function refusalOf(
  uri: string,
  resolution: Exclude<Resolution, { at: "served" }>,
  gen: ResolvedBundle,
  departed: DepartedNames,
): string {
  if (resolution.at === "not-a-key") {
    return `resource "${uri}" names no item of "${resolution.collection}" — ${resolution.why}`;
  }
  const retired = departed.resourceRetired(uri, gen.siblings);
  if (retired !== undefined) return retired;
  const quoted = (uris: readonly string[]): string =>
    uris.map((one) => `"${one}"`).join(", ");
  const statics = gen.resources.map((r) => r.uri);
  const templates = gen.resourceTemplates.map((t) => t.uriTemplate);
  return [
    `unknown resource "${uri}".`,
    statics.length === 0
      ? "No resource is served here."
      : `The resources served here are ${quoted(statics)}.`,
    ...(templates.length === 0
      ? []
      : [
          `An item of a collection is read at ${quoted(templates)}, its name written as the collection lists it.`,
        ]),
  ].join(" ");
}

/** What a served address is on a particular dialled bundle. Three outcomes, and
 *  each is a VALUE: none of them is a behaviour a caller has to run to learn. */
export type Bound =
  | {
      readonly at: "call";
      readonly address: Address;
      /** Open the member's streaming source. LAZY — nothing is dispatched until
       *  the returned stream is run, and the run's fiber owns its lifetime. */
      readonly open: () => Stream.Stream<unknown, unknown>;
      /** The leg that answered, for a reader that needs a SECOND member of the
       *  same surface (the bounded item read's `keys` watch). */
      readonly client: SurfaceClientCallable;
    }
  /** The tables carry this address; the client bundle has no leg for its
   *  surface. */
  | { readonly at: "no-leg"; readonly address: Address }
  /** The leg is there; its face carries no such member. A connection answering
   *  for a narrower surface than the roster being served. */
  | { readonly at: "no-member"; readonly address: Address };

/** WHICH client answers this address, and whether it can. */
export function bind(bundle: RootedSurfaceClients, address: Address): Bound {
  const client = clientAt(bundle, address.sibling);
  if (client === undefined) return { at: "no-leg", address };
  const proc = client.surface[address.key]?.[address.verb];
  if (proc === undefined) return { at: "no-member", address };
  const input =
    address.kind === "collection-item" ? { key: address.itemKey } : undefined;
  return {
    at: "call",
    address,
    open: () => asStream(proc(input), address.uri, address.kind),
    client,
  };
}

/** ONE fact about one dialled bundle, read by ONE reader — an MCP host — so it is
 *  ONE sentence however it is reached.
 *
 *  It always names the LEG, because the fix is always at the host's `client()`
 *  factory: it was re-invoked and did not carry a surface the roster it serves
 *  says it should. The three sites that report this (a generated tool's dispatch,
 *  a bespoke tool's, a resource's) used to word it for themselves and already
 *  disagreed about the same condition. */
export function noLegFor(sibling: SiblingKey, what: string): string {
  const which =
    sibling === undefined
      ? "the bundle's core client"
      : `sibling "${sibling}"'s client`;
  return (
    `${what} is served by this bundle, but the dialled client bundle carries ` +
    `no ${which} — the connection is a leg short of the roster being served, ` +
    "not the address wrong."
  );
}

/** The OTHER half of the same fact, and the same arrangement: the leg is there
 *  and its face is narrower than the roster being served.
 *
 *  Beside {@link noLegFor} because the two travel together — a `tools/call` that
 *  finds no leg already says the first sentence and used to hand-roll the second
 *  as a bare `client has no procedure "<ns>.<verb>"`, which is the same condition
 *  the resource path words through {@link unreachableDetail}. One name, so the
 *  leg sentence and the member sentence move together. */
export function noMemberFor(
  sibling: SiblingKey,
  member: string,
  verb: string,
): string {
  const which = sibling === undefined ? "core" : `sibling "${sibling}"`;
  return (
    `the dialled ${which} client's face has no "${member}.${verb}" — the ` +
    "connection is answering for a narrower surface than the roster being " +
    "served, not the address wrong."
  );
}

/** The unreachable arms' sentence — a leg that is missing, or a leg whose face
 *  is. Both name the CONNECTION as the thing that is behind, because in both
 *  cases the address is right and the dial is not. */
export function unreachableDetail(
  bound: Extract<Bound, { at: "no-leg" | "no-member" }>,
): string {
  const { address } = bound;
  const what = `${address.uri} (${address.kind})`;
  if (bound.at === "no-leg") return noLegFor(address.sibling, what);
  return `${what} is served by this bundle, but ${noMemberFor(
    address.sibling,
    address.key,
    address.verb,
  )}`;
}

/** Open the streaming source for a subscribed URI (the pusher's `StreamFor`).
 *
 *  `undefined` ONLY for a URI this generation does not serve, which is the one
 *  thing the pusher's silent drop is correct for. An address it DOES serve but
 *  cannot reach comes back as a failing stream, so it travels the pusher's own
 *  recovery path — reported through `onError`, then detached and retried — rather
 *  than going permanently, silently quiet under a host that still believes it is
 *  subscribed. */
export function streamForUri(
  bundle: RootedSurfaceClients,
  uri: string,
  gen: ResolvedBundle,
): Stream.Stream<unknown, unknown> | undefined {
  const resolved = addressOf(uri, gen);
  if (resolved.at !== "served") return undefined;
  const address = resolved.address;
  const bound = bind(bundle, address);
  return bound.at === "call"
    ? bound.open()
    : Stream.fail(new Error(unreachableDetail(bound)));
}

export interface Snapshot {
  value: unknown;
  mimeType: string;
}

/** A one-shot read that produced no snapshot: a well-formed collection-item URI
 *  whose key is simply not present yet (the #1681 held-open case). Collapsing it
 *  into a bare `undefined` + one "unknown resource" message hid the distinction
 *  between it and an unaddressable URI (invalid-states-unrepresentable) — but
 *  UNADDRESSABLE never reaches here: {@link readSnapshot} takes an Address, so
 *  the handler that resolved one has already answered that case itself.
 *
 *  It is an ESTABLISHED fact. A read that ran out of time established nothing,
 *  so it is not a miss at all — it fails, with the sentence the CLI face gives
 *  the same outcome. `not-present` means "membership answered, and the answer is
 *  no"; nothing else may borrow it. */
export type ReadMiss = { miss: "not-present" };
export function isMiss(r: Snapshot | ReadMiss): r is ReadMiss {
  return "miss" in r;
}

/** Read a one-shot snapshot for a resource URI: pull the first frame of the
 *  primitive's streaming source and return immediately.
 *
 *  The empty-open POLICY depends on the kind's snapshot guarantee:
 *
 *    - **cell / collection / stream** are SNAPSHOT-FIRST
 *      (`@kolu/surface/server` opens a cell/collection with a current-value frame,
 *      and `StreamHandlerDeps` REQUIRES "first yield is a fresh full snapshot"), so
 *      an empty open is a dead/dropped bridge link, NOT an empty value — it FAILS,
 *      never collapses to `null` (the green-dot lie in MCP form;
 *      caught-error-must-not-collapse-to-empty).
 *    - **collection-item** is snapshot-first ONLY when the key currently EXISTS.
 *      A collection's membership is dynamic (a key can be born later), and the
 *      collection `get` HOLDS OPEN for an absent key instead of throwing (it
 *      yields nothing until the first upsert — the fix for the gray-chip #1681).
 *      That held-open semantic is correct for a LIVE subscription but would make a
 *      one-shot read block forever on a not-yet-born key, so the read races the
 *      item's first frame against a live `keys`-absence watch and a hard deadline
 *      — see {@link readCollectionItemSnapshot}.
 *    - **event** is the ONE kind with no snapshot by contract (`EventHandlerDeps`
 *      explicitly carries no snapshot obligation — it may yield zero frames, and a
 *      late subscriber misses past occurrences — which is what distinguishes Event
 *      from Stream). Awaiting its first frame would block `resources/read` forever or
 *      until the next occurrence, so an event reads as an immediate explicit `null`
 *      — its live value is the `notifications/resources/updated` stream, delivered
 *      via `resources/subscribe`, not a readable snapshot.
 *
 *  An address that is SERVED but unreachable is RAISED, not missed: "unknown
 *  resource" would be false of it, and the two facts a host can act on are
 *  different (fix the address vs. fix the `client()` factory).
 *
 *  It takes the ADDRESS, not the `(uri, generation)` pair — "one derivation,
 *  once" applies to the handler above it too. `resources/read` resolves the
 *  address BEFORE it dials (that is what keeps an unknown URI from becoming a
 *  link failure under a daemon that is down), so re-deriving it here was the
 *  same walk twice per request and left the handler holding a value it threw
 *  away.
 *
 *  Returns an EFFECT: the caller runs it with the MCP request's `AbortSignal`, so
 *  a cancelled read interrupts every subscription it opened. */
export function readSnapshot(
  bundle: RootedSurfaceClients,
  address: Address,
): Effect.Effect<Snapshot | ReadMiss, unknown> {
  const bound = bind(bundle, address);
  if (bound.at !== "call") {
    return Effect.fail(new Error(unreachableDetail(bound)));
  }
  return (
    match(address)
      .with({ kind: "event" }, (event) =>
        Effect.succeed<Snapshot | ReadMiss>({
          value: null,
          mimeType: event.mimeType,
        }),
      )
      // A collection-item read must not lean on the held-open `get` to signal
      // absence — an absent key yields nothing forever — so it gets a BOUNDED read
      // that races the `get` first frame against a live `keys`-absence watch.
      .with({ kind: "collection-item" }, (item) =>
        readCollectionItemSnapshot(item, bound),
      )
      .with({ kind: P.union("cell", "collection", "stream") }, (frame) =>
        readFirstFrameSnapshot(frame, bound),
      )
      .exhaustive()
  );
}

/** Open a snapshot-first source (cell / collection / stream) and return its first
 *  frame.
 *
 *  cell / collection / collection-item / STREAM are ALL snapshot-first by the
 *  surface contract: `@kolu/surface/server` opens a cell/collection with a
 *  current-value frame, and `StreamHandlerDeps` REQUIRES "first yield is a fresh
 *  full snapshot" — only `Event` carries no snapshot obligation (handled by the
 *  caller as an immediate `null`). So an empty open for any of these is NOT an
 *  empty value — it is a dead/dropped bridge link, and collapsing it to JSON
 *  `null` would hand an MCP agent `surface://<kind>/<x> => null` as if it were
 *  real (the green-dot lie in MCP form, the snapshot-then-delta class). Fail
 *  loudly per caught-error-must-not-collapse-to-empty.
 *
 *  The read is the FRAMEWORK's {@link firstFrameOrThrow}, which is exactly this
 *  pair: `Stream.runHead` (it takes the first element and then ENDS the stream,
 *  releasing the subscription through the stream's own finalizers — the Effect
 *  equivalent of the old `for await … return`) with this empty-open policy over
 *  it. The MESSAGE stays this face's: the URI and the kind are MCP's words. */
function readFirstFrameSnapshot(
  address: Address,
  bound: Extract<Bound, { at: "call" }>,
): Effect.Effect<Snapshot, unknown> {
  return Effect.map(
    firstFrameOrThrow(
      bound.open(),
      `${address.uri} (${address.kind}) yielded no snapshot frame — the surface ` +
        "contract opens a cell/collection/stream with a current-value snapshot, so an " +
        "empty open means the bridge link dropped, not that the value is null.",
    ),
    (value) => ({ value, mimeType: address.mimeType }),
  );
}

/** One-shot read of a collection-item URI, BOUNDED against
 *  `collectionHandlers.get`'s held-open-on-absent semantic (#1681): the item `get`
 *  yields nothing until the key is a member, so taking its first frame ALONE hangs
 *  forever on a not-yet-present key.
 *
 *  The bounded race itself — the item's first frame against BOTH a live
 *  `keys`-absence watch AND a deadline, neither subsuming the other — is the
 *  FRAMEWORK's, `@kolu/surface/first-frame`'s `firstFrameOfCollectionItem`, which
 *  lives beside the held-open `get` footgun it guards. This function is the MCP
 *  vocabulary over it: which streams to hand it, and how each outcome reads as a
 *  `Snapshot` or a `ReadMiss`. It stays an EFFECT all the way down so the whole
 *  read runs inside the request's fiber — `resources/read` runs it under the MCP
 *  request's abort signal, and a Promise edge in the middle would detach the
 *  subscriptions from that interruption.
 *
 *  It takes the ADDRESS it was resolved from, so there is no second parse of the
 *  URI, no second template lookup and no second `decodeKey` — and therefore no
 *  `Effect.die` guard whose only job was to prove the second derivation agreed
 *  with the first.
 *
 *  Whether there IS a membership signal is the CONTRACT's answer, carried on the
 *  address (`listable`, resolved from `resolveCollectionVerbs` at expose time),
 *  not a duck-type of the dialled client. Asked of the client, a collection that
 *  DECLARES `keys` but whose leg does not carry the member read as "this
 *  collection has no membership signal" and degraded to the deadline alone — a
 *  five-second wait ending in a failure about time, for what is really the
 *  narrow-face fact {@link noMemberFor} already has a sentence for. */
function readCollectionItemSnapshot(
  address: Extract<Address, { kind: "collection-item" }>,
  bound: Extract<Bound, { at: "call" }>,
): Effect.Effect<Snapshot | ReadMiss, unknown> {
  const keysProc = address.listable
    ? bound.client.surface[address.key]?.keys
    : undefined;
  if (address.listable && keysProc === undefined) {
    return Effect.fail(
      new Error(noMemberFor(address.sibling, address.key, "keys")),
    );
  }
  return Effect.flatMap(
    firstFrameOfCollectionItem(
      bound.open(),
      keysProc === undefined
        ? null
        : asStream(keysProc(undefined), address.uri, "collection"),
      address.itemKey,
      `${address.uri} (collection-item) yielded no snapshot frame — a PRESENT ` +
        "collection item opens with a current-value snapshot, so an empty open means " +
        "the bridge link dropped, not that the value is null.",
      // The hard upper bound, so a quiet producer can never hang this read: a
      // collection with no `keys` verb has no membership signal to resolve an
      // absent key against at all, and one WITH a `keys` verb can still keep
      // saying "still a member" while the item stream says nothing. Both bounds
      // are always armed. The NUMBER is the framework's, beside the reader it
      // bounds — this adapter knows nothing about "how long may a local read
      // wait" that the CLI face does not, and the two spelled the same `5_000`
      // independently until the constant existed.
      ITEM_READ_DEADLINE_MS,
    ),
    (frame): Effect.Effect<Snapshot | ReadMiss, unknown> => {
      if (frame.present) {
        return Effect.succeed({
          value: frame.value,
          mimeType: address.mimeType,
        });
      }
      if (frame.reason === "absent")
        return Effect.succeed({ miss: "not-present" });
      // The read ran out of time, and that is NOT an absence. Either the
      // collection has no membership signal to resolve against, or it has one
      // that kept saying "still a member" while the item stream said nothing —
      // the race arms BOTH bounds, so a deadline does not imply keys-lessness
      // and cannot be reported as one.
      //
      // It FAILS rather than answering `not-present`. Answering was the shape
      // this repo names as a defect: the read did not complete, so "the key is
      // not present" is a claim nobody established, and a `console.error` beside
      // it puts the truth somewhere the caller cannot read while the value it
      // acts on stays a lie. An agent branching on the payload saw a confident
      // absence; only an operator tailing stderr saw the doubt.
      //
      // The CLI face already refuses exactly this arm of exactly this framework
      // reader, in these words (`surface-cli`'s `readCollectionItem`: "the read
      // did not complete, so whether the item is there is still unknown"). Two
      // faces over one `firstFrameOfCollectionItem` outcome had two answers, and
      // the MCP one was the degrading half.
      //
      // BARE, like every other failure this module raises: the request edge
      // brands exactly once (`resources/read`'s catch), and `brand` is a plain
      // prefix rather than an idempotent one, so branding here too reaches the
      // host as `surface-mcp: surface-mcp: …` — the doubled prefix `./tools.ts`
      // names as the reason the rule is request-edge-only.
      return Effect.fail(
        new Error(
          `${address.uri} — "${address.key}" did not answer for key ${JSON.stringify(address.itemKey)} within ${ITEM_READ_DEADLINE_MS}ms, so the read did not complete and whether the item is there is still unknown`,
        ),
      );
    },
  );
}

/** Assert that a member ref really handed back a `Stream`.
 *
 *  Every streaming verb on a real face does. What this catches is a DROPPED
 *  BRIDGE: a client whose member resolved to something that is not a stream (a
 *  stale/partial face over a dead link) would otherwise reach `Stream.runHead` as
 *  `undefined` and blow up three frames later with a shapeless error, or worse be
 *  coerced into an empty read. The surface contract guarantees a snapshot-first
 *  open, so "no streaming source at all" is a link/protocol failure and is stated
 *  as one. */
function asStream(
  source: unknown,
  uri: string,
  kind: Address["kind"],
): Stream.Stream<unknown, unknown> {
  if (!Stream.isStream(source)) {
    return Stream.fail(
      new Error(
        `${uri} (${kind}) resolved no streaming source — the ` +
          "surface contract guarantees a snapshot-first open, so this is a link/" +
          "protocol failure, not an empty value.",
      ),
    );
  }
  return source as Stream.Stream<unknown, unknown>;
}
