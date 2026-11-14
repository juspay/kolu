# ref-surface-remote

- Kind: reference. Reader: someone wiring `@kolu/surface-remote` who needs to look up an export.
- Rewritten from: `f50641c6a`
- Committed one `##` section at a time.

## The session

- Words (counted by `docs-lint`'s rules): 2,617 → 2,857. The growth is the new index table and entry headings. Before: one 790-word block, 18 table cells over 40 words and five `<Aside>`s. After: 21 entries, every block, cell and heading section inside the lint's limits, no asides.
- New entries for exports that were only named in prose: `SshKeepalive` / `sshKeepalive(intervalS, countMax)` (with `DEFAULT_SSH_KEEPALIVE`, `MAX_SSH_KEEPALIVE_TOLERANCE_S`) and `sshDialOpts(keepalive)`.
- The five asides became entry sections: "This bounds ssh transport death" → `What keepalive does not bound`; "A ControlMaster's opener…" → `sshDialOpts(keepalive)`; "The agent must greet…" → `The readiness banner`; "resolveDrvPath is deferred by contract" → `resolveDrvPath is deferred`; "localEnv is REQUIRED…" → `localEnv on a localhost dial`.
- Headings renamed: none. New `###`/`####` headings only. No inbound links pointed into this section.
- `extraArgs?` had no description; its row is traced to the doc comment on `SshConnectorOptions.extraArgs` in `packages/surface-remote/src/sshConnector.ts`.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "a default of `binary` is precisely how one host silently ended up with two different closures" | history |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## The mirror pump

- Old lines 189–292 at `f50641c6a`. Section words: 795 → 1,212. The growth is the index table, the entry headings and prose broken out of three dense paragraphs.
- Four index rows, four `###` entries (`pumpRemoteSurface(opts)`, `SurfaceSink` / `makeSink`, `reServeSurface(opts)`, `makeClientCursor(session)`), with `####` sections inside the two long ones: `log` and `onFault`, How the pump ends, Supervision and `close()`, `policy`, Demand gating, `absent` frames, A standing refusal.
- Headings renamed: none (the `##` heading is unchanged). No inbound links point into this section.
- Comparison: 0 missing.

### Moved

| Fact | Where |
| --- | --- |
| Why the `log` / `onFault` split exists (the kolu#2101 incident) | `the-server-half`, "Why faults get a channel of their own" |
| Why demand is counted in one gate rather than per member kind | `the-server-half`, "Why demand is counted in one place" |
| Why an `absent` frame exists, and why its value belongs to the source contract | `the-server-half`, "Why absence gets a frame of its own" |
| Why a refusal is raised as a defect rather than a frame | `the-server-half`, "Why a refusal stops the relay" |

### Cut

| Fact | Tag |
| --- | --- |
| "which used to spam the journal for the whole provisioning window" | history |
| "`reServeSurface` no longer hand-rolls the teardown" | history |

### Dropped code spans

None.

## The fleet fan-out

- Old lines 293–352 at `f50641c6a`. Section words: 627 → 672.
- Two index rows, two `###` entries (`buildRemotePool(opts)`, `serveHostMap(map, pool, opts)`), with `####` sections: `remove(host)` and `retire(host)`, `failureOf(host, session, state)`, The failure's evidence, The fail-loud seams. `failureOf`'s two return cases became a table.
- Headings renamed: none (the `##` heading is unchanged). No inbound links point into this section.
- Comparison: 0 missing.

### Moved

None. The two short reasons kept (the republish gate, the pinned tail) explain constraints the reader acts on.

### Cut

| Fact | Tag |
| --- | --- |
| "the O(M²) re-publish risk (every failed member re-publishing on every sibling's tick) is closed one layer down" as an argument; the behaviour (the structural `dequal` gate) is kept | rationale |

### Dropped code spans

None.

## Connection health — the host-map entry's fine payload

- Old lines 353–424 at `f50641c6a`. Section words: 967 → 1,022.
- Heading renamed: "Connection health — the host-map entry's fine payload" → "Connection health" (`#connection-health--the-host-maps-entry-s-fine-payload` → `#connection-health`). No link anywhere in the repo pointed at the old anchor, so nothing needed updating.
- Five index rows, five `###` entries, with `####` sections under `ConnectionInfo`: Fields on every arm, What a campaign scopes, `clockOffset` on the `connected` arm, When the clock probe fails. The arms and the per-arm fields became tables.
- Comparison: 0 missing.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "There is no per-host `connection` cell anymore: it was a second wire channel a browser subscribed independently, and the two could latch out of step." | history |
| "so a 'dot connected, word connecting' split has no construction path" | rationale |
| "carrying it would put a state on the browser's wire that every reader must handle and no producer can ever send" | rationale |
| "(not the per-attempt ~1s a per-dial reset showed)" reworded without the history | history |
| "never a silent hand-listed copy" | rationale |
| The issue numbers #1908 D3 and #1908 | history |

### Dropped code spans

None.

## A mirror, end to end

Unchanged: the section is a heading and one `<Snippet>`.

## Lifecycle invariants

- Old lines 429–471 at `f50641c6a`. Section words: 4,142 → 4,469. Page total: 9,785 → 10,297.
- Heading kept (`#lifecycle-invariants`), since the rewritten "The session" section links to it twice.
- The 21-item list became an index table and 21 `###` entries, with `####` sections inside `nudge()`, `runCapture`, `provisionAgent`, `deliverClosure` and `pullClosure`. The fault classes, the probe verdicts, the two manual cycles, the no-op arms, the lifetime policies, the option bags, the result arms and the watchdog arms became tables.
- The "Nix is the contract, not the implementation" aside was dissolved into the `provisionAgent` entry, fact by fact (remote-store `nix build`, darwin fronting linux, the ask-only warm check, the `--add-root` commit, no tarball or Docker fallback, the Linux and darwin routes). The "Shared library" aside is kept, the page's only one.
- Comparison: 0 missing for the section and for the whole page. Lint passes for the whole page.

### Moved

| Fact | Where |
| --- | --- |
| Why a `network` fault resets the remote run | `the-server-half`, "Why the session sorts silence into kinds" |
| Why an absence must never age into a terminal failure | `the-server-half`, "Why the session sorts silence into kinds" |
| Why the 127 verdict is read off the exit code, not the shell's wording | `the-server-half`, "Why the session sorts silence into kinds" |
| Why the pre-connected backstop's bound is baked in | `the-server-half`, "Why the session sorts silence into kinds" |
| Why a mirror stays silent rather than relaying a guess | `the-server-half`, "Why values replay and byte streams break" |

### Cut

| Fact | Tag |
| --- | --- |
| "`recheck()` used to no-op while a dial was in flight; that documented no-op is fixed" | history |
| Issue and task numbers: #1908 (D1b, D3, R6b, R8b), juspay/kolu#2101 (H2), P5 | history |
| "the process exits and the session dies with it", restated by the invariant above it | duplicate |
| "instead of reconnecting forever" / "rather than discarding a usable transport" as argument | rationale |
| "(both before Nix 2.35, or both from it on)", restated by the three-version table and the 2.34/2.35 rule in `resolveHostNix` | duplicate |

### Dropped code spans

None.

## Review round 1

- Opening cut to 50 words (rule 4): the subpath sentence moved into a second paragraph, so no fact left the page.
- B3, the "Why" link of the reference-entry template, one per entry a Moved row came from:
  - `log and onFault` → [Why faults get a channel of their own](/surface/the-server-half#why-faults-get-a-channel-of-their-own).
  - `Demand gating` → [Why demand is counted in one place](/surface/the-server-half#why-demand-is-counted-in-one-place).
  - `absent frames` → [Why absence gets a frame of its own](/surface/the-server-half#why-absence-gets-a-frame-of-its-own).
  - `A standing refusal` → [Why a refusal stops the relay](/surface/the-server-half#why-a-refusal-stops-the-relay).
  - `Fault classes and the give-up budget`, `Absence`, `A host with no runnable Nix` and `The pre-connected liveness backstop` → [Why the session sorts silence into kinds](/surface/the-server-half#why-the-session-sorts-silence-into-kinds), one link each (the five lifecycle rows).
  - `A mirror never fabricates a value` → [Why values replay and byte streams break](/surface/the-server-half#why-values-replay-and-byte-streams-break).
- Checks: lint passes; `.waterfall/compare.mjs … f50641c6a` 0 missing; `house-style.mjs` reports only this page's pre-existing Nix `realise` family.
