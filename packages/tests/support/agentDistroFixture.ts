/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a real kolu (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_UPDATER`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk bundle with the same layout `nix/agent-distro.nix` builds:
 *
 *     bin/agent-distro               prints a `--list --json` listing
 *     profiles/<name>/bin/claude     prints "agent-distro fixture: <name> claude"
 *     profiles/<name>/bin/agent-distro
 *
 * The real floor is gigabytes of compiled harnesses; what the e2e lane proves is
 * kolu's half — Settings lists the profiles, the next terminal (not the current
 * one) gets the chosen profile's `claude` first on its PATH and wears its chip,
 * and off removes both. The Nix build proves the real floor has this layout.
 *
 * The updater configs point at a state dir that never exists and an updater that
 * is never run (the floor is always there), so `current` never shadows the floor.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
export const FIXTURE_PROFILES = ["vanilla", "juspay"] as const;

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

/** Build the fixture once (per worker) and return the env that bakes it. */
export function agentDistroFixtureEnv(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-e2e-agent-distro-"));
  const listing = JSON.stringify({
    profiles: FIXTURE_PROFILES.map((name) => ({
      name,
      description: `Fixture profile ${name}`,
      harnesses: [
        {
          name: "claude",
          title: "Claude Code",
          tagline: "fixture",
          version: "0.0.0",
        },
      ],
    })),
  });
  const picker = `printf '%s\\n' '${listing}'`;
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  script(path.join(root, "bin", "agent-distro"), picker);
  const profiles = FIXTURE_PROFILES.map((name) => {
    const bin = path.join(root, "profiles", name, "bin");
    fs.mkdirSync(bin, { recursive: true });
    script(
      path.join(bin, "claude"),
      `echo "agent-distro fixture: ${name} claude"`,
    );
    script(path.join(bin, "agent-distro"), picker);
    const config = path.join(root, `update-${name}.json`);
    fs.writeFileSync(
      config,
      JSON.stringify({
        profile: name,
        state: `${PLACEHOLDER}/kolu-e2e-agent-distro/${name}`,
        history: `${PLACEHOLDER}/kolu-e2e-agent-distro/history.log`,
      }),
    );
    return { name, command: ["/bin/false"], config };
  });
  const updater = path.join(root, "updater.json");
  fs.writeFileSync(
    updater,
    JSON.stringify({ stateHomePlaceholder: PLACEHOLDER, profiles }),
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
