/** Framework-owned endpoint disposition for a version-skewed survivor. */

import { expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import { createEndpointForKoluTest as createEndpoint } from "./createEndpoint.kolu.testlib.ts";
import {
  converge,
  DaemonContractSkewError,
  type EndpointStatus,
  outcomeAdopted,
} from "./index.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describeDaemon("socket-contract mismatch names itself (upgrade-window)", () => {
  it("endpoint reports incompatible and leaves the survivor standing", async () => {
    const survivor = await plantYesterdayDaemon({
      gateFile: "daemon.pid",
      socketFile: "daemon.sock",
      assertSpawnAllowed: assertDaemonSpawnAllowed,
      plantState: () => {},
    });
    if (survivor.process.kind !== "live") {
      throw new Error("expected live survivor process");
    }
    const survivorPid = survivor.process.pid;

    const statuses: EndpointStatus<{ staleKey: string }>[] = [];
    try {
      const endpoint = createEndpoint<string, { staleKey: string }>({
        hostId: "local",
        home: {
          dir: survivor.dir,
          gatePath: survivor.gatePath,
          socketPath: survivor.socketPath,
        },
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "2.0",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "refuse" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            throw new Error("spawn must not run on a refused skew");
          },
        },
        connect: async () => {
          throw new DaemonContractSkewError({
            subject: "daemon",
            daemonVersion: "1.0",
            requiredVersion: "2.0",
            pid: survivorPid,
          });
        },
        log: silentLog,
        onStatus: (_host, status) => statuses.push(status),
        socketPollMs: 5,
        adoptConnectAttempts: 2,
        adoptConnectRetryMs: 1,
      });
      const outcome = await converge(endpoint);
      expect(outcomeAdopted(outcome)).toBe(false);
      expect(statuses.map((status) => status.state)).toContain("incompatible");
      const last = statuses.at(-1);
      expect(last?.state).toBe("incompatible");
      if (last?.state === "incompatible") {
        expect(last.daemonVersion).toBe("1.0");
        expect(last.requiredVersion).toBe("2.0");
      }
    } finally {
      await survivor.dispose();
    }
  });
});
