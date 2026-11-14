# the-server-half

- Kind: explanation. Reader: someone serving a surface that lives on another machine, who wants to know why the mirror is shaped as it is.
- Rewritten from: `f50641c6a`
- Words: 742 → 1,502. The growth is the rationale received from `ref-surface-remote` (nine passages, below) and one from `ref-surface`.
- Frontmatter: description reworded (133 → 138 characters).

## Headings

| Old | New |
| --- | --- |
| The mirror is a pump | Why the browser faces a local copy |
| One safety rule, per member | Why values replay and byte streams break |
| (new) | Why absence gets a frame of its own |
| (new) | Why a refusal stops the relay |
| (new) | Why demand is counted in one place |
| The session owns the pipe | Why the session owns the pipe |
| (new) | Why a dial waits for the peer to greet |
| (new) | Why the session sorts silence into kinds |
| (new) | Why faults get a channel of their own |
| Fronting a plain server | The far end is a plain server |
| Where it costs you | Where it costs you |

No inbound link points at any heading of this page (`.waterfall/anchors.md` lists none; every link from `across-the-hosts`, `mirror-over-ssh`, `serve-a-map`, `the-client-half`, `glossary`, `a-fleet-of-surfaces` and `blog/surface-framework` is to the page). Nothing needed updating.

## Moved

Received from `ref-surface-remote` (queued in `.waterfall/moved/the-server-half/ref-surface-remote.md`):

| Argument | Heading it now lives under |
| --- | --- |
| Why the `log` / `onFault` split exists, with the kolu#2101 incident | Why faults get a channel of their own |
| Why demand is counted in one gate rather than per member kind | Why demand is counted in one place |
| Why an `absent` frame exists, and why its value belongs to the source contract | Why absence gets a frame of its own |
| Why a refusal is raised as a defect rather than a frame | Why a refusal stops the relay |
| Why a `network` fault resets the remote run | Why the session sorts silence into kinds |
| Why an absence must never age into a terminal failure | Why the session sorts silence into kinds |
| Why the 127 verdict is read off the exit code, not the shell's wording | Why the session sorts silence into kinds |
| Why the pre-connected backstop's bound is baked in | Why the session sorts silence into kinds |
| Why a mirror stays silent rather than relaying a guess | Why values replay and byte streams break |

Also received, from `ref-surface` §Links (queued in `.waterfall/moved/the-client-half/ref-surface-06.md`): why the stdio readiness gate is required, now under "Why a dial waits for the peer to greet". It was queued for `the-client-half`, which is about the browser facing a fleet; the gate belongs to the dial this page already describes. Both pages have the same owner, and `docs/rewrite-ledger/surface/ref-surface.md` records the destination.

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "the framework chooses an honest flicker over a smooth-looking lie" | house rhetoric (the trade itself is kept, in plain words) |
| "a consumer written against the local copy is byte-identical to one written against the agent directly" reworded to "identical" | duplicate (the sentence before says the contract is identical on both hops) |
| "The point of the mirror is a single load-bearing sentence" | house rhetoric |
| "This is the same instinct as reactive honesty's 'an empty must not lie'" kept, its framing as an "instinct" dropped | house rhetoric |
| Aside title "The daemon variant adds supervision, not a new model" → "The daemon variant adds supervision" | house rhetoric ("not X but Y") |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
