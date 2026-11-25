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
 * Enabled with the dev server's OWN options. `log: false` turns off the
 * per-re-run console print only — every finding still reaches
 * `OBSERVE.diagnostics`, which is what the harness reads. `checks: false`
 * turns off the six cost checks (`hotRuns`, `hotTime`, `wideDeps`,
 * `unstableMemos`, `fanOut`, `wastedRecompute`), whose thresholds judge the
 * machine's timings rather than the code; the feedback findings — own-source
 * writes, relay tears, unstable identities — are not cost checks and stay on.
 *
 * Production is excluded twice over: `import.meta.env.DEV` and
 * `import.meta.env.MODE` are build-time literals, so a production build drops
 * these branches, and there `solid-js` exports `OBSERVE` as `undefined` and
 * resolves `solid-js/attribution` to its inert production twin anyway.
 * `default.nix`'s `mkClientDist` holds both halves to that: the dev-mode dist
 * must carry one of the engine's own code strings and the shipped dist must
 * not.
 *
 * WHY ITS OWN MODULE, IMPORTED FIRST. A diagnostic raised while a module is
 * evaluating — kolu has module-scope `createRoot`s, which are owned scopes —
 * is only seen if the channel was handed over, and the engine enabled, before
 * that module ran. ES modules are evaluated in import order, so this one must
 * be imported first in `index.tsx` AND must import nothing of the app's:
 * `solid-js`, its attribution entry and a bare string constant only.
 */

import { SOLID_OBSERVE_GLOBAL } from "kolu-common/solidDiagnostics";
import { OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";

if (import.meta.env.DEV || import.meta.env.MODE === "solid-dev") {
  (window as unknown as Record<string, unknown>)[SOLID_OBSERVE_GLOBAL] =
    OBSERVE;
}

// The build mode alone, not `DEV`: under `vite serve` the plugin's
// performance-tracks module already holds the engine open with these same
// options, and this build is the only one where nobody else does.
if (import.meta.env.MODE === "solid-dev") {
  attribution.enable({ log: false, checks: false });
}
