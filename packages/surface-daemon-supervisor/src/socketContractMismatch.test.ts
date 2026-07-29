/** Framework-owned endpoint disposition for a version-skewed survivor. */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import {
  converge,
  createEndpoint,
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
    assertDaemonSpawnAllowed("socket-contract mismatch survivor");
    const dir = mkdtempSync(join(tmpdir(), "upgrade-incompat-"));
    const socketPath = join(dir, "daemon.sock");
    const gatePath = join(dir, "daemon.pid");
    const survivor = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      { stdio: "ignore" },
    );
    const survivorPid = survivor.pid as number;
    writeFileSync(gatePath, `${survivorPid}\n`);
    const server = createServer((socket) => socket.on("error", () => {}));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const statuses: EndpointStatus<{ staleKey: string }>[] = [];
    try {
      const endpoint = createEndpoint<string, { staleKey: string }>({
        hostId: "local",
        home: { dir: dirname(socketPath), gatePath, socketPath },
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
      server.close();
      survivor.kill("SIGKILL");
    }
  });
});
