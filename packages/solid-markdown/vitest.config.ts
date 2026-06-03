import { defineConfig } from "vitest/config";

// The parse layer (render.ts) is deliberately DOM-free, so the default Node
// environment is enough — the sanitize layer (DOMPurify) is covered by the
// browser e2e suite (`code-tab.feature`), not here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
