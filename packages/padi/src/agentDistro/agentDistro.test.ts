/**
 * Which bundle a new terminal gets — the spawn-time resolution that pins it —
 * and the write gate on the pushed setting.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import { PICKER_COMMAND } from "@kolu/agent-distro/listing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assessAgentDistro, checkAgentDistroSetting } from "./agentDistro.ts";
import { __setAgentDistroBakeForTest, type AgentDistroBake } from "./bake.ts";
import { layerOnHost, withAgentLayer } from "./layer.ts";

const ON = { enabled: true, profile: "vanilla" } as const;

/** A store bundle as agent-distro builds it: `bin/` holds the harness
 *  commands AND the profile's own picker, `agent-distro`. */
function storeBundle(dir: string): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const command of ["claude", PICKER_COMMAND])
    writeFileSync(join(dir, "bin", command), "#!/bin/sh\n", { mode: 0o755 });
}

let root: string;
let savedStateHome: string | undefined;

function bake(opts: { floor: boolean }): AgentDistroBake {
  const floor = join(root, "floor");
  if (opts.floor) {
    for (const p of ["vanilla", "juspay"]) {
      const target = join(root, `store-${p}-kolu`);
      storeBundle(target);
      mkdirSync(join(floor, "profiles"), { recursive: true });
      symlinkSync(target, join(floor, "profiles", p));
    }
  }
  // The floor as its manifest names it: each profile's dir is a link (as a
  // store profile dir is reached), so the resolved path is what gets pinned.
  const manifest = {
    default: "vanilla",
    profiles: ["vanilla", "juspay"].map((name) => ({
      name,
      dir: join(floor, "profiles", name),
      bin: join(floor, "profiles", name, "bin"),
      hash: name,
    })),
  };
  // Each profile's updater config, already made concrete for this host (as the
  // bake reader does once), and the state dir it names.
  const profile = (name: string) => {
    const stateDir = join(root, "state", "agent-distro", name);
    return {
      name,
      command: ["/bin/false"],
      configText: JSON.stringify({
        state: stateDir,
        history: join(root, "state", "agent-distro", "history.log"),
      }),
      stateDir,
      historyFile: join(root, "state", "agent-distro", "history.log"),
      schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
    };
  };
  return {
    floor: opts.floor ? manifest : undefined,
    plugins: "/p/plugin",
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

describe("layerOnHost — the bundle on disk", () => {
  it("off → nothing", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(layerOnHost({ enabled: false, profile: "vanilla" })).toBeUndefined();
  });

  it("an unbaked padi → nothing, even when on", () => {
    __setAgentDistroBakeForTest(null);
    expect(layerOnHost(ON)).toBeUndefined();
  });

  it("the local floor: the profile's EXACT resolved dir, never the symlink", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(layerOnHost(ON)).toEqual({
      profile: "vanilla",
      bundle: join(root, "store-vanilla-kolu"),
      plugins: "/p/plugin",
    });
  });

  it("the host's `current` wins over the floor, resolved to its target", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    const fetched = join(root, "store-fetched-vanilla");
    storeBundle(fetched);
    const stateDir = join(root, "state", "agent-distro", "vanilla");
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(fetched, join(stateDir, "current"));
    expect(layerOnHost(ON)?.bundle).toBe(fetched);
  });

  it("the PATH a terminal gets is the bundle's own bin/, with `agent-distro` in it — on the floor and after a download", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    const onFloor = layerOnHost(ON);
    if (onFloor === undefined) throw new Error("no layer on the floor");
    expect(existsSync(join(agentBinDir(onFloor.bundle), PICKER_COMMAND))).toBe(
      true,
    );
    // A remote host, once its download lands `current`.
    __setAgentDistroBakeForTest(bake({ floor: false }));
    const fetched = join(root, "store-fetched-vanilla");
    storeBundle(fetched);
    const stateDir = join(root, "state", "agent-distro", "vanilla");
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(fetched, join(stateDir, "current"));
    const downloaded = layerOnHost(ON);
    expect(downloaded?.bundle).toBe(fetched);
    if (downloaded === undefined) throw new Error("no layer after download");
    expect(
      existsSync(join(agentBinDir(downloaded.bundle), PICKER_COMMAND)),
    ).toBe(true);
  });

  it("a remote host before its first download → nothing yet", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    expect(layerOnHost(ON)).toBeUndefined();
    // Not a status anyone sees: the one state the caller must act on.
    expect(assessAgentDistro(ON)).toEqual({
      kind: "needsDownload",
      profile: "vanilla",
    });
  });

  it("status reads ready with the layer a new terminal gets", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(ON)).toEqual({
      kind: "ready",
      layer: {
        profile: "vanilla",
        bundle: join(root, "store-vanilla-kolu"),
        plugins: "/p/plugin",
      },
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
  it("stamps the agents struct whole, and strips a previous spawn's for no layer", () => {
    const stamped = withAgentLayer(
      { agents: { profile: "juspay", bundle: "/old" }, other: 1 },
      { profile: "vanilla", bundle: "/new", plugins: "/p" },
    );
    expect(stamped).toEqual({
      agents: { profile: "vanilla", bundle: "/new" },
      other: 1,
    });
    expect(
      withAgentLayer(
        { agents: { profile: "juspay", bundle: "/old" }, other: 1 },
        undefined,
      ),
    ).toEqual({ other: 1 });
  });
});
