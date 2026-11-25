import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform, so a `.test.tsx` render harness compiles its JSX to
  // real DOM under happy-dom (mirrors `packages/surface/vitest.config.ts`).
  // `refresh: false` — no component hot replacement under test (the render
  // tests don't hot-reload).
  //
  // The plugin gives vitest the client posture: browser export conditions and
  // the DEVELOPMENT builds of `solid-js` and `@solidjs/web`, so Solid's dev
  // diagnostics fire under test.
  plugins: [solid({ refresh: false })],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The client is a BROWSER app: run its tests with a DOM so the browser
    // `@solidjs/web` build is honest (`isServer === false`) and module-load-time
    // DOM access (`window.matchMedia` in `@solid-primitives/media`, etc.) works.
    // (fs-scanning tests resolve paths via `fileURLToPath(import.meta.url)` —
    // NOT `new URL(…, import.meta.url)`, which the happy-dom global `URL`
    // rejects.)
    environment: "happy-dom",
    // Fails a test on any Solid dev diagnostic, and refuses a production
    // Solid build (`@kolu/solid-test-setup`).
    setupFiles: ["@kolu/solid-test-setup/setup"],
    // Inline Solid so it is transformed under the posture above and resolves to
    // the ONE browser-build core. Without this, `@kolu/surface-map`'s
    // `scopedByEntry` loads its own externalized `solid-js` whose reactive graph
    // never connects to the client's signals (a cross-instance split —
    // membership updates silently never re-run the owner's memos).
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
