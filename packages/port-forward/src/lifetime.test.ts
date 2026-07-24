/**
 * The property the ssh mechanism was rebuilt for: a forward does not outlive
 * the process that opened it — including when that process is SIGKILLed and
 * gets no chance to clean anything up.
 *
 * This is the one test that can only be written with a real sshd and a real
 * child process: the failure it pins (a listener still answering after its
 * owner is gone) is invisible in-process, and was exactly what the earlier
 * shared-ControlMaster design did for the length of a 10-minute idle timer.
 *
 * Gated twice, deliberately: `describeDaemon` (this forks a real child, the
 * `KOLU_DAEMON_TESTS` leash) and a live-sshd probe, since a build sandbox has
 * no sshd to reach. Both gates SKIP rather than fail — a skipped line in the
 * output is honest about what did not run.
 */

import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDaemonSpawnAllowed,
  daemonTestsEnabled,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { expect, it } from "vitest";

/** tsx's ESM loader, resolved from THIS package — `node --import <loader>
 *  fixture.ts` runs the TypeScript fixture as a real child (the shape
 *  `surface-remote`'s process-lifetime pins use). */
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;
const here = dirname(fileURLToPath(import.meta.url));

/** The ssh host the fixture forwards from. This machine's own sshd is a real
 *  ssh hop — the mechanism under test is the ssh child's lifetime, and that is
 *  identical whether the far end is across the room or across the loopback. */
const SSH_HOST = "localhost";

/** Can we reach an sshd non-interactively? Probed only when the daemon gate is
 *  on, so a bare `vitest` run spawns nothing at all — and the leash below says
 *  so at the fork itself, which is what the meta-lint checks. */
async function sshReachable(): Promise<boolean> {
  assertDaemonSpawnAllowed("the port-forward ssh reachability probe");
  return await new Promise((resolve) => {
    execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", SSH_HOST, "true"],
      (err) => resolve(err === null),
    );
  });
}

/** This machine's own network address — where a forward listens and a
 *  loopback-only server does NOT. Probing 127.0.0.1 would be a false test: ssh
 *  binds `0.0.0.0:<port>` with SO_REUSEADDR, so it can and does listen BESIDE a
 *  `127.0.0.1:<port>` origin, and a loopback probe would then be answered by
 *  the origin — proving nothing about the tunnel, before or after the kill. */
function ownAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal)
        return address.address;
    }
  }
  return undefined;
}

const LAN = ownAddress();
const canRun =
  daemonTestsEnabled() && LAN !== undefined && (await sshReachable());

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function refusesWithin(
  host: string,
  port: number,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await accepts(host, port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describeDaemon("a forward's lifetime is its owner's lifetime", () => {
  it.skipIf(!canRun)(
    "stops answering the moment the owning process is SIGKILLed",
    { timeout: 60_000 },
    async () => {
      assertDaemonSpawnAllowed("the port-forward lifetime fixture");

      // A loopback-only origin, i.e. the thing a forward exists to expose.
      const origin = createServer((_req, res) => res.end("origin"));
      const originPort = await new Promise<number>((resolve) => {
        origin.listen(0, "127.0.0.1", () => {
          const address = origin.address();
          if (address === null || typeof address === "string") {
            throw new Error("no address for the origin server");
          }
          resolve(address.port);
        });
      });

      const child = spawn(
        process.execPath,
        [
          "--import",
          TSX_LOADER,
          join(here, "lifetime.fixture.ts"),
          SSH_HOST,
          String(originPort),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      try {
        const localPort = await new Promise<number>((resolve, reject) => {
          let out = "";
          let err = "";
          child.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            const ready = /READY (\d+)/.exec(out);
            if (ready?.[1] !== undefined) resolve(Number(ready[1]));
          });
          child.stderr.on("data", (chunk: Buffer) => {
            err += chunk.toString();
          });
          child.once("exit", (code) =>
            reject(
              new Error(`the fixture exited ${code} before forwarding: ${err}`),
            ),
          );
        });

        // It really is serving the loopback-only origin, on an address the
        // origin itself cannot be reached at — so this is the tunnel answering.
        const response = await fetch(`http://${LAN}:${localPort}/`);
        expect(await response.text()).toBe("origin");

        // The whole point: no cleanup runs, no timer is waited on.
        child.kill("SIGKILL");

        expect(await refusesWithin(String(LAN), localPort, 15_000)).toBe(true);
      } finally {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => origin.close(() => resolve()));
      }
    },
  );
});
