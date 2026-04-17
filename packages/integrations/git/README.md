# kolu-git

Pure git operations for Kolu — repo resolution, worktree lifecycle, diff review, and path security.

## Error handling

All fallible functions return `GitResult<T>` instead of throwing:

```ts
type GitResult<T> = { ok: true; value: T } | { ok: false; error: GitError };
```

`GitError` is a discriminated union on `code`: `NOT_A_REPO`, `BASE_BRANCH_NOT_FOUND`, `WORKTREE_NAME_EXHAUSTED`, `PATH_ESCAPES_ROOT`, `GIT_FAILED`.

The server unwraps results at the RPC boundary via `unwrapGit()` in `router.ts`, mapping error codes to `ORPCError` statuses. This package has **zero dependency on oRPC**.

## Logger injection

Functions accept `log?: Logger` (from `anyagent`). Pass a pino child logger in production; omit in tests.

## Modules

| Module         | Exports                                                                           | Purpose                                                                  |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `schemas.ts`   | `GitInfoSchema`, `GitDiffOutputSchema`, etc.                                      | Zod schemas (re-exported by `kolu-common`)                               |
| `resolve.ts`   | `resolveGitInfo`, `watchGitHead`, `gitInfoEqual`, `hasGitDir`, `subscribeGitInfo` | Repo context resolution + `.git/HEAD` watching + combined subscribe loop |
| `worktree.ts`  | `worktreeCreate`, `worktreeRemove`, `detectDefaultBranch`                         | Worktree lifecycle                                                       |
| `review.ts`    | `getStatus`, `getDiff`, `parseNameStatus`                                         | Diff review (local + branch modes)                                       |
| `safe-path.ts` | `resolveUnder`                                                                    | Path traversal guard                                                     |
| `errors.ts`    | `GitError`, `GitResult`, `ok`, `err`                                              | Sum-type error types and constructors                                    |

## Server integration

The server's `meta/git.ts` is a thin adapter around `subscribeGitInfo`:

1. Calls `subscribeGitInfo(cwd, onChange)` — the integration owns the resolve + `.git/HEAD` watch + re-resolve loop, including dedup via `gitInfoEqual` and `git init` detection (same-cwd `setCwd` on a not-yet-a-repo checks `.git` and re-resolves if it appeared)
2. On change, bridges results into the metadata event system (`updateServerMetadata`, `publishForTerminal("git", …)`) and tracks the repo in the recents list
3. On terminal cwd change (via the `cwd:` channel), calls `watcher.setCwd(next)` — the integration swaps the watched directory

`NOT_A_REPO` (expected, debug) is distinguished from `GIT_FAILED` (unexpected, error) inside `subscribeGitInfo` — the callback receives `GitInfo | null` either way, but only real failures are logged at error level.
