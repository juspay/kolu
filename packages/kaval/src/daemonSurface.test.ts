import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directLink } from "@kolu/surface/links/direct";
import type { Logger } from "@kolu/surface-daemon";
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

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

const runtimes: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe("kaval daemon surface", () => {
  it("adds frozen identity without moving system.version, and drain refuses without ending the daemon", async () => {
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-control-rc-")),
      lifetime: { kind: "forever" },
    });
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/user/1000/kaval-test",
      commit: "abc1234",
      buildId: "kaval-build-7",
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
