# architecture

- Kind: explanation. Reader: someone who wants to know how kolu is put together and what survives what.
- Rewritten from: `f50641c6a`
- Words: 4,150 → 2,470
- Frontmatter: `description` 299 → 129 characters. `order`, `section`, `koluHero` unchanged.
- All three inline SVGs kept verbatim (classes, `id`s, `<title>` text), as is the `ax-cmp` comparison table, the `doc-term` block and every `LinkCard`.
- Second source: each package's `package.json` dependencies, read to fill the "depends on" column of the package table.

## Headings

| Old | New |
| --- | --- |
| The stack | The stack |
| A deploy _adopts_ what's running | A deploy adopts what is running |
| Compared to tmux and zellij | Compared to tmux and zellij |
| One contract — `@kolu/surface` | One contract — `@kolu/surface` |
| Identity is a `folder`, not a port | How a daemon is identified |
| Talking over the wire | Talking over the wire (kept; `deployment` links to `#talking-over-the-wire`) |
| A second door, for one local process | The Conductor's tool endpoint |
| Three loops of data flow | Three loops of data flow (now with `### Terminal input and output`, `### Metadata`, `### The conductor loop`) |
| The packages | The packages |
| Your `other` machines | Other machines |
| Explore | Explore |

No inbound link pointed at any renamed heading (`.waterfall/anchors.md` lists only `#talking-over-the-wire`, which is kept). The page's outbound link to `/deployment#allow-a-reverse-proxy-origin` is unchanged.

Asides: four → two (the deploy tip and the origin-gate caution), each under 50 words.

## Moved

- That kolu-server delivers the agents to each host, reading a content-addressed build and having the host pull it from the cache → `agents` (that page's subject; two sentences and a link remain here). The internals of the delivery (the Nix routes, `plugin.json` profiles built with `lib.mkProfile`, the closure helpers) are not moved: they are cut as implementation, listed below.
- Nothing was moved to `deployment`. Checked `deployment.mdx` as it stands: it owns the binary cache a reader enables ("First run compiling? Enable the binary cache"), and the closure-publishing internals this page carried are not there and are cut as implementation.

## Cut

| Fact | Tag |
| --- | --- |
| padi "grew up" in-process inside kolu-server and moved out behind a unix socket | history |
| The version handshake's tiny side channel, and that a build-only redeploy converges the same way | implementation |
| "A genuinely incompatible pty-host contract requires a destructive recycle" (the table row keeps contract-skewed kaval being recycled) | implementation |
| Every change to the framework ships with drishti's tests green | implementation |
| Why kolu-server's membership list is a field in its config store, distinct from daemon state | implementation |
| A wake due while the process was down is not lost, and a delivered one does not ring twice | duplicate (`conductor`) |
| The volatility-boundary argument, "the dependency arrow pointing out" as a thesis, `electricity` phrasing | rationale (one clause kept) |
| Why `conductor` is a face kolu mounts rather than a wing of the web server; "on ACP's clock" | rationale |
| `kolu tui` reserved for a later face; `surfaceFace.ts` mounts `@kolu/surface-cli`'s projection | implementation |
| Why `padi-client` is split out (packages copied whole by repos consuming kolu from a pin) | implementation |
| `acp` being a leaf "by construction", machine-checked, vendorable by olai | implementation |
| `AgentVocab` / `AgentPlugin` member lists | implementation |
| The agent-distro paragraph's internals: `readPublishedClosure`, `pullClosure`, `closureRoute`, `deliverClosure`, the Nix 2.17–2.34 and 2.35 lines, `--list --json`, the versions file, `current` | moved to `agents` / `deployment`, and implementation |
| CI publishing closures (`nix-cache.yml`, `publish-closures`, `publish-closure`) and the dial's route order | duplicate (`deployment`) |
| The manifest separating what the flake exposes from what it proves | implementation |
| `hosts` resource as the live roster for the Conductor's fleet tools | duplicate (`mcp`, `conductor`) |
| The Conductor never sitting in a blocking tool call; unbounded waits not served on that face | duplicate (`conductor`, `mcp`) |
| "Partitioned so nothing is lost or double-painted"; kaval bounding a viewer's queue by snapshot cost; `overflow` carried "since contract 5.0" | implementation (the behaviour and the `overflow` frame are kept) |
| ssh's own dead-peer check beside the remote probe; "a busy-but-running daemon keeps its connection, one that exits is noticed at once" | implementation |
| "Adding a new agent is one adapter here; adding a new forge is one adapter here" | implementation |
| Why the loopback endpoint is not a route on the app listener ("entangling them would make the browser's origin gate…") | rationale (the fact that it is separate is kept) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 30 missing.

| Span | Where it went |
| --- | --- |
| `folder`, `other` | heading words only; both headings renamed to plain English |
| `hosts` | cut, duplicate (`mcp`) |
| `kolu surface`, `surfaceFace.ts`, `@kolu/surface-cli`, `kolu tui` | cut, implementation (the `kolu` binary's verbs are kept) |
| `./attention`, `./attach` | cut, implementation (named in plain words in the `padi-client` row) |
| `_core` | cut, implementation (the hazards are summarised in the `xterm-kit` row) |
| `screen_image` | cut, implementation; the tool lives on `mcp` |
| `AgentVocab`, `AgentPlugin`, `Leg`, `effect` | cut, implementation |
| `@juspay/agent-distro`, `@odu/*`, `plugin.json`, `lib.mkProfile`, `--list --json`, `current` | cut, implementation (checked `deployment.mdx`: none of these appear there) |
| `readPublishedClosure`, `pullClosure`, `closureRoute`, `deliverClosure`, `@kolu/surface-remote`, `nix` | cut, implementation (checked `deployment.mdx`: not there; a reader does not act on these) |
| `nix-cache.yml`, `publish-closures`, `publish-closure` | cut, implementation (`deployment` "First run compiling? Enable the binary cache" owns the cache a reader uses, without these names) |
