# deployment

- Kind: how-to. Reader: someone running kolu as a service on their own machine.
- Rewritten from: `f50641c6a`
- Words: 1,325 → 908 (target 1,000)
- Frontmatter: description reworded, 141 → 157 characters. No other key changed.

## Headings

No heading renamed. `First run compiling? Enable the binary cache` is kept
verbatim: `README.md`, three changelog lines, `quickstart`, `from-a-mac` and
`remote-hosts` link to its anchor. `#enable-the-service`,
`#bind-a-different-address`, `#allow-a-reverse-proxy-origin` and
`#capture-memory-diagnostics` are kept for the same reason. The binary-cache
section is now an intro plus `<Steps>`.

## Moved

- How agent binaries reach another machine (content-addressed vs signed copies,
  the Nix 2.35 split, `trusted-users` and the cache key, agent-distro's
  published index, the four-times-a-day refresh, aarch64 Linux having no
  pre-built set) → `agents`, which is the fact home. The page now carries two
  sentences and a link to `/agents` (its "When a delivery fails" and "Kept up
  to date" sections). Links point at the page, not its anchors, because that
  page is being rewritten in the same change.

## Cut

| Fact | Tag |
| --- | --- |
| CI boots the example flake's systemd configuration in a NixOS VM and builds its launchd activation package on macOS | implementation |
| `services.kolu.agentPackages` defaults come "from the module's flake" | implementation |
| "Nothing to warm, nothing to run before switching" | duplicate (the sentence before it says this) |
| Linger "is the opposite of a headless box" | rationale |
| Both log paths "work because a service manager owns the server's output" kept; the rest of that argument dropped | rationale |
| Agents shipping inside kolu itself on the machine running kolu, and the two systems the cache is filled for | moved to `agents` (delivery), duplicate of the cache paragraph here |
| "This machine's Nix trusts nothing for it" | implementation |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`. Six reported, none lost in
substance:

| Span | Where it went |
| --- | --- |
| `ignoring untrusted flake configuration setting 'extra-substituters'` | still on the page, as a fenced `text` block instead of an inline span |
| `nix.conf` | still on the page as `/etc/nix/nix.conf`; the bare mention of editing `nix.conf` was folded into the step |
| `sudo systemctl restart nix-daemon`, `sudo launchctl kickstart -k system/org.nixos.nix-daemon` | still on the page, verbatim, inside step 2 (the old spans were line-wrapped, so the comparison does not match them) |
| `nix profile install` | still on the page (the old span was line-wrapped) |
| `trusted-users` | cut here; it belongs to delivery, which lives on `agents` |
