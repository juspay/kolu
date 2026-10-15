/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a padi (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_STATE`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk FLOOR described the way `@kolu/agent-distro`'s Nix half describes the
 * real one — by its manifest, `share/kolu/agent-distro.json` (`{dir, bin}`),
 * which names agent-distro's ONE package, laid out as upstream's:
 *
 *     bin/claude                        prints "agent-distro fixture: claude"
 *     bin/agent-distro                  the picker: prints "agent-distro picker fixture";
 *                                       with `--list --json`, upstream's shape — no profile
 *                                       in effect without `AI_PROFILE`, else the stand-in's
 *     share/agent-distro/versions       its harnesses (kolu-server and padi read it)
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
import {
  packageFiles,
  STAND_IN_PROFILE,
  standInListJson,
} from "@kolu/agent-distro/testing";
import os from "node:os";
import path from "node:path";

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

/** What the package's stub `claude` prints — the step that runs it waits for
 *  this, and it is never typed (the command is just `claude`). */
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
  // The ONE package, as upstream builds it.
  const dir = path.join(root, "package");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  script(path.join(bin, "claude"), `echo "${FIXTURE_CLAUDE_SAYS}"`);
  // The picker, as the package carries it: a command for people, which kolu
  // asks only for the profile in effect.
  script(
    path.join(bin, "agent-distro"),
    `${standInListJson([FIXTURE_HARNESS])}\necho "${FIXTURE_PICKER_SAYS}"`,
  );
  for (const [file, text] of Object.entries(
    packageFiles(dir, [FIXTURE_HARNESS]),
  )) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  // The host state, as the Nix half writes it: every path under the
  // placeholder home padi makes concrete on its host.
  const state = path.join(root, "state.json");
  fs.writeFileSync(
    state,
    JSON.stringify({
      stateHomePlaceholder: PLACEHOLDER,
      state: `${PLACEHOLDER}/${FIXTURE_MARK}/state`,
      history: `${PLACEHOLDER}/${FIXTURE_MARK}/history.log`,
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
