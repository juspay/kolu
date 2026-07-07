/**
 * @kolu/surface-map — a keyed map of remote surfaces served as one.
 *
 * One entry spec typed once, entries keyed at runtime. The default entrypoint is
 * the CONTRACT half (`defineSurfaceMap` + its types); serve it with
 * `@kolu/surface-map/server` and consume it with `@kolu/surface-map/client`
 * (`/solid` re-exports the client for Solid consumers, whose `useEntry` owns
 * swap disposal).
 */

export {
  defineSurfaceMap,
  type EntryState,
  type EntryStatus,
  entryStatusSchema,
  type Key,
  type SurfaceMap,
} from "./define";
// (`EntryState` is sourced from the SOLID-FREE `./define`, NOT `./client`: a
// `export type … from "./client"` still makes TS typecheck the Solid client for a NODE
// consumer of this index — surface-remote's serveHostMap imports `SurfaceMap` here — pulling
// onWake's `window`/`document` into a DOM-less typecheck.)
