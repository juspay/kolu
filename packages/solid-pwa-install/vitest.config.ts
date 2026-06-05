import { defineConfig } from "vitest/config";

// The pure layer (detectInstallPlatform / installInstructions) is deliberately
// DOM-free, so the default Node environment is enough — the browser-only
// createPwaInstall (window/customElements) is exercised in the live app, not
// here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
