/** Shared `@pierre/diffs` highlight worker pool for every Kolu `CodeView`.
 *
 *  Pierre tokenizes diff/file syntax on whatever thread renders the view —
 *  unless it is handed a `WorkerPoolManager`. Without one, highlighting a large
 *  diff (a 50k-line lockfile, or a whole PR's worth of hunks in one CodeView)
 *  runs on the UI thread and blocks it. This module builds the pool once — a
 *  process-wide singleton, the way an expensive Shiki highlighter is built once
 *  and reused — and `CodeView` hands it to Pierre's constructor so tokenization
 *  runs off the UI thread. Plain (un-highlighted) ASTs still paint synchronously;
 *  the worker streams the highlighted tokens back and the view repaints.
 *
 *  The pool is deliberately never torn down: it stays warm for the session like
 *  a cached highlighter (re-opening the Code tab is instant), and Pierre's
 *  internal LRU bounds its memory. So a single CodeView unmount must NOT
 *  terminate it — other views share the same instance.
 *
 *  Browser-only by construction: `getCodeViewWorkerPool()` is reached from
 *  `CodeView`'s `onMount`, so the `new Worker(...)` never runs during SSR
 *  (transcript-html's static export consumes `@pierre/diffs` directly, not this
 *  wrapper). */

import {
  DEFAULT_THEMES,
  type HighlighterTypes,
  type ThemesType,
} from "@pierre/diffs";
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerPoolManager,
} from "@pierre/diffs/worker";

/** The single highlighter contract every Kolu `CodeView` shares with the worker
 *  pool that tokenizes for it. Both facts here must hold for the off-thread
 *  tokens to be byte-identical to any main-thread path:
 *
 *  - `preferredHighlighter`: which Shiki regex engine tokenizes. `shiki-js`
 *    drops the Oniguruma WASM payload — lighter for an Electron client.
 *  - `theme`: the dual light+dark registry the highlighter is built with. The
 *    active scheme is a CSS-variable swap (`themeType`), so the worker
 *    highlights once and theme toggles never re-tokenize.
 *
 *  `CodeView`'s `buildOptions` and the worker pool's `highlighterOptions` both
 *  read from this one object, so the engine/theme axis lives in exactly one
 *  place: a future engine or theme change is a one-line edit here that cannot
 *  drift between the synchronous and worker paths. */
export const HIGHLIGHTER_CONTRACT = {
  preferredHighlighter: "shiki-js",
  theme: DEFAULT_THEMES,
} as const satisfies {
  preferredHighlighter: HighlighterTypes;
  theme: ThemesType;
};

/** Web workers in the pool. Kolu views one diff/file CodeView at a time, but a
 *  single CodeView holds *many* items that highlight as they scroll in, so a
 *  couple of workers let neighbouring hunks tokenize in parallel — without
 *  spinning up Pierre's default of eight Shiki engines, which is wasteful on a
 *  desktop client. */
const POOL_SIZE = 2;

/** The shared pool. `getOrCreateWorkerPoolSingleton` is `pool ??= new
 *  WorkerPoolManager(...)` module-side, so the options below are consumed only
 *  on the *first* call; every later call returns that same warm instance and
 *  ignores its args. A per-CodeView-mount call is therefore free and never
 *  builds a second pool — this wrapper is a pure adapter that pre-fills Kolu's
 *  options (one lifetime cache, Pierre's, instead of mirroring it locally). */
export const getCodeViewWorkerPool = (): WorkerPoolManager =>
  getOrCreateWorkerPoolSingleton({
    poolOptions: {
      // Kolu owns the worker factory, so the worker bundles through the
      // client's Vite (`new Worker(new URL(...))` is Vite's worker pattern)
      // rather than Pierre guessing the bundler. If the Worker can't construct
      // (CSP, workers disabled), Pierre catches the throw, sets `workersFailed`,
      // and the view degrades to un-highlighted (plain-AST) rendering — the
      // content still paints, so no extra guard is needed here.
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
      poolSize: POOL_SIZE,
    },
    // The worker tokenizes against the same engine + theme registry the view
    // renders with — see `HIGHLIGHTER_CONTRACT`. Pierre destructures it, so the
    // binding is passed directly (no defensive copy needed).
    highlighterOptions: HIGHLIGHTER_CONTRACT,
  });
