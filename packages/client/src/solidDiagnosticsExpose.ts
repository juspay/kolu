/// <reference types="vite/client" />

/**
 * THE SOLID-DIAGNOSTICS LANE'S WINDOW ONTO THE RUNTIME, opened before the app
 * exists.
 *
 * `OBSERVE` is Solid's diagnostics channel, present only in its development
 * runtime — which both the `solid-dev` Vite mode builds against (the dist the
 * `ci::e2e-solid-dev` lane serves) and the plain Vite dev server serves
 * (`@solidjs/vite-plugin` replaces the runtime with the dev one for `serve`),
 * so both are let through. The e2e harness subscribes from an init script to
 * get each finding's code, owner path and location, which the console cannot
 * carry for a diagnostic whose call site throws; nothing in a bundle would
 * otherwise hand it the module's export.
 *
 * THE ATTRIBUTION ENGINE, WHICH ONLY THIS BUILD HAS TO INSTALL. Nineteen of
 * Solid's 75 codes — `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
 * `UNSTABLE_MEMO_OUTPUT`, `WASTED_RECOMPUTE`, the hold and waterfall family —
 * are raised by `@solidjs/signals/attribution`, which `solid-js/attribution`
 * re-exports: an engine the development runtime ships BESIDE itself and
 * leaves uninstalled, so until something calls `attribution.enable()` those
 * codes cannot fire at all, whatever the page does. Under `vite serve` the
 * plugin installs it for us — the performance-tracks module it injects calls
 * `enablePerformanceTracks()`, which is
 * `attribution.enable({ log: false, checks: false })` — but that plugin
 * applies to `serve` only (`@solidjs/vite-plugin`'s `solid:performance-tracks`,
 * `env.command === "serve"`). In the `solid-dev` BUILD nothing else would, so
 * the engine is this module's to turn on: otherwise the e2e lane clicks
 * through the whole app with those 19 codes unraisable, and `ci::dev-smoke`,
 * which boots and never clicks, is the only lane that can raise them.
 *
 * Enabled with `SOLID_ATTRIBUTION_OPTIONS`, the one judged set this lane
 * shares with the vitest setup (`@kolu/solid-test-setup/attribution`, which
 * imports nothing but a type): no console print, the four checks that read
 * the clock as a cost off (`HOT_SCOPE_RERUNS` and `HOT_SCOPE_FANOUT` under
 * `hotRuns: false`, `HOT_SCOPE_TIME`, `WASTED_RECOMPUTE`), and the five that
 * time a real wait off too — `SILENT_HOLD` and `UNTRACKED_ASYNC_HANDLER`
 * (both under `holds: false`), `LONG_HOLD`, `ASYNC_WATERFALL` and
 * `STACKED_HOLDS` would fail scenarios on this lane for a daemon's latency
 * rather than for code. The three COUNT checks stay on — `WIDE_SCOPE_DEPS`
 * (200 deps), `UNSTABLE_MEMO_OUTPUT` (four consecutive equal-but-new memo
 * outputs) and the runtime's `HUGE_FAN_OUT` at the engine's lower 250
 * threshold — since a count judges the graph a diff built. `GRAPH_GROWTH` and
 * `ABANDONED_FLIGHTS` stay at their defaults, ON: neither times a wait — one
 * wants three consecutive visits to a named route (kolu has no router, so it
 * is inert), the other three superseded flights of one source inside a
 * second. Judged here are the runtime's own codes plus the engine's
 * `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
 * `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`, `FALLBACK_FLASH`,
 * `OPTIMISTIC_REVERTED`, `GRAPH_GROWTH`, `ABANDONED_FLIGHTS`,
 * `WIDE_SCOPE_DEPS` and `UNSTABLE_MEMO_OUTPUT`. Every
 * finding that stays on still reaches `OBSERVE.diagnostics`, which is what
 * the harness reads.
 *
 * Production is excluded twice over: `import.meta.env.DEV` and
 * `import.meta.env.MODE` are build-time literals, so a production build drops
 * these branches, and there `solid-js` exports `OBSERVE` as `undefined` and
 * resolves `solid-js/attribution` to its inert production twin anyway.
 * `default.nix`'s `mkClientDist` holds both halves to that: the dev-mode dist
 * must carry one of the engine's own code strings, and the shipped dist must
 * carry neither that nor an option name this `enable()` call contributes —
 * which is what proves the branch itself was dropped, since minification
 * cannot rename the keys of an object handed to another package.
 *
 * WHY ITS OWN MODULE, IMPORTED FIRST. A diagnostic raised while a module is
 * evaluating — kolu has module-scope `createRoot`s, which are owned scopes —
 * is only seen if the channel was handed over, and the engine enabled, before
 * that module ran. ES modules are evaluated in import order, so this one must
 * be imported first in `index.tsx` AND must import nothing of the app's:
 * `solid-js`, its attribution entry and two constant modules that themselves
 * import nothing (`kolu-common/solidDiagnostics`,
 * `@kolu/solid-test-setup/attribution`).
 */

import { SOLID_ATTRIBUTION_OPTIONS } from "@kolu/solid-test-setup/attribution";
import { SOLID_OBSERVE_GLOBAL } from "kolu-common/solidDiagnostics";
import { OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";

if (import.meta.env.DEV || import.meta.env.MODE === "solid-dev") {
  (window as unknown as Record<string, unknown>)[SOLID_OBSERVE_GLOBAL] =
    OBSERVE;
}

// The build mode alone, not `DEV`: under `vite serve` the plugin's
// performance-tracks module already holds the engine open, and this build is
// the only one where nobody else does.
if (import.meta.env.MODE === "solid-dev") {
  attribution.enable(SOLID_ATTRIBUTION_OPTIONS);
}
