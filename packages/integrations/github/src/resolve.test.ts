import type { Logger } from "kolu-shared";
import { describe, expect, it, vi } from "vitest";
import { subscribeGitHubPr } from "./resolve.ts";

/** A `Logger` whose `error` is a spy, so we can assert the watcher contained a
 *  throwing consumer instead of letting it escape as an unhandled rejection. */
function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("subscribeGitHubPr", () => {
  it("contains a throwing onChange instead of escaping as an unhandled rejection", async () => {
    // No `gh` binary available in the test env: `resolveGitHubPr` catches the
    // missing-`KOLU_GH_BIN` internally and returns a classified result, then
    // `emit` runs our `onChange` with it. We make that callback throw — the
    // shape of a metadata write blowing up — and assert it is logged, not
    // propagated. Without the `fetchAndEmit` try/catch this rejects the
    // floated promise and crashes the process via the global handler.
    const original = process.env.KOLU_GH_BIN;
    process.env.KOLU_GH_BIN = "/nonexistent/gh-for-test";
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const log = spyLogger();
    let calls = 0;
    const watcher = subscribeGitHubPr(() => {
      calls += 1;
      throw new Error("metadata write blew up");
    }, log);

    try {
      // Real change → pending dedup is a no-op on first call, then a floated
      // `fetchAndEmit` resolves and calls our throwing `onChange`.
      watcher.setGit("/repo", "feature");
      // Let the floated async settle.
      await new Promise((r) => setTimeout(r, 50));

      expect(calls).toBeGreaterThan(0); // the throwing consumer ran
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "github pr watcher: emit failed",
      );
      expect(unhandled).not.toHaveBeenCalled(); // nothing escaped
    } finally {
      watcher.stop();
      process.off("unhandledRejection", unhandled);
      if (original === undefined) delete process.env.KOLU_GH_BIN;
      else process.env.KOLU_GH_BIN = original;
    }
  });
});
