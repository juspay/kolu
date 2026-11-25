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
 * Production is excluded twice over: `import.meta.env.DEV` and
 * `import.meta.env.MODE` are build-time literals, so a production build drops
 * this branch, and there `solid-js` exports `OBSERVE` as `undefined` anyway.
 *
 * WHY ITS OWN MODULE, IMPORTED FIRST. A diagnostic raised while a module is
 * evaluating — kolu has module-scope `createRoot`s, which are owned scopes —
 * is only seen if the channel was handed over before that module ran. ES
 * modules are evaluated in import order, so this one must be imported first in
 * `index.tsx` AND must import nothing of the app's: `solid-js` and a bare
 * string constant only.
 */

import { SOLID_OBSERVE_GLOBAL } from "kolu-common/solidDiagnostics";
import { OBSERVE } from "solid-js";

if (import.meta.env.DEV || import.meta.env.MODE === "solid-dev") {
  (window as unknown as Record<string, unknown>)[SOLID_OBSERVE_GLOBAL] =
    OBSERVE;
}
