# kolu-git

Pure git operations for Kolu — repo resolution, worktree lifecycle, diff review, and path security.

## Error handling

All fallible functions return `GitResult<T>` instead of throwing:

```ts
type GitResult<T> = { ok: true; value: T } | { ok: false; error: GitError };
```

`GitError` is a discriminated union on `code`: `NOT_A_REPO`, `BASE_BRANCH_NOT_FOUND`, `WORKTREE_NAME_COLLISION`, `PATH_ESCAPES_ROOT`, `FILE_GONE`, `GIT_FAILED`.

`FILE_GONE` is the delete-while-viewing race (and the build output cleaned under an open row). It is its own member so "is this failure a missing path?" has one authority: `unwrapGit` maps it to the typed `FileGone` the Code tab keys on, rather than the wire contract resting on an errno string surviving re-wrapping into a `GIT_FAILED` message.

Callers unwrap results at the RPC boundary via `unwrapGit()` — the boundary helper lives in `@kolu/padi`'s `terminalWorkspace/endpoint.ts`, which maps each `GitError` code onto one of padi's declared tagged errors (`FileGone`, `GitFailed`, `WorktreeNameCollision`, …), so a failure crosses the wire as a member of the surface's own error union rather than as an HTTP-shaped status. This package has **zero dependency on the RPC layer**.

## Logger injection

Functions accept `log?: Logger` (from `anyagent`). Pass a pino child logger in production; omit in tests.

## Modules

| Module         | Exports                                                                           | Purpose                                                                  |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `schemas.ts`   | `GitInfoSchema`, `GitDiffOutputSchema`, etc.                                      | Effect Schema definitions (re-exported by `kolu-common`)                 |
| `resolve.ts`   | `resolveGitInfo`, `watchGitHead`, `gitInfoEqual`, `hasGitDir`, `subscribeGitInfo` | Repo context resolution + `.git/HEAD` watching + combined subscribe loop |
| `worktree.ts`  | `worktreeCreate`, `worktreeRemove`, `detectDefaultBranch`                         | Worktree lifecycle                                                       |
| `review.ts`    | `getStatus`, `getDiff`, `parseNameStatus`                                         | Diff review (local + branch modes)                                       |
| `browse.ts`    | `listAll`, `listIgnored`, `listDirectory`, `readFile`, `filePreviewTag`           | Code-tab listings + file reads (`listDirectory` opens a collapsed ignored dir) |
| `dir-change.ts` | `subscribeDirChange`                                                             | Non-recursive one-directory change ticks — `listDirectory`'s watch counterpart, for non-git browse roots |
| `safe-path.ts` | `resolveUnder`                                                                    | Path traversal guard                                                     |
| `errors.ts`    | `GitError`, `GitResult`, `ok`, `err`                                              | Sum-type error types and constructors                                    |

## Server integration

The server's `meta/git.ts` is a thin adapter around `subscribeGitInfo`:

1. Calls `subscribeGitInfo(cwd, onChange)` — the integration owns the resolve + `.git/HEAD` watch + re-resolve loop, including dedup via `gitInfoEqual` and `git init` detection (same-cwd `setCwd` on a not-yet-a-repo checks `.git` and re-resolves if it appeared)
2. On change, bridges results into the metadata event system (`updateServerMetadata`, `publishForTerminal("git", …)`) and tracks the repo in the recents list
3. On terminal cwd change (via the `cwd:` channel), calls `watcher.setCwd(next)` — the integration swaps the watched directory

`NOT_A_REPO` (expected, debug) is distinguished from `GIT_FAILED` (unexpected, error) inside `subscribeGitInfo` — the callback receives `GitInfo | null` either way, but only real failures are logged at error level.
