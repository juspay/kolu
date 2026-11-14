# ref-surface-supervisor

- Kind: reference (Surface, `Daemons · Reference`). Reader: someone wiring `@kolu/surface-daemon-supervisor` who needs to look up an export.
- Rewritten from: `f50641c6a`
- Words (counted by `.waterfall/words.mjs`): 3,894 → 3,881.
- Frontmatter: unchanged (the `description` is 118 characters and one sentence).
- Shape: each `##` group opens with a short paragraph and an index table (`Export` · `Subpath` · `What it is`) linking to entries; 35 `###` entries and 5 `####` sections follow. Before: 16 table cells over 40 words, one 341-word block, a 529-word section, a 452-word section and two `<Aside>`s. After: every cell one line, no asides, every section inside the lint's limits.
- Comparison (`.waterfall/compare.mjs`): 0 missing.
- Code and page did not disagree anywhere; the package barrel (`packages/surface-daemon-supervisor/src/index.ts`) and its `package.json` `exports` were read to confirm the subpaths (`.`, `/dial`, `/states`) now stated in the index tables.

## Headings

| Old | New |
| --- | --- |
| The face is Effect-native | The face is Effect-native |
| The dial leaf — `/dial` | The dial leaf — `/dial` |
| The endpoint | The endpoint |
| The convergence kit | The convergence kit |
| The third observation — `unspeakable-protocol` | The third observation — `unspeakable-protocol` |

No `##`/`###` heading was renamed; every new heading is an export name or a
named section inside an entry. No inbound link points at any heading of this
page (`.waterfall/anchors.md` lists none). The page is linked, without an
anchor, from `website/src/content/surface/glossary.mdx:37` and
`website/src/content/surface/ref-surface-daemon.mdx:13`; both still resolve.

New entries for exports that the old page named only in prose or inside another
row: `Endpoint` (states, `current()`, `holdRestarting`, the private boot trio),
`probeDaemonIdentityFrom(opts)` as its own entry, and the two `####` sections
`An unreadable gate` and `The incompatible state`, which were prose inside the
old "The endpoint" block.

Both `<Aside>`s became entry sections, as the reference addendum requires:
"`cfg.env` means different things per launch mode" → `#### cfg.env per launch
mode` under `survivableSpawnDriver(cfg, deps?)`; "Two policies in the wild" →
two sentences in the convergence kit's opening, keeping the links to
[kaval](/kaval), [padi](/padi), `recycle-and-upgrade` and
`surface-daemon-invariants`.

## Moved

| Fact | Where |
| --- | --- |
| "There is no Promise-shaped twin: a supervisor composes its boot, its recycle and its drain into one fiber tree…" (the long form; the page keeps the short one) | `the-daemon-spine`, "Why the supervisor is a separate package" |
| "padi's old **refuse** is gone, because reasoning from 'the drain verb is unreachable' to 'leave it standing' left a cross-epoch upgrade permanently unconverged until a human stopped a daemon out of band." | `the-daemon-spine`, "Recycling a daemon without lying to its clients" (written without the history: refusing leaves the upgrade unconverged until a person intervenes) |
| "Folding the two together means 'inherit the parent env on a normal launch' is a type error, not a prose invariant a caller must remember." | `the-daemon-spine`, "Why the framework takes values, not loose fields" |

## Cut

No API fact is cut. What went:

| Fact | Tag |
| --- | --- |
| Why `readProcessIdentity`, `readSocketHolders` and `readProcessState` were once Promise-shaped (`osfacts-client` declared no `effect` dependency, the supervisor lifted each at its call site, "every lift is gone") | history |
| "`awaitExit` no longer takes an `AbortSignal`… an abandoned `AbortController` was" → stated as the present fact: it takes neither, and interruption cannot be refused | history |
| "the list that once recorded both barrels as a known cost is empty, and empty is the assertion" (the assertion itself is kept) | history |
| "The graft that is gone is the one the COMPILER needed" (the copy/compile split that stands is kept) | history |
| "a local error type would be a second name for facts this package does not produce" | rationale |
| "the very thing a drain verb would have requested" → kept as the short "the act the drain verb requests" | rationale |
| "(a version is something you read off a wire you can speak)" | rationale |
| "That split is the whole safety story" and "so the observation can never put a SIGTERM near a process we have not proven is ours" | duplicate (`surface-daemon-invariants`, "An observation may only act on a daemon proven ours") |
| "The oRPC `NOT_FOUND` *frame* that carried this failure is gone with the protocol epoch" → stated as the present fact: the narrowing derives on the Effect RPC failure, and that frame does not exist on this wire | history |
| Capitals for emphasis (`REQUIRED`, `NOT`, `ONE`, `OWNS`, `COMPLETE`, `COALESCING`, `TAKEOVER`, `STOPPED`, `BARREL`, `VALUE`, `TYPE`, `DATA`, `WHY`, `CLASSIFIED`, `NON-EMPTY`, `OPTIONAL`, `SUPERVISOR`, `COMPILER`) | duplicate (the same words in lower case) |

## Dropped code spans

None. `.waterfall/compare.mjs` reports 0 missing: every code span, both
`<Snippet>` tags (`region="endpoint"`, `region="converge"`) and every table
first-column entry of `f50641c6a` is on the page.
