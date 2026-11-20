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

let pool: WorkerPoolManager | undefined;

export const codeViewWorkerPool = (): WorkerPoolManager => {
  if (pool) return pool;
  registerRhaiLanguage();
  pool = getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
      poolSize: POOL_SIZE,
    },
    highlighterOptions: HIGHLIGHTER_CONTRACT,
  });
  return pool;
};
