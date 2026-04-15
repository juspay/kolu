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

| Module         | Exports                                                       | Purpose                                        |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `schemas.ts`   | `GitInfoSchema`, `GitDiffOutputSchema`, etc.                  | Zod schemas (re-exported by `kolu-common`)     |
| `resolve.ts`   | `resolveGitInfo`, `watchGitHead`, `gitInfoEqual`, `hasGitDir` | Repo context resolution + `.git/HEAD` watching |
| `worktree.ts`  | `worktreeCreate`, `worktreeRemove`, `detectDefaultBranch`     | Worktree lifecycle                             |
| `review.ts`    | `getStatus`, `getDiff`, `parseNameStatus`                     | Diff review (local + branch modes)             |
| `safe-path.ts` | `resolveUnder`                                                | Path traversal guard                           |
| `errors.ts`    | `GitError`, `GitResult`, `ok`, `err`                          | Sum-type error types and constructors          |

## Server integration

The server keeps a thin provider adapter in `meta/git.ts` that:

1. Calls `resolveGitInfo()` / `watchGitHead()` from this package
2. Bridges results into the metadata event system (`updateMetadata`, `publishForTerminal`)
3. Distinguishes `NOT_A_REPO` (expected, debug) from `GIT_FAILED` (unexpected, error)
