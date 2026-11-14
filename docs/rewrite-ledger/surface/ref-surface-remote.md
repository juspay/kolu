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
| Why the `log` / `onFault` split exists (the kolu#2101 incident) | `the-server-half` (pending, queued in `.waterfall/moved/the-server-half/ref-surface-remote.md`) |
| Why demand is counted in one gate rather than per member kind | `the-server-half` (pending, same queue) |
| Why an `absent` frame exists, and why its value belongs to the source contract | `the-server-half` (pending, same queue) |
| Why a refusal is raised as a defect rather than a frame | `the-server-half` (pending, same queue) |

### Cut

| Fact | Tag |
| --- | --- |
| "which used to spam the journal for the whole provisioning window" | history |
| "`reServeSurface` no longer hand-rolls the teardown" | history |

### Dropped code spans

None.
