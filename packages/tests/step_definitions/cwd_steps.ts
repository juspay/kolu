/** CWD display assertions for the inspector companion.
 *
 *  After the canvas-peer companion refactor the cwd lives only inside
 *  MetadataInspector — features that assert "the header CWD should
 *  show X" first open the inspector companion in their Background, so
 *  the `inspector-cwd` testid is mounted and queryable when the step
 *  runs. The "header" wording is kept verbatim from before the refactor
 *  so existing feature files (worktree, git-context, recent-repos) read
 *  unchanged. */

import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then(
  "the header CWD should show {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const el = document.querySelector('[data-testid="inspector-cwd"]');
        return (el?.textContent ?? "").includes(exp);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);
