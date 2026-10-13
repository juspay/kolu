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
profile's dir, `bin` and store hash), the **profiles listing** (every profile
this build knows, and the state directory a host keeps its `current` under —
agent-distro's own `stateDirectory`, against a placeholder home padi makes
concrete), the **delivery** kolu-server reads (upstream's flake, its one binary
cache — `lib.cache` — and its schedule, `lib.schedule`; the floor arm only) and
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
  field of `agent-distro --list --json`, read as `{ name, description,
  origin }` (upstream's `source` is left to upstream), and its parser `parseProfileInEffect` — `undefined` for a
  bundle older than profile references, a throw for output out of format.
  padi asks it once per terminal; kolu never re-derives it.
- `./profileFile` — a bundle's `share/agent-distro/profile.json` (`{ name,
  description }`, upstream's `ProfileFile`) and its parser.
- `./bake` — the two files the Nix half bakes besides the floor, their
  schemas and parsers: the profiles listing (`KOLU_AGENT_DISTRO_PROFILES`,
  `parseAgentDistroProfiles`, read by padi) and the delivery
  (`KOLU_AGENT_DISTRO_DELIVERY`, `parseAgentDistroDelivery`: flake, cache URL
  and key, schedule — read by kolu-server, which delivers every host's agents).
- `./schedule` — upstream's update schedule (`UpdaterScheduleSchema`:
  `periodSeconds`, `offsetSeconds`, from `lib.schedule`: 02/08/14/20 UTC), the
  due rule (a line-for-line mirror of upstream's `updateDue`, golden-tested
  against its numbers), the next boundary, upstream's retry numbers for a
  failed scheduled run (`scheduledAskNow`, `attemptStarted`/`attemptEnded`),
  and the `last-success` stamp's file and reader. kolu-server's delivery timer
  runs on it.
- `./history` — upstream's `history.log` (`<time> <profile> <event>`, the
  event `updated:` / `skipped:` / `failed:`), its parser AND its writer
  (`historyLine`, `historyTimestamp`: upstream's own format, which padi
  appends to when a delivery lands, so a host that also runs agent-distro's
  Home Manager module keeps one log), the `AgentUpdateEvent` and
  `AgentUpdateRun` schemas (a run's words carry their author, `by`:
  `AgentUpdateAuthor`: `delivery`, `padi`, or for a log line `historyAuthor`'s
  answer by its kind — `agent-distro` for `skipped:`/`failed:`, which only
  upstream's updater writes, `log` for `updated:` and the stamp, which either
  may), `SAME_RUN_MS`, and the last run read off the log and the stamp
  (`lastRunOf`).
- `./versions` — a bundle's `share/agent-distro/versions`
  (`name\ttitle\tversion` per harness) and its parser — what Settings lists
  for a profile and what a host's receipt names, so the two say the same — and
  `bundleChanges`, what changed between two bundles in upstream's words
  (`Claude Code 2.0.1 → 2.0.3, Pi added 0.4`), for the history line.
- `./manifest` — the floor manifest's schema, where it sits and its parser,
  and `DEFAULT_AGENT_PROFILE` (from `defaults.json`: the bundle listed first,
  which kolu's default Agents profile — a reference — rides). Readers find each
  profile's directory through it, never through a layout of their own.
- `./schema` — the value schemas that cross the padi wire for agent-distro,
  defined once: `AgentDistroSetting` (what kolu-server pushes; kolu-common's
  preference field is this schema), `AgentDistroDeliveryReport` (what
  kolu-server tells a padi about a delivery to its host: `delivering` ·
  `landed` · `failed`), `AgentDistroStatus` (what padi reports — and what a new
  terminal there gets — and a failure's typed reason,
  `AgentDistroFailureReason`: `refused`, the host's Nix would not take the
  copied paths; `binderRefused`, the Nix of the machine running kolu would not
  take the bundle from agent-distro's cache to pass on; or `delivery`, anything
  else — and a ready host's `delivering`, set while a newer set is on its way
  and the old one keeps serving; no byte counts), their defaults and equality, and
  `TerminalAgents` (the one `agents` field a terminal record is stamped with),
  with its optional `effective` (the profile in effect, `./inEffect`),
  `bundleProfileOf` (the bundle a profile rides: its own when the build ships
  one by that name, else the default bundle, `DEFAULT_AGENT_PROFILE`; every terminal
  gets the setting's profile as `AI_PROFILE`), `AgentDistroResolved` (whether
  the setting's profile resolves on a host: `none` · `pending` · `resolved`
  with agent-distro's name and description · `failed` with its own words),
  and `AgentDistroReceipt` (what a host keeps of its deliveries: the serving
  bundle's versions, the last run, the last five events, and `error` when the host's files
  would not read).
  padi-client DECLARES the cells and record that carry them; padi, kolu-common,
  the server and the client import the values from here.
- `./bundle` — agent-distro's bundle and state shape: a bundle's `bin/`, a
  profile's `current` link, a store path's short hash, and making a state
  path concrete for a host's state home (`concreteStatePath`).
- `./status` — how a host's status shows, and every word kolu says about it:
  the one fenced fold from status to the host tab's mark (`agentMarkOf`); its
  words (`agentMarkLabel`, its hover and accessible name), with a failed delivery's cause, remedy and when kolu tries
  again worded once (`agentFailureLines`, `agentFailureRemedy`,
  `AGENTS_REFUSED_MEANS`, `AGENTS_REFUSED_FIX`, `AGENTS_BINDER_REFUSED_MEANS`,
  `AGENTS_BINDER_REFUSED_FIX`, `AGENTS_DELIVERY_AGAIN`); the
  stored preference — `null` until someone chooses — and
  the one fold from it to the setting new terminals get (`agentDistroSettingOf`,
  `agentsChosen`; nothing chosen is off on `DEFAULT_AGENT_PROFILE`, the bundle
  kolu lists first), the one whole-value writer behind the Agents switch and its
  picker (`agentDistroChoice`) and the first-run step's done-predicate and words
  (`firstRunAgentsDone`, its title `AGENTS_FIRST_RUN_TITLE`, its done line
  `agentsChosenLabel` — a NAME, never a reference); how a profile is named
  (`agentProfileTitle`: a shipped bundle capitalized, `JUSPAY_PROFILE` as
  "Juspay", anything else as itself); the picker's cards and the one it selects
  (`agentProfileCards`, `agentSelectedCard`, with `AGENTS_CUSTOM`'s own words
  and `JUSPAY_DESCRIPTION` — kolu's naming of a reference it does not ship);
  the off hint (`agentsHint`) and the welcome step's line (`agentsStepHint`);
  Custom…'s suggestions and memory (`profileSuggestions`, `rememberProfile`, at
  most `RECENT_PROFILES_CAP`), the line under its field — pending, resolved or
  agent-distro's own words (`agentsResolvedLine`, with
  `AGENTS_UNRESOLVED_MEANS`) — and what the picker brings, as chips
  (`agentChips`, with `AGENTS_REPO_OVERRIDES`); the tile pill's profile and
  hover (`agentChipProfile`, `agentChipLabel`: the profile in effect and where
  agent-distro resolved it from, else the setting's); Settings' ONE fleet line,
  one group per agent state, naming machines before it counts them
  (`agentFleetSummary`); what a machine's host details say about its agents —
  profile and short hash, state with its last run, a failure's cause and what it
  means there, whether that failure has a fix in a machine's Nix settings
  (`hasFix`, which earns the docs link), that machine's events, and whether
  its one action — check for newer agents, also how a failed machine is tried
  again — is offered (`canCheck`: not while a delivery runs there)
  (`agentHostDetail`, with `AGENTS_HOST_CHECK`); whether a
  terminal's agents went stale and what its restart does (`agentStalenessOf`,
  `agentRestartReady`, `agentRestartAction`, `agentStaleLabel`,
  `restartedLabel`); keeping it current — the fleet-wide palette command
  (`AGENTS_CHECK_NOW`, `agentUpdateCheckable`, `agentHostCheckable`,
  `agentCheckFailed`) and when an update has landed on a
  host (`landedFacts`, `updateLanded`); and the setting's own toasts
  (`agentToast`, with `updated` quoting the history line) — typed against `./schema`, so a field added to the wire
  is one the folds must handle.
- `./testing` — test support only: `bundleFiles` (a profile bundle's
  `profile.json` and `versions`, written as upstream writes them, at the paths
  `./profileFile` and `./versions` name), `readFrom` (a `readText` over
  them) and `standInListJson` (a stand-in picker's `--list --json`, which
  fails as upstream does for a profile containing `nobody`). Every test that
  fakes a bundle — this package's, padi's, kolu-server's boot read, the e2e
  fixture — goes through it.
- `./solid` — agent-distro's logo (`doc/logo.svg`, vendored byte-identical from
  the npins pin) and the one `AgentDistroLogo` component that draws it.

**What does not: anything that runs in a process.** Reading the floor's files
(kolu-server's `agentDistroListing.ts`), delivering bundles to every host
(kolu-server's `src/agentDelivery/`), landing them and resolving profiles on a
host (padi's `src/agentDistro/`), pushing the setting (kolu-server's
`padiCellPusher.ts`) and the Settings and tile components (the client) stay
where they run and import from here. This package imports nothing from padi, the
server or the client, and depends only on `effect` and `solid-js` (for the
logo). Because `@kolu/padi-client` depends on it, it is in the closure an
out-of-repo consumer vendors with padi-client, so its versions are literal.

User docs: [kolu.dev/agents](https://kolu.dev/agents).
