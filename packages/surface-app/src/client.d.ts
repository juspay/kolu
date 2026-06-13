/**
 * The shell-carried build commit. The `surfaceApp()` Vite plugin (or
 * `buildSurfaceClient` from `/bun`, or your own shell templating via
 * `injectShellCommit`) publishes the commit as
 * `window.__SURFACE_APP_COMMIT__` in the `no-store` `index.html` — NEVER as a
 * bundler define inside a content-hashed asset, which a post-build stamp would
 * rewrite under an unchanged (and so `immutable`-cached) filename and strand
 * returning browsers on the old stamp (kolu#1319). Read it via
 * `shellCommit()` from `@kolu/surface-app/lifecycle`; this declaration exists
 * for apps that reach the global directly —
 * `/// <reference types="@kolu/surface-app/client" />`.
 */
interface Window {
  __SURFACE_APP_COMMIT__?: string;
}
