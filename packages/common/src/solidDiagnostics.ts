/**
 * WHERE A PAGE REACHES SOLID'S DIAGNOSTICS CHANNEL — the one name both sides
 * of the dev-diagnostics lane agree on.
 *
 * `solid-js` exports `OBSERVE` in its development runtime only, and nothing in
 * a bundle hands it to a page script. So the client assigns it to this global
 * as it boots (`packages/client/src/solidDiagnosticsExpose.ts`, dev runtimes
 * only), and the e2e harness's init script owns the property beforehand so it
 * can subscribe the moment the client writes it
 * (`packages/tests/support/solidDevBuild.ts`).
 *
 * It lives here because it is a contract between two packages that both depend
 * on `kolu-common` and on nothing of each other's. This module imports
 * nothing: the client's copy is evaluated before any app module.
 */
export const SOLID_OBSERVE_GLOBAL = "__SOLID_OBSERVE__";
