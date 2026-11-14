# the-daemon-spine

- Kind: explanation. Reader: someone building or operating a daemon-hosted surface who wants to know why the control core is frozen and what that costs.
- Rewritten from: `f50641c6a`
- Words: 703 → 1,168 (it grew by the rationale received from three reference pages).
- Frontmatter: description reworded, paired dashes removed (168 → 137 characters).

## Headings

| Old | New |
| --- | --- |
| The problem a daemon has that a page does not | What a daemon must answer that a page does not |
| The control core is frozen so it survives a skew | Why the control core is frozen (plus a new `###` What a frozen contract survives, and what it does not) |
| Recycle without lying | Recycling a daemon without lying to its clients |
| Why the halves are two packages | Why the supervisor is a separate package |
| (new) | Why a runtime fault kills the process |
| (new) | Why the framework takes values, not loose fields |
| The trade | What freezing costs you |

No inbound link points at any heading of this page (`.waterfall/anchors.md`; every link from `blog/surface-framework`, `docs/kaval`, `glossary`, `make-it-a-daemon`, `ref-surface-daemon`, `surface-daemon-invariants` and `the-server-half` is to the page, not to an anchor). No link needed updating.

## Moved

Received from the reference pages' rationale queue (`.waterfall/moved/the-daemon-spine/`):

| Received from | Argument | Heading here |
| --- | --- | --- |
| `ref-surface-daemon` | The frozen fragment does not version within an epoch; a framing change is a declared flag day, because negotiation lives inside the protocol being replaced and a value inside a frame cannot describe a break in the frame | What a frozen contract survives, and what it does not |
| `surface-daemon-invariants` | The same flag-day argument | What a frozen contract survives, and what it does not (integrated once) |
| `ref-surface-daemon` | A drain refusal is a defect: the frozen fragment's shape is not a consumer's to widen, so an undeclared throw must not pose as a narrowable member error | Why the framework takes values, not loose fields |
| `ref-surface-daemon` | The home is a spine primitive, not a helper: loose path strings do not cross from consumer to framework, and overrides are absorbed into the home | Why the framework takes values, not loose fields |
| `ref-surface-daemon` | A runtime fault is fatal rather than logged: a poll read's failure is already cell-local, so a dead runtime is structural wiring death; plus the juspay/kolu#2101 incident | Why a runtime fault kills the process |
| `ref-surface-daemon` | The zombie class as the reason the owned-fault arm is separate from the graceful stop | Why a runtime fault kills the process |
| `ref-surface-supervisor` | The supervisor is Effect-native with no Promise-shaped twin, so an abandoned boot, restart or drain tears its own work down | Why the supervisor is a separate package |
| `ref-surface-supervisor` | An unspeakable peer is taken over, not refused: refusing leaves a cross-epoch upgrade unconverged until a person intervenes | Recycling a daemon without lying to its clients |
| `ref-surface-supervisor` | Launch mode and environment inheritance are one union field, so the illegal combination is a type error | Why the framework takes values, not loose fields |

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "oRPC base64+newline peer codec → Effect RPC ndjson" codec names, in the received flag-day passage | history (the flag-day rule is kept without naming the codecs) |
| "The oRPC-era `PRECONDITION_FAILED` code said the same thing with a string the caller had to compare" | history |
| "padi's old refuse is gone" phrasing | history (kept as the reason refusing is the wrong act) |
| "the split is load-bearing, not tidiness", "That ordering is the whole trick" kept; "`never changes shape`" bolding and italics for emphasis | rationale (house rhetoric and emphasis removed; the facts stay) |
| Emphasis italics and bold: *which build it is*, **never changes shape**, *before*, *behind*, *is*, *where*, *forever* | rationale (written plainly) |
| Paired dashes in the opening, "The problem a daemon has…" and "A daemon is not a fleet" | rationale (replaced by sentence breaks and commas) |

The one history passage kept is the juspay/kolu#2101 zombie, with its PR link, because it is the reason a runtime fault exits non-zero.

## Dropped code spans

None. `node .waterfall/compare.mjs website/src/content/surface/the-daemon-spine.mdx` reports 0 missing.
