# ref-surface-daemon

- Kind: reference. Reader: someone writing or supervising a daemon with `@kolu/surface-daemon` who needs to look up an export.
- Rewritten from: `f50641c6a`
- Words (counted by `.waterfall/words.mjs`): 3,991 → 4,314. The growth is the five index tables and the 40 new entry headings; every long block, essay cell and heading section is now inside the lint's limits.
- Frontmatter: `description` reworded ("frozen identity fragment" → "frozen control core"), still one sentence, 140 characters. No other key changed.
- Shape: eleven `##` groups became nine, each opening with an index table whose first column keeps the old table's first-column text verbatim. One `###` per export, `####` where an entry exceeded the 300-word heading limit (`Refusing to drain`, `The optional arguments`, `What takes a home`, `The sibling reaper`, `The three lifetimes`, `pusher`). The page's one `<Aside>` ("Two convergence axes live here") became the entry section `The two convergence axes`; the page now has no asides.
- New entries for exports only named in prose: `@kolu/surface-daemon/pidGate.testlib` (index row), `serveOverUnixSocket` (its group), `frontDaemonOverStdio(opts)` and `reExecAsDetachedDaemon({ stripArgs, stderrLog? })` (index table added), the three Nix recipes (index table added).

## Headings renamed

| Old | New |
| --- | --- |
| (page opening, no heading) | `## Entry points` (new group, holding the old intro's subpath facts and the `/home` + `/lifetime` table) |
| `## The upgrade-window test kit` | `### @kolu/surface-daemon/upgrade-window.testlib` (now an entry under `Entry points`) |
| `## The narrow entries — /home and /lifetime` | `### @kolu/surface-daemon/home` and `### @kolu/surface-daemon/lifetime` (entries under `Entry points`) |
| `## The lifecycle` | kept |
| `## The owned-runtime-fault exit` | folded into the lifecycle entries `armRuntimeFaultExit(opts) · DAEMON_RUNTIME_FAULT_MARKER` and `DaemonSpec.faultSignal` |
| `## The anchor self-reap` | kept verbatim (linked from `make-it-a-daemon` and twice on this page) |
| `## The frozen control core`, `## The on-disk home`, `## Serving the surface`, `## Fronting over stdio`, `## Baked identity`, `## Nix recipes` | kept |

No `##` anchor that anything links to changed. `/surface/ref-surface-daemon#the-anchor-self-reap` (from `website/src/content/surface/make-it-a-daemon.mdx:51`) still resolves; the two same-page links to it were kept. No inbound link anywhere needs an update.

## Moved

| Fact | Where it now lives |
| --- | --- |
| "The fragment never versions — within a protocol epoch": the Effect-4 flag-day argument (oRPC base64+newline codec → Effect RPC ndjson, why negotiation cannot cross a framing change) | `the-daemon-spine` (pending: queued in `.waterfall/moved/the-daemon-spine/ref-surface-daemon.md`). The wire facts stay here: `CONTROL_CORE_VERSION` frozen at `"1.0"`, the six byte-pinned fields, `unspeakable-protocol`. |
| Why a drain refusal is a defect: "the frozen fragment's shape is not a consumer's to widen" and the oRPC-era `PRECONDITION_FAILED` comparison | `the-daemon-spine` (pending, same queue file). The defect rule, the absent error schema, `Effect.promise` and the absence of a narrowable code stay here. |
| "This is a spine primitive, not a helper" framing | `the-daemon-spine` (pending, same queue file). Every API fact of that paragraph stays here under `What takes a home`. |
| Why a runtime fault is fatal rather than logged: the `@kolu/surface` poll ruling and the juspay/kolu#2101 incident | `the-daemon-spine` (pending, same queue file). The exit codes, the orderly teardown and `armRuntimeFaultExit` stay here. |

## Cut

| Fact | Tag |
| --- | --- |
| "which is how a module documented browser-safe came to compile a daemon's signal handling for an out-of-repo consumer (juspay/kolu#2216). The leaves close that." | history |
| "the field that made this a requirement (juspay/kolu#2178): TERM left every orphan up, KILL reaped them" (the sibling reaper's incident) | history |
| "The recorded failure is juspay/kolu#2101 — a padi that logged one probe timeout…" | history (and queued to `the-daemon-spine`, above) |
| "byte-identical to what this recipe hashed before the pinned arm existed" → rewritten as "byte-identical to the unpinned formula" | history |
| "`null` bakes the byte-identical declaration it baked before the option existed" → rewritten as "byte-identical to one from a tree that never set it" | history |
| "Honest residual:", "three honest constructors", "the ONE answer", "deliberately so", "not a helper", "by construction" flourishes | rationale (house rhetoric; the facts they decorated are kept) |
| Emphasis capitals: `NOT`, `PUBLISHES`, `ONE`, `OWNS`, `THUNK`, `REQUIRED`, `WHAT`, `TEST-ONLY`, `FATAL`, `WHOLE`, `PARAMETER`, `NAMES`, `UNSET` | rationale (written in lower case; no fact changed) |

## Dropped code spans

None. `node .waterfall/compare.mjs website/src/content/surface/ref-surface-daemon.mdx f50641c6a` reports 0 missing: every code block, `<Snippet>` tag, inline code span and first-column table entry of the old page is present.
