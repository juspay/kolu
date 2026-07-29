import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directLink } from "@kolu/surface/links/direct";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInProcessPtyHost,
  type PtyHostClient,
} from "./inProcessPtyHost.ts";
import {
  type kavalDaemonContract,
  serveKavalDaemonSurface,
} from "./daemonSurface.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";
import { silentLog } from "./silentLogger.testlib.ts";

const runtimes: Array<{ close(): Promise<void> }> = [];
const savedEnv = { ...process.env };
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  process.env = { ...savedEnv };
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
    // Both channels must stay closed over the one boot record, rather than
    // re-reading mutable ambient identity at request/composition time.
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
    const client = directLink<typeof kavalDaemonContract>(runtime.router);

    // Existing consumers keep the exact historic path and shape.
    const version = await client.surface.system.version({});
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

    const hello = await client.surface.control.core.hello();
    expect(hello).toEqual({
      stateRoot: "/run/user/1000/kaval-test",
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      controlCoreVersion: "1.0",
      startedAt: version.startedAt,
      commit: "abc1234",
      buildId: "kaval-build-7",
    });

    // Letter: the frozen void verb rejects with the approved typed refusal.
    await expect(client.surface.control.core.drain()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    // Effect: neither a silent success nor a daemon-killing implementation can
    // pass — the same daemon still answers both identity channels afterward.
    await expect(client.surface.control.core.hello()).resolves.toEqual(hello);
    await expect(client.surface.system.heartbeat({})).resolves.toEqual({
      ts: expect.any(Number),
    });

    // The legacy typed client remains a valid subset of the additive router.
    const legacy = client as unknown as PtyHostClient;
    await expect(legacy.surface.terminal.list({})).resolves.toEqual({
      entries: [],
    });
  });
});
