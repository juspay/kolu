/** Migration-safety coverage for the git domain schemas. */

import { describe, expect, it } from "vitest";
import { GitInfoSchema } from "./schemas.ts";

/** The pre-#1065 persisted shape — a `GitInfoSchema` blob written before
 *  `unpushedCommitCount` existed. */
const legacyGitInfo = {
  repoRoot: "/repo",
  repoName: "repo",
  worktreePath: "/repo",
  branch: "main",
  isWorktree: false,
  mainRepoRoot: "/repo",
};

describe("GitInfoSchema", () => {
  it("validates a pre-#1065 git blob (no unpushedCommitCount), defaulting it to 0", () => {
    // Regression for the production break where deploying #1065 over an
    // existing session made `session.get`'s output validation throw
    // EVENT_ITERATOR_VALIDATION_FAILED on every reconnect, killing the saved-
    // session subscription. GitInfoSchema is embedded in the persisted +
    // streamed SavedSessionSchema, so it must tolerate legacy blobs.
    const parsed = GitInfoSchema.parse(legacyGitInfo);
    expect(parsed.unpushedCommitCount).toBe(0);
  });

  it("preserves an explicit unpushedCommitCount", () => {
    const parsed = GitInfoSchema.parse({
      ...legacyGitInfo,
      unpushedCommitCount: 3,
    });
    expect(parsed.unpushedCommitCount).toBe(3);
  });
});
