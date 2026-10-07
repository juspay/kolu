/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a real kolu (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_UPDATER`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk bundle described the way `@kolu/agent-distro`'s Nix half describes the
 * real one — by its manifest, `share/kolu/agent-distro.json`, which names:
 *
 *     the picker                     prints a `--list --json` listing
 *     each profile's bin/claude      prints "agent-distro fixture: <name> claude"
 *     each profile's bin/agent-distro
 *
 * The real floor is gigabytes of compiled harnesses; what the e2e lane proves is
 * kolu's half — Settings lists the profiles, the next terminal (not the current
 * one) gets the chosen profile's `claude` first on its PATH and wears its chip,
 * and off removes both. The Nix build proves the real manifest's entries exist.
 *
 * The updater configs point at a state dir that never exists and an updater that
 * is never run (the floor is always there), so `current` never shadows the floor.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
export const FIXTURE_PROFILES = ["vanilla", "juspay"] as const;

/** The fixture's ONE harness, as its listing names it — steps read the line
 *  Settings shows off this (`harnessLine`), never a hand-typed copy. */
export const FIXTURE_HARNESS = {
  name: "claude",
  title: "Claude Code",
  tagline: "fixture",
  version: "0.0.0",
} as const;

/** A fixture profile, as the picker lists it. */
export function fixtureProfile(name: string): {
  name: string;
  description: string;
  harnesses: (typeof FIXTURE_HARNESS)[];
} {
  return {
    name,
    description: `Fixture profile ${name}`,
    harnesses: [FIXTURE_HARNESS],
  };
}

/** What a profile's stub `claude` prints — the step that runs it waits for
 *  this, and it is never typed (the command is just `claude`). */
export function fixtureClaudeSays(profile: string): string {
  return `agent-distro fixture: ${profile} claude`;
}

/** Every fixture path carries this, so a step can tell a fixture agent on the
 *  PATH from anything else. */
export const FIXTURE_MARK = "kolu-e2e-agent-distro";

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

/** Build the fixture once (per worker) and return the env that bakes it. */
export function agentDistroFixtureEnv(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_MARK}-`));
  const listing = JSON.stringify({
    profiles: FIXTURE_PROFILES.map(fixtureProfile),
  });
  const picker = `printf '%s\\n' '${listing}'`;
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  script(path.join(root, "bin", "agent-distro"), picker);
  const profiles = FIXTURE_PROFILES.map((name) => {
    const bin = path.join(root, "profiles", name, "bin");
    fs.mkdirSync(bin, { recursive: true });
    script(path.join(bin, "claude"), `echo "${fixtureClaudeSays(name)}"`);
    script(path.join(bin, "agent-distro"), picker);
    const config = path.join(root, `update-${name}.json`);
    fs.writeFileSync(
      config,
      JSON.stringify({
        profile: name,
        state: `${PLACEHOLDER}/${FIXTURE_MARK}/${name}`,
        history: `${PLACEHOLDER}/${FIXTURE_MARK}/history.log`,
      }),
    );
    return { name, command: ["/bin/false"], config };
  });
  const updater = path.join(root, "updater.json");
  fs.writeFileSync(
    updater,
    JSON.stringify({ stateHomePlaceholder: PLACEHOLDER, profiles }),
  );
  // The manifest — the only thing about the floor's shape kolu reads.
  fs.mkdirSync(path.join(root, "share", "kolu"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "share", "kolu", "agent-distro.json"),
    JSON.stringify({
      default: FIXTURE_PROFILES[0],
      picker: path.join(root, "bin", "agent-distro"),
      profiles: FIXTURE_PROFILES.map((name) => {
        const dir = path.join(root, "profiles", name);
        return { name, dir, bin: path.join(dir, "bin"), hash: name };
      }),
    }),
  );
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.json"), '{"name":"kolu"}');
  return {
    KOLU_AGENT_DISTRO_BUNDLE: root,
    KOLU_AGENT_DISTRO_UPDATER: updater,
    KOLU_AGENT_PLUGIN_DIR: plugin,
  };
}
