---
name: release
description: Cut a kolu release — tag master, promote the Unreleased changelog entry, publish a GitHub release. ONLY invoke when the user explicitly types `/release` or `$release`; never auto-select from a natural-language request.
argument-hint: "[X.Y.Z]"
---

# Release

A kolu release is a **tag on `master`** (kolu ships only as a Nix flake; master stays the channel). Version's single source of truth: `packages/server/package.json`. Do these in order — **nothing is committed, tagged, or pushed before the human approves in §4.**

1. **Settle inputs** — version from the argument, else ask (valid semver `X.Y.Z`, differs from the last tag; show the `feat`/`fix` history since the last tag to inform the call — it's an editorial choice, kolu is an app, not a library). Date: default today, confirm.
2. **Preflight** (refuse if any fails) — on `master`, clean tree, synced with `origin/master`, latest CI green on `HEAD`.
3. **Stage the release — uncommitted** — in the working tree only:
   - **Audit every entry against the changelog guidelines** in `.apm/instructions/website-docs.instructions.md` and fix violations in place: release-relative prose and `kind` (a `fixed`/`changed` touching a feature the last release never shipped folds into that feature's `added` entry), one entry per change (merge iteration leftovers), no internal phase/campaign vocabulary.
   - **Promote** the current `unreleased.mdx` body to `website/src/content/changelog/<X-Y-Z>.mdx` with `{ version, date }` frontmatter — consolidate duplicate product-area `###` headings (first-seen order, merge their bullets — never regroup by `kind`), and open with one editorial summary paragraph above the first `###` (the build fails without it). Reset `unreleased.mdx` to an empty open section.
   - **Set the version** in `packages/server/package.json`.
4. **Approval gate** — show the human the staged (uncommitted) diff — the promoted changelog as it will actually publish, the version bump, and the tag `v${version}` — and **`AskUserQuestion`** to proceed. Iterate on the changelog until approved; `No` discards the staged changes and leaves the tree clean.
5. **Commit + push** — commit (`release ${version}`) and push `master`. **Do not tag yet.**
6. **CI gate** — wait for CI to go green on the exact release commit. On failure, fix forward (or revert) on `master`; **never tag a commit CI hasn't passed**.
7. **Tag & publish** — annotated tag `v${version}` on the green release commit; push it; `gh release create v${version}` with notes pointing at `kolu.dev/changelog#v<X-Y-Z>`.
8. **Verify & report** — tag on `master`, GitHub release live, `kolu.dev/changelog` shows the release. Report the tag URL, the release URL, and the pin: `nix run github:juspay/kolu/v${version}`.

ARGUMENTS: $ARGUMENTS
