# @kolu/agent-distro

kolu's contract with upstream [agent-distro](https://github.com/juspay/agent-distro)
— the facts about agent-distro that kolu relies on, written once so every kolu
process that touches agent-distro reads them from the same place.

**What belongs here: the upstream contract — both halves, build and runtime.**

The **Nix half**, `default.nix` (imported by the root `default.nix`): builds the
local floor of every profile with agent-distro's own Nix library, writes its
**manifest** (`share/kolu/agent-distro.json`: the default profile, the picker,
each profile's dir, `bin` and store hash), the per-profile updater configs and
the plugin dir; `bakeArgs { floor }` bakes them onto a wrapper and
`proof { floor }` is the build-time check every wrapper runs on what it baked.
The default profile is typed once, in `defaults.json`, which both halves read.

The **TypeScript half**, as data and pure functions:

- `./listing` — what `agent-distro --list --json` prints (profiles, harnesses,
  `profiles[0]` the default) and its parser; kolu's `available | unavailable`
  listing value.
- `./progress` — the updater's `--progress` stdout protocol
  (`{progress:{done,total}}` lines, then one `{result:…}`), its parser and types.
- `./manifest` — the floor manifest's schema, where it sits and its parser,
  and `DEFAULT_AGENT_PROFILE` (from `defaults.json`). Readers find the picker
  and each profile's directory through it, never through a layout of their own.
- `./schema` — the value schemas that cross the padi wire for agent-distro,
  defined once: `AgentDistroSetting` (what kolu-server pushes; kolu-common's
  preference field is this schema), `AgentDistroStatus` (what padi reports, with
  its progress), their defaults and equality. padi-client DECLARES the cells
  that carry them; padi, kolu-common, the server and the client import the
  values from here.
- `./bundle` — agent-distro's bundle and state shape: a bundle's `bin/`, the
  updater's `current` link, a store path's short hash, and making
  `lib.mkUpdater`'s config concrete for a host's state home.
- `./status` — how a host's status shows: the one fenced fold from status to
  the host tab's mark treatment (`agentMarkOf`), its words, the Settings hint,
  the per-host status lines with their collapse rule, and whether a terminal's
  agents went stale (`agentStalenessOf`, `agentRestartReady`, `agentStaleLabel`)
  — typed against `./schema`, so a field added to the wire is one the folds
  must handle.
- `./solid` — agent-distro's logo (`doc/logo.svg`, vendored byte-identical from
  the npins pin) and the one `AgentDistroLogo` component that draws it.

**What does not: anything that runs in a process.** Spawning the picker
(kolu-server's `agentDistroListing.ts`), resolving and downloading bundles on a
host (padi's `src/agentDistro/`), pushing the setting (kolu-server's
`padiCellPusher.ts`) and the Settings and tile components (the client) stay
where they run and import from here. This package imports nothing from padi, the
server or the client, and depends only on `effect` (plus `solid-js` for the
logo). Because `@kolu/padi-client` depends on it, it is in the closure an
out-of-repo consumer vendors with padi-client, so its versions are literal.

User docs: [kolu.dev/agents](https://kolu.dev/agents).
