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
