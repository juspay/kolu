/**
 * Which bundle a new terminal gets on this host, and how kolu-server's
 * delivery reports (`agentDistro.report`) move it: the spawn-time resolution
 * that pins a bundle, and the status / receipt a host publishes as deliveries
 * start, land and fail. Real temp dirs throughout — `current`, `last-success`
 * and the history log are the files upstream reads too.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentLink } from "@kolu/agent-distro/bundle";
import type {
  AgentDistroDeliveryReport,
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import type { PtyHostSystemInfo } from "kaval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { agentSpawnEnv, composeSpawnInput } from "../ptyHost/index.ts";
import {
  agentDistroSettingStore,
  assessAgentDistro,
  newTerminalLayer,
  onAgentDistroReport,
  onAgentDistroSettingWrite,
} from "./agentDistro.ts";
import { __setAgentDistroBakeForTest, type AgentDistroBake } from "./bake.ts";
import { __resetAgentDistroDeliveriesForTest } from "./deliveries.ts";
import { type AgentLayer, layerOnHost, withAgentLayer } from "./layer.ts";

const ON: AgentDistroSetting = { enabled: true, profile: "vanilla" };
const OFF: AgentDistroSetting = { enabled: false, profile: "vanilla" };

/** A store bundle as agent-distro builds it: `bin/` holds the harness
 *  commands AND the profile's own picker, `agent-distro`; `versions` (when
 *  given) is its `share/agent-distro/versions` file. */
function storeBundle(dir: string, versions?: string): string {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const command of ["claude", "agent-distro"])
    writeFileSync(join(dir, "bin", command), "#!/bin/sh\n", { mode: 0o755 });
  if (versions !== undefined) {
    mkdirSync(join(dir, "share", "agent-distro"), { recursive: true });
    writeFileSync(join(dir, "share", "agent-distro", "versions"), versions);
  }
  return dir;
}

/** The first `command` a shell finds on `PATH`. */
function commandOnPath(command: string, PATH: string | undefined) {
  for (const dir of (PATH ?? "").split(":")) {
    const candidate = join(dir, command);
    if (dir !== "" && existsSync(candidate)) return candidate;
  }
  return undefined;
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
const saved: Record<string, string | undefined> = {};
let published: AgentDistroStatus[];
let receipts: AgentDistroReceipt[];

const stateDirOf = (name: string) => join(root, "state", "agent-distro", name);
const historyFile = () => join(root, "state", "agent-distro", "history.log");

/** A bake as the reader makes it — concrete for this host — with the local
 *  floor (both profiles' bundles in kolu's closure) or none (a remote host). */
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
  const profile = (name: string) =>
    [
      name,
      { name, stateDir: stateDirOf(name), historyFile: historyFile() },
    ] as const;
  return {
    floor: opts.floor ? manifest : undefined,
    plugins: "/p/plugin",
    profiles: new Map([profile("vanilla"), profile("juspay")]),
  };
}

/** The framework's order for a setting write: `onWrite` first, then the
 *  store. */
function write(next: AgentDistroSetting): void {
  onAgentDistroSettingWrite(next);
  agentDistroSettingStore.set(next);
}

const status = () => published.at(-1);
const receipt = () => receipts.at(-1);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-test-")));
  for (const k of ["XDG_STATE_HOME", "PATH"]) saved[k] = process.env[k];
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.PATH = "/usr/bin:/bin";
  __resetAgentDistroDeliveriesForTest();
  agentDistroSettingStore.set(OFF);
  published = [];
  receipts = [];
  setPadiSurfaceCtx({
    cells: new Proxy({} as never, {
      get: (_t, name) => ({
        get: () => undefined,
        set: (v: unknown) => {
          if (name === "agentDistroStatus")
            published.push(v as AgentDistroStatus);
          if (name === "agentDistroReceipt")
            receipts.push(v as AgentDistroReceipt);
        },
        patch: () => {},
      }),
    }),
    collections: new Proxy({} as never, { get: () => ({}) }),
    events: new Proxy({} as never, { get: () => ({ publish: () => {} }) }),
  } as never);
});

afterEach(() => {
  __resetPadiSurfaceCtxForTest();
  __setAgentDistroBakeForTest(undefined);
  __resetAgentDistroDeliveriesForTest();
  agentDistroSettingStore.set(OFF);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("layerOnHost — the bundle on disk", () => {
  it("off → nothing", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(layerOnHost(OFF)).toBeUndefined();
  });

  it("an unbaked padi → nothing, even when on", () => {
    __setAgentDistroBakeForTest(null);
    expect(layerOnHost(ON)).toBeUndefined();
    expect(assessAgentDistro(ON)).toEqual({ kind: "unavailable" });
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
    const fetched = storeBundle(join(root, "agent-distro-vanilla-fetched"));
    mkdirSync(stateDirOf("vanilla"), { recursive: true });
    symlinkSync(fetched, currentLink(stateDirOf("vanilla")));
    expect(layerOnHost(ON)?.bundle).toBe(fetched);
  });

  it("a new terminal's PATH finds `agent-distro` in the floor's bin/", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    const onFloor = layerOnHost(ON);
    if (onFloor === undefined) throw new Error("no layer on the floor");
    expect(whichOnSpawnPath(onFloor, "agent-distro")).toBe(
      join(root, "agent-distro-vanilla", "bin", "agent-distro"),
    );
  });

  it("a remote host before its first delivery, with no word from kolu-server → nothing, undelivered — never downloading from silence", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    expect(layerOnHost(ON)).toBeUndefined();
    expect(assessAgentDistro(ON)).toEqual({
      kind: "undelivered",
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
      delivering: false,
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
      delivering: false,
    });
  });

  it("waits on the vanilla bundle's delivery on a host without one, and gets it once it lands", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(REFERENCE);
    expect(status()).toEqual({
      kind: "undelivered",
      profile: "github:me/profile",
    });
    // A delivery is the BUNDLE's: kolu-server names the vanilla bundle.
    onAgentDistroReport({ kind: "delivering", profile: "vanilla" });
    expect(status()).toEqual({
      kind: "downloading",
      profile: "github:me/profile",
    });
    const bundle = storeBundle(join(root, "store-vanilla"));
    onAgentDistroReport({ kind: "landed", profile: "vanilla", bundle });
    expect(status()).toEqual({
      kind: "ready",
      profile: "github:me/profile",
      bundle,
      delivering: false,
    });
  });
});

describe("delivery reports — what a host does with kolu-server's word", () => {
  const report = (r: AgentDistroDeliveryReport) => onAgentDistroReport(r);

  it("`landed`: `current` points at the bundle, upstream's files are written, and new terminals get it on PATH", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    const bundle = storeBundle(
      join(root, "store-vanilla"),
      "claude\tClaude Code\t2.1.291\n",
    );
    const before = Math.floor(Date.now() / 1000);

    report({ kind: "landed", profile: "vanilla", bundle });

    const link = currentLink(stateDirOf("vanilla"));
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(bundle);
    const stamp = Number(
      readFileSync(join(stateDirOf("vanilla"), "last-success"), "utf8"),
    );
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    const history = readFileSync(historyFile(), "utf8").trim().split("\n");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatch(/ vanilla updated: Claude Code 2\.1\.291$/);

    expect(status()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle,
      delivering: false,
    });
    const layer = newTerminalLayer();
    expect(layer).toEqual({ profile: "vanilla", bundle, plugins: "/p/plugin" });
    if (layer === undefined) throw new Error("no layer after landing");
    expect(whichOnSpawnPath(layer, "agent-distro")).toBe(
      join(bundle, "bin", "agent-distro"),
    );

    expect(receipt()).toMatchObject({
      profile: "vanilla",
      bundle,
      versions: [{ name: "claude", title: "Claude Code", version: "2.1.291" }],
      lastRun: {
        outcome: "updated",
        words: "Claude Code 2.1.291",
        by: "delivery",
      },
      running: [],
    });
  });

  it("a newer bundle landing names what changed; the same bundle again writes no history line", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    const older = storeBundle(
      join(root, "store-older"),
      "claude\tClaude Code\t2.1.286\n",
    );
    const newer = storeBundle(
      join(root, "store-newer"),
      "claude\tClaude Code\t2.1.291\npi\tPi\t0.4\n",
    );
    report({ kind: "landed", profile: "vanilla", bundle: older });
    report({ kind: "landed", profile: "vanilla", bundle: newer });
    report({ kind: "landed", profile: "vanilla", bundle: newer });
    const history = readFileSync(historyFile(), "utf8").trim().split("\n");
    expect(history).toHaveLength(2);
    expect(history[1]).toMatch(
      / vanilla updated: Claude Code 2\.1\.286 → 2\.1\.291, Pi added 0\.4$/,
    );
    expect(realpathSync(currentLink(stateDirOf("vanilla")))).toBe(newer);
    expect(newTerminalLayer()?.bundle).toBe(newer);
  });

  it("`failed refused` with nothing serving: status error, and the receipt's last run is the delivery's failure", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    const message =
      "the host's nix does not trust agent-distro's cache signing key";

    report({ kind: "failed", profile: "vanilla", reason: "refused", message });

    expect(status()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "refused",
      message,
    });
    expect(newTerminalLayer()).toBeUndefined();
    expect(receipt()?.lastRun).toMatchObject({
      outcome: "failed",
      words: message,
      by: "delivery",
    });
  });

  it("`failed binderRefused` with nothing serving: status error with that reason", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    const message =
      "the binder's nix does not trust agent-distro's cache signing key";

    report({
      kind: "failed",
      profile: "vanilla",
      reason: "binderRefused",
      message,
    });

    expect(status()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "binderRefused",
      message,
    });
    expect(newTerminalLayer()).toBeUndefined();
  });

  it("a failure while a bundle serves leaves the host ready on it: the failure shows only in the receipt", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(ON);
    const floorBundle = join(root, "agent-distro-vanilla");
    expect(status()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: floorBundle,
      delivering: false,
    });

    report({ kind: "delivering", profile: "vanilla" });
    report({
      kind: "failed",
      profile: "vanilla",
      reason: "delivery",
      message: "error: cannot copy path from https://cache.example",
    });

    expect(status()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: floorBundle,
      delivering: false,
    });
    expect(newTerminalLayer()?.bundle).toBe(floorBundle);
    expect(receipt()).toMatchObject({
      profile: "vanilla",
      bundle: floorBundle,
      lastRun: {
        outcome: "failed",
        words: "error: cannot copy path from https://cache.example",
        by: "delivery",
      },
      running: [],
    });
  });

  it("`delivering` while a bundle serves: ready on it, delivering", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(ON);
    report({ kind: "delivering", profile: "vanilla" });
    const floorBundle = join(root, "agent-distro-vanilla");
    expect(status()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: floorBundle,
      delivering: true,
    });
    // The serving bundle keeps going to new terminals until the newer lands.
    expect(newTerminalLayer()?.bundle).toBe(floorBundle);
    expect(receipt()?.running).toEqual(["vanilla"]);
  });

  it("`delivering` with nothing serving: downloading, and new terminals get no agents", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    report({ kind: "delivering", profile: "vanilla" });
    expect(status()).toEqual({ kind: "downloading", profile: "vanilla" });
    expect(newTerminalLayer()).toBeUndefined();
    expect(receipt()?.running).toEqual(["vanilla"]);
  });

  it("a new delivery clears the last failure: error → downloading", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    report({
      kind: "failed",
      profile: "vanilla",
      reason: "delivery",
      message: "boom",
    });
    expect(status()?.kind).toBe("error");
    report({ kind: "delivering", profile: "vanilla" });
    expect(status()).toEqual({ kind: "downloading", profile: "vanilla" });
  });

  it("`landed` for a bundle this host lacks (no bin/) throws, and is recorded as padi's failure", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    const missing = join(root, "store-not-here");
    mkdirSync(missing);

    expect(() =>
      report({ kind: "landed", profile: "vanilla", bundle: missing }),
    ).toThrow(/has no .*store-not-here\/bin/);

    expect(existsSync(currentLink(stateDirOf("vanilla")))).toBe(false);
    expect(status()).toMatchObject({
      kind: "error",
      profile: "vanilla",
      reason: "delivery",
    });
    expect(receipt()?.lastRun).toMatchObject({ outcome: "failed", by: "padi" });
  });

  it("a report for a profile this padi's listing does not name throws", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(ON);
    expect(() =>
      report({ kind: "delivering", profile: "no-such-profile" }),
    ).toThrow(/no-such-profile/);
    // The refused report started nothing: still no word of a delivery.
    expect(status()).toEqual({ kind: "undelivered", profile: "vanilla" });
  });

  it("a report to an unbaked padi throws", () => {
    __setAgentDistroBakeForTest(null);
    expect(() => report({ kind: "delivering", profile: "vanilla" })).toThrow(
      /no agent-distro bake/,
    );
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
