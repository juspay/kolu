/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a padi (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_STATE`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk FLOOR described the way `@kolu/agent-distro`'s Nix half describes the
 * real one — by its manifest, `share/kolu/agent-distro.json` (`{dir, bin}`),
 * which names agent-distro's ONE package, laid out as upstream's:
 *
 *     bin/claude                        execs the command a scenario left in the relay
 *                                       ({@link fixtureClaudeRelay}), else prints
 *                                       "agent-distro fixture: claude"
 *     bin/agent-distro                  the picker: prints "agent-distro picker fixture";
 *                                       with `--list --json`, upstream's shape — no profile
 *                                       in effect without `AI_PROFILE`, else the stand-in's;
 *                                       with `--models claude`, {@link FIXTURE_MODELS}
 *     share/agent-distro/versions       its harnesses (kolu-server and padi read it)
 *     share/agent-distro/answers        the flags its picker answers, as upstream
 *                                       writes them ({@link STAND_IN_ANSWERS}) — the
 *                                       file a package older than `--models` has not
 *                                       got, which {@link ageOutFixturePackage} takes
 *                                       away for the one scenario about that skew
 *
 * The real package is gigabytes of compiled harnesses; what the e2e lane proves
 * is kolu's half — Settings writes the switch and the profile list, the next
 * terminal (not the current one) gets the package's `claude` first on its PATH
 * and wears its pill, and off removes both. The Nix build proves the real
 * manifest's entries exist.
 *
 * There is no DELIVERY bake (`KOLU_AGENT_DISTRO_DELIVERY`): delivering needs
 * agent-distro's published index and binary cache, so the suite's kolu-server
 * builds and delivers nothing. With an empty profile list this machine serves
 * the floor; with any profile in the list padi has no set for that stack
 * (`undelivered`) and new terminals get no agents. Profile delivery is
 * unit-tested where it lives (kolu-server's `agentDelivery/`, padi's
 * `agentDistro/`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AgentModels,
  PACKAGE_ANSWERS_FILE,
} from "@kolu/agent-distro/models";
import {
  packageFiles,
  STAND_IN_ANSWERS,
  STAND_IN_PROFILE,
  standInListJson,
  standInModels,
} from "@kolu/agent-distro/testing";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

/** The fixture's ONE harness, as its versions file names it — steps read the
 *  chips kolu draws off this (`agentChips`), never a hand-typed copy. */
export const FIXTURE_HARNESS = {
  name: "claude",
  title: "Claude Code",
  version: "0.0.0",
} as const;

/** The fixture package's listing, as kolu-server reads it off the floor. */
export const FIXTURE_LISTING = {
  kind: "available",
  harnesses: [FIXTURE_HARNESS],
} as const;

/** What the stub picker answers for `--models claude` — the shape upstream's
 *  own parser reads, for the one harness this floor carries: Claude Code
 *  cannot list its models, and takes one with `--model`. So kolu builds a
 *  waterfall agent's command as `claude --model <whatever was chosen>`, and
 *  any model id the setup names is accepted. */
export const FIXTURE_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: { kind: "unlisted" },
};

/** What the package's stub `claude` prints when no scenario left it a command
 *  to run — the step that runs it waits for this, and it is never typed (the
 *  command is just `claude`). */
export const FIXTURE_CLAUDE_SAYS = "agent-distro fixture: claude";

/** What the stub picker (`agent-distro`) prints: one plain line, as a command
 *  for people does. Not a substring of {@link FIXTURE_CLAUDE_SAYS}, nor it of
 *  this, so neither run can satisfy the other's wait. */
export const FIXTURE_PICKER_SAYS = "agent-distro picker fixture";

/** The profile the stand-in `--list --json` reports in effect for a non-empty
 *  `AI_PROFILE` (shared with padi's unit tests). */
export const FIXTURE_STACK_PROFILE = STAND_IN_PROFILE;

/** Every fixture path carries this, so a step can tell a fixture agent on the
 *  PATH from anything else. */
export const FIXTURE_MARK = "kolu-e2e-agent-distro";

/** The fixture's update log, relative to the host's state home — upstream's
 *  `history.log`, which padi reads the receipt off. */
const HISTORY_LOG = `${FIXTURE_MARK}/history.log`;

/** The fixture's update log on a host whose state home is `stateHome` — where
 *  a step seeds a line in upstream's format. */
export function fixtureHistoryLog(stateHome: string): string {
  return path.join(stateHome, HISTORY_LOG);
}

/** The floor package's own `share/agent-distro/answers` — where the package
 *  says which flags its picker takes. */
function answersFile(): string {
  const { KOLU_AGENT_DISTRO_BUNDLE: root } = agentDistroFixtureEnv();
  if (root === undefined)
    throw new Error("the agent-distro fixture was built without a bundle");
  return path.join(root, "package", PACKAGE_ANSWERS_FILE);
}

/** THE FLOOR AS A PACKAGE OLDER THAN THIS KOLU: take its `answers` away, so
 *  it is one that predates `--models` — the state every host whose delivered
 *  agents are behind the kolu talking to them is in. Arranged BEFORE Agents
 *  is turned on, because padi reads the file when it settles the status it
 *  publishes. The worker's floor is shared, so whoever ages it out puts it
 *  back ({@link restoreFixturePackage}). */
export function ageOutFixturePackage(): void {
  fs.rmSync(answersFile(), { force: true });
}

/** The floor as this kolu builds it again — idempotent, so an After hook may
 *  call it for a scenario that never aged anything out. */
export function restoreFixturePackage(): void {
  fs.writeFileSync(answersFile(), STAND_IN_ANSWERS);
}

let memo: Record<string, string> | undefined;
let relay: string | undefined;

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

/** Build the fixture once (per worker) and return the env that bakes it. */
export function agentDistroFixtureEnv(): Record<string, string> {
  memo ??= buildFixture();
  return memo;
}

/** WHERE A SCENARIO LEAVES THE AGENT IT WANTS RUN. kolu builds a waterfall
 *  agent's command itself now — `claude --model <model>` off the work's
 *  setup — so a scenario can no longer hand its own stand-in binary to
 *  `lifecycle_create`. It writes that command here instead: the floor's
 *  `claude` execs this file's one line when it is there (and removes it, so
 *  it serves exactly one run), and prints {@link FIXTURE_CLAUDE_SAYS} when it
 *  is not. Per worker, beside the floor it belongs to. */
export function fixtureClaudeRelay(): string {
  agentDistroFixtureEnv();
  if (relay === undefined)
    throw new Error("the agent-distro fixture was built without a relay path");
  return relay;
}

function buildFixture(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_MARK}-`));
  // The ONE package, as upstream builds it.
  const dir = path.join(root, "package");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  relay = path.join(root, "claude-relay");
  // `claude`, as a scenario needs it: the command left in the relay REPLACES
  // this process (so `/proc/<pid>/comm` reads the stand-in agent's own name,
  // which is what agent detection reads), and the relay is spent.
  script(
    path.join(bin, "claude"),
    [
      `relay=${JSON.stringify(relay)}`,
      'if [ -f "$relay" ]; then',
      '  command=$(cat "$relay")',
      '  rm -f "$relay"',
      '  exec /bin/sh -c "exec $command"',
      "fi",
      `echo "${FIXTURE_CLAUDE_SAYS}"`,
    ].join("\n"),
  );
  // The picker, as the package carries it: a command for people, which kolu
  // asks for the profile in effect and for a harness's models.
  script(
    path.join(bin, "agent-distro"),
    [
      standInListJson([FIXTURE_HARNESS]),
      standInModels({ [FIXTURE_HARNESS.name]: FIXTURE_MODELS }),
      `echo "${FIXTURE_PICKER_SAYS}"`,
    ].join("\n"),
  );
  for (const [file, text] of Object.entries(
    packageFiles(dir, [FIXTURE_HARNESS]),
  )) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  // WHAT THE PACKAGE SAYS IT ANSWERS, as upstream's own package does — the
  // file kolu reads to know it may ask this package for a harness's models.
  fs.writeFileSync(path.join(dir, PACKAGE_ANSWERS_FILE), STAND_IN_ANSWERS);
  // The host state, as the Nix half writes it: every path under the
  // placeholder home padi makes concrete on its host.
  const state = path.join(root, "state.json");
  fs.writeFileSync(
    state,
    JSON.stringify({
      stateHomePlaceholder: PLACEHOLDER,
      state: `${PLACEHOLDER}/${FIXTURE_MARK}/state`,
      history: `${PLACEHOLDER}/${HISTORY_LOG}`,
      landed: `${PLACEHOLDER}/${FIXTURE_MARK}/landed.json`,
    }),
  );
  // The manifest — the only thing about the floor's shape kolu reads.
  fs.mkdirSync(path.join(root, "share", "kolu"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "share", "kolu", "agent-distro.json"),
    JSON.stringify({ dir, bin }),
  );
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.json"), '{"name":"kolu"}');
  return {
    KOLU_AGENT_DISTRO_BUNDLE: root,
    KOLU_AGENT_DISTRO_STATE: state,
    KOLU_AGENT_PLUGIN_DIR: plugin,
  };
}
