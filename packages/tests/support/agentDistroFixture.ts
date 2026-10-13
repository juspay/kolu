/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a padi (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_PROFILES`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk bundle described the way `@kolu/agent-distro`'s Nix half describes the
 * real one — by its manifest, `share/kolu/agent-distro.json`, which names each
 * profile's bundle, laid out as upstream's:
 *
 *     bin/claude                        prints "agent-distro fixture: <name> claude"
 *     bin/agent-distro                  the profile's picker: prints "agent-distro picker fixture: <name>";
 *                                       with `--list --json`, the profile in effect (upstream's `profile`
 *                                       field): a bundle's name as that built-in, a profile containing
 *                                       "nobody" as upstream's failure to fetch it, anything else as
 *                                       {@link FIXTURE_REFERENCE_PROFILE}
 *     share/agent-distro/profile.json   its name and description (kolu-server reads it)
 *     share/agent-distro/versions       its harnesses (kolu-server and padi read it)
 *
 * The real floor is gigabytes of compiled harnesses; what the e2e lane proves is
 * kolu's half — Settings lists the profiles, the next terminal (not the current
 * one) gets the chosen profile's `claude` first on its PATH and wears its chip,
 * and off removes both. The Nix build proves the real manifest's entries exist.
 *
 * There is no DELIVERY bake (`KOLU_AGENT_DISTRO_DELIVERY`): delivering needs
 * Nix and agent-distro's binary cache, so the suite's kolu-server delivers
 * nothing and this machine serves the floor. Delivery is unit-tested where it
 * lives (kolu-server's `agentDelivery/`, padi's `agentDistro/`).
 */

import fs from "node:fs";
import {
  bundleFiles,
  STAND_IN_REFERENCE_PROFILE,
  standInListJson,
} from "@kolu/agent-distro/testing";
import os from "node:os";
import path from "node:path";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
/** The bundles the fixture ships — what upstream ships at kolu's pin: ONE,
 *  `vanilla`. Juspay's set is the REFERENCE `github:juspay/skills`, which
 *  rides this bundle like any other reference. */
export const FIXTURE_PROFILES = ["vanilla"] as const;
/** The profile the fixture's listing leads with — the one "turn Agents on"
 *  picks. */
export const FIXTURE_DEFAULT_PROFILE = FIXTURE_PROFILES[0];

/** The fixture's ONE harness, as its listing names it — steps read the chips
 *  kolu draws off this (`agentChips`), never a hand-typed copy. */
export const FIXTURE_HARNESS = {
  name: "claude",
  title: "Claude Code",
  version: "0.0.0",
} as const;

/** A fixture profile, as kolu-server reads it off the bundle's two files. */
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

/** What a profile's stub picker (`agent-distro`) prints: one plain line, as a
 *  command for people does. Not a substring of {@link fixtureClaudeSays}'s
 *  line, nor it of this, so neither run can satisfy the other's wait. */
export function fixturePickerSays(profile: string): string {
  return `agent-distro picker fixture: ${profile}`;
}

/** The profile the fixture's `agent-distro --list --json` reports in effect
 *  for an `AI_PROFILE` that is not one of its bundles
 *  (`@kolu/agent-distro/testing`'s stand-in, shared with padi's unit tests). */
export const FIXTURE_REFERENCE_PROFILE = STAND_IN_REFERENCE_PROFILE;

/** Every fixture path carries this, so a step can tell a fixture agent on the
 *  PATH from anything else. */
export const FIXTURE_MARK = "kolu-e2e-agent-distro";

let memo: Record<string, string> | undefined;

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

/** Build the fixture once (per worker) and return the env that bakes it. */
export function agentDistroFixtureEnv(): Record<string, string> {
  memo ??= buildFixture();
  return memo;
}

function buildFixture(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_MARK}-`));
  for (const name of FIXTURE_PROFILES) {
    const dir = path.join(root, "profiles", name);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin, { recursive: true });
    script(path.join(bin, "claude"), `echo "${fixtureClaudeSays(name)}"`);
    // The profile's own picker, as upstream's bundle carries it: a command for
    // people, which kolu never runs.
    script(
      path.join(bin, "agent-distro"),
      `${standInListJson(name, FIXTURE_PROFILES)}\necho "${fixturePickerSays(name)}"`,
    );
    // The two files the bundle describes itself with, as a real one writes them.
    for (const [file, text] of Object.entries(
      bundleFiles(dir, fixtureProfile(name)),
    )) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  // The profiles listing, as the Nix half writes it: each profile's state
  // under the placeholder home padi makes concrete on its host.
  const profiles = path.join(root, "profiles.json");
  fs.writeFileSync(
    profiles,
    JSON.stringify({
      stateHomePlaceholder: PLACEHOLDER,
      history: `${PLACEHOLDER}/${FIXTURE_MARK}/history.log`,
      profiles: FIXTURE_PROFILES.map((name) => ({
        name,
        state: `${PLACEHOLDER}/${FIXTURE_MARK}/${name}`,
      })),
    }),
  );
  // The manifest — the only thing about the floor's shape kolu reads.
  fs.mkdirSync(path.join(root, "share", "kolu"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "share", "kolu", "agent-distro.json"),
    JSON.stringify({
      default: FIXTURE_DEFAULT_PROFILE,
      profiles: FIXTURE_PROFILES.map((name) => {
        const dir = path.join(root, "profiles", name);
        return { name, dir, bin: path.join(dir, "bin") };
      }),
    }),
  );
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.json"), '{"name":"kolu"}');
  return {
    KOLU_AGENT_DISTRO_BUNDLE: root,
    KOLU_AGENT_DISTRO_PROFILES: profiles,
    KOLU_AGENT_PLUGIN_DIR: plugin,
  };
}
