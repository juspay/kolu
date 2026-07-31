import { composeSpawnEnv } from "kolu-pty";
import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Environment for Git commands Kolu runs reactively in the background.
 *
 * Git's read commands may refresh cached index metadata and briefly take
 * `.git/index.lock`. That optional write can collide with the user's `git add`
 * or `git commit`, even though Kolu asked only for status. Git provides this
 * exact switch for background refreshers: required writes still lock normally,
 * while optional index refreshes stay read-only.
 */
export function backgroundGitEnv(): NodeJS.ProcessEnv {
  return {
    ...composeSpawnEnv(process.env),
    GIT_OPTIONAL_LOCKS: "0",
  };
}

/** A `simple-git` client whose background reads cannot take optional locks. */
export function backgroundGit(baseDir?: string): SimpleGit {
  return simpleGit(baseDir).env(backgroundGitEnv());
}
