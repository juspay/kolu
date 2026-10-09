# @kolu/agent-distro

kolu's contract with upstream [agent-distro](https://github.com/juspay/agent-distro)
— the facts about agent-distro that kolu relies on, written once so every kolu
process that touches agent-distro reads them from the same place.

**What belongs here: the upstream contract — both halves, build and runtime.**

The **Nix half**, `default.nix` (imported by the root `default.nix`): builds the
local floor of every profile with agent-distro's own Nix library — each
profile's bundle as upstream builds it, with its harness launchers and its own
picker, `bin/agent-distro`, in `bin/` (kolu bakes no picker of its own) — writes
its **manifest** (`share/kolu/agent-distro.json`: the default profile, and each
profile's dir, `bin` and store hash), the per-profile updater configs and
the plugin dir; `bakeArgs { floor }` bakes them onto a wrapper and
`proof { floor }` is the build-time check every wrapper runs on what it baked —
on the floor it runs kolu-server's own boot read of the profiles (`readListing`,
a command the root `default.nix` builds) and checks every harness it names has
a launcher, and every profile its picker.
The default profile is typed once, in `defaults.json`, which both halves read.

The **TypeScript half**, as data and pure functions:

- `./listing` — the profiles kolu offers, as their bundles describe
  themselves: `profileOfBundle`, the ONE composition of a profile (name,
  description, harnesses with versions) from its bundle's two files, and
  `floorListing`, every floor profile in the manifest's order (the default
  first); kolu's `available | unavailable` listing value. kolu never runs a
  picker for information: the picker is a command for people.
- `./inEffect` — the profile in effect for a launch, upstream's `profile`
  field of `agent-distro --list --json` (`{ name, description, source,
  origin }`, `source` one of `positional` · `repository` · `variable` ·
  `builtin`), and its parser `parseProfileInEffect` — `undefined` for a
  bundle older than profile references, a throw for output out of format.
  padi asks it once per terminal; kolu never re-derives it.
- `./profileFile` — a bundle's `share/agent-distro/profile.json` (`{ name,
  description }`, upstream's `ProfileFile`) and its parser.
- `./progress` — the updater's `--progress` stdout protocol
  (`{progress:{done,total}}` lines, then one `{result:…}`), its parser and
  types, and `updaterLastWord` (the cause from its stderr, without its
  `agent-distro:` prefix).
- `./schedule` — upstream's update schedule as the updater config carries it
  (`periodSeconds`, `offsetSeconds`: 02/08/14/20 UTC), the due rule (a
  line-for-line mirror of upstream's `updateDue`, golden-tested against its
  numbers), the next boundary, and the `last-success` stamp's file and reader.
- `./history` — the updater's `history.log` (`<time> <profile> <event>`, the
  event `updated:` / `skipped:` / `failed:` in its own words), its parser,
  the `AgentUpdateEvent` and `AgentUpdateRun` schemas (a run's words carry
  their author, `by`: `AgentUpdateAuthor`, the updater or padi), `SAME_RUN_MS`,
  and the last run read off the log and the stamp (`lastRunOf`).
- `./versions` — a bundle's `share/agent-distro/versions`
  (`name\ttitle\tversion` per harness) and its parser — what Settings lists
  for a profile and what a host's receipt names, so the two say the same.
- `./manifest` — the floor manifest's schema, where it sits and its parser,
  and `DEFAULT_AGENT_PROFILE` (from `defaults.json`). Readers find each
  profile's directory through it, never through a layout of their own.
- `./schema` — the value schemas that cross the padi wire for agent-distro,
  defined once: `AgentDistroSetting` (what kolu-server pushes; kolu-common's
  preference field is this schema), `AgentDistroStatus` (what padi reports —
  and what a new terminal there gets — with its progress, and a failure's typed
  reason, `AgentDistroFailureReason`), their defaults and equality, and
  `TerminalAgents` (the one `agents` field a terminal record is stamped with),
  with its optional `effective` (the profile in effect, `./inEffect`), the
  profile REFERENCE helpers (`isProfileReference` — the one test, a `/` or a
  `:` — `REFERENCE_BUNDLE_PROFILE` and `bundleProfileOf`: a reference rides
  the `vanilla` bundle with the reference as `AI_PROFILE`),
  and `AgentDistroReceipt` (what a host keeps of its updates: the serving
  bundle's versions, the last run, the last five events, `running` — every
  profile with a run in flight there — and `error` when the updater's files
  would not read).
  padi-client DECLARES the cells and record that carry them; padi, kolu-common,
  the server and the client import the values from here.
- `./bundle` — agent-distro's bundle and state shape: a bundle's `bin/`, the
  updater's `current` link, a store path's short hash, and making
  `lib.mkUpdater`'s config concrete for a host's state home.
- `./status` — how a host's status shows, and every word kolu says about it:
  the one fenced fold from status to the host tab's mark (`agentMarkOf`); its
  words (`agentMarkWords`, `agentMarkLabel`), which the hover, the download
  toasts and the Settings line share, with a failure's cause, remedy and retry
  worded once (`agentFailureLines`); the agents line with versions
  (`versionsLine`, which cuts each version's `+` suffix by upstream's
  picker's own display rule, so Settings, the receipt line and
  `agent-distro` agree); the moments a download is worth a toast
  (`downloadEdge`); the stored preference — `null` until someone chooses — and
  the one fold from it to the setting new terminals get (`agentDistroSettingOf`,
  `agentsChosen`), the one whole-value writer behind the Agents control
  (`agentDistroChoice`) and the first-run step's done-predicate and words
  (`firstRunAgentsDone`, its title `AGENTS_FIRST_RUN_TITLE`, its done line
  `agentsChosenLabel`); the Agents hint in its two
  layouts of one vocabulary — Settings' (`agentsHint`) and the welcome step's
  one-line-per-choice form (`agentsStepHint`); the segments,
  with which is pressed and where the keyboard rests (`agentsPressedSegment`,
  `agentsRestingSegment`), Custom (`AGENTS_CUSTOM`, Settings only) and the
  check its reference field makes (`profileReferenceProblem`); the tile
  pill's profile and hover (`agentChipProfile`, `agentChipLabel`: the profile
  in effect and where it came from, else the setting's); the per-host status lines
  with their collapse rule; a saved choice kolu does not ship
  (`unknownProfileOf`); whether a terminal's agents went stale and what its
  restart does (`agentStalenessOf`, `agentRestartReady`, `agentRestartAction`,
  `agentStaleLabel`, `restartedLabel`); keeping it current — the line's last
  run ("updated 3h ago"), the History rows (`agentUpdateHistoryRows`), Check
  now (`AGENTS_CHECK_NOW`, `agentUpdateCheckable`, `agentUpdateRunning`) and
  the `updated` moment of `downloadEdge`; and the setting's own toasts
  (`agentToast`, with `updated` quoting the updater) — typed against `./schema`, so a field added to the wire is one
  the folds must handle.
- `./testing` — test support only: `bundleFiles` (a profile bundle's
  `profile.json` and `versions`, written as upstream writes them, at the paths
  `./profileFile` and `./versions` name) and `readFrom` (a `readText` over
  them). Every test that fakes a bundle — this package's, kolu-server's boot
  read, the e2e fixture — goes through it.
- `./solid` — agent-distro's logo (`doc/logo.svg`, vendored byte-identical from
  the npins pin) and the one `AgentDistroLogo` component that draws it.

**What does not: anything that runs in a process.** Reading the floor's files
(kolu-server's `agentDistroListing.ts`), resolving and downloading bundles on a
host (padi's `src/agentDistro/`), pushing the setting (kolu-server's
`padiCellPusher.ts`) and the Settings and tile components (the client) stay
where they run and import from here. This package imports nothing from padi, the
server or the client, and depends only on `effect`, `@kolu/byte-units` (the
one byte formatter, for a download's bytes) and `solid-js` (for the logo). Because `@kolu/padi-client` depends on it, it is in the closure an
out-of-repo consumer vendors with padi-client, so its versions are literal.

User docs: [kolu.dev/agents](https://kolu.dev/agents).
