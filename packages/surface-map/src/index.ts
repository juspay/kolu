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
  type EntryStatus,
  entryStatusSchema,
  type Key,
  type SurfaceMap,
} from "./define";
