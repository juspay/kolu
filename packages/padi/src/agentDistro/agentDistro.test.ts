/**
 * Which set a new terminal gets on this host, and how kolu-server's delivery
 * reports (`agentDistro.report`) move it: the served set (`landed.json`, else
 * the floor's package with no profile), the stack-matching readiness that
 * decides whether it serves the setting, and the status / receipt a host
 * publishes as deliveries start, land and fail. Real temp dirs throughout —
 * `current`, `last-success` and the history log are the files upstream reads
 * too.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { currentLink } from "@juspay/agent-distro/update/state";
import {
  GC_ROOTS_DIR,
  PACKAGE_GC_ROOT,
  profileGcRoot,
} from "@kolu/agent-distro/gcRoots";
import type { DeliveredProfile } from "@kolu/agent-distro/landing";
import type {
  AgentDistroDeliveryReport,
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import { builtProfileFiles, packageFiles } from "@kolu/agent-distro/testing";
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
  publishAgentDistroAtBoot,
} from "./agentDistro.ts";
import { __setAgentDistroBakeForTest, type AgentDistroBake } from "./bake.ts";
import {
  __resetAgentDistroDeliveriesForTest,
  landDelivery,
} from "./deliveries.ts";
import { type AgentLayer, withAgentLayer } from "./layer.ts";
import { servedSetOnHost } from "./onHost.ts";

const JUSPAY = "github:juspay/skills";
const EKALA = "github:ekala/agents";

const STOCK: AgentDistroSetting = { enabled: true, profiles: [] };
const OFF: AgentDistroSetting = { enabled: false, profiles: [] };
const stack = (...profiles: string[]): AgentDistroSetting => ({
  enabled: true,
  profiles,
});

/** Write `files` (path → text) to disk. */
function writeFiles(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

/** agent-distro's package as it builds: `bin/` holds the harness commands AND
 *  the picker, `agent-distro`; `versions` (when given) is its versions file. */
function storePackage(
  dir: string,
  versions?: readonly { name: string; title: string; version: string }[],
): string {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const command of ["claude", "agent-distro"])
    writeFileSync(join(dir, "bin", command), "#!/bin/sh\n", { mode: 0o755 });
  if (versions !== undefined) writeFiles(packageFiles(dir, versions));
  return dir;
}

/** A built profile in the store, as `mkProfile` writes it, delivered for
 *  `reference`. */
function storeProfile(
  reference: string,
  name: string,
  opts: { dir?: string; rev?: string } = {},
): DeliveredProfile {
  const path = join(root, "store", opts.dir ?? `profile-${name}`);
  writeFiles(builtProfileFiles(path, { name, description: `the ${name}` }));
  return {
    reference,
    name,
    ...(opts.rev === undefined ? {} : { rev: opts.rev }),
    path,
  };
}

/** The first `command` a shell finds on `PATH`. */
function commandOnPath(command: string, PATH: string | undefined) {
  for (const dir of (PATH ?? "").split(":")) {
    const candidate = join(dir, command);
    if (dir !== "" && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The env a terminal spawned with `layer` gets — the spawn input padi really
 *  composes. */
function spawnEnv(layer: AgentLayer): Record<string, string | undefined> {
  return composeSpawnInput(
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
  ).env;
}

let root: string;
const saved: Record<string, string | undefined> = {};
let published: AgentDistroStatus[];
let receipts: AgentDistroReceipt[];

const stateDir = () => join(root, "state", "agent-distro", "package");
const historyFile = () => join(root, "state", "agent-distro", "history.log");
const gcRootsDir = () => join(root, "home", GC_ROOTS_DIR);
const landedFile = () =>
  join(root, "state", "kolu", "agent-distro-landed.json");
const historyLines = () =>
  existsSync(historyFile())
    ? readFileSync(historyFile(), "utf8").trim().split("\n")
    : [];

/** A bake as the reader makes it — concrete for this host — with the local
 *  floor (agent-distro's package in kolu's closure, reached through a link as
 *  a store path is) or none (a remote host). */
function bake(opts: { floor: boolean }): AgentDistroBake {
  const floorLink = join(root, "floor");
  if (opts.floor)
    symlinkSync(storePackage(join(root, "store", "floor-package")), floorLink);
  return {
    floor: opts.floor
      ? { dir: floorLink, bin: join(floorLink, "bin") }
      : undefined,
    plugins: "/p/plugin",
    stateDir: stateDir(),
    historyFile: historyFile(),
    landedFile: landedFile(),
    gcRootsDir: gcRootsDir(),
  };
}

const floorPackage = () => join(root, "store", "floor-package");

/** The framework's order for a setting write: `onWrite` first, then the
 *  store. */
function write(next: AgentDistroSetting): void {
  onAgentDistroSettingWrite(next);
  agentDistroSettingStore.set(next);
}

const status = () => published.at(-1);
const receipt = () => receipts.at(-1);
const report = (r: AgentDistroDeliveryReport) => onAgentDistroReport(r);

/** A `landed` report of `bundle` with `delivered` — its stack is theirs. */
const landed = (
  bundle: string,
  delivered: readonly DeliveredProfile[],
): AgentDistroDeliveryReport => ({
  kind: "landed",
  set: { bundle, profiles: [...delivered] },
});

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-test-")));
  for (const k of ["XDG_STATE_HOME", "PATH", "AI_PROFILE"])
    saved[k] = process.env[k];
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

describe("servedSetOnHost — the set this host serves", () => {
  it("before any landing: the floor's EXACT resolved package, never the link, with no profile", () => {
    expect(servedSetOnHost(bake({ floor: true }))).toEqual({
      bundle: floorPackage(),
      profiles: [],
    });
  });

  it("a remote host before its first delivery serves nothing", () => {
    expect(servedSetOnHost(bake({ floor: false }))).toBeUndefined();
  });

  it("a floor whose package is gone is a broken build: it throws", () => {
    const b = bake({ floor: false });
    expect(() =>
      servedSetOnHost({
        ...b,
        floor: { dir: join(root, "gone"), bin: join(root, "gone", "bin") },
      }),
    ).toThrow(/does not exist/);
  });

  it("the landed record wins over the floor", () => {
    const b = bake({ floor: true });
    const bundle = storePackage(join(root, "store", "delivered"));
    const juspay = storeProfile(JUSPAY, "juspay", { rev: "a1b2c3d4e5" });
    landDelivery(b, { bundle, profiles: [juspay] });
    expect(servedSetOnHost(b)).toEqual({ bundle, profiles: [juspay] });
  });

  it("a landed record naming a profile this host lacks throws, naming it", () => {
    const b = bake({ floor: true });
    const bundle = storePackage(join(root, "store", "delivered"));
    writeFiles({
      [landedFile()]: JSON.stringify({
        bundle,
        profiles: [
          { reference: JUSPAY, name: "juspay", path: join(root, "nope") },
        ],
      }),
    });
    expect(() => servedSetOnHost(b)).toThrow(/juspay profile at .*nope/);
  });

  it("a landed record that does not parse throws", () => {
    const b = bake({ floor: true });
    writeFiles({ [landedFile()]: JSON.stringify({ profile: "vanilla" }) });
    expect(() => servedSetOnHost(b)).toThrow();
  });
});

describe("assessAgentDistro — the set serves only the stack it was built for", () => {
  it("off → off; an unbaked padi → unavailable, even when on", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(OFF)).toEqual({ kind: "off" });
    __setAgentDistroBakeForTest(null);
    expect(assessAgentDistro(STOCK)).toEqual({ kind: "unavailable" });
  });

  it("the empty stack on the floor: ready with the package and no profile", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(STOCK)).toEqual({
      kind: "ready",
      layer: { bundle: floorPackage(), profiles: [], plugins: "/p/plugin" },
      delivering: false,
    });
  });

  it("a stack the floor cannot serve waits: undelivered, never the floor without its profiles", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    expect(assessAgentDistro(stack(JUSPAY))).toEqual({
      kind: "undelivered",
      profiles: [JUSPAY],
    });
    write(stack(JUSPAY));
    expect(newTerminalLayer()).toBeUndefined();
  });

  it("a remote host before its first delivery, with no word from kolu-server → undelivered — never downloading from silence", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    expect(assessAgentDistro(STOCK)).toEqual({
      kind: "undelivered",
      profiles: [],
    });
  });

  it("the same profiles in another order are another stack", () => {
    const b = bake({ floor: false });
    __setAgentDistroBakeForTest(b);
    const bundle = storePackage(join(root, "store", "delivered"));
    landDelivery(b, {
      bundle,
      profiles: [storeProfile(JUSPAY, "juspay"), storeProfile(EKALA, "ekala")],
    });
    expect(assessAgentDistro(stack(JUSPAY, EKALA)).kind).toBe("ready");
    expect(assessAgentDistro(stack(EKALA, JUSPAY))).toEqual({
      kind: "undelivered",
      profiles: [EKALA, JUSPAY],
    });
    expect(assessAgentDistro(stack(JUSPAY)).kind).toBe("undelivered");
  });

  it("a landed record this host cannot hold reads as an error in padi's words, not a half set", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    writeFiles({ [landedFile()]: "{ not json" });
    expect(assessAgentDistro(STOCK)).toMatchObject({
      kind: "error",
      profiles: [],
    });
  });

  it("a delivery of ANOTHER stack does not mark the serving one as delivering", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    report({ kind: "delivering", profiles: [JUSPAY] });
    expect(assessAgentDistro(STOCK)).toMatchObject({
      kind: "ready",
      delivering: false,
    });
    expect(assessAgentDistro(stack(JUSPAY))).toEqual({
      kind: "downloading",
      profiles: [JUSPAY],
    });
  });
});

describe("delivery reports — what a host does with kolu-server's word", () => {
  it("`landed`: the set is recorded, `current` points at the package, upstream's files are written, and new terminals get it", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY));
    const bundle = storePackage(join(root, "store", "delivered"), [
      { name: "claude", title: "Claude Code", version: "2.1.291" },
    ]);
    const juspay = storeProfile(JUSPAY, "juspay", { rev: "a1b2c3d4e5f6" });
    const before = Math.floor(Date.now() / 1000);

    report(landed(bundle, [juspay]));

    expect(JSON.parse(readFileSync(landedFile(), "utf8"))).toEqual({
      bundle,
      profiles: [juspay],
    });
    const link = currentLink(stateDir());
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(bundle);
    const stamp = Number(
      readFileSync(join(stateDir(), "last-success"), "utf8"),
    );
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    // Upstream's one-package line: `<time> updated: <words>`, no profile.
    expect(historyLines()).toEqual([
      expect.stringMatching(
        /^\S+ updated: Claude Code 2\.1\.291, juspay a1b2c3d$/,
      ),
    ]);

    expect(status()).toEqual({
      kind: "ready",
      set: { bundle, profiles: [juspay] },
      delivering: false,
    });
    const layer = newTerminalLayer();
    expect(layer).toEqual({
      bundle,
      profiles: [juspay],
      plugins: "/p/plugin",
    });
    if (layer === undefined) throw new Error("no layer after landing");
    const env = spawnEnv(layer);
    expect(commandOnPath("agent-distro", env.PATH)).toBe(
      join(bundle, "bin", "agent-distro"),
    );
    expect(env.AI_PROFILE).toBe(juspay.path);
    expect(env.AGENT_DISTRO_PLUGINS).toBe("/p/plugin");

    expect(receipt()).toMatchObject({
      serving: {
        set: { bundle, profiles: [juspay] },
        versions: [
          { name: "claude", title: "Claude Code", version: "2.1.291" },
        ],
      },
      lastRun: {
        outcome: "updated",
        words: "Claude Code 2.1.291, juspay a1b2c3d",
        by: "log",
      },
    });
  });

  it("a stack exports every built profile as AI_PROFILE, space-joined bottom to top", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY, EKALA));
    const bundle = storePackage(join(root, "store", "delivered"));
    const juspay = storeProfile(JUSPAY, "juspay");
    const ekala = storeProfile(EKALA, "ekala");
    report(landed(bundle, [juspay, ekala]));
    const layer = newTerminalLayer();
    if (layer === undefined) throw new Error("no layer after landing");
    expect(spawnEnv(layer).AI_PROFILE).toBe(`${juspay.path} ${ekala.path}`);
  });

  it("the empty stack exports no AI_PROFILE at all", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(STOCK);
    const layer = newTerminalLayer();
    if (layer === undefined) throw new Error("no layer on the floor");
    expect("AI_PROFILE" in spawnEnv(layer)).toBe(false);
  });

  it("a newer landing names what changed in the history; the same set again writes no line", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY, EKALA));
    const older = storePackage(join(root, "store", "older"), [
      { name: "claude", title: "Claude Code", version: "2.1.286" },
    ]);
    const newer = storePackage(join(root, "store", "newer"), [
      { name: "claude", title: "Claude Code", version: "2.1.291" },
      { name: "pi", title: "Pi", version: "0.4" },
    ]);
    const juspayOld = storeProfile(JUSPAY, "juspay", {
      dir: "juspay-old",
      rev: "1111111aaaa",
    });
    const juspayNew = storeProfile(JUSPAY, "juspay", {
      dir: "juspay-new",
      rev: "2222222bbbb",
    });
    const ekala = storeProfile(EKALA, "ekala", { rev: "3333333cccc" });
    report(landed(older, [juspayOld, ekala]));
    report(landed(newer, [juspayNew, ekala]));
    report(landed(newer, [juspayNew, ekala]));
    const lines = historyLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(
      /^\S+ updated: Claude Code 2\.1\.286 → 2\.1\.291, Pi added 0\.4, juspay 1111111 → 2222222$/,
    );
    expect(realpathSync(currentLink(stateDir()))).toBe(newer);
    expect(newTerminalLayer()?.bundle).toBe(newer);
  });

  it("a changed list is said in the history: a profile added or removed, the package unchanged", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    const bundle = storePackage(join(root, "store", "delivered"));
    const juspay = storeProfile(JUSPAY, "juspay", { rev: "a1b2c3d4" });
    const ekala = storeProfile(EKALA, "ekala", { rev: "e1e2e3e4e5" });
    write(stack(JUSPAY));
    report(landed(bundle, [juspay]));
    write(stack(JUSPAY, EKALA));
    report(landed(bundle, [juspay, ekala]));
    write(stack(EKALA));
    report(landed(bundle, [ekala]));
    write(stack(EKALA, JUSPAY));
    report(landed(bundle, [ekala, juspay]));
    write(stack(JUSPAY, EKALA));
    report(landed(bundle, [juspay, ekala]));
    expect(historyLines().map((l) => l.replace(/^\S+ /, ""))).toEqual([
      "updated: versions not recorded by this package, juspay a1b2c3d",
      "updated: ekala added e1e2e3e",
      "updated: juspay removed",
      "updated: juspay added a1b2c3d",
      "updated: profiles reordered: juspay + ekala",
    ]);
  });

  it("a landing for a stack the setting has since left is refused: the current set keeps serving, and the receipt is untouched", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY));
    const bundle = storePackage(join(root, "store", "delivered"));
    const juspay = storeProfile(JUSPAY, "juspay");
    report(landed(bundle, [juspay]));
    expect(status()).toMatchObject({
      kind: "ready",
      set: { profiles: [juspay] },
    });
    const before = receipt();

    // A delivery of the longer stack started before the list was cut back.
    const ekala = storeProfile(EKALA, "ekala");
    expect(() => report(landed(bundle, [juspay, ekala]))).toThrow(
      /the Agents setting is now/,
    );
    expect(status()).toMatchObject({
      kind: "ready",
      set: { bundle, profiles: [juspay] },
    });
    expect(newTerminalLayer()?.profiles).toEqual([juspay]);
    // Its failure report, which kolu-server sends next, marks nothing either.
    report({ kind: "failed", profiles: [JUSPAY, EKALA], message: "refused" });
    expect(status()).toMatchObject({
      kind: "ready",
      set: { profiles: [juspay] },
    });
    expect(receipt()?.lastRun).toEqual(before?.lastRun);
  });

  it("a landing removes every GC root but the package's and its stack's — a legacy bundle's bare-name root included", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    const roots = gcRootsDir();
    mkdirSync(roots, { recursive: true });
    for (const name of [
      PACKAGE_GC_ROOT,
      profileGcRoot(JUSPAY),
      profileGcRoot(EKALA),
      "vanilla",
    ])
      symlinkSync(join(root, "store"), join(roots, name));
    write(stack(JUSPAY));
    const bundle = storePackage(join(root, "store", "delivered"));
    report(landed(bundle, [storeProfile(JUSPAY, "juspay")]));
    expect(readdirSync(roots).sort()).toEqual(
      [PACKAGE_GC_ROOT, profileGcRoot(JUSPAY)].sort(),
    );
  });

  it("at boot, every root but the served set's goes — a host whose agents are off still drops an older kolu's bundle root", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    const bundle = storePackage(join(root, "store", "delivered"));
    write(stack(JUSPAY));
    report(landed(bundle, [storeProfile(JUSPAY, "juspay")]));
    const roots = gcRootsDir();
    mkdirSync(roots, { recursive: true });
    for (const name of [
      PACKAGE_GC_ROOT,
      profileGcRoot(JUSPAY),
      profileGcRoot(EKALA),
      "vanilla",
    ])
      symlinkSync(join(root, "store"), join(roots, name));
    write(OFF);
    publishAgentDistroAtBoot();
    expect(readdirSync(roots).sort()).toEqual(
      [PACKAGE_GC_ROOT, profileGcRoot(JUSPAY)].sort(),
    );
  });

  it("`landed` for a package this host lacks (no bin/) throws, and is recorded as padi's failure", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(STOCK);
    const missing = join(root, "store-not-here");
    mkdirSync(missing);

    expect(() => report(landed(missing, []))).toThrow(
      /has no .*store-not-here\/bin/,
    );

    expect(existsSync(currentLink(stateDir()))).toBe(false);
    expect(status()).toMatchObject({ kind: "error", profiles: [] });
    expect(receipt()?.lastRun).toMatchObject({ outcome: "failed", by: "padi" });
  });

  it("`landed` naming a profile this host lacks throws, naming the profile", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY));
    const bundle = storePackage(join(root, "store", "delivered"));
    expect(() =>
      report(
        landed(bundle, [
          { reference: JUSPAY, name: "juspay", path: join(root, "absent") },
        ]),
      ),
    ).toThrow(/the juspay profile at .*absent/);
    expect(existsSync(landedFile())).toBe(false);
  });

  it("`failed` with nothing serving: status error, and the receipt's last run is the delivery's failure", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(stack(JUSPAY));
    const message = `the ${JUSPAY} profile did not build for x86_64-linux`;

    report({ kind: "failed", profiles: [JUSPAY], message });

    expect(status()).toEqual({ kind: "error", profiles: [JUSPAY], message });
    expect(newTerminalLayer()).toBeUndefined();
    expect(receipt()?.lastRun).toMatchObject({
      outcome: "failed",
      words: message,
      by: "delivery",
    });
  });

  it("a failure while a set serves leaves the host ready on it: the failure shows only in the receipt", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(STOCK);
    const ready = {
      kind: "ready",
      set: { bundle: floorPackage(), profiles: [] },
      delivering: false,
    };
    expect(status()).toEqual(ready);

    report({ kind: "delivering", profiles: [] });
    report({
      kind: "failed",
      profiles: [],
      message: "error: cannot copy path from https://cache.example",
    });

    expect(status()).toEqual(ready);
    expect(newTerminalLayer()?.bundle).toBe(floorPackage());
    expect(receipt()).toMatchObject({
      serving: { set: { bundle: floorPackage(), profiles: [] } },
      lastRun: {
        outcome: "failed",
        words: "error: cannot copy path from https://cache.example",
        by: "delivery",
      },
    });
  });

  it("`delivering` while a set serves its stack: ready on it, delivering — it keeps serving until the newer lands", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(STOCK);
    report({ kind: "delivering", profiles: [] });
    expect(status()).toMatchObject({
      kind: "ready",
      set: { bundle: floorPackage() },
      delivering: true,
    });
    expect(newTerminalLayer()?.bundle).toBe(floorPackage());
  });

  it("a changed list waits for its own set: downloading, no agents — the old set does not serve it", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(stack(JUSPAY));
    report({ kind: "delivering", profiles: [JUSPAY] });
    expect(status()).toEqual({ kind: "downloading", profiles: [JUSPAY] });
    expect(newTerminalLayer()).toBeUndefined();
  });

  it("a new delivery after a failure reads downloading — the failure stays the last run until it ends", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(STOCK);
    report({ kind: "failed", profiles: [], message: "boom" });
    expect(status()).toEqual({ kind: "error", profiles: [], message: "boom" });
    report({ kind: "delivering", profiles: [] });
    expect(status()).toEqual({ kind: "downloading", profiles: [] });
    expect(receipt()?.lastRun).toMatchObject({
      outcome: "failed",
      words: "boom",
      by: "delivery",
    });
  });

  it("a set that lands clears its stack's failure: the receipt's last run is the landing", () => {
    __setAgentDistroBakeForTest(bake({ floor: false }));
    write(STOCK);
    report({ kind: "failed", profiles: [], message: "boom" });
    report({ kind: "delivering", profiles: [] });
    const bundle = storePackage(join(root, "store", "delivered"), [
      { name: "claude", title: "Claude Code", version: "2.1.291" },
    ]);
    report(landed(bundle, []));
    expect(status()).toMatchObject({ kind: "ready", delivering: false });
    expect(receipt()?.lastRun).toMatchObject({ outcome: "updated" });
  });

  it("the receipt shows the failure of the setting's stack only", () => {
    __setAgentDistroBakeForTest(bake({ floor: true }));
    write(stack(JUSPAY));
    report({ kind: "failed", profiles: [JUSPAY], message: "juspay broke" });
    expect(receipt()?.lastRun).toMatchObject({ words: "juspay broke" });
    // The setting's write re-publishes the receipt for the NEW stack — its
    // onWrite runs before the store holds it, so it must not read the store.
    write(STOCK);
    expect(status()).toMatchObject({ kind: "ready" });
    expect(receipt()?.lastRun).toBeUndefined();
    write(stack(JUSPAY));
    expect(receipt()?.lastRun).toMatchObject({ words: "juspay broke" });
  });

  it("a report to an unbaked padi throws", () => {
    __setAgentDistroBakeForTest(null);
    expect(() => report({ kind: "delivering", profiles: [] })).toThrow(
      /no agent-distro bake/,
    );
  });
});

describe("withAgentLayer — the record stamp the chip reads", () => {
  const juspay: DeliveredProfile = {
    reference: JUSPAY,
    name: "juspay",
    rev: "a1b2c3d",
    path: "/nix/store/p-juspay",
  };

  it("stamps the package and profiles whole, and strips a previous spawn's for no layer", () => {
    const old = { bundle: "/old", profiles: [] };
    expect(
      withAgentLayer(
        { agents: old, other: 1 },
        { bundle: "/new", profiles: [juspay], plugins: "/p" },
      ),
    ).toEqual({ agents: { bundle: "/new", profiles: [juspay] }, other: 1 });
    expect(withAgentLayer({ agents: old, other: 1 }, undefined)).toEqual({
      other: 1,
    });
  });

  it("drops a previous spawn's profile in effect: the new one is asked again", () => {
    expect(
      withAgentLayer(
        {
          agents: {
            bundle: "/old",
            profiles: [juspay],
            effective: {
              name: "juspay + repo",
              description: "",
              source: "from ./plugin.json over AI_PROFILE=/nix/store/p",
            },
          },
        },
        { bundle: "/new", profiles: [juspay], plugins: "/p" },
      ),
    ).toEqual({ agents: { bundle: "/new", profiles: [juspay] } });
  });
});
