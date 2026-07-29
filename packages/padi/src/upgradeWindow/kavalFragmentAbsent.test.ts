/** Yesterday-kaval arm: a live pty-host surface with no frozen fragment. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { daemonBuild, type Logger } from "@kolu/surface-daemon";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import { decide } from "@kolu/surface-daemon-supervisor";
import {
  createInProcessPtyHost,
  PTY_HOST_CONTRACT_VERSION,
  servePtyHostOverUnixSocket,
} from "kaval";
import { expect, it } from "vitest";
import { probeKavalForConvergence } from "../ptyHost/connect.ts";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

describeDaemon("yesterday kaval without the frozen fragment", () => {
  it("becomes a build mismatch and the not-drainable policy nudges the human", async () => {
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: false }),
    );
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "yesterday-kaval-rc-")),
      lifetime: { kind: "forever" },
    });
    const listener = await servePtyHostOverUnixSocket({
      socketPath: yesterday.socketPath,
      router: ptyHost.servedRouter,
      log: silentLog,
    });
    try {
      const probe = await probeKavalForConvergence(yesterday.socketPath);
      expect(probe).not.toBeNull();
      if (probe === null) throw new Error("fragment absence became null");
      expect(probe.identity).toEqual({
        contractVersion: PTY_HOST_CONTRACT_VERSION,
        build: { kind: "off-nix" },
      });
      expect(probe.instanceKey).toEqual({ kind: "pre-instance" });

      const decision = decide(
        {
          capability: "not-drainable",
          baked: {
            contractVersion: PTY_HOST_CONTRACT_VERSION,
            build: daemonBuild("current-kaval-build"),
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe.identity,
      );
      expect(decision.kind).toBe("report-mismatch");
      probe.dispose();
    } finally {
      listener.close();
      await ptyHost.close();
      await yesterday.dispose();
    }
  });
});
