/**
 * @kolu/cells — descriptor primitives.
 *
 * Three concepts cover the majority of typed reactive state pushed from a
 * server to a Solid client over a streaming RPC:
 *
 *   - `Cell<T>`         a singleton typed value, optionally persisted.
 *   - `Collection<K,T>` keyed values, each independently observable.
 *   - `Stream<I,T>`     a derived view computed on demand from a reactive
 *                       input — never persisted.
 *
 * Descriptors are pure data: name, schemas, default values. They carry no
 * runtime behaviour and are safe to import from any package — server,
 * client, or shared. Server-side handler helpers live in `./server`;
 * Solid client hooks live in `./solid`.
 *
 * The library intentionally does not auto-derive an oRPC contract.
 * TypeScript needs the contract literal at compile time for the typed
 * client; consumers hand-list contract entries in their own
 * `oc.router({...})` and pass the matching descriptor to the helpers.
 */

import type { ZodType } from "zod";

/** A singleton typed cell. `name` is the descriptor's stable identifier
 *  — used for type identity, error messages, and as a human-readable tag
 *  in the contract / channel layout. **The framework does not dispatch
 *  on it at runtime.** Hooks accept procedure refs explicitly (e.g.
 *  `useCell(cell, { source: client.preferences.get })`), and publisher
 *  channel names are passed as explicit strings to `publisherChannel`.
 *  Conventionally a cell's `name`, its contract router path, and its
 *  channel name all coincide, but nothing enforces or requires it — each
 *  string is wired up at the call site. */
export interface Cell<Name extends string, T> {
  readonly kind: "cell";
  readonly name: Name;
  readonly schema: ZodType<T>;
  readonly default: T;
}

export function cell<Name extends string, T>(opts: {
  name: Name;
  schema: ZodType<T>;
  default: T;
}): Cell<Name, T> {
  return { kind: "cell", ...opts };
}

export interface Collection<Name extends string, K, T> {
  readonly kind: "collection";
  readonly name: Name;
  readonly keySchema: ZodType<K>;
  readonly schema: ZodType<T>;
}

export function collection<Name extends string, K, T>(opts: {
  name: Name;
  keySchema: ZodType<K>;
  schema: ZodType<T>;
}): Collection<Name, K, T> {
  return { kind: "collection", ...opts };
}

export interface Stream<Name extends string, I, T> {
  readonly kind: "stream";
  readonly name: Name;
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<T>;
}

export function stream<Name extends string, I, T>(opts: {
  name: Name;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<T>;
}): Stream<Name, I, T> {
  return { kind: "stream", ...opts };
}
