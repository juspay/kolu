# a-fleet-of-surfaces

- Kind: tutorial. Reader: a developer who has one remote box mirrored and now wants a keyed fleet of them.
- Rewritten from: `f50641c6a`
- Words: 693 → 657
- Sentence-level work only. The 80-word opening became a 42-word opening plus a second paragraph; the 90-word registry paragraph became two; the 41-word summary sentence became two; the tip aside's two two-em-dash sentences became sentences with commas and parentheses. The steps, every command, every code block and every `<Snippet>` are unchanged, so the tutorial runs exactly as before.
- First use of "surface map" links to the glossary.

## Frontmatter

`description` was 170 characters and two sentences. Now one sentence, 125 characters: "Fan out to N boxes through a surface map: entries, chips, useEntry, and per-host presence isolated to each box's own chip."

## Headings

Unchanged.

## Moved

None.

## Cut

| Fact | Tag |
| --- | --- |
| "That last step is the whole point" | house rhetoric; the per-entry presence fact that follows is kept |
| "You have built a mini-drishti" claim in the description | duplicate of the "You built a mini-drishti" section |
| The union-budget overflow (TS2590) that a second precise mapped type would trip | implementation; the reader sees only that declared calls are typed |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Review round 1

- Aside cut to 50 words (rule 12): "entry.procedures is typed — no cast" is now 37 words. The `entry.rpc` sentence it carried, the structural addressing face and its link to `entry-contracts`, moved into the running text under `Render the fleet`. The page's other aside ("Same code as part 3") was already inside the limit at 43 words.
- Checks: lint passes; `.waterfall/compare.mjs … f50641c6a` 0 missing; `house-style.mjs` reports only the pre-existing Nix `realise` at line 77.
