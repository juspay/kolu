# kolu-xyne

Kolu's integration with [Xyne CLI](https://github.com/xynehq/xyne-cli)
(`xyne`). Two surfaces:

- **Dock detection** — when `xyne` is foregrounded in a terminal (or named
  by the OSC 633;E preexec hint — the command-name hint wins over the
  foreground basename), the adapter picks the newest transcript under
  `~/.xyne/agent/sessions/<encoded-cwd>/` as the session identity and
  watches it, so the tile/dock light up with the Xyne badge, the session
  title (from the `_summary.json` sidecar), and the last-used model (from
  the transcript's newest `model_change` entry). Detection re-arms whenever
  a new transcript appears in the sessions tree, so title/model follow the
  newest session for the cwd. See also: [Agent Detection](https://kolu.dev/agent-detection), [troubleshooting](https://kolu.dev/troubleshooting).

  Xyne's persisted transcript carries no live phase events, so `state` is a
  permanent honest `waiting` — no busy/attention states are derivable until
  Xyne publishes a live signal on disk. `taskProgress` and `contextTokens`
  are likewise permanent honest nulls.

- **Sleep/restore resume** — a slept or cold-restored Xyne terminal wakes
  to `xyne --session <uuid>` — the exact conversation it was running, rendered
  from the OS-derived identity plus the live process's allowlisted flags by
  anyagent's `resumeFormFor`. There is no most-recent fallback: a terminal with
  no captured identity wakes to a bare shell.

## File layout

```
~/.xyne/                      (KOLU_XYNE_DIR override for tests)
  agent/sessions/
    <encoded-cwd>/            /home/a/b → -home-a-b
      <timestamp>_<uuid>.jsonl          transcript (header + messages)
      <timestamp>_<uuid>_summary.json   {"title": …}
```

## Testing

`KOLU_XYNE_DIR` points the whole tree at a fixture root; `encodeCwd`,
`resolveXyneSession`, `deriveXyneInfo`, and `readLatestModel` are pure
functions given a cwd/path — see `src/core.test.ts`.
