# @kolu/agent-distro

kolu's contract with upstream [agent-distro](https://github.com/juspay/agent-distro)
— the facts about agent-distro that kolu relies on, written once so every kolu
process that touches agent-distro reads them from the same place.

agent-distro is ONE package — every harness launcher and its picker,
`bin/agent-distro` — and **profiles** are not part of it: each is an
`agent-distro.nix` that upstream's `lib.mkProfile` builds into a store path a
launch reads from `AI_PROFILE` (a whitespace-separated stack, bottom to top),
with a repository's own `agent-distro.nix` composed over it. kolu models
exactly that: the Agents setting is a switch for the harnesses and, separate
from it, an ordered list of profile references. There is no bundle of the two.

**What belongs here: the upstream contract — both halves, build and runtime.**

The **Nix half**, `default.nix` (imported by the root `default.nix`): builds the
local floor — the package as upstream builds it (`mkLaunchers`), with its
picker in `bin/` (kolu bakes no picker of its own) — and writes its
**manifest** (`share/kolu/agent-distro.json`: `{ dir, bin }`), the **host
state** (`KOLU_AGENT_DISTRO_STATE`: the package's state directory —
agent-distro's own `stateDirectory` for its one package — the history log and
kolu's record of the set that landed, against a placeholder home padi makes
concrete), the **delivery** kolu-server reads (upstream's flake —
`github:<lib.caIndex.repo>` — its content-addressed index base,
`lib.caIndex.rawBase`, its one binary cache's URL and key, `lib.cache`, and its
schedule, `lib.schedule`; the floor arm only) and the plugin dir;
`bakeArgs { floor }` bakes them onto a wrapper and `proof { floor }` is the
build-time check every wrapper runs on what it baked — on the floor it runs
kolu-server's own boot read of the package (`readListing`, a command the root
`default.nix` builds) and checks every harness it names has a launcher.

Upstream's own **vocabulary** — the due rule and the scheduled run's numbers,
the history line's writer and reader, the versions file and `changes()`, the
`--list --json` value and its words — is imported, never repeated: upstream's
runtime tree (`src/`) names itself `@juspay/agent-distro`, and kolu grafts it
from the npins pin as a workspace member (`nix/workspace.nix`, the `@odu/*`
mechanism). This package depends on it.

The **TypeScript half**, as data and pure functions:

- `./listing` — the harnesses kolu offers, as the package describes them
  (`share/agent-distro/versions`, read with upstream's `parseVersions`):
  `floorListing`; kolu's `available | unavailable` listing value and
  `AgentVersionSchema`. kolu never runs the picker for information.
- `./inEffect` — the profile in effect for a launch, upstream's `profile`
  field of `agent-distro --list --json`, read with upstream's `parseListing`
  and named with its `nameText` / `sourceText` (`juspay + my-repo`, `from
  ./agent-distro.nix over AI_PROFILE=…`): `parseProfileInEffect`, `undefined`
  when none is in effect, a throw for output out of format. padi asks it once
  per terminal; kolu never re-derives it.
- `./profileFile` — a BUILT profile's `share/agent-distro/profile.json` (its
  name and description; the fields a launch reads are upstream's) and its
  parser. kolu-server reads it off each profile it builds.
- `./landing` — what kolu delivers to a host: `DeliveredProfile` (reference,
  name, locked revision, store path) and `DeliveredSet` (the package and its
  profiles, in stack order — padi's `landed.json`), `sameStack`, and
  `deliveryChanges`, the history log's words for a landing in upstream's idiom
  (`changes()` for the package, extended for profiles: `juspay a1b2c3d →
  d4e5f6a`, `ekala added 9f8e7d6`, `profiles reordered: …`).
- `./receipt` — the history log read back (`recentEvents`, through upstream's
  `parseHistory`, which also reads lines written before upstream's
  one-package release), the `AgentUpdateEvent` and `AgentUpdateRun` schemas (a
  run's words carry their author, `by`: `delivery`, `padi`, or for a log line
  `historyAuthor`'s answer by its kind), `SAME_RUN_MS`, and the last run read
  off the log and the stamp (`lastRunOf`).
- `./bake` — the two files the Nix half bakes besides the floor, their schemas
  and parsers: the host state (`parseAgentDistroHostState`, read by padi) and
  the delivery (`parseAgentDistroDelivery`: flake, index base, cache URL and
  key, `UpdaterScheduleSchema` — read by kolu-server, which delivers every
  host's agents).
- `./manifest` — the floor manifest's schema, where it sits and its parser.
- `./schema` — the value schemas that cross the wire for agent-distro,
  defined once: `AgentDistroSetting` (`{ enabled, profiles }` — what
  kolu-server pushes; kolu-common's preference field is this schema),
  `AgentDistroDeliveryReport` (what kolu-server tells a padi about a delivery:
  `delivering` · `landed` with the package and the built profiles · `failed`
  with its cause in kolu-server's words, each naming the stack it is about),
  `AgentDistroStatus` (what padi reports — and what a new terminal there gets:
  a set serves only while it is the setting's stack), `AgentProfiles` (whether
  each profile of the setting builds — kolu-server's `agentProfiles` cell),
  `AgentDistroReceipt` (what a host keeps of its deliveries: the serving
  package's versions, the profiles that landed with it, the last run, the last
  five events, and `error` when the host's files would not read), their
  defaults and equality, and `TerminalAgents` (the one `agents` field a
  terminal record is stamped with: the package, the built profiles exported as
  `AI_PROFILE`, and the profile in effect, `./inEffect`). padi-client and
  kolu-common DECLARE the cells and records that carry them; padi, the server
  and the client import the values from here.
- `./bundle` — agent-distro's package and state shape: its `bin/` and versions
  file, the `current` link and `last-success` stamp, a store path's short hash,
  and making a state path concrete for a host's state home
  (`concreteStatePath`).
- `./status` — how a host's status shows, and every word kolu says about it:
  the one fenced fold from status to the host tab's mark (`agentMarkOf`) and
  its words (`agentMarkLabel`), a failed delivery's cause and when kolu tries
  again (`agentFailureLines`, `AGENTS_DELIVERY_AGAIN`); the stored preference —
  `null` until someone chooses — and the one fold from it to the setting new
  terminals get (`agentDistroSettingOf`, `agentsChosen`), the one whole-value
  writer behind the switch and the profile list (`agentDistroChoice`) and the
  list's edits (`profilesWithAdded`, `profilesWithRemoved`,
  `profilesWithMoved`); the list's rows and the line under each — pending,
  what it built to, or its own words (`agentProfileRows`,
  `agentsResolvedLine`, `AGENTS_UNRESOLVED_MEANS`), the Juspay entry
  (`JUSPAY_OFFER`, `juspayOffered`) and the fine print (`AGENTS_PROFILES_MEAN`);
  the add field's suggestions and memory (`profileSuggestions`,
  `rememberProfiles`); the first-run step's done-predicate and words
  (`firstRunAgentsDone`, `AGENTS_FIRST_RUN_TITLE`, `agentsChosenLabel`); the
  harness chips (`agentChips`), the off hint (`agentsHint`) and the welcome
  step's line (`agentsStepHint`); Settings' ONE fleet line
  (`agentFleetSummary`) and what a machine's host details say about its agents
  (`agentHostDetail`, with `AGENTS_HOST_CHECK`); whether a terminal's agents
  went stale and what its restart does (`agentStalenessOf`,
  `agentRestartReady`, `agentRestartAction`, `agentStaleLabel`,
  `restartedLabel`); the tile pill's words (`agentChipProfile`,
  `agentChipLabel`); keeping it current (`AGENTS_CHECK_NOW`,
  `agentCheckFailed`, `landedFacts`, `updateLanded`); and the setting's own
  toasts (`agentToast`) — typed against `./schema`, so a field added to the
  wire is one the folds must handle.
- `./testing` — test support only: `packageFiles` (the package's versions
  file), `builtProfileFiles` (a built profile's `profile.json`), `readFrom` (a
  `readText` over them) and `standInListJson` (a stand-in picker's
  `--list --json`, upstream's shape). Every test that fakes a package or a
  profile — this package's, padi's, kolu-server's boot read, the e2e fixture —
  goes through it.
- `./solid` — agent-distro's logo (`doc/logo.svg`, vendored byte-identical from
  the npins pin) and the one `AgentDistroLogo` component that draws it.

**What does not: anything that runs in a process.** Reading the floor's files
(kolu-server's `agentDistroListing.ts`), locking, building and delivering every
host's set (kolu-server's `src/agentDelivery/`), landing it on a host (padi's
`src/agentDistro/`), pushing the setting (kolu-server's `padiCellPusher.ts`)
and the Settings and tile components (the client) stay where they run and
import from here. This package imports nothing from padi, the server or the
client, and depends only on `effect`, upstream's vocabulary and `solid-js` (for
the logo). Because `@kolu/padi-client` depends on it, it is in the closure an
out-of-repo consumer vendors with padi-client, so its versions are literal.

User docs: [kolu.dev/agents](https://kolu.dev/agents).
