/**
 * A remote host's first download, end to end through padi's own code: the
 * setting write starts agent-distro's updater (a stub here, run exactly as the
 * real one is), and the host's status follows what actually happened.
 *
 * The stub records the argv it was given — the shape that once handed the real
 * updater its config twice — and then does what the case asks: lands `current`,
 * skips with exit 0 (the updater's "cache not usable"), fails, or lands slowly.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  agentDistroSettingStore,
  checkForAgentUpdate,
  newTerminalLayer,
  onAgentUpdateTick,
  onAgentDistroSettingWrite,
} from "./agentDistro.ts";
import { __resetAgentDistroDownloadsForTest } from "./download.ts";
import { __setAgentDistroBakeForTest, type AgentDistroBake } from "./bake.ts";

const ON: AgentDistroSetting = { enabled: true, profile: "vanilla" };
const OFF: AgentDistroSetting = { enabled: false, profile: "vanilla" };

// The stub updater: `node stub.mjs <config> --progress`, speaking the real
// updater's `--progress` protocol — progress lines, then one result line, human
// words on stderr.
const STUB = `
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + "\\n");
const cfg = JSON.parse(readFileSync(args[0], "utf8"));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const flip = () => {
  mkdirSync(cfg.state, { recursive: true });
  rmSync(cfg.state + "/current", { force: true });
  symlinkSync(process.env.STUB_BUNDLE, cfg.state + "/current");
};
const land = () => {
  flip();
  out({ result: "updated", bundle: process.env.STUB_BUNDLE });
};
// What the real updater writes beside \`current\`: the stamp of a successful
// run, and one history line per event.
const stamp = () =>
  writeFileSync(cfg.state + "/last-success", Math.floor(Date.now() / 1000) + "\\n");
const record = (event) =>
  appendFileSync(cfg.history, new Date().toISOString().slice(0, 19) + "Z " + cfg.profile + " " + event + "\\n");
switch (process.env.STUB_MODE) {
  case "ok":
    out({ progress: { done: 1100000000, total: 2000000000 } });
    land();
    break;
  case "slow":
    out({ progress: { done: 1100000000, total: 2000000000 } });
    await new Promise((r) => setTimeout(r, 400));
    land();
    break;
  case "skip":
    process.stderr.write("agent-distro: vanilla update skipped: cache https://cache.example not usable; add it to nix.settings substituters/trusted-public-keys\\n");
    out({ result: "skipped", reason: "cache https://cache.example not usable; add it to nix.settings substituters/trusted-public-keys" });
    break;
  case "fail":
    out({ result: "failed", reason: "nix build exit 1" });
    process.exit(1);
  case "garbage":
    // A progress line in a shape the contract does not have, then a result
    // that names a bundle without landing one.
    out({ progress: { done: "a lot", total: 2 } });
    out({ result: "unchanged", bundle: process.env.STUB_BUNDLE });
    break;
  case "flipfirst":
    // As the real updater does: \`current\` flips, then a while later the result.
    flip();
    await new Promise((r) => setTimeout(r, 400));
    out({ result: "updated", bundle: process.env.STUB_BUNDLE });
    break;
  case "elsewhere":
    // Lands one bundle but reports another — the host would resolve something
    // other than what the updater says it fetched.
    flip();
    out({ result: "updated", bundle: "/nix/store/0000000000000000000000000000000-other" });
    break;
  case "tworesults":
    out({ result: "skipped", reason: "first" });
    out({ result: "skipped", reason: "second" });
    break;
  case "crash":
    process.stderr.write("TypeError: boom\\n");
    process.exit(3);
  case "update": {
    // An update while a bundle serves: bytes, a while, then the newer bundle.
    out({ progress: { done: 512, total: 2048 } });
    await new Promise((r) => setTimeout(r, 400));
    mkdirSync(cfg.state, { recursive: true });
    rmSync(cfg.state + "/current", { force: true });
    symlinkSync(process.env.STUB_BUNDLE2, cfg.state + "/current");
    stamp();
    record("updated: Claude Code 2.1.286 → 2.1.291");
    out({ result: "updated", bundle: process.env.STUB_BUNDLE2 });
    break;
  }
  case "unchanged":
    stamp();
    out({ result: "unchanged", bundle: realpathSync(cfg.state + "/current") });
    break;
  case "updateelsewhere":
    // An update that flips \`current\` to a newer bundle but reports another.
    mkdirSync(cfg.state, { recursive: true });
    rmSync(cfg.state + "/current", { force: true });
    symlinkSync(process.env.STUB_BUNDLE2, cfg.state + "/current");
    out({ result: "updated", bundle: "/nix/store/0000000000000000000000000000000-other" });
    break;
  case "slowfail":
    // A build that fails a while in.
    await new Promise((r) => setTimeout(r, 400));
    out({ result: "failed", reason: "nix build exit 1" });
    process.exit(1);
  case "vanish":
    // Dies after removing \`current\` and before landing anything.
    rmSync(cfg.state + "/current", { force: true });
    process.stderr.write("TypeError: boom\\n");
    process.exit(3);
  case "skipupdate":
    record("skipped: bundle not fully cached yet (would build claude-code)");
    out({ result: "skipped", reason: "bundle not fully cached yet (would build claude-code)" });
    break;
}
`;

let root: string;
let stubLog: string;
let published: AgentDistroStatus[];
let receipts: AgentDistroReceipt[];
const saved: Record<string, string | undefined> = {};

function write(next: AgentDistroSetting): void {
  // The framework's order: `onWrite` first, then the store.
  onAgentDistroSettingWrite(next);
  agentDistroSettingStore.set(next);
}

const last = () => published.at(-1);
const invocations = (): string[][] =>
  readFileSync(stubLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);

async function until(pred: (s: AgentDistroStatus | undefined) => boolean) {
  // `performance`, not `Date`: the scheduled cases fake the wall clock.
  const deadline = performance.now() + 5_000;
  while (!pred(last())) {
    if (performance.now() > deadline)
      throw new Error(`status never settled; last ${JSON.stringify(last())}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-dl-")));
  stubLog = join(root, "argv.log");
  writeFileSync(stubLog, "");
  const stub = join(root, "stub.mjs");
  writeFileSync(stub, STUB);
  const bundle = join(root, "store-fetched-vanilla");
  mkdirSync(join(bundle, "bin"), { recursive: true });
  // The newer bundle an update lands, with its versions file.
  const bundle2 = join(root, "store-newer-vanilla");
  mkdirSync(join(bundle2, "share", "agent-distro"), { recursive: true });
  writeFileSync(
    join(bundle2, "share", "agent-distro", "versions"),
    "claude\tClaude Code\t2.1.291\n",
  );
  // A `nix` for padi's PATH check; the stub never calls it.
  const fakeBin = join(root, "fakebin");
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, "nix"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(fakeBin, "nix"), 0o755);
  for (const k of [
    "XDG_STATE_HOME",
    "PATH",
    "STUB_LOG",
    "STUB_BUNDLE",
    "STUB_BUNDLE2",
    "STUB_MODE",
  ])
    saved[k] = process.env[k];
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.PATH = `${fakeBin}:${saved.PATH ?? ""}`;
  process.env.STUB_LOG = stubLog;
  process.env.STUB_BUNDLE = bundle;
  process.env.STUB_BUNDLE2 = bundle2;
  process.env.STUB_MODE = "ok";
  const bake: AgentDistroBake = {
    floor: undefined, // a remote host
    plugins: "/p/plugin",
    profiles: new Map([
      [
        "vanilla",
        {
          name: "vanilla",
          command: [process.execPath, stub],
          // Concrete for this host, as the bake reader makes it once.
          configText: JSON.stringify({
            profile: "vanilla",
            state: join(root, "state", "agent-distro", "vanilla"),
            history: join(root, "state", "agent-distro", "history.log"),
            periodSeconds: 21600,
            offsetSeconds: 7200,
          }),
          stateDir: join(root, "state", "agent-distro", "vanilla"),
          historyFile: join(root, "state", "agent-distro", "history.log"),
          schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
        },
      ],
    ]),
  };
  __setAgentDistroBakeForTest(bake);
  __resetAgentDistroDownloadsForTest();
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
  __resetAgentDistroDownloadsForTest();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("a host's first download", () => {
  it("lands `current`: downloading, then ready with the fetched bundle", async () => {
    write(ON);
    expect(published[0]).toEqual({ kind: "downloading", profile: "vanilla" });
    await until((s) => s?.kind === "ready");
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, "store-fetched-vanilla"),
    });
  });

  it("hands the updater ONE config path — the host-concrete one — then --progress", async () => {
    write(ON);
    await until((s) => s?.kind === "ready");
    const [argv] = invocations();
    // Not the baked config (which the updater would read, then take the second
    // path for a mode and die), and nothing but the progress flag after it.
    expect(argv).toHaveLength(2);
    expect(argv?.[0]).toMatch(/kolu-agent-distro-[^/]+\/update\.json$/);
    expect(argv?.[1]).toBe("--progress");
  });

  it("relays the bytes: downloading { done, total }", async () => {
    process.env.STUB_MODE = "slow";
    write(ON);
    await until((s) => s?.kind === "downloading" && s.progress !== undefined);
    expect(last()).toEqual({
      kind: "downloading",
      profile: "vanilla",
      progress: { done: 1_100_000_000, total: 2_000_000_000 },
    });
    await until((s) => s?.kind === "ready");
  });

  it("a line outside the --progress contract is the run's error, quoted", async () => {
    process.env.STUB_MODE = "garbage";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "updater",
      message:
        'the updater wrote an unexpected --progress line: {"progress":{"done":"a lot","total":2}}',
    });
  });

  it("a second result line is the run's error, quoted", async () => {
    process.env.STUB_MODE = "tworesults";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "updater",
      message:
        'the updater wrote a second result line: {"result":"skipped","reason":"second"}',
    });
  });

  it("a run that dies without its result line is an error naming it", async () => {
    process.env.STUB_MODE = "crash";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toMatchObject({
      reason: "updater",
      message: "the updater exited 3 without a result: TypeError: boom",
    });
  });

  it("an updater SKIP (exit 0, nothing landed) is an error with its own words", async () => {
    process.env.STUB_MODE = "skip";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "updater",
      message:
        "cache https://cache.example not usable; add it to nix.settings substituters/trusted-public-keys",
    });
  });

  it("an updater failure (exit 1) is an error, and nothing retries on its own", async () => {
    process.env.STUB_MODE = "fail";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toMatchObject({ message: "nix build exit 1" });
    await new Promise((r) => setTimeout(r, 200));
    expect(invocations()).toHaveLength(1);
  });

  it("turning it off and on again is the retry", async () => {
    process.env.STUB_MODE = "fail";
    write(ON);
    await until((s) => s?.kind === "error");
    process.env.STUB_MODE = "ok";
    write(OFF);
    expect(last()).toEqual({ kind: "off" });
    write(ON);
    await until((s) => s?.kind === "ready");
    expect(invocations()).toHaveLength(2);
  });

  it("re-enabling while a download runs does not start a second one", async () => {
    process.env.STUB_MODE = "slow";
    write(ON);
    write(OFF);
    write(ON);
    expect(last()).toEqual({ kind: "downloading", profile: "vanilla" });
    await until((s) => s?.kind === "ready");
    expect(invocations()).toHaveLength(1);
  });

  it("no `nix` on padi's PATH is a typed `nixMissing` failure stating the cause — no remedy, no retry — and runs nothing", () => {
    process.env.PATH = join(root, "nowhere");
    write(ON);
    expect(last()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "nixMissing",
      message:
        "nix is not on padi's PATH on this host, so the agents cannot be downloaded",
    });
    expect(invocations()).toHaveLength(0);
  });

  it("a reported bundle this host does not resolve is a failure, not a ready", async () => {
    process.env.STUB_MODE = "elsewhere";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toEqual({
      kind: "error",
      profile: "vanilla",
      reason: "updater",
      message: `the updater landed /nix/store/0000000000000000000000000000000-other, but this host resolves ${join(root, "store-fetched-vanilla")} for vanilla`,
    });
  });

  it("mid-run, after `current` flips: still downloading, and a new terminal gets no agents", async () => {
    process.env.STUB_MODE = "flipfirst";
    write(ON);
    const current = join(root, "state", "agent-distro", "vanilla", "current");
    const deadline = Date.now() + 5_000;
    while (!existsSync(current)) {
      if (Date.now() > deadline) throw new Error("the stub never flipped");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(last()).toEqual({ kind: "downloading", profile: "vanilla" });
    expect(newTerminalLayer()).toBeUndefined();
    await until((s) => s?.kind === "ready");
    expect(newTerminalLayer()?.bundle).toBe(
      join(root, "store-fetched-vanilla"),
    );
  });

  it("a host in error gives a new terminal no agents — even with the landed `current` on disk", async () => {
    process.env.STUB_MODE = "elsewhere";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(newTerminalLayer()).toBeUndefined();
  });

  it("the retry after a mismatch downloads again — the disowned `current` is never ready", async () => {
    process.env.STUB_MODE = "elsewhere";
    write(ON);
    await until((s) => s?.kind === "error");
    process.env.STUB_MODE = "ok";
    write(OFF);
    write(ON);
    // Not straight to ready on the bundle the failed run disowned.
    expect(last()).toEqual({ kind: "downloading", profile: "vanilla" });
    expect(newTerminalLayer()).toBeUndefined();
    await until((s) => s?.kind === "ready");
    expect(invocations()).toHaveLength(2);
    expect(newTerminalLayer()?.bundle).toBe(
      join(root, "store-fetched-vanilla"),
    );
  });
});

describe("an update while a bundle serves", () => {
  const first = join("store-fetched-vanilla");
  /** Land the first download, then make the next run do `mode`. */
  async function serving(mode: string): Promise<void> {
    write(ON);
    await until((s) => s?.kind === "ready" && s.update === undefined);
    process.env.STUB_MODE = mode;
  }
  const lastReceipt = () => receipts.at(-1);

  it("keeps the old bundle serving — ready + update, bytes on it — until the new one lands", async () => {
    await serving("update");
    expect(checkForAgentUpdate({ force: true })).toBe("started");
    await until((s) => s?.kind === "ready" && s.update?.progress !== undefined);
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, first),
      update: { progress: { done: 512, total: 2048 } },
    });
    // A new terminal mid-run still gets the old bundle, never nothing.
    expect(newTerminalLayer()?.bundle).toBe(join(root, first));
    await until(
      (s) =>
        s?.kind === "ready" && s.bundle === join(root, "store-newer-vanilla"),
    );
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, "store-newer-vanilla"),
    });
    expect(newTerminalLayer()?.bundle).toBe(join(root, "store-newer-vanilla"));
    // The receipt says what changed, in the updater's words, with the new
    // bundle's versions — published before the status that flips.
    expect(lastReceipt()).toMatchObject({
      profile: "vanilla",
      versions: [{ name: "claude", title: "Claude Code", version: "2.1.291" }],
      lastRun: { outcome: "updated", words: "Claude Code 2.1.286 → 2.1.291" },
      events: [{ kind: "updated", words: "Claude Code 2.1.286 → 2.1.291" }],
    });
  });

  it("only one run at a time: a check during a run is refused, and does not start another", async () => {
    await serving("update");
    expect(checkForAgentUpdate({ force: true })).toBe("started");
    expect(checkForAgentUpdate({ force: true })).toBe("running");
    expect(checkForAgentUpdate({ force: false })).toBe("running");
    await until((s) => s?.kind === "ready" && s.update === undefined);
    // The first download and the one update.
    expect(invocations()).toHaveLength(2);
  });

  it("a skipped update is not an error: the old bundle keeps serving, the receipt says so", async () => {
    await serving("skipupdate");
    checkForAgentUpdate({ force: true });
    await until((s) => s?.kind === "ready" && s.update === undefined);
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, first),
    });
    expect(lastReceipt()?.lastRun).toMatchObject({
      outcome: "skipped",
      words: "bundle not fully cached yet (would build claude-code)",
      by: "updater",
    });
    expect(lastReceipt()?.events[0]?.kind).toBe("skipped");
  });

  it("a failed update (a crash, no result line, no history line) is not an error either: the receipt carries it in padi's words", async () => {
    // The e2e fixture's crash handler always writes a result line, so THIS is
    // where padi's no-result path is exercised.
    await serving("crash");
    checkForAgentUpdate({ force: true });
    await until((s) => s?.kind === "ready" && s.update === undefined);
    expect(last()?.kind).toBe("ready");
    expect(lastReceipt()?.lastRun).toMatchObject({
      outcome: "failed",
      words: "the updater exited 3 without a result: TypeError: boom",
      by: "padi",
    });
    expect(lastReceipt()?.events).toEqual([]);
  });

  it("an update that dies with no `current` left keeps the old bundle — never a first download", async () => {
    await serving("vanish");
    checkForAgentUpdate({ force: true });
    await until((s) => s?.kind === "ready" && s.update === undefined);
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, first),
    });
    expect(newTerminalLayer()?.bundle).toBe(join(root, first));
    // Nothing else started.
    expect(invocations()).toHaveLength(2);
  });

  it("the receipt names every profile with a run in flight, from start to end", async () => {
    await serving("update");
    expect(lastReceipt()?.running).toEqual([]);
    checkForAgentUpdate({ force: true });
    expect(lastReceipt()?.running).toEqual(["vanilla"]);
    await until((s) => s?.kind === "ready" && s.update === undefined);
    expect(lastReceipt()?.running).toEqual([]);
  });

  it("an unchanged run: same bundle, the receipt says it checked and is up to date", async () => {
    await serving("unchanged");
    checkForAgentUpdate({ force: true });
    await until(() => lastReceipt()?.lastRun?.outcome === "unchanged");
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, first),
    });
  });

  it("the due rule: a fresh stamp is not due; the scheduled check then starts nothing", async () => {
    await serving("unchanged");
    checkForAgentUpdate({ force: true });
    await until(() => lastReceipt()?.lastRun?.outcome === "unchanged");
    expect(checkForAgentUpdate({ force: false })).toBe("notDue");
    // A day later it is due again.
    const runs = invocations().length;
    expect(
      checkForAgentUpdate({ force: false, now: Date.now() + 86_400_000 }),
    ).toBe("started");
    await until((s) => s?.kind === "ready" && s.update === undefined);
    expect(invocations()).toHaveLength(runs + 1);
  });

  it("refuses with nothing serving: agents off, or a first download that has not landed", async () => {
    expect(checkForAgentUpdate({ force: true })).toBe("notReady");
    process.env.STUB_MODE = "fail";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(checkForAgentUpdate({ force: true })).toBe("notReady");
  });

  it("a first download still in flight refuses as running", async () => {
    process.env.STUB_MODE = "slow";
    write(ON);
    expect(checkForAgentUpdate({ force: true })).toBe("running");
    await until((s) => s?.kind === "ready");
  });
});

describe("an update that does not land cleanly keeps the agents", () => {
  async function serving(mode: string): Promise<void> {
    write(ON);
    await until((s) => s?.kind === "ready" && s.update === undefined);
    process.env.STUB_MODE = mode;
  }

  it("a landing other than the one reported: still ready on the old bundle, the new path disowned, the receipt says it failed", async () => {
    await serving("updateelsewhere");
    expect(checkForAgentUpdate({ force: true })).toBe("started");
    await until((s) => s?.kind === "ready" && s.update === undefined);
    // Never `error`: the old bundle keeps serving, and new terminals get it.
    expect(last()).toEqual({
      kind: "ready",
      profile: "vanilla",
      bundle: join(root, "store-fetched-vanilla"),
    });
    expect(newTerminalLayer()?.bundle).toBe(
      join(root, "store-fetched-vanilla"),
    );
    expect(receipts.at(-1)?.lastRun).toMatchObject({
      outcome: "failed",
      by: "padi",
    });
    expect(receipts.at(-1)?.lastRun?.words).toMatch(/landed .*other/);
    // The next update lands cleanly and replaces it.
    process.env.STUB_MODE = "update";
    expect(checkForAgentUpdate({ force: true })).toBe("started");
    await until(
      (s) =>
        s?.kind === "ready" && s.bundle === join(root, "store-newer-vanilla"),
    );
  });
});

describe("scheduled updates: a failed run is retried, a skip waits", () => {
  // The policy's tick, on a fake wall clock (only `Date`: the stub still runs
  // in real time) from the next real boundary (02/08/14/20 UTC) — later than
  // any stamp a stub run writes now.
  const t0 =
    (Math.floor((Date.now() / 1000 - 7200) / 21600) + 1) * 21600 * 1000 +
    7200 * 1000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** The timer's tick at wall-clock `atMs`. */
  const tick = (boundaryPassed: boolean, atMs: number) => {
    vi.setSystemTime(atMs);
    onAgentUpdateTick(boundaryPassed);
  };
  const runs = () => invocations().length;
  async function settled(): Promise<void> {
    await until((s) => s?.kind === "ready" && s.update === undefined);
  }
  async function servingWith(mode: string): Promise<void> {
    write(ON);
    await settled();
    process.env.STUB_MODE = mode;
  }

  it("a FAILED run (say, offline at the boundary) gets upstream's three attempts, five minutes apart", async () => {
    await servingWith("fail");
    const first = runs();
    tick(true, t0);
    await settled();
    expect(runs()).toBe(first + 1);
    tick(false, t0 + 60_000); // too soon
    expect(runs()).toBe(first + 1);
    tick(false, t0 + 300_000);
    await settled();
    expect(runs()).toBe(first + 2);
    tick(false, t0 + 600_000);
    await settled();
    expect(runs()).toBe(first + 3);
    tick(false, t0 + 900_000); // out of attempts
    tick(false, t0 + 3_600_000);
    expect(runs()).toBe(first + 3);
    // The next boundary starts over.
    tick(true, t0 + 6 * 3_600_000);
    await settled();
    expect(runs()).toBe(first + 4);
  });

  it("the five minutes count from when the failed run ENDED", async () => {
    await servingWith("slowfail");
    const first = runs();
    tick(true, t0);
    // The run fails four minutes in.
    vi.setSystemTime(t0 + 240_000);
    await settled();
    expect(runs()).toBe(first + 1);
    tick(false, t0 + 300_000); // a minute after it failed
    expect(runs()).toBe(first + 1);
    tick(false, t0 + 540_000);
    await settled();
    expect(runs()).toBe(first + 2);
  });

  it("a SKIPPED run is not retried: it waits for the next boundary", async () => {
    await servingWith("skipupdate");
    const first = runs();
    tick(true, t0);
    await settled();
    expect(runs()).toBe(first + 1);
    tick(false, t0 + 300_000);
    tick(false, t0 + 600_000);
    expect(runs()).toBe(first + 1);
  });

  it("an ask that met a run in flight asks again on the next tick", async () => {
    await servingWith("update");
    const first = runs();
    expect(checkForAgentUpdate({ force: true })).toBe("started"); // a Check now
    tick(true, t0); // the boundary meets it: no run, no attempt
    await settled();
    expect(runs()).toBe(first + 1); // the Check now's run only
    process.env.STUB_MODE = "fail";
    tick(false, t0 + 60_000); // asked again
    await settled();
    expect(runs()).toBe(first + 2);
  });
});
