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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/padi-client/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  __resetAgentDistroDownloadsForTest,
  __setAgentDistroBakeForTest,
  agentDistroSettingStore,
  onAgentDistroSettingWrite,
} from "./agentDistro.ts";
import type { AgentDistroBake } from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
const ON: AgentDistroSetting = { enabled: true, profile: "vanilla" };
const OFF: AgentDistroSetting = { enabled: false, profile: "vanilla" };

// The stub updater: `node stub.mjs <config> --progress`, speaking the real
// updater's `--progress` protocol — progress lines, then one result line, human
// words on stderr.
const STUB = `
import { appendFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + "\\n");
const cfg = JSON.parse(readFileSync(args[0], "utf8"));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const land = () => {
  mkdirSync(cfg.state, { recursive: true });
  symlinkSync(process.env.STUB_BUNDLE, cfg.state + "/current");
  out({ result: "updated", bundle: process.env.STUB_BUNDLE });
};
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
  case "crash":
    process.stderr.write("TypeError: boom\\n");
    process.exit(3);
}
`;

let root: string;
let stubLog: string;
let published: AgentDistroStatus[];
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
  const deadline = Date.now() + 5_000;
  while (!pred(last())) {
    if (Date.now() > deadline)
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
    "STUB_MODE",
  ])
    saved[k] = process.env[k];
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.PATH = `${fakeBin}:${saved.PATH ?? ""}`;
  process.env.STUB_LOG = stubLog;
  process.env.STUB_BUNDLE = bundle;
  process.env.STUB_MODE = "ok";
  const bake: AgentDistroBake = {
    floor: undefined, // a remote host
    plugins: "/p/plugin",
    stateHomePlaceholder: PLACEHOLDER,
    profiles: new Map([
      [
        "vanilla",
        {
          name: "vanilla",
          command: [process.execPath, stub],
          configText: JSON.stringify({
            profile: "vanilla",
            state: `${PLACEHOLDER}/agent-distro/vanilla`,
            history: `${PLACEHOLDER}/agent-distro/history.log`,
          }),
        },
      ],
    ]),
  };
  __setAgentDistroBakeForTest(bake);
  __resetAgentDistroDownloadsForTest();
  agentDistroSettingStore.set(OFF);
  published = [];
  setPadiSurfaceCtx({
    cells: new Proxy({} as never, {
      get: (_t, name) => ({
        get: () => undefined,
        set: (v: AgentDistroStatus) => {
          if (name === "agentDistroStatus") published.push(v);
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

  it("a run that dies without its result line is an error naming it", async () => {
    process.env.STUB_MODE = "crash";
    write(ON);
    await until((s) => s?.kind === "error");
    expect(last()).toMatchObject({
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

  it("no `nix` on padi's PATH is an error that says so, and runs nothing", () => {
    process.env.PATH = join(root, "nowhere");
    write(ON);
    const status = last();
    expect(status?.kind).toBe("error");
    expect(status?.kind === "error" ? status.message : "").toMatch(
      /nix is not on padi's PATH/,
    );
    expect(invocations()).toHaveLength(0);
  });
});
