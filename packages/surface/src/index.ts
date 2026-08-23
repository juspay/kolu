/**
 * @kolu/surface — descriptor primitives.
 *
 * Four concepts cover the majority of typed reactive state pushed from a
 * server to a Solid client over a streaming RPC:
 *
 *   - `Cell<T>`         a singleton typed value, optionally persisted.
 *   - `Collection<K,T>` keyed values, each independently observable.
 *   - `Stream<I,T>`     a derived view computed on demand from a reactive
 *                       input — never persisted.
 *   - `Event<I,T>`      occurrences over time — no current value, no
 *                       snapshot+deltas obligation, handler-based
 *                       consumption. Lifecycle events fit this shape.
 *
 * Descriptors are pure data: name, schemas, default values. They carry no
 * runtime behaviour and are safe to import from any package — server,
 * client, or shared. Server-side handler helpers live in `./server`;
 * Solid client hooks live in `./solid`.
 *
 * Headline path: declare the whole reactive surface once with
 * `defineSurface` (`./define`); the framework derives the Effect `RpcGroup`,
 * server router (`implementSurface`, `./server`), and client bundle
 * (`surfaceClient`, `./solid`) from one spec. The descriptor primitives
 * here are the low-level building blocks that wiring stands on, and
 * remain available as a manual escape hatch.
 */

import type { Schema } from "effect";

/** A wire schema carried by a descriptor: an Effect `Schema.Codec` whose decoded
 *  type is `T` and whose decode/encode require NO services (`RD = RE = never`).
 *  Context-freedom is enforced by the type, not by convention — a schema that
 *  demanded a service could not be decoded on the wire, where there is no
 *  environment to provide it. The descriptor twin of `define.ts`s `WireSchema<T>`. */
export type DescriptorSchema<T> = Schema.Codec<T, unknown, never, never>;

/** A singleton typed cell. `name` is the descriptor's stable identifier
 *  — used for type identity, error messages, and as a human-readable tag
 *  in the RPC tag / channel layout. **The framework does not dispatch
 *  on it at runtime.** Hooks accept procedure refs explicitly (e.g.
 *  `useCell(cell, { source: client.preferences.get })`), and publisher
 *  channel names are passed as explicit strings to `publisherChannel`.
 *  Conventionally a cell's `name`, its RPC tag, and its
 *  channel name all coincide, but nothing enforces or requires it — each
 *  string is wired up at the call site. */
export interface Cell<Name extends string, T> {
  readonly kind: "cell";
  readonly name: Name;
  readonly schema: DescriptorSchema<T>;
  readonly default: T;
  /** The field that identifies an element of an array inside this cell's value —
   *  see `CellSpec.arrayKey` in `./define.ts`, which is where it is DECLARED, and
   *  `./solid/writeValue.ts`, which is the one seam that reads it. Carried on the
   *  descriptor because the descriptor is what the client hook receives: it is how
   *  the definition site's answer reaches the store write without the use site
   *  being asked to repeat it. */
  readonly arrayKey?: string;
}

export function cell<Name extends string, T>(opts: {
  name: Name;
  schema: DescriptorSchema<T>;
  default: T;
  arrayKey?: string;
}): Cell<Name, T> {
  return { kind: "cell", ...opts };
}

export interface Collection<Name extends string, K, T> {
  readonly kind: "collection";
  readonly name: Name;
  readonly keySchema: DescriptorSchema<K>;
  readonly schema: DescriptorSchema<T>;
  /** The field that identifies an element of an array inside ONE ENTRY'S value —
   *  see `CollectionSpec.arrayKey` in `./define.ts`, which says which of a
   *  collection's two delivery paths applies it, and {@link Cell.arrayKey}. */
  readonly arrayKey?: string;
}

export function collection<Name extends string, K, T>(opts: {
  name: Name;
  keySchema: DescriptorSchema<K>;
  schema: DescriptorSchema<T>;
  arrayKey?: string;
}): Collection<Name, K, T> {
  return { kind: "collection", ...opts };
}

export interface Stream<Name extends string, I, T> {
  readonly kind: "stream";
  readonly name: Name;
  readonly inputSchema: DescriptorSchema<I>;
  readonly outputSchema: DescriptorSchema<T>;
  /** The field that identifies an element of an array inside this stream's frames
   *  — see `StreamSpec.arrayKey` in `./define.ts` and {@link Cell.arrayKey}. */
  readonly arrayKey?: string;
}

export function stream<Name extends string, I, T>(opts: {
  name: Name;
  inputSchema: DescriptorSchema<I>;
  outputSchema: DescriptorSchema<T>;
  arrayKey?: string;
}): Stream<Name, I, T> {
  return { kind: "stream", ...opts };
}

/** A point-in-time event channel: occurrences flow from server to client,
 *  no snapshot semantics, no current value. Distinct from `Stream<I,T>`
 *  because the framework MUST NOT yield a snapshot on (re-)subscribe — a
 *  late subscriber misses past occurrences by design. Also distinct
 *  because consumers register a handler rather than reading a current
 *  value: there's no `sub()` to call, just a callback that fires per
 *  occurrence. Lifecycle notifications (terminal exit, session expiry,
 *  one-shot completions) fit this shape. */
export interface Event<Name extends string, I, T> {
  readonly kind: "event";
  readonly name: Name;
  readonly inputSchema: DescriptorSchema<I>;
  readonly outputSchema: DescriptorSchema<T>;
}

export function event<Name extends string, I, T>(opts: {
  name: Name;
  inputSchema: DescriptorSchema<I>;
  outputSchema: DescriptorSchema<T>;
}): Event<Name, I, T> {
  return { kind: "event", ...opts };
}
