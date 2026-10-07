# @kolu/agent-distro

kolu's contract with upstream [agent-distro](https://github.com/juspay/agent-distro)
— the facts about agent-distro that kolu relies on, written once so every kolu
process that touches agent-distro reads them from the same place.

**What belongs here: the upstream contract, as data and pure functions.**

- `./listing` — what `agent-distro --list --json` prints (profiles, harnesses,
  `profiles[0]` the default) and its parser; kolu's `available | unavailable`
  listing value.
- `./progress` — the updater's `--progress` stdout protocol
  (`{progress:{done,total}}` lines, then one `{result:…}`), its parser and types.
- `./bundle` — the bundle and state layout: a bundle's `bin/`, the floor's
  `bin/agent-distro` and `profiles/<name>`, the updater's `current` link, a
  store path's short hash, and making `lib.mkUpdater`'s config concrete for a
  host's state home.
- `./status` — how a host's status shows: the one fenced fold from status to
  the host tab's mark treatment (`agentMarkOf`), its words, the Settings hint,
  the per-host status lines with their collapse rule, and whether a terminal's
  agents went stale (`agentStalenessOf`, `agentRestartReady`, `agentStaleLabel`)
  — over structural
  status/setting types (the wire schemas are `@kolu/padi-client`'s; the client
  pins that the two agree).
- `./solid` — agent-distro's logo (`doc/logo.svg`, vendored byte-identical from
  the npins pin) and the one `AgentDistroLogo` component that draws it.

**What does not: anything that runs in a process.** Spawning the picker
(kolu-server's `agentDistroListing.ts`), resolving and downloading bundles on a
host (padi's `src/agentDistro/`), pushing the setting (kolu-server's
`padiCellPusher.ts`), the Settings and tile components (the client), and the Nix
that builds the bundle (`nix/agent-distro.nix`) stay where they run and import
from here. This package imports nothing from padi, the server or the client.

User docs: [kolu.dev/agents](https://kolu.dev/agents).
