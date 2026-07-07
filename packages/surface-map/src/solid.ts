/**
 * @kolu/surface-map/solid — the Solid client entrypoint.
 *
 * `connectSurfaceMap`'s client is inherently Solid (its bound subtrees are the
 * base `SurfaceClient` hooks). The `useEntry(accessor)` reactive lens — which
 * owns swap disposal — is a method on the returned client. This entry re-exports
 * the client half so Solid consumers have a conventional import site.
 */

export {
  connectSurfaceMap,
  type Entry,
  type SurfaceMapClient,
} from "./client";
