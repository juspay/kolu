/**
 * Which bundle a new terminal gets — the spawn-time resolution that pins it —
 * and the write gate on the pushed setting.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setAgentDistroBakeForTest,
  assessAgentDistro,
  checkAgentDistroSetting,
  resolveAgentLayer,
  withAgentLayer,
} from "./agentDistro.ts";
import type { AgentDistroBake } from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
const ON = { enabled: true, profile: "vanilla" } as const;

let root: string;
let savedStateHome: string | undefined;

function bake(opts: { floor: boolean }): AgentDistroBake {
  const floor = join(root, "floor");
  if (opts.floor) {
    for (const p of ["vanilla", "juspay"]) {
      const target = join(root, `store-${p}-kolu`);
      mkdirSync(join(target, "bin"), { recursive: true });
      mkdirSync(join(floor, "profiles"), { recursive: true });
      symlinkSync(target, join(floor, "profiles", p));
    }
  }
  const profile = (name: string) => ({
    name,
    command: ["/bin/false"],
    configText: JSON.stringify({
      state: `${PLACEHOLDER}/agent-distro/${name}`,
      history: `${PLACEHOLDER}/agent-distro/history.log`,
    }),
  });
  return {
    floor: opts.floor ? floor : undefined,
    plugins: "/p/plugin",
    stateHomePlaceholder: PLACEHOLDER,
    profiles: new Map([
      ["vanilla", profile("vanilla")],
      ["juspay", profile("juspay")],
    ]),
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-test-")));
  savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, "state");
});
afterEach(() => {
  __setAgentDistroBakeForTest(undefined);
  if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedStateHome;
});

describe("resolveAgentLayer", () => {
  it("off → nothing", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(
      resolveAgentLayer({ enabled: false, profile: "vanilla" }),
    ).toBeUndefined();
  });

  it("an unbaked padi → nothing, even when on", () => {
    __setAgentDistroBakeForTest(null);
    expect(resolveAgentLayer(ON)).toBeUndefined();
  });

  it("the local floor: the profile's EXACT resolved dir, never the symlink", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(resolveAgentLayer(ON)).toEqual({
      profile: "vanilla",
      bundle: join(root, "store-vanilla-kolu"),
      plugins: "/p/plugin",
    });
  });

  it("the host's `current` wins over the floor, resolved to its target", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    const fetched = join(root, "store-fetched-vanilla");
    mkdirSync(join(fetched, "bin"), { recursive: true });
    const stateDir = join(root, "state", "agent-distro", "vanilla");
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(fetched, join(stateDir, "current"));
    expect(resolveAgentLayer(ON)?.bundle).toBe(fetched);
  });

  it("a remote host before its first download → nothing yet", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    expect(resolveAgentLayer(ON)).toBeUndefined();
    // Not a status anyone sees: the one state the caller must act on.
    expect(assessAgentDistro(ON)).toEqual({
      kind: "needsDownload",
      profile: "vanilla",
    });
  });

  it("status reads ready with the bundle a new terminal gets", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(ON)).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, "store-vanilla-kolu"),
    });
    expect(assessAgentDistro({ enabled: false, profile: "x" })).toEqual({
      kind: "off",
    });
  });
});

describe("checkAgentDistroSetting — the write gate", () => {
  it("refuses to turn on a profile this build does not know", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(() =>
      checkAgentDistroSetting({ enabled: true, profile: "nope" }),
    ).toThrow(/unknown agent-distro profile 'nope'/);
  });

  it("takes any profile when off, and anything on an unbaked padi", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(() =>
      checkAgentDistroSetting({ enabled: false, profile: "nope" }),
    ).not.toThrow();
    __setAgentDistroBakeForTest(null);
    expect(() =>
      checkAgentDistroSetting({ enabled: true, profile: "nope" }),
    ).not.toThrow();
  });
});

describe("withAgentLayer — the record stamp the chip reads", () => {
  it("stamps profile + bundle, and strips a previous spawn's pair for no layer", () => {
    const stamped = withAgentLayer(
      { agentProfile: "juspay", agentBundle: "/old", other: 1 },
      { profile: "vanilla", bundle: "/new", plugins: "/p" },
    );
    expect(stamped).toEqual({
      agentProfile: "vanilla",
      agentBundle: "/new",
      other: 1,
    });
    expect(
      withAgentLayer(
        { agentProfile: "juspay", agentBundle: "/old", other: 1 },
        undefined,
      ),
    ).toEqual({ other: 1 });
  });
});
