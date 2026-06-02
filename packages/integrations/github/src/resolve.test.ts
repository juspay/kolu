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

  it("contains a throwing onChange on the synchronous pending emit after the watcher has left its initial pending state", async () => {
    // Regression for the synchronous path: `setGit` emits `{ kind: "pending" }`
    // directly (not via the floated `fetchAndEmit`). On the *first* branch the
    // initial `lastPr` is already pending, so dedup suppresses it. But once a
    // resolve has driven `lastPr` to a non-pending value, a *later* branch
    // change re-emits pending through the consumer — synchronously, inside
    // `setGit`. If the boundary lived only in `fetchAndEmit`, this throw would
    // escape straight out of `setGit` into the server's `channels.git.consume`
    // and freeze the subscription. The boundary belongs on the shared `emit`.
    const original = process.env.KOLU_GH_BIN;
    process.env.KOLU_GH_BIN = "/nonexistent/gh-for-test";
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const log = spyLogger();
    // First, let a real resolve land so `lastPr` becomes non-pending, *without*
    // throwing yet.
    let shouldThrow = false;
    const watcher = subscribeGitHubPr(() => {
      if (shouldThrow) throw new Error("metadata write blew up");
    }, log);

    try {
      watcher.setGit("/repo", "feature");
      await new Promise((r) => setTimeout(r, 50)); // resolve settles → lastPr non-pending

      // Now arm the throw and change branch. This drives the synchronous
      // pending emit through the throwing consumer.
      shouldThrow = true;
      expect(() => watcher.setGit("/repo", "other-branch")).not.toThrow();

      await new Promise((r) => setTimeout(r, 50));

      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "github pr watcher: emit failed",
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
      process.off("unhandledRejection", unhandled);
      if (original === undefined) delete process.env.KOLU_GH_BIN;
      else process.env.KOLU_GH_BIN = original;
    }
  });
});
