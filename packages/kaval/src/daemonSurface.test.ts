import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { buildSurfaceFace } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  kavalControlSurface,
  kavalDaemonGroup,
  serveKavalDaemonSurface,
} from "./daemonSurface.ts";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { ptyHostClientOver } from "./ptyHostClient.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

const runtimes: Array<{ close(): Promise<void> }> = [];
const savedEnv = { ...process.env };
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  process.env = { ...savedEnv };
});

const EXPECTED_DAEMON_TAGS = [
  "surface/activity/get",
  "surface/commandRun/get",
  "surface/cwd/get",
  "surface/exit/get",
  "surface/foreground/get",
  "surface/inventory/get",
  "surface/terminalAttach/get",
  "surface/title/get",
  "surface/system/heartbeat",
  "surface/system/info",
  "surface/system/version",
  "surface/terminal/getHistory",
  "surface/terminal/getScreenCells",
  "surface/terminal/getScreenState",
  "surface/terminal/getScreenText",
  "surface/terminal/kill",
  "surface/terminal/killAll",
  "surface/terminal/list",
  "surface/terminal/resize",
  "surface/terminal/spawn",
  "surface/terminal/write",
  "surface/system/clockNow",
  "surface/system/identity",
  "surface/system/live",
  "surface/control/core/drain",
  "surface/control/core/hello",
  "surface/control/system/clockNow",
  "surface/control/system/identity",
  "surface/control/system/live",
].sort();

describe("kaval daemon group", () => {
  it("advertises exactly the pty-host tags plus the control sibling's — nothing renamed, nothing dropped", () => {
    expect([...kavalDaemonGroup.requests.keys()].sort()).toEqual(
      EXPECTED_DAEMON_TAGS,
    );
  });

  it("is the DISJOINT union of its two halves (a silent merge-collision would shrink it)", () => {
    expect(kavalDaemonGroup.requests.size).toBe(
      ptyHostSurface.group.requests.size +
        kavalControlSurface.group.requests.size,
    );
    const ptyTags = new Set(ptyHostSurface.group.requests.keys());
    const overlap = [...kavalControlSurface.group.requests.keys()].filter(
      (tag) => ptyTags.has(tag),
    );
    expect(overlap).toEqual([]);
  });

  it("binds exactly one handler at every advertised tag, and none anywhere else", () => {
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-tags-rc-")),
      lifetime: { kind: "forever" },
    });
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/user/1000/kaval-test",
    });
    runtimes.push(runtime);
    expect(Object.keys(runtime.handlers).sort()).toEqual(EXPECTED_DAEMON_TAGS);
  });
});

describe("kaval daemon surface", () => {
  it("adds frozen identity without moving system.version, and drain refuses without ending the daemon", async () => {
    process.env.KAVAL_COMMIT_HASH = "abc1234";
    process.env.KAVAL_BUILD_ID = "kaval-build-7";
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-control-rc-")),
      lifetime: { kind: "forever" },
    });
    process.env.KAVAL_COMMIT_HASH = "changed-after-boot";
    process.env.KAVAL_BUILD_ID = "changed-after-boot";
    expect(Object.isFrozen(ptyHost)).toBe(true);
    expect(Object.isFrozen(ptyHost.boot)).toBe(true);
    expect(Object.isFrozen(ptyHost.boot.identity)).toBe(true);
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/user/1000/kaval-test",
    });
    runtimes.push(runtime);
    const dispatch = directDispatch(runtime);
    const pty = ptyHostClientOver(dispatch);
    const control = buildSurfaceFace(kavalControlSurface, dispatch).surface
      .core as {
      hello(): Effect.Effect<Record<string, unknown>, unknown>;
      drain(): Effect.Effect<void, unknown>;
    };

    const version = await Effect.runPromise(pty.surface.system.version({}));
    expect(Object.keys(version).sort()).toEqual([
      "contractVersion",
      "identity",
      "lifetime",
      "pid",
      "startedAt",
    ]);
    expect(version.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(version.identity).toEqual({
      staleKey: "kaval-build-7",
      navigableCommit: "abc1234",
    });

    const hello = await Effect.runPromise(control.hello());
    expect(hello).toEqual({
      stateRoot: "/run/user/1000/kaval-test",
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      controlCoreVersion: "1.0",
      startedAt: version.startedAt,
      commit: "abc1234",
      buildId: "kaval-build-7",
    });

    await expect(Effect.runPromise(control.drain())).rejects.toThrow(
      /not drainable/,
    );
    await expect(Effect.runPromise(control.hello())).resolves.toEqual(hello);
    await expect(
      Effect.runPromise(pty.surface.system.heartbeat({})),
    ).resolves.toEqual({
      ts: expect.any(Number),
    });

    await expect(
      Effect.runPromise(pty.surface.terminal.list({})),
    ).resolves.toEqual({
      entries: [],
    });
  });
});
