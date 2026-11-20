import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { CONTROL_CORE_VERSION } from "@kolu/surface-daemon";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { connectPadi } from "./dial.ts";
import { PADI_SURFACE_VERSION, padiControlSibling } from "./surface.ts";

const STATE_ROOT = "/tmp/padi-client-smoke";
const STARTED_AT = 1_700_000_000_000;

type FakePadi = {
  socketPath: string;
  close: () => Promise<void>;
};

async function serveFakePadi(surfaceVersion: string): Promise<FakePadi> {
  const dir = mkdtempSync(join(tmpdir(), "padi-client-dial-"));
  const socketPath = join(dir, "padi.sock");
  const runtime = implementSurface(padiControlSibling, {
    cells: {
      version: {
        store: inMemoryStore({ controlCoreVersion: CONTROL_CORE_VERSION }),
      },
    },
    procedures: {
      core: {
        hello: () =>
          Effect.succeed({
            stateRoot: STATE_ROOT,
            surfaceVersion,
            controlCoreVersion: CONTROL_CORE_VERSION,
            startedAt: STARTED_AT,
          }),
        drain: () => Effect.void,
        controlVersion: () =>
          Effect.succeed({ controlCoreVersion: CONTROL_CORE_VERSION }),
        clockNow: () => Effect.succeed({ epochMs: STARTED_AT }),
      },
    },
  });

  const listener: UnixSocketListener = await serveOverUnixSocket({
    socketPath,
    group: padiControlSibling.group,
    handlers: runtime.handlers,
    log: silentLogger,
  });
  expect(listener.outcome).toEqual({ kind: "listening" });

  return {
    socketPath,
    close: async () => {
      listener.close();
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let live: FakePadi | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

describe("connectPadi, with no padi installed", () => {
  it("dials a socket, handshakes the frozen core, and reports the far end's identity", async () => {
    live = await serveFakePadi(PADI_SURFACE_VERSION);

    const connection = await Effect.runPromise(connectPadi(live.socketPath));
    try {
      expect(connection.identity.stateRoot).toBe(STATE_ROOT);
      expect(connection.identity.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(connection.startedAt).toBe(STARTED_AT);
      expect(connection.metadata.controlCoreVersion).toBe(CONTROL_CORE_VERSION);
    } finally {
      connection.dispose();
    }
  });

  it("hands back BOTH typed faces over the one dispatch — the control core answers on it", async () => {
    live = await serveFakePadi(PADI_SURFACE_VERSION);

    const connection = await Effect.runPromise(connectPadi(live.socketPath));
    try {
      const version = await Effect.runPromise(
        connection.client.control.surface.core.controlVersion(),
      );
      expect(version).toStrictEqual({
        controlCoreVersion: CONTROL_CORE_VERSION,
      });
      expect(typeof connection.client.padi.surface.terminals.keys).toBe(
        "function",
      );
    } finally {
      connection.dispose();
    }
  });

  it("REFUSES a padi it cannot speak to, loudly and by type", async () => {
    const ahead = `${Number(PADI_SURFACE_VERSION.split(".")[0]) + 1}.0`;
    live = await serveFakePadi(ahead);

    const error = await Effect.runPromise(connectPadi(live.socketPath)).then(
      (connection) => {
        connection.dispose();
        return undefined as unknown;
      },
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(DaemonContractSkewError);
    expect((error as DaemonContractSkewError).daemonVersion).toBe(ahead);
    expect((error as DaemonContractSkewError).requiredVersion).toBe(
      PADI_SURFACE_VERSION,
    );
  });
});
