/**
 * Which bundle a new terminal gets — the spawn-time resolution that pins it.
 */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyHostSystemInfo } from "kaval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSpawnEnv, composeSpawnInput } from "../ptyHost/index.ts";
import { assessAgentDistro } from "./agentDistro.ts";
import { __setAgentDistroBakeForTest, type AgentDistroBake } from "./bake.ts";
import { type AgentLayer, layerOnHost, withAgentLayer } from "./layer.ts";
import { commandOnPath } from "./onHost.ts";

const ON = { enabled: true, profile: "vanilla" } as const;

/** A store bundle as agent-distro builds it: `bin/` holds the harness
 *  commands AND the profile's own picker, `agent-distro`. */
function storeBundle(dir: string): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const command of ["claude", "agent-distro"])
    writeFileSync(join(dir, "bin", command), "#!/bin/sh\n", { mode: 0o755 });
}

/** Where a shell finds `command` on the PATH a terminal spawned with `layer`
 *  gets — the spawn input padi really composes. */
function whichOnSpawnPath(
  layer: AgentLayer,
  command: string,
): string | undefined {
  const input = composeSpawnInput(
    { id: "T-agents-path" },
    {
      shell: "/bin/sh",
      home: root,
      platform: "linux",
      rcDir: root,
    } as PtyHostSystemInfo,
    {
      kavalSocket: "/tmp/kaval-test/pty-host.sock",
      toolsPath: [],
      agents: agentSpawnEnv(layer),
      serverVersion: "9.9.9-test",
    },
  );
  return commandOnPath(command, input.env.PATH);
}

let root: string;
let savedStateHome: string | undefined;

function bake(opts: { floor: boolean }): AgentDistroBake {
  const floor = join(root, "floor");
  if (opts.floor) {
    for (const p of ["vanilla", "juspay"]) {
      const target = join(root, `agent-distro-${p}`);
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
      bundle: join(root, "agent-distro-vanilla"),
      plugins: "/p/plugin",
    });
  });

  it("the host's `current` wins over the floor, resolved to its target", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    const fetched = join(root, "agent-distro-vanilla-fetched");
    storeBundle(fetched);
    const stateDir = join(root, "state", "agent-distro", "vanilla");
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(fetched, join(stateDir, "current"));
    expect(layerOnHost(ON)?.bundle).toBe(fetched);
  });

  it("a new terminal's PATH finds `agent-distro` in the pinned bundle's bin/ — on the floor and on a host's `current`", () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      __setAgentDistroBakeForTest(bake({ floor: true }));
      const onFloor = layerOnHost(ON);
      if (onFloor === undefined) throw new Error("no layer on the floor");
      expect(whichOnSpawnPath(onFloor, "agent-distro")).toBe(
        join(root, "agent-distro-vanilla", "bin", "agent-distro"),
      );
      // A remote host (no floor), once its download lands `current`.
      __setAgentDistroBakeForTest(bake({ floor: false }));
      const fetched = join(root, "agent-distro-vanilla-fetched");
      storeBundle(fetched);
      const stateDir = join(root, "state", "agent-distro", "vanilla");
      mkdirSync(stateDir, { recursive: true });
      symlinkSync(fetched, join(stateDir, "current"));
      const downloaded = layerOnHost(ON);
      if (downloaded === undefined) throw new Error("no layer after download");
      expect(whichOnSpawnPath(downloaded, "agent-distro")).toBe(
        join(fetched, "bin", "agent-distro"),
      );
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
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
        bundle: join(root, "agent-distro-vanilla"),
        plugins: "/p/plugin",
      },
    });
    expect(assessAgentDistro({ enabled: false, profile: "x" })).toEqual({
      kind: "off",
    });
  });
});

describe("a profile reference — the setting's fallback, on the vanilla bundle", () => {
  const REFERENCE = { enabled: true, profile: "github:me/profile" } as const;

  it("gets the vanilla bundle, and the layer keeps the reference as the profile", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(REFERENCE)).toEqual({
      kind: "ready",
      layer: {
        profile: "github:me/profile",
        bundle: join(root, "agent-distro-vanilla"),
        plugins: "/p/plugin",
      },
    });
  });

  it("downloads the vanilla bundle on a host without one", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    expect(assessAgentDistro(REFERENCE)).toEqual({
      kind: "needsDownload",
      profile: "github:me/profile",
    });
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

  it("drops a previous spawn's profile in effect: the new one is asked again", () => {
    expect(
      withAgentLayer(
        {
          agents: {
            profile: "github:me/p",
            bundle: "/old",
            effective: {
              name: "mine",
              description: "",
              origin: "github:me/p",
            },
          },
        },
        { profile: "github:me/p", bundle: "/new", plugins: "/p" },
      ),
    ).toEqual({ agents: { profile: "github:me/p", bundle: "/new" } });
  });
});
