---
name: release
description: Cut a kolu release — tag master, promote the Unreleased changelog entry, publish a GitHub release. ONLY invoke when the user explicitly types `/release` or `$release`; never auto-select from a natural-language request.
argument-hint: "[X.Y.Z]"
---

# Release

A kolu release is a **tag on `master`** (kolu ships only as a Nix flake; master stays the channel). Version's single source of truth: `packages/server/package.json`. Do these in order — **nothing is committed, tagged, or pushed before the human approves.**

1. **Settle inputs** — version from the argument, else ask (valid semver `X.Y.Z`, differs from the last tag; show the `feat`/`fix` history since the last tag to inform the call — it's an editorial choice, kolu is an app, not a library). Date: default today, confirm.
2. **Preflight** (refuse if any fails) — on `master`, clean tree, synced with `origin/master`, latest `/ci` green on `HEAD`.
3. **Fix the changelog — its own approved commit** — audit every entry in `unreleased.mdx` against `.apm/instructions/changelog.instructions.md` and fix violations **in place, uncommitted**. Show the human the diff and **`AskUserQuestion`** to approve; iterate until approved, then commit (`changelog: reconcile for ${version}`). A separate commit is the point: promotion renames the file, so folding fixes into it would bury the one diff the human can actually review.
4. **Stage the promotion — uncommitted** — promote the fixed `unreleased.mdx` body to `website/src/content/changelog/<X-Y-Z>.mdx` with `{ version, date }` frontmatter — consolidate duplicate product-area `###` headings (first-seen order, merge their bullets — never regroup by `kind`), and open with one editorial summary paragraph (the `summary` frontmatter field; the build fails without it). Reset `unreleased.mdx` to an empty open section. Set the version in `packages/server/package.json`.
5. **Approval gate** — show the human the staged (uncommitted) diff — the promoted changelog as it will actually publish, the version bump, and the tag `v${version}` — and **`AskUserQuestion`** to proceed. Iterate until approved; `No` discards the staged changes, leaving only the approved changelog commit.
6. **Commit + push** — commit (`release ${version}`) and push `master` (both commits). **Do not tag yet.**
7. **`/ci` gate** — run `/ci` on the exact release commit. On failure, open a PR with the fix, let the human merge it, run `/ci` on the resulting commit, and tag that instead; **never tag a commit `/ci` hasn't passed**.
8. **Tag & publish** — annotated tag `v${version}` on the green release commit; push it; `gh release create v${version}` with notes pointing at `kolu.dev/changelog#v<X-Y-Z>`.
9. **Verify & report** — tag on `master`, GitHub release live, `kolu.dev/changelog` shows the release. Report the tag URL, the release URL, and the pin: `nix run github:juspay/kolu/v${version}`.

ARGUMENTS: $ARGUMENTS
