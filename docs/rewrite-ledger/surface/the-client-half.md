# the-client-half

- Kind: explanation. Reader: someone writing a browser client over a fleet of same-shaped surfaces, who wants to know what the keyed client guarantees.
- Rewritten from: `f50641c6a`
- Words: 738 → 907. The growth is the rationale received from `ref-surface` §Links.
- Frontmatter: description reworded (128 → 145 characters).

## Headings

| Old | New |
| --- | --- |
| One contract, many hosts | One contract, many hosts |
| `entries` is the one authority on presence | Why `entries` is the only authority on presence |
| (split out of the same section) | Why reading a host is total |
| Liveness on by construction | Why a status never renders green over a dead link |
| (new) | Why a roster move does not rebuild your page |
| Where it costs you | Where it costs you |

No inbound link points at any heading of this page (`.waterfall/anchors.md` lists none; the links from `entry-contracts`, `serve-a-map`, `across-the-hosts`, `a-fleet-of-surfaces` and `glossary` are to the page). Nothing needed updating.

## Moved

Received from `ref-surface` §Links (queued in `.waterfall/moved/the-client-half/ref-surface-06.md`):

| Argument | Heading it now lives under |
| --- | --- |
| Why a following wire exists at all (a replacement with nowhere to stop reaches every client, every standing subscription and every reactive handle, and the page rebuilds its tree) | Why a roster move does not rebuild your page |
| "A link that re-subscribed internally would hide the failure the fence must see" | Why a roster move does not rebuild your page |

The second queued passage, why the stdio readiness gate is required, is integrated on [`the-server-half`](the-server-half.md) under "Why a dial waits for the peer to greet": it argues about the dial to a remote peer, which that page owns.

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| drishti as the fleet exemplar, with its link | duplicate (`the-server-half`, "The far end is a plain server") |
| "The fleet is the single-surface client, keyed" | duplicate (the paragraph already says there is no per-host client) |
| "liveness by construction" as a phrase, in the description and a heading | house rhetoric (the fact, that `live` is a required input to the fold, is kept) |
| "two opinions about liveness is exactly how a green dot ends up floating over a dead socket" kept, its "exactly" dropped | house rhetoric |
| "it is policy wearing a framework costume" (aside) | kept, with the aside's title reworded from "Framework owns the keyed volatility; the app owns policy" |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
