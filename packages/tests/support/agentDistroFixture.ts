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
  type StandInModels,
  standInModels,
} from "@kolu/agent-distro/testing";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

export const FIXTURE_HARNESS = {
  name: "claude",
  title: "Claude Code",
  version: "0.0.0",
} as const;

export const FIXTURE_LISTING = {
  kind: "available",
  harnesses: [FIXTURE_HARNESS],
} as const;

export const FIXTURE_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: { kind: "unlisted" },
};

export const FIXTURE_CLAUDE_SAYS = "agent-distro fixture: claude";

export const FIXTURE_PICKER_SAYS = "agent-distro picker fixture";

export const FIXTURE_STACK_PROFILE = STAND_IN_PROFILE;

export const FIXTURE_MARK = "kolu-e2e-agent-distro";

const HISTORY_LOG = `${FIXTURE_MARK}/history.log`;

export function fixtureHistoryLog(stateHome: string): string {
  return path.join(stateHome, HISTORY_LOG);
}

function fixtureFile(...parts: readonly string[]): string {
  const { KOLU_AGENT_DISTRO_BUNDLE: root } = agentDistroFixtureEnv();
  if (root === undefined)
    throw new Error("the agent-distro fixture was built without a bundle");
  return path.join(root, ...parts);
}

const answersFile = (): string => fixtureFile("package", PACKAGE_ANSWERS_FILE);

export function ageOutFixturePackage(): void {
  fs.rmSync(answersFile(), { force: true });
}

export function restoreFixturePackage(): void {
  fs.writeFileSync(answersFile(), STAND_IN_ANSWERS);
  writePicker(FIXTURE_MODELS);
}

export const FIXTURE_LIST_FAILS =
  "agent-distro claude: error: cannot list its models: claude models exited 1: LITELLM_API_KEY is not set";

export function failFixtureModelList(): void {
  writePicker({ launch: FIXTURE_MODELS.launch, fails: FIXTURE_LIST_FAILS });
}

export function listFixtureModels(ids: ReadonlyArray<string>): void {
  writePicker({
    launch: FIXTURE_MODELS.launch,
    models: { kind: "listed", ids: [...ids] },
  });
}

let memo: Record<string, string> | undefined;
let relay: string | undefined;

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

function writePicker(
  answer: StandInModels,
  file = fixtureFile("package", "bin", "agent-distro"),
): void {
  script(
    file,
    [
      standInListJson([FIXTURE_HARNESS]),
      standInModels({ [FIXTURE_HARNESS.name]: answer }),
      `echo "${FIXTURE_PICKER_SAYS}"`,
    ].join("\n"),
  );
}

export function agentDistroFixtureEnv(): Record<string, string> {
  memo ??= buildFixture();
  return memo;
}

export function fixtureClaudeRelay(): string {
  agentDistroFixtureEnv();
  if (relay === undefined)
    throw new Error("the agent-distro fixture was built without a relay path");
  return relay;
}

function buildFixture(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_MARK}-`));
  const dir = path.join(root, "package");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  relay = path.join(root, "claude-relay");
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
  writePicker(FIXTURE_MODELS, path.join(bin, "agent-distro"));
  for (const [file, text] of Object.entries(
    packageFiles(dir, [FIXTURE_HARNESS]),
  )) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.writeFileSync(path.join(dir, PACKAGE_ANSWERS_FILE), STAND_IN_ANSWERS);
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
