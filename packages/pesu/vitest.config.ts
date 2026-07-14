import { defineConfig } from "vitest/config";

// Node env (a server-side daemon — no DOM), *.test.ts co-located in src/.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
