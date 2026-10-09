/** Every harness a built-in agent-distro profile ships has a decided skill
 *  invocation, so a pin bump that brings a new harness fails here, in CI, and
 *  not inside a tile's memo at runtime.
 *
 *  The walk reads agent-distro's own source at kolu's npins pin, which the dev
 *  shell exposes as `KOLU_AGENT_DISTRO_SRC` (`shell.nix`). The built manifest
 *  (`share/kolu/agent-distro.json`) would need the whole floor built, which the
 *  unit lane never does, and the e2e fixture bundles carry only `claude`. The
 *  source says the same thing the build does: every profile under `profiles/`
 *  gets every harness under `harnesses/` (upstream's `mkLaunchers` takes
 *  `lib/discover-harnesses.nix`'s list for any profile), and a harness's
 *  directory name is its command name — the name the listing carries. */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillInvocation } from "./terminalTip";

const src = process.env.KOLU_AGENT_DISTRO_SRC;
if (!src)
  throw new Error(
    "KOLU_AGENT_DISTRO_SRC is unset: run the unit lane in kolu's dev shell (shell.nix)",
  );

const dirs = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

const PROFILES = dirs(join(src, "profiles"));
const HARNESSES = dirs(join(src, "harnesses"));

describe("skillInvocation — every built-in profile's harnesses", () => {
  it("the pin ships the profiles and harnesses this walk expects to find", () => {
    expect(PROFILES).toContain("vanilla");
    expect(HARNESSES.length).toBeGreaterThan(0);
  });

  for (const profile of PROFILES)
    for (const harness of HARNESSES)
      it(`${profile} · ${harness} has a decided invocation`, () => {
        expect(() => skillInvocation(harness, "kolu")).not.toThrow();
      });
});
