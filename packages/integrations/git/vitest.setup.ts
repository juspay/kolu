// Tests in this package scaffold real git repos in /tmp and run
// `git commit` against them. On a pristine NixOS host with no
// `~/.gitconfig`, git aborts with "Author identity unknown" (see #887,
// fixed for the cucumber suite in #888 via the same env pinning).
// `??=` lets a developer's existing identity win when running locally.
process.env.GIT_AUTHOR_NAME ??= "kolu-test";
process.env.GIT_AUTHOR_EMAIL ??= "test@kolu.dev";
process.env.GIT_COMMITTER_NAME ??= "kolu-test";
process.env.GIT_COMMITTER_EMAIL ??= "test@kolu.dev";
