/**
 * Build-time compile of pulam-tui for the Nix closure (pulam P3 PR2a).
 *
 * pulam-tui's render layer (`tui.tsx`) is SolidJS JSX that only becomes reactive
 * through @opentui/solid's babel-preset-solid transform. Running that transform
 * at RUNTIME (a `bun --preload` of @opentui/solid's preload) drags @babel/core +
 * its browserslist/caniuse-lite tail into the production closure. So we run the
 * transform ONCE here, at Nix build time, via @opentui/solid's Bun plugin: the
 * output is plain, already-reactive JS, so the RUNTIME needs no babel at all.
 * Bun still loads @opentui/core's native Zig FFI core at runtime — only the JSX
 * *transform* moves to build time.
 *
 * `solid-js` + `@opentui/solid` MUST be bundled, not external: @opentui/solid's
 * Bun plugin rewrites `solid-js/dist/server.js` → the reactive `solid.js` client
 * build (Bun resolves solid-js to its SSR/server build under the `node`
 * condition, whose signals don't track). That redirect only fires when solid is
 * loaded *during the build*, so an external solid-js ships the NON-REACTIVE server
 * build and the UI silently freezes at runtime (the dev `bunfig` preload masks
 * this, since it does the same redirect at load time — so it only bites the Nix
 * bundle). Bundling them in also guarantees ONE solid instance shared between our
 * code and the reconciler. Only `@opentui/core` stays external — its native Zig
 * FFI loader is bundle-hostile and resolves its per-arch lib (libopentui.so,
 * shipped PREBUILT, no node-gyp) from node_modules at runtime. The `external`
 * list and the runtime native-lib set are two halves of one fact: because
 * @opentui/core is external, its .so is dlopen'd at run time and needs libstdc++
 * on LD_LIBRARY_PATH — which the wrapper in `default.nix` adds (libc/libm resolve
 * via the running bun process; only libstdc++/libgcc_s must be added). `splitting:
 * true` keeps the OpenTUI render path (the dynamic `import` of `./tui.tsx`, behind
 * bin.ts's TTY gate) a lazy chunk, so a piped/`--json` run never pulls the native
 * renderer in.
 *
 * This comment is the single canonical rationale for the whole transform/bundle/
 * native-dlopen story; the dev preload (bunfig.toml), the Nix buildPhase
 * (packages/pulam-tui/nix/default.nix), and the wrapper's LD_LIBRARY_PATH
 * (default.nix) each carry only a one-line local note that points back here, so
 * the reasoning lives in exactly one place and the three secondary sites can't
 * drift.
 */
import { rmSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

// Bun.build does not clean its outdir, so an orphaned chunk from a prior build
// would linger and could be exec'd — wipe dist/ first (the plan's build rule).
rmSync("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/bin.ts"],
  outdir: "./dist",
  target: "bun",
  splitting: true,
  // Bundle everything (so solid-js gets the reactive redirect + one instance);
  // only the native @opentui/core package is external (see the note above).
  external: ["@opentui/core"],
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  // Fail the Nix build loudly rather than ship a half-bundled viewer.
  throw new AggregateError(result.logs, "pulam-tui: bun build failed");
}

console.log(`pulam-tui: bundled ${result.outputs.length} file(s) into dist/`);
