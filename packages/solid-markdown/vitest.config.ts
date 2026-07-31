import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // sanitize.ts is an actual DOMPurify boundary. DOMPurify supports jsdom for
    // server-side policy tests; the production sanitizer and allowlist still
    // run unchanged (happy-dom does not implement DOMPurify's platform needs).
    environment: "jsdom",
  },
});
