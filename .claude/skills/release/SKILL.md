---
name: release
description: Cut a kolu release — tag master, promote the Unreleased changelog entry, publish a GitHub release. ONLY invoke when the user explicitly types `/release` or `$release`; never auto-select from a natural-language request.
argument-hint: "[X.Y.Z]"
---

# Release

Cut a kolu release. kolu ships only as a Nix flake, so a release is a **tag on `master`** — master stays the channel; the tag is a changelog anchor + a pin. The version is an editorial call (it's an app, not a library — `.0` is a milestone, a `.N` bump is a normal release). Its **single source of truth is `packages/server/package.json`** (`version`); the server reads it at runtime and Nix reads the same file for the artifact version, so there is nothing else to bump. Use valid semver, `X.Y.Z` (e.g. `1.0.0`), and tag `v${version}` (e.g. `v1.0.0`).

Do the **what** below in order; figure out the **how** yourself. Use **`AskUserQuestion`** whenever a choice is genuinely the user's. **Phases §1–§3 are read-only — nothing is committed, tagged, or pushed before the go/no-go in §3.** Only §4 onward mutates the tree.

## 1. Settle the inputs
- **Version** — from the argument, else ask (valid semver `X.Y.Z`, e.g. `1.0.0`). Show the `feat`/`fix` history since the last tag so the major/minor call is informed. Verify it parses as semver and differs from the last tag.
- **Date** — default today; confirm.

## 2. Preflight (refuse if any fails) — read-only
- On `master`, clean working tree, synced with `origin/master`.
- Latest CI on `HEAD` is green (the base the release commit will build on).

## 3. Confirm — the go/no-go — read-only
- Show the plan: the exact notes about to publish (the current `unreleased.mdx` body), the version bump (`packages/server/package.json` → `${version}`), and the tag (`v${version}`).
- **`AskUserQuestion`** to proceed. `No` leaves the tree untouched — nothing has been written yet.

## 4. Apply the release commit
- **Promote the changelog** — write `website/src/content/changelog/<X-Y-Z>.mdx` with `{ version, date }` frontmatter from the current `unreleased.mdx` body. **Normalize first**: `merge=union` lets concurrent PRs each append their own `### Added` (etc.), so the accumulated body can carry duplicate headings — consolidate to one section per heading (`Added` / `Fixed` / `Changed` / `Heads-up`, in that order), merging their bullets, before stamping. Then reset `unreleased.mdx` to an empty open section (just the `version: Unreleased` frontmatter).
- **Set the version** — set `packages/server/package.json` `version` to `${version}` (the single source — Nix and the runtime both read it; nothing else to bump).
- **Commit + push** — commit (`release ${version}`) and push `master`. **Do not tag yet.**

## 5. Wait for CI on the release commit
- Wait for CI/status checks to go green on the exact release commit you just pushed. **Never tag a commit CI hasn't passed** — that's why the tag is created *after* this gate, not on the pre-release `HEAD`.
- If CI fails, fix forward (or revert) on `master`; do not tag.

## 6. Tag & publish
- Annotated tag `v${version}` on the green release commit; push the tag.
- `gh release create v${version}` — notes point at `kolu.dev/changelog#v<X-Y-Z>`.

## 7. Verify & report
- Tag is on `master`; the GitHub release is live; `kolu.dev/changelog` shows the release (Pages redeploys on the `website/**` change).
- Report the tag URL, the release URL, and the pin: `nix run github:juspay/kolu/v${version}`.

ARGUMENTS: $ARGUMENTS
