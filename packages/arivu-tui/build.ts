/**
 * Build-time compile of arivu-tui for the Nix closure.
 *
 * arivu-tui's render layer (`tui.tsx`) is SolidJS JSX that only becomes reactive
 * through @opentui/solid's babel-preset-solid transform. Running that transform
 * at RUNTIME (a `bun --preload` of @opentui/solid's preload) drags @babel/core +
 * its browserslist/caniuse-lite tail into the production closure — which kolu's
 * `installPhase` prune strips, a cwd-sensitive whack-a-mole (`ENOENT @babel/core`,
 * then `ENOENT browserslist`). So we run the transform ONCE here, at Nix build
 * time, via @opentui/solid's Bun plugin: the output is plain, already-reactive
 * JS, so the RUNTIME needs no babel at all and the prune can stay aggressive.
 * Bun still loads OpenTUI's native Zig FFI core at runtime — only the JSX
 * *transform* moves to build time.
 *
 * `packages: "external"` keeps every dependency (@opentui/*, @kolu/*, cleye,
 * solid-js) resolved from node_modules at runtime; we bundle only arivu-tui's own
 * `src/`. `splitting: true` keeps the OpenTUI render path a lazy chunk, so
 * `bin.ts`'s `isTTY && !--json` gate still decides whether the native renderer is
 * ever loaded (a piped/JSON run never pulls it in).
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/bin.ts"],
  outdir: "./dist",
  target: "bun",
  splitting: true,
  packages: "external",
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  // Fail the Nix build loudly rather than ship a half-bundled viewer.
  throw new AggregateError(result.logs, "arivu-tui: bun build failed");
}

console.log(`arivu-tui: bundled ${result.outputs.length} file(s) into dist/`);
