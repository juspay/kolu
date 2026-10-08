// Tests in this package scaffold real git repos in /tmp and commit against
// them. Identity now travels via `testGit`'s `-c user.*` config (simple-git
// v4 strips `GIT_AUTHOR_*` / `GIT_COMMITTER_*` from child environments unless
// allowlisted, so setting them here would be dead code) — see `src/testGit.ts`.
