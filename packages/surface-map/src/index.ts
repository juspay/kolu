/**
 * @kolu/surface-map — a keyed map of remote surfaces served as one.
 *
 * One entry spec typed once, entries keyed at runtime. The default entrypoint is
 * the CONTRACT half (`defineSurfaceMap` + its types); serve it with
 * `@kolu/surface-map/server` and consume it with `@kolu/surface-map/client` (its
 * client is inherently Solid — `useEntry` owns swap disposal — so there is no
 * separate `/solid` entrypoint to pick between).
 */

export {
  defineSurfaceMap,
  type EntryState,
  type EntryStatus,
  entryStatusSchema,
  type EvidenceLine,
  type FailureEvidence,
  type Key,
  type KeyCodec,
  type MembershipId,
  MembershipIdSchema,
  PENDING_MEMBERSHIP_ID,
  type SurfaceMap,
} from "./define";
// (`EntryState` is sourced from the SOLID-FREE `./define`, NOT `./client`: a
// `export type … from "./client"` still makes TS typecheck the Solid client for a NODE
// consumer of this index — surface-remote's serveHostMap imports `SurfaceMap` here — pulling
// onWake's `window`/`document` into a DOM-less typecheck.)
// The uniform fold envelope's field constants + encoder — dependency-free (no zod, no
// solid), so it belongs on this node-safe default entry alongside `EntryState` rather
// than the Solid `./client`. A hand-folding consumer OUTSIDE the typed client (e.g. the
// e2e harness, which bypasses `connectSurfaceMap` for raw HTTP resets) reads `fold`/the
// field names from here instead of re-spelling the envelope's own literals.
export { fold, INPUT_FIELD, MAP_KEY_FIELD } from "./envelope";
