/**
 * Build-time compile of arivu-tui for the Nix closure (arivu P3 PR2a).
 *
 * arivu-tui's render layer (`tui.tsx`) is SolidJS JSX that only becomes reactive
 * through @opentui/solid's babel-preset-solid transform. Running that transform
 * at RUNTIME (a `bun --preload` of @opentui/solid's preload) drags @babel/core +
 * its browserslist/caniuse-lite tail into the production closure. So we run the
 * transform ONCE here, at Nix build time, via @opentui/solid's Bun plugin: the
 * output is plain, already-reactive JS, so the RUNTIME needs no babel at all.
 * Bun still loads @opentui/core's native Zig FFI core at runtime — only the JSX
 * *transform* moves to build time.
 *
 * `packages: "external"` keeps every dependency (@opentui/*, @kolu/*, cleye,
 * solid-js) resolved from node_modules at runtime; we bundle only arivu-tui's own
 * `src/`. `splitting: true` keeps the OpenTUI render path (the dynamic `import`
 * of `./tui.tsx`, behind bin.ts's TTY gate) a lazy chunk, so a piped/`--json` run
 * never pulls the native renderer in.
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
  packages: "external",
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  // Fail the Nix build loudly rather than ship a half-bundled viewer.
  throw new AggregateError(result.logs, "arivu-tui: bun build failed");
}

console.log(`arivu-tui: bundled ${result.outputs.length} file(s) into dist/`);
