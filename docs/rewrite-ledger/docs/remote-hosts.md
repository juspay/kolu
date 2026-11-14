# remote-hosts

- Kind: how-to. Reader: someone adding another machine to kolu and keeping it working.
- Rewritten from: `f50641c6a`
- Words: 5,369 → 2,248
- Frontmatter: `description` 262 → 128 characters. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| Prerequisites | What a host needs |
| Add a host | Add a host |
| Pre-seed hosts at launch (optional) | Pre-seed hosts at launch |
| First connect — provisioning over ssh | First connect (+ new `### While it connects`, `## Host tabs and the connection pip`) |
| Switch hosts, and per-host canvases | Switch hosts |
| Put the tabs in your own order | Put the tabs in your own order (kept: inbound links) |
| One conductor, every host | One Conductor, every host |
| When a host is down | When a host is down (kept: same-page link) |
| Port forwarding | Port forwarding (frozen) |
| How a click becomes a page | What a press opens |
| Managing open doors | Open and close doors |
| A printed `localhost` URL uses the same door | A printed `localhost` URL |
| Known limitations | Known limitations |
| Forwarded ssh-agent | Forwarded ssh-agent (kept: inbound links) |
| Related | Related |

Every heading with an inbound link (`#port-forwarding`, `#forwarded-ssh-agent`, `#put-the-tabs-in-your-own-order`, `#when-a-host-is-down`) kept its text, so no inbound link needed updating. Two outbound links were repointed on integrator notice: `/padi#steady-state-supervision` → `/padi#when-kaval-stops-answering`; the `/operations#three-things-to-know-first` link was cut with its sentence.

## Moved

- Delivery of coding agents and profiles to other machines (agent-distro index, content-addressed vs signed sets, Nix 2.35 split for agents, four-times-a-day refresh, profile build rules) → `agents`. This page keeps two sentences and a link.
- The Conductor reaching every host (one conversation, `host/id` naming, live host roster, no conductor per host) → `conductor`. This page keeps two sentences and a link.
- Port forwarding stays here, including the printed `localhost` URL card (`right-panel` links here).

## Cut

| Fact | Tag |
| --- | --- |
| "that combination used to read as healthy while nothing would run" | history |
| Long cold-connect narration detail: the exact banner wording, "kolu-2.2.0: 42 MiB of 180 MiB", every tenth of the way, line wrapping, fixed tail height, six rows on screen, no fake progress bar | visible on screen |
| Deadline mechanics: short local vs longer remote deadline, "No new output in the last 14 min", the half-hour campaign backstop measured from when the tab started watching, a reload restarting it, a shown card surviving a blip | implementation |
| Warm reconnect refreshing the target-store root; the extra evaluation pass after a restart with a cold derivation cache | implementation |
| `journalctl --user -u kolu`, the "started by hand" log case, padi's own log in its state root on the host | duplicate (`operations` owns where logs are) |
| Host-row shape: strip on desktop, pull-down sheet on phone, anchored popover for the add box, chips vs tabs wording | visible on screen |
| "The pip reports the whole chain, not just the first link" as a separate claim; "a build pinning its CPUs"; a connection carrying nothing for a minute being ended | implementation |
| The diagnostics popover's agent detail (profile, build, last update, check-for-newer button, the agent-distro mark opening the same popover); "diagnostics is never hover-opened" | visible on screen |
| Per-host warm state detail: the fleet index of terminal keys, the ~100 KB screen snapshot per terminal, `terminal attach burst` / `terminal attach: ends` log lines and their `attach`/`publish`/`foreign` reasons, how browser memory scales | implementation |
| Attention detail: the rust stripe, the working row in the popover, the tab never changing width, a background agent chiming like the active one | visible on screen (states live on `notifications`) |
| Drag detail: the hold-or-move threshold, dropping a tab back in its own slot, removal leaving no hole, a re-added machine being a new arrival; the full list of places the order shows | visible on screen |
| Conductor tab detail: `◆ Conductor`, no connection dot, no host hue, <kbd>⌘⇧O</kbd>, its violet badge; the one-conversation-per-fleet trade-off aside | duplicate (`conductor`) / rationale |
| "Those lines travel with the failure, not alongside it", surviving a quiet browser; "never just an exit code" | implementation |
| The kaval card's example versions, that the verdict also shows in the kaval dialog, and the "newer build available" badge | visible on screen |
| "That last row is the honest one"; "kolu says so rather than offering a button that would fail" kept, the surrounding argument cut | rationale |
| Ports read "not scraped from output" kept in short form; the Steps' extra examples (another user's service, a door no scan may close) trimmed | duplicate |
| Printed-URL card detail: "in this terminal, in another one, or a server that detached from all of them", "Printed text never creates a port fact of its own", the cross-link back to the Inspector | implementation / duplicate (`right-panel`) |
| Known-limitations preamble ("each is ssh reality, not a kolu bug", the GUI-session explanation repeated per row) | duplicate |
| ssh-agent: "anything else that signs with your local agent", the stable-link rationale in full | implementation |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `plugin.json`, `github:you/your-profile`, `~/src/my-profile` | moved to `agents` with profile delivery |
| `host/id`, `prod`, `◆ Conductor` | moved to `conductor` |
| `terminal attach burst`, `terminal attach: ends`, `attach`, `publish`, `foreign` | cut, implementation |
| `journalctl --user -u kolu`, `journalctl` | cut, duplicate (`operations`); the page still names the service log and `nix log` |
| `you@box` | still on the page, inside the `KOLU_PADI_HOST` code block rather than as a span |
| `<host>` | still on the page, inside `` `ssh <host>` `` |
| `⌘/Super+K` | still on the page, as `<kbd>⌘/Super+K</kbd>` |
| table entries `Home + hostname`, `user@host`, `green pip`, `amber pip (pulsing)`, `amber pip, "kaval down"`, `red pip + struck label` | the tab/pip table was split: the tab labels are now a sentence, and the pip rows are `green`, `amber, pulsing`, `amber, "kaval down"`, `red, label struck through` |
