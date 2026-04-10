---
argument-hint: <timeframe> (e.g. 'last week', 'last 2 weeks', 'since 2026-03-01')
description: List features added to Kolu during a timeframe
---

List features added to Kolu during: $ARGUMENTS (e.g. "last week", "last 2 weeks", "since 2026-03-01")

## Instructions

1. Determine the repo from `git remote get-url origin`. Run `gh pr list --repo <owner/repo> --state merged --search "merged:>=$(date -d '$ARGUMENTS ago' +%Y-%m-%d 2>/dev/null || date -d '$ARGUMENTS' +%Y-%m-%d 2>/dev/null)" --json number,title,mergedAt,url --limit 200` to get merged PRs in the timeframe. If the date parsing fails, fall back to `git log --since="$ARGUMENTS" --merges --oneline` and correlate with `gh pr list --state merged`.
2. Filter to user-facing changes — skip pure refactors, CI fixes, test-only changes, docs-only changes, and dependency bumps unless they unlock a visible feature.
3. For each PR, read the PR title and body (via `gh pr view <number>`) to understand what changed.
4. Group notable features by area (e.g. Terminal, Sidebar, Theme, Networking, Developer Experience). Within each area, lead with the biggest feature, then list related smaller ones. Put minor fixes/polish in a flat "Minor" section at the end.

## Output format

```
## What changed in Kolu ($ARGUMENTS)

### Area Name

- **Short description of feature** — one-line explanation. [#123](url)
- Related smaller feature. [#124](url)

### Another Area

- **Feature** — explanation. [#200](url)

### Minor

- Short description. [#456](url)
- ...
```

Keep descriptions concise and user-facing (what it does for the user, not implementation details). Link every item to its PR. Choose area names that reflect what the user cares about, not internal module names.