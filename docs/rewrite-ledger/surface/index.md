# index

- Kind: explanation (the Surface section's front door). Reader: someone arriving at the framework docs who has to pick a stratum and a first page.
- Rewritten from: `f50641c6a`
- Words: 216 → 201
- Frontmatter: `description` cut from two sentences (145 characters) to one (136): "A surface is a typed, reactive slice of live state you declare once, and the framework derives the contract, the server, and the client." Keys unchanged, `koluHero` untouched.

## Headings

Unchanged: "Three strata", "What each layer answers". No inbound link targets an anchor on this page (`.waterfall/anchors.md` lists none, and a repo grep for `surface/#` and `surface/index#` finds none).

## What changed

- The opening sentence had two em-dashes (lint rule 14). It became two sentences: what a surface is, then what the framework derives. The opening paragraph is 46 words.
- "You stop hand-writing 'fetch, then subscribe, then reconcile, then reconnect' and just read the values" became "You read the values instead of hand-writing fetch, subscribe, reconcile, reconnect": active, and no quoted phrase.
- The "Three strata" paragraph dropped the emphasis italics on *independently*, and "you can go straight to either" became a clause of its own.
- The closing paragraph dropped the "not a ladder you must climb" set piece and the "proves" framing: kaval and drishti are now stated as what they are.
- Emphasis italics on *once* and *independently* removed (rule 16). Bold is kept only on the term **surface** where it is defined, and on the stratum names **Basics**, **Daemons**, **Multi-host**, **kaval** and **drishti**, which name cards and products on screen.

The `<Aside>` (one, under 50 words), `<StrataMap />`, both `<CardGrid>`s and all six `<LinkCard>`s, including their `href` and `description` attributes, are unchanged.

## Moved

Nothing moved on or off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "a ladder you must climb" / "proves a daemon needn't be multi-host" | house rhetoric (the fact, kaval being a daemon that is not multi-host, is kept) |
| "and just read the values" as a flourish | house rhetoric (reworded, same fact) |

## Dropped code spans

`.waterfall/compare.mjs`: 0 missing.
