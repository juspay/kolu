# session-list-info — the inference, owned

What the second patch under `../patches/` says about one stored conversation
(`messageCount`, `clearedAt`, and WHICH listed conversation it supersedes).

The pair of things the adapters' `session/list` cannot say today — how big a
conversation is, and which other one a `/clear` moved you into — answered by
the patch at `../patches/session-list-info.patch`, whose pairing rules are
extracted here so *they* carry the tests, not the patch's comments.

`@kolu/acp-claude`'s `listedIn` is the reader of both stamps, and it exists for
[olai](https://github.com/juspay/olai)'s picker: kolu's conductor is one
conversation per host and never lists the stored ones. The patch travels with
the leg that reads it rather than with the product that draws it, which is the
rule this whole directory keeps.

The shape follows from the pin carrying the code in compiled form:

- **`facts.js`** is the code of the inference, dependency-free so it can be
  spliced verbatim into the compiled adapter bundle
- **`../../src/facts.test.ts`** is the testing, in the package's own vitest
  lane (kolu has no bun, and a suite no runner collects proves nothing): not
  the wiring (that one has its own
  scenario in olai's `choosing_an_agent.feature`), but the edges of the rules
  themselves — the tie, the same-timestamp boundary, the stale candidate,
  the claimant arriving second, the undated opener, the unreadable
  transcript, the cache keys, the refusal announcers through `say`. It
  imports `facts.js` where it ships, so the proven file is the spliced file.
- **`regenerate.sh`** rebuilds `../patches/session-list-info.patch` from
  `../shim/package-lock.json` (this package's own shim, since the split),
  splices `facts.js` (with `export` removed) ahead
  of the class declaration, replaces the `listSessions` method with the one
  authored per the note in the script, and then `diff -u` computes the
  hunks — the patch committed is this script's print-out, because hunks
  by hand are hunks numbered by hand; three rounds of malformed regen taught
  where the arithmetic belongs (the diffing machinery that has to be right
  everywhere anyway).

Run it when `facts.js` changes:

```console
$ bash packages/acp-claude/adapter/session-list-info/regenerate.sh
$ nix-build -A acp-adapter --no-out-link    # applies both patches at -F0 and builds the pin
```

and note that the template's `sessionListFactsCache` and the bundled handler
of a process-lifetime Map live inside the splice scaffold — the script, not
`facts.js`, owns them (`facts.js` is the pure part; what has a lifecycle a
process should know about is handled with the logger beside it).
