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
 */

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

/** A static resource (cell / collection key-set / stream / event). */
export interface ResourceEntry {
  uri: string;
  /** Which primitive kind backs it — drives how the pusher streams updates
   *  and how `ReadResource` produces a snapshot. */
  kind: "cell" | "collection" | "stream" | "event";
  /** The surface key (e.g. `nodes`), independent of the URI encoding. */
  key: string;
  name: string;
  mimeType: string;
}

/** A `surface://collections/<key>/{id}` template — one per exposed
 *  collection, alongside its key-set `ResourceEntry`. */
export interface ResourceTemplateEntry {
  uriTemplate: string;
  key: string;
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
  /** MCP tool name (`<ns>_<verb>`). */
  name: string;
  /** Surface namespace + verb — the wire call `client.surface[ns][verb]`. */
  ns: string;
  verb: string;
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

export function cellUri(key: string): string {
  return `${CELL_PREFIX}${encodeURIComponent(key)}`;
}
export function collectionUri(key: string): string {
  return `${COLLECTION_PREFIX}${encodeURIComponent(key)}`;
}
export function collectionItemTemplate(key: string): string {
  return `${COLLECTION_PREFIX}${encodeURIComponent(key)}/{id}`;
}
export function streamUri(key: string): string {
  return `${STREAM_PREFIX}${encodeURIComponent(key)}`;
}
export function eventUri(key: string): string {
  return `${EVENT_PREFIX}${encodeURIComponent(key)}`;
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
          name: toolName(ns, verb),
          ns,
          verb,
          mutates: exposureMutates(exposure),
          inputSchema: built.schema,
          hasInput: procSpec.input !== undefined,
          wrapped: built.wrapped,
        });
      })
      .with({ kind: "cell" }, ({ key }) => {
        resources.push({
          uri: cellUri(key),
          kind: "cell",
          key,
          name: key,
          mimeType: "application/json",
        });
      })
      .with({ kind: "collection" }, ({ key, spec: collSpec }) => {
        resources.push({
          uri: collectionUri(key),
          kind: "collection",
          key,
          name: key,
          mimeType: "application/json",
        });
        resourceTemplates.push({
          uriTemplate: collectionItemTemplate(key),
          key,
          name: `${key} item`,
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
          uri: kind === "stream" ? streamUri(key) : eventUri(key),
          kind,
          key,
          name: key,
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
