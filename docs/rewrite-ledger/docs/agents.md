# agents

- Kind: how-to. Reader: someone deciding whether to let kolu bring coding
  agents into their terminals, and then running them on every machine.
- Rewritten from: `f50641c6a`
- Words: 4,041 → 1,780 (plan target 1,500). About 180 of those words are
  delivery facts moved **in** from `deployment` after the target was set
  (content-addressed versus signed closures, the Nix 2.35 split, the cache
  key and `trusted-users`, agent-distro's published index, the
  four-times-a-day refresh, the agents shipping inside kolu and aarch64 Linux
  having no pre-built set). The page's own material is about 1,600 words.
- Frontmatter: description 350 → 125 characters. No other key changed.
- This page is the fact home for agents delivered to other machines (plan §4),
  so every delivery, update and failure fact stays here.

## Headings

| Old | New |
| --- | --- |
| First run | First run |
| Settings → Agents | Settings → Agents |
| Profiles | Profiles |
| How profiles stack | How profiles stack (frozen, verbatim) |
| Built once, by kolu | Built once, by kolu |
| New terminals only, and each one says which | Which agents a terminal has |
| Restarting a terminal onto the current agents | Restarting a terminal onto the current agents (frozen, verbatim) |
| Where they sit on the PATH | Where they sit on the PATH |
| On other machines | On other machines |
| Kept up to date | Kept up to date |
| When a delivery fails | When a delivery fails |
| Turning it off | Turning it off |
| What doesn't change | (dropped; its one fact is the `agent-detection` link card) |

Every heading with an inbound link keeps its text, so no link anywhere needed
updating: `#first-run`, `#settings--agents`, `#profiles`,
`#how-profiles-stack`, `#built-once-by-kolu`,
`#restarting-a-terminal-onto-the-current-agents`,
`#where-they-sit-on-the-path`, `#on-other-machines`, `#kept-up-to-date`,
`#when-a-delivery-fails`. The two renamed headings
("New terminals only, and each one says which", "What doesn't change") had no
inbound links in `.waterfall/anchors.md`. Same-page links were updated.

Outbound links checked against the pages that own them:
`/tiles#restarting-a-terminal-in-place`,
`/deployment#first-run-compiling-enable-the-binary-cache` (both kept verbatim
by their rewriters), `/shell-integration`, `/agent-detection`,
`/remote-hosts`.

## Moved in (from other pages' rewrites)

- From `deployment`: content-addressed versus signed copies, the Nix 2.35
  split, `nix.settings.trusted-users` and the cache key, agent-distro's
  published index, the four-times-a-day refresh, the agents shipping inside
  kolu, and the cache carrying them for x86_64 Linux and Apple Silicon only
  (aarch64 Linux compiles on first `nix run`). All are under
  "When a delivery fails", "Kept up to date" and "On other machines".
- From `remote-hosts`: profile delivery, `plugin.json`,
  `github:you/your-profile` and `~/src/my-profile`, under "Profiles",
  "Built once, by kolu" and "On other machines".

## Moved out

- The tip bar under a tile's title bar (a launch button per agent, then a
  skill to try) → `tiles`, "A tip under the title bar", which owns it.
- What a profile file contains, item by item (`skills/<name>/SKILL.md`,
  `mcp.json`, the `extensions."asia.nixos.agent-distro"` block's `packages`,
  `env` and `settings`) → agent-distro's own
  [Profiles](https://agent-distro.kolu.dev/#profiles) and
  [From APM](https://agent-distro.kolu.dev/#from-apm) pages, both linked from
  "Built once, by kolu". Nothing in this repo documented them twice.

## Cut

| Fact | Tag |
| --- | --- |
| "kolu adds no agents on a fresh install and on one that predates this" | history |
| A profile that carries an old `agent-distro.nix`, and agent-distro's migration message under its row | history |
| The welcome's done line: "Agents: on", "Agents: juspay ✓", an error in place of the check, and how long the line stays | visible on screen |
| The welcome step's full wording: the list always empty to start, **Turn on ⏎** keeping the keyboard until you choose, the question folding away, an **Enter** out of habit changing nothing once chosen | visible on screen |
| **⌘⏎** still opening a terminal that gets no agents | duplicate (the page already says no terminal gets agents until you switch them on) |
| The welcome card keeping the question at the top of every empty canvas while agents are off | duplicate (stated under "First run") |
| Settings' hint sentence while agents are off ("Off. New terminals use only the agents you installed yourself…"), and chips naming the agents without versions | visible on screen |
| The fleet line's example text, the per-state dots, and "zest ready, last update failed" | visible on screen |
| The row's **Docs →** and **Provided by agent-distro ↗** links | visible on screen |
| A profile row's example text ("juspay (a1b2c3d) · Juspay skills + Kolu…"), the scrolling box of Nix output and its **Copy** button in Settings | visible on screen |
| The suggestion list's exact contents (**+ Juspay** first, then profiles you added before, minus those already listed) and that typing filters them | visible on screen |
| "An empty list draws no rows: it is the agents as they ship" | duplicate (the opening says it) |
| Opening a terminal in a repository reads its `plugin.json` through agent-distro before you type, to tell the pill what is in effect | implementation |
| Hovering the pill to see where each profile came from; the pill showing your list until agent-distro answers; `cd` not changing it | visible on screen |
| Hovering a dimmed pill to compare what the terminal has with what new terminals get | visible on screen |
| Splits restarting "each on its own id" phrased as a mechanism, and the old shell being stopped "the way sleep stops it" | implementation (the result, no history file and surviving `nohup` jobs, is kept) |
| A profile's own commands going first on the agent's PATH when it starts, not in the shell | implementation |
| "That is on purpose" after the bundled `claude` winning | rationale |
| kolu moving none of the agents' bytes itself | implementation |
| The turning arc never filling, because a copy reports no byte counts | visible on screen |
| The "dimmed, with a turning arc" mark (the host is connected but has not said yet) | visible on screen |
| Terminals opened on a host before its delivery lands having no agents and no pill | duplicate (the mark table and the Restart rule say it) |
| Host details being the popover behind a tab's connection pip, and Settings' fleet line opening the same place | visible on screen |
| A host keeping its delivered set in its own Nix store; a host that also installs agent-distro through its Home Manager module sharing that set and log | implementation |
| A profile for another kind of machine having the same skills, servers and settings anywhere | rationale (the failure case is a row of the failure table) |
| "Nothing is ever compiled on a host, and the agents are never compiled at all", said a second time under "Kept up to date" | duplicate |
| The failure cause naming who said it (kolu's delivery, padi, or agent-distro's updater), with Nix's output in a scrolling, copying box, and "New terminals on &lt;host&gt; get no coding agents until this is fixed" | visible on screen |
| Host-details state strings: "ready · updated 3h ago", "ready · delivering newer agents…", "checked 2h ago, up to date", "ready · last update failed 3m ago", and the dot clearing on a later run | visible on screen |
| The toast's exact format ("Claude Code 2.1.286 → 2.1.291, juspay a1b2c3d → d4e5f6a") | visible on screen |
| `agent-distro` arriving in the same build as the agents, so a new terminal gets the new one too | implementation |
| A machine whose update log kolu could not read saying so with padi's words | visible on screen |
| A later failure leaving a working machine's mark plain with a warning dot, said a third time | duplicate (the mark table and "Kept up to date") |
| "Agent detection works the same either way" as its own section | duplicate (kept as the `agent-detection` link card) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`. Twelve reported.

| Span | Where it went |
| --- | --- |
| `skills/<name>/SKILL.md`, `mcp.json`, `extensions."asia.nixos.agent-distro"`, `packages`, `env`, `settings` | moved out: agent-distro's own Profiles page, linked from "Built once, by kolu" |
| `agent-distro.nix` | cut, history (the migration note) |
| `cd` | cut, visible on screen (the pill not changing when you `cd`) |
| `PATH` | still on the page, as the plain word PATH in "Where they sit on the PATH"; the old page's code span was in the dropped sentence about a profile's commands |
| `trusted-users` | on the page as `nix.settings.trusted-users`, the name the failure message prints |
| `nix.conf` | cut: the page now states the requirement positively (a Mac must trust the login or the cache's key), which is the one-line fix the refusal prints |
| table entry: "dimmed, with a turning arc" | cut, visible on screen |
