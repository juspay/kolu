import {
  DEFAULT_THEMES,
  type HighlighterTypes,
  type ThemesType,
} from "@pierre/diffs";
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerPoolManager,
} from "@pierre/diffs/worker";
import { registerRhaiLanguage } from "./languages/rhai";

export const HIGHLIGHTER_CONTRACT = {
  preferredHighlighter: "shiki-js",
  theme: DEFAULT_THEMES,
} as const satisfies {
  preferredHighlighter: HighlighterTypes;
  theme: ThemesType;
};

const POOL_SIZE = 2;

/** The pool is deliberately never torn down: it stays warm for the session like
 *  a cached highlighter (re-opening the Code tab is instant), and Pierre's
 *  internal LRU bounds its memory. So a single CodeView unmount must NOT
 *  terminate it — other views share the same instance. */
export const getCodeViewWorkerPool = (): WorkerPoolManager => {
  // Custom languages must be registered on the main thread before Pierre
  // resolves and transfers their grammars to its workers.
  registerRhaiLanguage();

  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
      poolSize: POOL_SIZE,
    },
    highlighterOptions: HIGHLIGHTER_CONTRACT,
  });
};
