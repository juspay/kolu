# operations

- Kind: how-to. Reader: someone stopping, rolling back, or duplicating a kolu installation.
- Rewritten from: `f50641c6a`
- Words: 1,495 → 1,216 (target 1,100)
- Frontmatter: description 245 → 139 characters. No other key changed.

## Headings

| Old | New |
| --- | --- |
| Three things to know first | Before you start (the three items are now a list) and Where the logs are |
| Stop the stack | Stop the stack |
| Roll back to an older release | Roll back to an older release |
| Run a second kolu beside a live one | Run a second kolu beside a live one |

`#roll-back-to-an-older-release` is linked from `troubleshooting` and is kept.

Inbound link still needing an update, in a page assigned to another rewriter:

- `website/src/content/docs/remote-hosts.mdx:254` — `/operations#three-things-to-know-first` → `/operations#where-the-logs-are` (it links for "redirect `kolu web` output", which now lives under that heading).

Four bold run-in paragraphs are gone: three became list items under "Before you
start", one became the "Where the logs are" heading. Five `<Aside>`s became
two: the `pkill padi` caution and the shared-state-root caution. The capture
tip, the SIGTERM caution and the separate-machine caution are now plain text.

## Moved

- Restoring a `config.json` backup (the palette flow, what each row shows, what a restore does) → `troubleshooting` "kolu lost my session (or my settings look wrong)", linked. The backup ring itself is still named here in two sentences.

## Cut

| Fact | Tag |
| --- | --- |
| The opening's framing ("one vocabulary, introduced once here and used by both") | rationale |
| "padi and kaval hold the state, and they are what a careless stop or a careless test run damages" | rationale |
| "not because anything refuses them, but because they compute entirely different paths" | implementation |
| `pkill padi` "prolonged a real recovery"; "your editor's buffer name" as the example match | history |
| A pile-up of local builds once drove the OOM killer to reap the production kaval | history |
| "Your 'local test' has just performed the production upgrade"; "with its own state root the digest differs, and there is nothing of production's for it to find" | duplicate (the caution already states the consequence) |
| "That takeover logic exists only in the newer binary. An older kolu has no code for it." kept as one clause; the repetition dropped | duplicate |
| Backup-ring detail: byte-identical restarts skipped, the **Debug → Restore state from backup** path, copying over `config.json` by hand | moved to `troubleshooting` |

## Dropped code spans

`.waterfall/compare.mjs` reports 0 missing.

## Review round 1

- Two asides cut under 50 words. Cut as duplicate: "but it also matches anything else" is kept in shorter words; the corroboration detail ("a gate file under its own padi runtime directory naming a pid the OS agrees is holding the socket") is the takeover rule stated under "Before you start" and in `surface-daemon-invariants`.
- Three bold run-in sentences in "Before you start" are plain list items now.
