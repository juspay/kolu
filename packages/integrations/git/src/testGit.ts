import { simpleGit, type SimpleGit } from "simple-git";

/**
 * A simple-git client for tests that scaffold real repos (and commit against
 * them) without a developer's `~/.gitconfig`.
 *
 * simple-git v4 filters `GIT_*` variables out of the child environment unless
 * allowlisted (see `background.ts`), so the old trick of setting
 * `GIT_AUTHOR_*` / `GIT_COMMITTER_*` in `vitest.setup.ts` silently stops
 * working: commits then abort with "Author identity unknown" on any machine
 * whose git config has no `user.name`/`user.email` (CI boxes, `pu` hosts).
 * The `config` option maps to `git -c user.name=… -c user.email=…` — not a
 * guarded `GIT_*` variable, so it survives the v4 env filter.
 */
export function testGit(baseDir?: string): SimpleGit {
  return simpleGit({
    baseDir,
    config: ["user.name=kolu-test", "user.email=test@kolu.dev"],
  });
}
