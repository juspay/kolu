/**
 * The curation gate — default-deny `expose` map + the resolver that turns it
 * into the concrete resource/tool lists the server registers.
 *
 * The Atlas note's thesis: the map is a morning, the *selection* is the
 * project. Nothing reaches an agent until the surface author opts it in.
 * Membership is the allowlist — an omitted primitive/procedure is NOT
 * exposed, full stop. The keys are typed against the spec where tractable
 * (procedures key as `"<ns>.<verb>"`, primitives by their surface key), with
 * a runtime existence check so a stringly-typed key that the compiler can't
 * narrow still fails loudly at boot rather than silently registering nothing.
 *
 *   - a Cell      → resource `surface://cells/<key>`
 *   - a Collection→ resource `surface://collections/<key>` (the key set) +
 *                   a template `surface://collections/<key>/{id}`
 *   - a Stream    → resource `surface://streams/<key>`
 *   - an Event    → resource `surface://events/<key>`
 *   - a procedure → tool `<ns>_<verb>` (`.` is illegal in a tool name; the
 *                   wire path stays `<ns>.<verb>`)
 *
 * ## A ROOTED BUNDLE composes by PREFIX, never by merge
 *
 * A bundle is an unprefixed CORE beside a keyed set of SIBLINGS — the one shape
 * the serve seam (`implementRootedSurfaces`), the consume seam
 * (`connectSurfaces`) and the gate (`exposeRootedFaces`) already compose on. Here
 * it means one extra SEGMENT, and only for a sibling: `surface://collections/
 * <sibling>/<member>` and `<sibling>_<ns>_<verb>`, with the core keeping the bare
 * spellings above. That is `composeSurfaceContracts`' rule applied to MCP's own
 * names, and it makes two siblings that expose the same member key disjoint by
 * construction rather than by a merge nobody checked.
 *
 * The rule is the same for a sibling's hand-authored tools, which `./bundle.ts`
 * puts through {@link scopedToolName}: one rule for every name a sibling
 * contributes. Only a BUNDLE-ROOT tool is bare, having no row to be relative to.
 *
 * Each sibling's map is resolved against ITS OWN spec, so `resolveExpose` runs
 * per surface and this module never needs a composed top-level spec — the same
 * per-surface reading `exposeRootedFaces` takes.
 */

import type { SiblingKey } from "@kolu/surface/client";
import type { SurfaceSpec, WireSchemaAny } from "@kolu/surface/define";
import {
  classifyExpose,
  type ExposeMap,
  exposureMutates,
} from "@kolu/surface/expose";
import { match, P } from "ts-pattern";
import { admitsNoArgument, inputSchema, toolName } from "@kolu/surface/verbs";
import { ADAPTER_NAME, brand } from "./tools";

// ── Expose map types ────────────────────────────────────────────────────

// The MAP and the KEY GRAMMAR are shared vocabulary and live in
// `@kolu/surface/expose`: since juspay/kolu#2169 the wire faces
// (`serveSurfaceApp`, `serveOverUnixSocket`) take the same map, and a second
// reading of it here would be two authorities on one contract — a consumer that
// gates its MCP face and its browser face writes ONE kind of map, and the same
// key means the same thing on both. There is deliberately no re-export: one
// concept gets one import path, so two readers of the same file cannot disagree
// about where `ExposeMap` lives. What stays here is the RESOLUTION, because only
// this adapter turns a classified entry into a `surface://` URI or an MCP tool
// name.

// ── Resolved registration lists ─────────────────────────────────────────

/** WHICH surface of a rooted bundle an entry came from — the FRAMEWORK's
 *  {@link SiblingKey}, beside `clientAt` and the fold, because the argv face
 *  needs exactly the same one and could not import this face's without pointing a
 *  face at a face. Re-exported under the name this package publishes. */
export type { SiblingKey };

/** A static resource (cell / collection key-set / stream / event). */
export interface ResourceEntry {
  uri: string;
  /** Which primitive kind backs it — drives how the pusher streams updates
   *  and how `ReadResource` produces a snapshot. */
  kind: "cell" | "collection" | "stream" | "event";
  /** The surface key (e.g. `nodes`), independent of the URI encoding. */
  key: string;
  /** Which surface of the bundle answers it — see {@link SiblingKey}. The
   *  READ path resolves the client through this, so an entry that outlives its
   *  sibling is refused by name rather than resolving nothing. */
  sibling: SiblingKey;
  name: string;
  mimeType: string;
}

/** A `surface://collections/<key>/{id}` template — one per exposed
 *  collection, alongside its key-set `ResourceEntry`. */
export interface ResourceTemplateEntry {
  uriTemplate: string;
  key: string;
  sibling: SiblingKey;
  name: string;
  mimeType: string;
  /** The collection's key schema — used to decode an item-template URI's
   *  `<id>` segment (a string) back into the collection's actual key type
   *  before calling `.get({ key })`. A `keySchema: Schema.Finite` collection
   *  must turn the string `"42"` into `42`, not address item `"42"`. */
  keySchema: WireSchemaAny;
}

/** A tool backed by an exposed procedure. */
export interface ToolEntry {
  /** MCP tool name — `<ns>_<verb>` on the core, `<sibling>_<ns>_<verb>` on a
   *  sibling. */
  name: string;
  /** Surface namespace + verb — the wire call `client.surface[ns][verb]`. */
  ns: string;
  verb: string;
  /** Which surface of the bundle answers it — see {@link SiblingKey}. */
  sibling: SiblingKey;
  mutates: boolean;
  inputSchema: Record<string, unknown>;
  /** Whether the procedure declares an input. A no-input procedure's payload
   *  schema is `Schema.Void`, so the dispatcher must call it with `undefined`,
   *  not the empty args object. */
  hasInput: boolean;
  /** Whether the input schema wrapped a non-object (scalar/array/union) input
   *  under a `value` property to satisfy MCP. The dispatcher must unwrap
   *  `args.value` before handing it to the procedure's schema, which expects
   *  the bare value (a `Schema.String` input is advertised as
   *  `{ value: string }`). */
  wrapped: boolean;
}

export interface ResolvedExpose {
  resources: ResourceEntry[];
  resourceTemplates: ResourceTemplateEntry[];
  tools: ToolEntry[];
}

// ── URI helpers ─────────────────────────────────────────────────────────

export const CELL_PREFIX = "surface://cells/";
export const COLLECTION_PREFIX = "surface://collections/";
export const STREAM_PREFIX = "surface://streams/";
export const EVENT_PREFIX = "surface://events/";

/** The address of one member of a bundle, under a kind's prefix: the sibling key
 *  as a leading SEGMENT where there is one, and nothing at all for the core.
 *
 *  ONE builder behind all four kinds, because the prefix rule is one rule and
 *  four hand-written spellings of it are four places for the core's "no segment"
 *  case to be forgotten. Every segment is `encodeURIComponent`-ed on its own, so
 *  a member key containing a slash cannot forge an extra segment — which is what
 *  lets {@link parseCollectionItem}'s reader count segments and know what it has. */
function memberUri(prefix: string, sibling: SiblingKey, key: string): string {
  const member = encodeURIComponent(key);
  return sibling === undefined
    ? `${prefix}${member}`
    : `${prefix}${encodeURIComponent(sibling)}/${member}`;
}

export function cellUri(sibling: SiblingKey, key: string): string {
  return memberUri(CELL_PREFIX, sibling, key);
}
export function collectionUri(sibling: SiblingKey, key: string): string {
  return memberUri(COLLECTION_PREFIX, sibling, key);
}
export function collectionItemTemplate(
  sibling: SiblingKey,
  key: string,
): string {
  return `${collectionUri(sibling, key)}/{id}`;
}
/** A collection-item URI, split into the bundle address it names.
 *
 *  Segment counting is the whole rule, and it is sound because every segment was
 *  `encodeURIComponent`-ed on the way out by {@link memberUri} above: TWO segments is a CORE
 *  collection's item, THREE is a sibling's. A two-segment URI that is really a
 *  sibling's key-set resource never reaches here — the caller answers those from
 *  the resource index first — and the one case where the two readings would
 *  genuinely overlap is refused at boot by {@link assertItemSpaceUnshadowed}.
 *
 *  `null` for anything else, including a URI with four or more segments: a rooted
 *  bundle is one level deep, so a deeper address names nothing rather than being
 *  folded into the last segment.
 *
 *  It lives HERE, directly below the builders, because the reader's soundness is a
 *  precondition on the WRITER — one axis, "how a bundle address is spelled in a
 *  `surface://` URI", and the segment-counting rule is only sound because
 *  {@link memberUri} encodes each segment on its own. Split across two modules
 *  that was a promise a caller had to keep, held together by this comment across a
 *  boundary. */
export function parseCollectionItem(
  uri: string,
): { sibling: SiblingKey; key: string; id: string } | null {
  if (!uri.startsWith(COLLECTION_PREFIX)) return null;
  const raw = uri.slice(COLLECTION_PREFIX.length).split("/");
  if (raw.length !== 2 && raw.length !== 3) return null;
  let parts: string[];
  try {
    parts = raw.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (parts.some((segment) => segment === "")) return null;
  return parts.length === 2
    ? { sibling: undefined, key: parts[0] as string, id: parts[1] as string }
    : {
        sibling: parts[0] as string,
        key: parts[1] as string,
        id: parts[2] as string,
      };
}

export function streamUri(sibling: SiblingKey, key: string): string {
  return memberUri(STREAM_PREFIX, sibling, key);
}
export function eventUri(sibling: SiblingKey, key: string): string {
  return memberUri(EVENT_PREFIX, sibling, key);
}

/** The TOOL name one member of a bundle answers to — the same prefix rule in
 *  MCP's own separator. `.` is illegal in a tool name and `/` is not a tool name
 *  at all, so where the URI takes a segment the tool name takes the `_` it
 *  already uses to join `<ns>` to `<verb>`.
 *
 *  Applied to a sibling's HAND-AUTHORED tools as well as its generated ones —
 *  one rule for every name, so a reader of a `tools/list` never has to know which
 *  kind they are looking at. That is why it takes a finished name rather than an
 *  `(ns, verb)` pair.
 *
 *  It does NOT make the space unique on its own: `_` is legal inside a tag
 *  segment, so `a_b_c` can be spelled by more than one `(sibling, ns, verb)`
 *  triple, and a bundle-root tool is bare and shares the space with every scoped
 *  one. The one-pass collision check over the FINISHED namespace is what
 *  guarantees uniqueness — and, for the same reason, a name is not a sound
 *  reading of WHICH sibling owns it. */
export function scopedToolName(sibling: SiblingKey, name: string): string {
  return sibling === undefined ? name : `${sibling}_${name}`;
}

/** Reject an input-bearing stream/event exposed as a STATIC resource — the one gate
 *  both the stream and event arms take. A `surface://<kind>s/<key>` URI carries no
 *  input, so the adapter reads/subscribes via `.get(undefined)`; a spec whose
 *  `inputSchema` *requires* an argument (e.g. `Schema.Struct({ id })`) can't be a
 *  single static resource. Fail at BOOT rather than register one whose every
 *  read/subscribe fails validation. (An input-bearing one belongs behind a
 *  projection that fixes the input, or a future resource-template encoding.) */
function assertExposableAsResource(
  kind: "stream" | "event",
  key: string,
  inputSchema: WireSchemaAny,
): void {
  // The FRAMEWORK's predicate, not a second spelling of it: the CLI face asks
  // the same question before letting `get <member>` stand with no `[arg]`, and
  // two hand-written decodes held in agreement by a comment is how one face
  // comes to refuse at boot what the other accepts and hangs on.
  if (!admitsNoArgument(inputSchema)) {
    throw new Error(
      brand(
        `${kind} "${key}" requires an input, so it can't be exposed as a static resource ` +
          `(surface://${kind}s/${key} carries no input). Project it to a no-input ${kind}, or expose a fixed-input view.`,
      ),
    );
  }
}

/** What a host SHOWS for a resource — the member key on the core, and
 *  `<sibling>/<member>` on a sibling.
 *
 *  A resource `name` is display text, not an address, and two siblings exposing
 *  the same member key would otherwise offer an agent two rows reading `entries`
 *  with nothing to tell them apart. The URI already carries the segment; this is
 *  the same fact where a person reads it. */
function displayName(sibling: SiblingKey, key: string): string {
  return sibling === undefined ? key : `${sibling}/${key}`;
}

// ── Resolver ─────────────────────────────────────────────────────────────

/** Walk a spec + expose map, producing the concrete lists to register.
 *
 *  The KEY GRAMMAR is not this function's: `classifyExpose` (`@kolu/surface/expose`)
 *  owns it, so the MCP face and the wire faces read one map one way — a key that
 *  names nothing, a procedure exposed as a resource, and a primitive exposed as a
 *  tool are all refused THERE, once, in the vocabulary every face shares. What is
 *  left here is what only this adapter knows: which `surface://` URI a primitive
 *  gets, which tool name a procedure gets, its JSON-Schema input, and the one gate
 *  a wire face has no equivalent of (an input-bearing stream/event cannot be a
 *  STATIC resource).
 *
 *  The adapter's NAME travels into the classifier, so the framework's refusal
 *  comes back already saying which door the consumer came through — the way
 *  every other boot-time refusal from this package does. The brand is a FIELD on
 *  the framework's own error class, not a rewrite of its message: a consumer
 *  handling "my expose map is wrong" across faces matches the class, never the
 *  text, and the original stack survives because nothing was caught and
 *  rebuilt. */
export function resolveExpose<S extends SurfaceSpec>(
  spec: S,
  expose: ExposeMap<S>,
  /** Which surface of a rooted bundle this map belongs to — a sibling's key, or
   *  `undefined` for the core (and for a bundle that is one surface). It is
   *  folded into every name this resolver mints, which is the whole of the
   *  prefix composition (see the module header).
   *
   *  REQUIRED, with no default. `undefined` here is not "the argument was
   *  omitted" — it is the ADDRESS, the bare core. With a default the two readings
   *  were the same call, so a caller walking a sibling and forgetting the key
   *  would silently mint bare, core-shaped names for it: a composition bug the
   *  collision pass catches only sometimes, because `_` is legal inside a
   *  segment. Saying `undefined` out loud costs one word and cannot be
   *  forgotten. */
  sibling: SiblingKey,
): ResolvedExpose {
  const resources: ResourceEntry[] = [];
  const resourceTemplates: ResourceTemplateEntry[] = [];
  const tools: ToolEntry[] = [];

  // Matched exhaustively on the entry's `kind`, so a member kind the framework
  // grows later is a COMPILE error here rather than something a trailing `else`
  // quietly resolves as a stream.
  for (const entry of classifyExpose(spec, expose, ADAPTER_NAME)) {
    match(entry)
      .with({ kind: "procedure" }, ({ ns, verb, exposure, spec: procSpec }) => {
        // The spec `classifyExpose` resolved travels ON the entry, so the input
        // schema is read from the same lookup that proved the procedure exists —
        // never a second one this face could disagree with. The conservative
        // `mutates` default is the framework's `exposureMutates`, for the same
        // reason: the CLI face reads the same flag off the same map, and a
        // safety default spelled twice is one that can be relaxed in one place.
        const built = inputSchema(procSpec.input);
        tools.push({
          name: scopedToolName(sibling, toolName(ns, verb)),
          ns,
          verb,
          sibling,
          mutates: exposureMutates(exposure),
          inputSchema: built.schema,
          hasInput: procSpec.input !== undefined,
          wrapped: built.wrapped,
        });
      })
      .with({ kind: "cell" }, ({ key }) => {
        resources.push({
          uri: cellUri(sibling, key),
          kind: "cell",
          key,
          sibling,
          name: displayName(sibling, key),
          mimeType: "application/json",
        });
      })
      .with({ kind: "collection" }, ({ key, spec: collSpec }) => {
        resources.push({
          uri: collectionUri(sibling, key),
          kind: "collection",
          key,
          sibling,
          name: displayName(sibling, key),
          mimeType: "application/json",
        });
        resourceTemplates.push({
          uriTemplate: collectionItemTemplate(sibling, key),
          key,
          sibling,
          name: `${displayName(sibling, key)} item`,
          mimeType: "application/json",
          keySchema: collSpec.keySchema,
        });
      })
      .with({ kind: P.union("stream", "event") }, ({ kind, key, spec: io }) => {
        // A stream is a static resource only if its input accepts no argument (the
        // adapter reads/subscribes via `.get(undefined)`) — see the shared gate. An
        // event takes the SAME gate: its live value is the
        // `notifications/resources/updated` stream, not a readable snapshot
        // (`readSnapshot` returns an immediate `null`), but its subscribe path still
        // calls `.get(undefined)`.
        assertExposableAsResource(kind, key, io.inputSchema);
        resources.push({
          uri:
            kind === "stream"
              ? streamUri(sibling, key)
              : eventUri(sibling, key),
          kind,
          key,
          sibling,
          name: displayName(sibling, key),
          mimeType: "application/json",
        });
      })
      .exhaustive();
  }

  // Tool-name uniqueness (proc-vs-proc, proc-vs-bespoke, bespoke-vs-bespoke) is
  // checked in one pass in `serveSurfaceAsMcp`, where the full namespace — the
  // exposed procedures here plus the bespoke tools — is in view.
  return { resources, resourceTemplates, tools };
}
