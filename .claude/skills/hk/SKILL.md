---
name: hk
description: Zettelkasten on GitHub Issues. Each issue is a node, `#N` references are links (GitHub auto-tracks backlinks via CrossReferencedEvent). Use when the user types `/hk`, or asks to "add to the roadmap issue", "note this in the kasten", "file a bug on #N", "link #A to #B", "what links to #N", "create a TIL / ADR / decision node", or otherwise wants to capture/mutate knowledge as interlinked GitHub issues. The skill takes a free-form prompt — no subcommands, no flags — and infers intent from the prompt and the node's markdown structure.
---

# hk (hubkasten)

AI-friendly zettelkasten on GitHub Issues. One repo = one kasten. Each issue = one node. `#N` = a link. GitHub auto-tracks backlinks via `CrossReferencedEvent` — no extra bookkeeping.

## Invocation

```
/hk #N <free-form prompt>
/hk <owner/repo#N> <free-form prompt>
/hk <free-form prompt>        # no number → create a new node, or search
```

The first token that looks like `#N` or `owner/repo#N` identifies the target node. Everything else is natural language — interpret it.

## Core rules

1. **Always fetch fresh before mutating.** Never cache. Other agents (and humans) edit these issues concurrently. Stale writes clobber work.
   ```bash
   gh api repos/<owner>/<repo>/issues/<N> --jq '.body' > /tmp/hk-<N>-body.md
   ```
2. **Read the node's structure before mutating.** Section headings, checkbox lists, and prose style are the schema — follow what's there. If the user says "file a bug on #559", find its `## Known bugs` section and append in that format.
3. **`#N` is the only link primitive.** To link, just mention `#N` in the body — the backlink appears on #N's timeline for free. Don't invent label/type/category systems.
4. **No confirmation step.** Mutate and push. The fresh read right before the edit removes stale-state risk; the user can undo or re-prompt if they dislike the result.
5. **Infer repo from context.** First `owner/repo#N` or issue URL the user gives. If ambiguous and the cwd is a git repo, use its `origin` remote. Otherwise ask once.

## Operations

All three are _inferred_ from the prompt — never ask the user to pick one.

### Mutate an existing node (`/hk #N …`)

1. `gh api repos/<owner>/<repo>/issues/<N> --jq '.body' > /tmp/hk-<N>-body.md`
2. Read the body. Identify the section/format the user's intent maps to.
3. Optionally follow `#M` references with another `gh api` call if context is needed (skill decides based on the prompt).
4. Edit `/tmp/hk-<N>-body.md` in place.
5. Push: `gh issue edit <N> --repo <owner>/<repo> --body-file /tmp/hk-<N>-body.md`
6. Report what changed in one sentence.

### Create a new node (`/hk create a TIL about …`, `/hk new roadmap for …`)

1. Decide the title from the prompt.
2. Draft the body. Keep it short; the structure grows organically through later edits.
3. Cross-link: if the prompt mentions any `#M`, include them in the body so the backlink registers automatically.
4. `gh issue create --repo <owner>/<repo> --title "<title>" --body-file /tmp/hk-new.md`
5. Return the new issue's URL.

### Query (`/hk what links to #N`, `/hk search <terms>`)

Forward links (what #N references): read its body, grep for `#\d+`.

Backlinks (what references #N):

```bash
gh api graphql -f query='
  query($owner:String!,$repo:String!,$num:Int!) {
    repository(owner:$owner,name:$repo) {
      issue(number:$num) {
        timelineItems(first:100, itemTypes:[CROSS_REFERENCED_EVENT]) {
          nodes { ... on CrossReferencedEvent {
            source { ... on Issue { number title state }
                      ... on PullRequest { number title state } }
          } }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F num=<N>
```

Free-text search:

```bash
gh api 'search/issues?q=repo:<owner>/<repo>+<terms>+in:body,title'
```

## Heuristics for inferring intent

| Prompt shape                                                    | Likely op                                          |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `/hk #N <bug description>` and #N has a `## Known bugs` section | Append bug item under that section                 |
| `/hk #N mark phase 4 done`                                      | Toggle checkboxes in `### Phase 4` section         |
| `/hk #N add a phase for X`                                      | Insert new `### Phase N+1: X` after the last phase |
| `/hk #N show me the current state`                              | Just print the body (no edit)                      |
| `/hk create a TIL about X`                                      | New issue, short prose, maybe a code block         |
| `/hk what links to #N`                                          | Backlinks query, no edit                           |
| `/hk search <terms>`                                            | `search/issues`, no edit                           |

When a prompt doesn't fit any of these, read the node's structure and improvise — that's the whole point of using an LLM here. A "roadmap" node tells you how to operate on it by the sections it already has.

## Example session

User: `/hk #559 canvas scroll bug — terminal & canvas both react to two-finger scroll`

1. Fetch #559 body.
2. Find `## Known bugs` section (checkbox list referencing `#561`, `#562`, etc.).
3. Append `- [ ] Two-finger scroll on a terminal pans the canvas simultaneously — gesture ownership needed (~150ms idle release)`.
4. `gh issue edit 559 --repo juspay/kolu --body-file /tmp/hk-559-body.md`.
5. Report: "Added scroll-conflict bug under Known bugs on #559."

## What this skill is not

- Not a label/taxonomy system — `#N` references are the only structure.
- Not a hardcoded schema — the markdown _is_ the schema, per node.
- Not a confirmation wizard — always mutate directly.
- Not a cache — always fetch fresh.

## Design doc

Full rationale and name candidates: [juspay/kolu#568](https://github.com/juspay/kolu/issues/568).
