import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The screen tests render real Ink components, so the suite includes .tsx.
    // The JSX transform reads `jsx: react-jsx` from tsconfig — the same shape
    // tsx uses at runtime — so no transform options are set here.
    include: ["src/**/*.test.{ts,tsx}"],
    // ink-testing-library's fake stdout advertises no colour, so chalk would
    // strip every attribute and a test could not tell an error line from an
    // ordinary one. Forcing colour on keeps the styling observable.
    env: { FORCE_COLOR: "1" },
  },
});
