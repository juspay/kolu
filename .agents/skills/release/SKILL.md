---
name: release
description: Cut a kolu release — tag master, promote the Unreleased changelog entry, publish a GitHub release. ONLY invoke when the user explicitly types `/release` or `$release`; never auto-select from a natural-language request.
argument-hint: "[X.Y]"
---

# Release

Cut a kolu release. kolu ships only as a Nix flake, so a release is a **tag on `master`** — master stays the channel; the tag is a changelog anchor + a pin. The version is an editorial call (it's an app, not a library — `.0` is a milestone, a `.N` bump is a normal release). Its **single source of truth is `packages/server/package.json`** (`version`); the server reads it at runtime and Nix reads the same file for the artifact version, so there is nothing else to bump. Use valid semver (e.g. `1.0.0`).

Do the **what** below in order; figure out the **how** yourself. Use **`AskUserQuestion`** whenever a choice is genuinely the user's. Everything is read-only until the explicit go/no-go in §5 — nothing is committed, tagged, or pushed before that.

## 1. Settle the inputs
- **Version** — from the argument, else ask (valid semver, e.g. `1.0.0`). Show the `feat`/`fix` history since the last tag so the major/minor call is informed.
- **Date** — default today; confirm.

## 2. Preflight (refuse if any fails)
- On `master`, clean working tree, synced with `origin/master`.
- Latest CI on `HEAD` is green. Never tag a commit CI hasn't passed.

## 3. Promote the changelog
- Ensure `website/src/content/changelog/<X-Y>.mdx` exists with `{ version, date }` frontmatter — promote `unreleased.mdx` into it (or, if the entry was pre-seeded, just set its date).
- Reset `unreleased.mdx` to an empty open section.

## 4. Set the version
- Set `packages/server/package.json` `version` to the release version — the single source of truth. Nothing else to bump (Nix and the runtime both read this file). Verify it parses as semver and differs from the last tag.

## 5. Confirm — the go/no-go
- Show the plan + the exact notes about to publish, then **`AskUserQuestion`** to proceed. `No` leaves the tree untouched.

## 6. Cut it
- Commit (`release X.Y`), annotated tag `vX.Y`, push `master` + tag.
- `gh release create vX.Y` — notes point at `kolu.dev/changelog#v<X-Y>`.

## 7. Verify & report
- Tag is on `master`; the GitHub release is live; `kolu.dev/changelog` shows the release (Pages redeploys on the `website/**` change).
- Report the tag URL, the release URL, and the pin: `nix run github:juspay/kolu/vX.Y`.

ARGUMENTS: $ARGUMENTS
