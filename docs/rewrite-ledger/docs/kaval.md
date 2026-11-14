# kaval

- Kind: explanation + reference. Reader: someone driving terminals from the shell, locally or over ssh, and someone who wants to know what the daemon under kolu owns.
- Rewritten from: `f50641c6a`
- Words: 2,640 → 1,989 (`.waterfall/words.mjs`; the plan's own counter read 2,859 → target 1,800).
- Frontmatter: description 251 → 157 characters. No other key changed. The `koluHero` block and the inline SVG are unchanged.

## Headings

| Old | New |
| --- | --- |
| How it fits together | How it fits together |
| Run the pair | Run the pair |
| Drive a running `kolu` | Drive a running `kolu` |
| An agent inside a terminal locates itself — two env vars | Two environment variables inside a terminal |
| Reach a remote `kaval` — over ssh | unchanged (linked from `padi` and `remote-hosts`) |
| What `kaval` owns | What `kaval` owns |
| What lives above it | What lives above it |
| Why `kaval-tui send`, not a message bus | unchanged (linked from `agent-fleets`) |
| Commands · `kaval-tui` | Commands · `kaval-tui` (plus new `###` entries: Create a terminal · Read a terminal's screen · Send input to an agent · Wait for an agent to finish) |
| Detaching — the ssh model | Detach from a terminal |
| Fine print | Sockets and limits |

Both anchors other pages link (`#reach-a-remote-kaval--over-ssh`, `#why-kaval-tui-send-not-a-message-bus`) keep their heading text. The two renamed headings had no inbound links anywhere in the repo, so nothing needed updating.

## Moved

Nothing was moved off this page. Facts that live elsewhere are now two sentences plus a link:

- The workspace layer above kaval (repo context, pull request state, agent state, session restore, socket discovery, agent-state waits) → `padi`, linked from "What lives above it".
- Stopping a daemon by hand → `operations`, linked from "Sockets and limits".
- Browser access to another machine → `remote-access`, linked from the remote ssh section.

## Cut

| Fact | Tag |
| --- | --- |
| Pronunciation of _kaval_ ("said KAH-val, the first a long, as in father") and the gloss of _paḍi_ (repeated on the `padi` page) | duplicate |
| "a tmux/zellij-shaped duo, minus the multiplexer's session model" (the comparison kept as "a machine where kolu has never been installed") | rationale |
| The frozen control core reporting kaval's build and boot identity "without moving its existing pty-host procedures" | implementation |
| padi's not-drainable policy wording; the update nudge kept as one clause | implementation |
| "kolu no longer runs PTYs in-process", "the kolu-server is just the web shell your browser talks to" | history / implementation |
| "the same primitive backs kolu's terminals; kaval just serves it over a socket"; "the system split is why padi handles workspace meaning" | rationale |
| `command` tap being a sensor (`commandRun`) that no consumer may replay | implementation |
| The `$TMUX` convention as the model for the two environment variables | rationale |
| `create` env rationale: copying the caller's env leaked an orchestrating agent's identity vars and lost its transcript (issue #1872). The behaviour (clean canonical base, `--env`) is kept | rationale |
| "a usable raw multiplexer (beta)": which subcommands have shipped | history |
| "that persistence is later work" after "restarting the daemon ends its terminals" | history |
| Auto-discovery "used to read both every time, which meant scanning the whole of `/tmp`" | history |
| hcom's shared database described as "one integration per tool… kolu won't take on that setup step", "and here's the thing: it doesn't need to" | rationale (the fact, hooks per agent, is kept) |
| The `/debate` skill's port link (srid/llm-debate) and its quoted rule "pass file paths, not pasted argument text"; "an inbox is a file; a subscription is a watch on a path" | rationale |
| "the honest floor", "no bus required", "Files carry the content, the terminal carries the floor" | rationale |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 2 missing.

| Span | Why |
| --- | --- |
| `$TMUX` | cut, rationale (the naming convention behind the two variables) |
| `commandRun` | cut, implementation (the sensor name for the `command` tap) |

Every command, flag, socket path, exit code, escape chord and environment variable of the old page is still on it.
