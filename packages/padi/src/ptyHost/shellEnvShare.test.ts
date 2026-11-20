import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Endpoint } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import type { PtyHostClient, PtyHostIdentity, PtyHostSystemInfo } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAgentToolsLinkDirs } from "../agentToolsBake.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { setLocalSocketPath } from "./daemonStatus.ts";
import { scriptedDispatch } from "./dispatch.testlib.ts";
import {
  __setEndpointForTest,
  setSpawnServerVersion,
  terminalShellEnv,
} from "./index.ts";

type KavalEndpoint = Endpoint<
  PtyHostClient,
  PtyHostIdentity,
  KavalConnectionMetadata
>;

const BASH = execFileSync("sh", ["-c", "command -v bash"], {
  encoding: "utf8",
}).trim();

setSpawnServerVersion("9.9.9-test");
setAgentToolsLinkDirs([]);

let home: string;
let rcDir: string;
let runs: string;
let restoreEndpoint = (): void => {};

const ranCount = (): number =>
  readFileSync(runs, "utf8")
    .split("\n")
    .filter((line) => line !== "").length;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "shell-env-share-home-")));
  rcDir = realpathSync(mkdtempSync(join(tmpdir(), "shell-env-share-rc-")));
  runs = join(home, "runs");
  appendFileSync(runs, "");
  writeFileSync(
    join(home, ".bashrc"),
    [
      "[[ $- == *i* ]] || return",
      `echo ran >> ${runs}`,
      "export LITELLM_API_KEY=sk-from-bashrc",
    ].join("\n"),
  );
  vi.stubEnv("SHELL", BASH);
  vi.stubEnv("HOME", home);
  setLocalSocketPath(join(rcDir, "kaval.sock"));
  const info: PtyHostSystemInfo = {
    shell: BASH,
    home,
    platform: "linux",
    rcDir,
  };
  const endpoint = {
    current: () => ({
      metadata: {
        dispatch: scriptedDispatch((tag) =>
          tag.endsWith("system/info") ? async () => info : undefined,
        ),
      },
    }),
  } as unknown as KavalEndpoint;
  restoreEndpoint = __setEndpointForTest(endpoint);
});

afterEach(() => {
  restoreEndpoint();
  restoreEndpoint = (): void => {};
  vi.unstubAllEnvs();
});

const ask = () =>
  terminalShellEnv({
    cwd: home,
    agents: { bundle: join(home, "bundle"), plugins: "plugins", profiles: [] },
  });

describe("two questions about the same directory and layer", () => {
  it("in flight together cost ONE shell, and both get its answer", async () => {
    const [first, second] = await Effect.runPromise(
      Effect.all([ask(), ask()], { concurrency: "unbounded" }),
    );
    expect(first?.LITELLM_API_KEY).toBe("sk-from-bashrc");
    expect(second).toEqual(first);
    expect(ranCount()).toBe(1);
  }, 30_000);

  it("asked again after that one answered, read the dotfiles again", async () => {
    await Effect.runPromise(ask());
    await Effect.runPromise(ask());
    expect(ranCount()).toBe(2);
  }, 30_000);
});
