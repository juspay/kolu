import { mkdtempSync } from "node:fs";
import { Effect } from "effect";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { daemonBuild } from "@kolu/surface-daemon";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  decide,
  instanceKeyFromStartedAt,
  isUnspeakablePeerError,
  isUnspeakableProtocolError,
} from "@kolu/surface-daemon-supervisor";
import {
  createInProcessPtyHost,
  PTY_HOST_CONTRACT_VERSION,
  serveKavalDaemonSurface,
  servePtyHostOverUnixSocket,
} from "kaval";
import { expect, it } from "vitest";
import { probeKavalForConvergence } from "../ptyHost/connect.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

const kavalPolicy = {
  capability: "not-drainable",
  baked: {
    contractVersion: PTY_HOST_CONTRACT_VERSION,
    build: daemonBuild("current-kaval-build"),
  },
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
} as const;

describeDaemon("yesterday kaval at our rendezvous", () => {
  it("PREVIOUS EPOCH: an undecodable first frame is classified at the decode, never as absence", async () => {
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: false }),
    );
    let server: Server | undefined;
    try {
      server = createServer((socket) => {
        socket.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code !== "ECONNRESET" && err.code !== "EPIPE") throw err;
        });
        socket.write("EVENT: hello\ndata: {oh no}\n\n");
      });
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(yesterday.socketPath, () => resolve());
      });

      const raised = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      ).then(
        (probe) => {
          throw new Error(
            `probe resolved ${probe === null ? "null" : "an identity"} against an undecodable peer`,
          );
        },
        (error: unknown) => error,
      );

      expect(isUnspeakableProtocolError(raised)).toBe(true);
      if (!isUnspeakableProtocolError(raised)) throw new Error("unreachable");
      expect(raised.socketPath).toBe(yesterday.socketPath);
      expect(raised.evidence.trigger).toBe("undecodable-frame");
      if (raised.evidence.trigger !== "undecodable-frame") {
        throw new Error("unreachable");
      }
      expect(raised.evidence.frame).toContain("EVENT: hello");
      expect(raised.evidence.frame.startsWith('"')).toBe(true);

      expect(isUnspeakablePeerError(raised)).toBe(false);
    } finally {
      server?.close();
      await yesterday.dispose();
    }
  });

  it("PREVIOUS EPOCH, SILENT: a peer that accepts and never answers is classified at the silence bound", async () => {
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: true }),
    );
    try {
      const raised = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      ).then(
        (probe) => {
          probe?.dispose();
          throw new Error(
            `probe resolved ${probe === null ? "null" : "an identity"} against a silent peer`,
          );
        },
        (error: unknown) => error,
      );

      expect(isUnspeakableProtocolError(raised)).toBe(true);
      if (!isUnspeakableProtocolError(raised)) throw new Error("unreachable");
      expect(raised.socketPath).toBe(yesterday.socketPath);
      expect(raised.evidence.trigger).toBe("silence");

      expect(isUnspeakablePeerError(raised)).toBe(false);
    } finally {
      await yesterday.dispose();
    }
  }, 30_000);

  it("SAME EPOCH, different build: the not-drainable policy nudges the human", async () => {
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: false }),
    );
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "yesterday-kaval-rc-")),
      lifetime: { kind: "forever" },
    });
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/kaval-yesterday",
    });
    const listener = await servePtyHostOverUnixSocket({
      socketPath: yesterday.socketPath,
      served: { group: runtime.group, handlers: runtime.handlers },
      log: silentLog,
    });
    try {
      const probe = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      );
      expect(probe).not.toBeNull();
      if (probe === null) throw new Error("a speakable peer probed to null");
      expect(probe.identity).toEqual({
        contractVersion: PTY_HOST_CONTRACT_VERSION,
        build: { kind: "off-nix" },
      });
      expect(probe.instanceKey).toEqual(
        instanceKeyFromStartedAt(ptyHost.boot.startedAt),
      );

      const decision = decide(kavalPolicy, probe.identity);
      expect(decision).toMatchObject({
        kind: "report-mismatch",
        running: {
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          build: { kind: "off-nix" },
        },
      });
      probe.dispose();
    } finally {
      listener.close();
      await runtime.close();
      await ptyHost.close();
      await yesterday.dispose();
    }
  });
});
