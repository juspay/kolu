# reactive-honesty

- Kind: explanation. Reader: someone building on `@kolu/surface` who wants to know why the framework refuses the convenient fallbacks, and what that costs them.
- Rewritten from: `f50641c6a`
- Words (`.waterfall/words.mjs`): 1,699 → 1,916. The growth is the rationale received from the reference pages (below); the page's own prose shrank. Limit 2,500; longest heading section 250 words.
- Frontmatter: description reworded (143 → 134 characters, em-dash removed).

## Headings

| Old | New |
| --- | --- |
| A poll read may reconcile, but it publishes only by RETURNING | A poll read may reconcile, but it publishes only by returning (same anchor) |
| The through-line | What the rules have in common |
| (new) | `###` Absent is not a failure · `###` The same split on the command line (both under "An empty stream fails loud, never quiet") |
| (new) | `###` Why the overlay waits a second (under "Green is a claim about the page, not about the socket") |
| (new) | `##` A face offers only what it can do |
| (new) | `###` The buffer that batches is bounded (was the bold run-in "The buffer that does it is bounded…") |

The other `##` headings keep their text, as §3 of the plan directs. No file in the repo links into this page's headings (`grep -rn "reactive-honesty#"`: no hits), so no inbound link needed an update. `consume-outside-solid` links to the page with no anchor and is unaffected.

## Moved (received from)

| Fact | From | Now at |
| --- | --- | --- |
| Why a poll source's `label` is required rather than a convention: a convention is a rule held by memory, the next fused cell is added by someone who has not read it, and the guard then fires anonymously on the source nobody expected to loop | `ref-surface` old line 586 (`.waterfall/moved/reactive-honesty/ref-surface-03.md`) | `## A poll read may reconcile, but it publishes only by returning`, last paragraph, linking the entry |
| The readout is the one verdict the framework owns, because it is the one an app gets wrong | `ref-surface` old line 1841 (`ref-surface-09.md`) | `## Green is a claim about the page, not about the socket` |
| Why `presentingDown` exists: an app reading the raw transport status alarms on every sub-second forced reconnect (a watchdog's half-open recovery, a Wi-Fi roam), and an app smoothing it by hand re-derives the same number | `ref-surface` old lines 1869–1876 (`ref-surface-09.md`) | `### Why the overlay waits a second`, linking `/surface/ref-surface#the-readout` |
| Why a non-pushing transport subtracts `--follow` at build: a caller finds out what a face can do from `--help`, and a flag that parses and then always fails is a flag whose help is untrue | `ref-surface-cli` old lines 149–155 | `## A face offers only what it can do`, first paragraph |
| Why `"absent"` and a deadline take different exit codes: a deadline is not an answer, and reporting it as success would make "I could not find out" indistinguishable from it | `ref-surface-cli` old lines 172–183 | `### The same split on the command line`, linking `/surface/ref-surface-cli#exit-codes` |
| Why `resolve` is one step: the endpoint's name is needed exactly when the dial fails, and `describe(values)` beside `connect(values)` is two readings of one decision | `ref-surface-cli` old lines 94–98 | `## A face offers only what it can do`, second paragraph |

Dropped from the queue as a duplicate: "that gap is where the green-light-over-an-empty-collection bug lives" (`ref-surface-09.md`). The section "Green is a claim about the page, not about the socket" already opens with that bug, as a collection whose stream has died rendering empty under a green light. Recorded as a `duplicate` cut in `docs/rewrite-ledger/surface/ref-surface.md`.

No API fact came with the queue: the exit codes, the `endpoint.streaming: false` subtraction, the `resolve` signature, `DISCONNECT_OVERLAY_GRACE_MS` and the `label` requirement all stay in the reference entries, which this page links to.

## Cut

| Fact | Tag |
| --- | --- |
| "Together they are what we call reactive honesty" | duplicate (the page title says it) |
| "This is not a nicety — it is load-bearing" | rationale (house rhetoric, no fact) |
| "That split is the whole point" | rationale (house rhetoric) |
| "self-clearing by construction" → "clears itself" | rationale (flourish) |
| "for years the indicator every app draws had two inputs to remember… Apps never made it" | history (kept as the present-tense reason an indicator drawn from `status` alone claims only that a socket is open) |
| "the connect seams do not hand back a transport status any more" | history (kept as what the seams hand back) |
| "Kolu learned this building port forwarding. It needed to know whether…" | history (kept as what port forwarding needs: the fact lives on the connection) |
| "Kolu shipped exactly that… The fix was not a guard on the announcement but the removal of the shape… The reactor now detects" | history (kept as what the shape does and what the cure is; the freeze, the dead interface and `SIGKILL` stay as the failure mode) |
| "Olai found this the way you find it" | history (the measurement stays: ten seconds of answer, seventy-two seconds to the screen, five chunks a second, 200 ms link) |
| "A first attempt at this batched into an unbounded one, and the cost was invisible until CI found it" | history (kept as "the cost stays invisible until a test finds it") |
| "throwing there once turned a normal empty into a non-retriable error that killed the subscription" | history ("once" dropped; the consequence stays in the present) |
| Emphasis capitals: `BROADCAST`, `AT`, `DO`, `ANNOUNCE`, `RETURNING`, `SHAPE`, `YOUR`, `DECISION`, `ONE` | rewritten in lower case |

No incident on the page has a PR link: the three the old page carried (the port-forward freeze, the green light over an empty collection, the batching lag) are not cited by number in the page or in `packages/surface`, so each is written as the present-tense failure mode or as a measurement rather than as history.

## Dropped code spans

None (`node .waterfall/compare.mjs website/src/content/surface/reactive-honesty.mdx`: 0 missing).
