/**
 * The CONSUMER smoke: dial a padi that does not exist.
 *
 * `connectPadi` is the one verb an out-of-repo consumer (olai's server, PR 1a of
 * the orchestrator plan) calls, and the whole claim of this package is that it
 * works with NO padi installed — no daemon binary, no kaval, no PTY host, no
 * spawn. So this test stands up the far end itself: a plain `net` server on a
 * temp socket serving the frozen control core over the same ndjson framing a
 * real padi serves, and then dials it with the real `connectPadi`.
 *
 * That is deliberately the WHOLE local dial path, not a mock of it —
 * `dialSocket` → `socketDuplexLink` over `padiDaemonGroup` → the control-core
 * `hello` → the compatibility gate → the two typed faces built over one
 * dispatch. `packages/padi`'s own `dial.test.ts` covers the same path against a
 * REAL spawned padi and stays there, where the daemon is; what is new here is
 * the arrangement a hydrating consumer is actually in.
 *
 * The far end serves only the CONTROL sibling, which is exactly what makes the
 * point: the frozen core is reachable independently of `padiSurface`'s version,
 * so the third case below — a padi one major ahead — is refused by the gate
 * rather than discovered as a schema-decode failure three calls later.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTROL_CORE_VERSION } from "@kolu/surface-daemon";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { connectPadi } from "./dial.ts";
import { PADI_SURFACE_VERSION, padiControlSibling } from "./surface.ts";

const STATE_ROOT = "/tmp/padi-client-smoke";
const STARTED_AT = 1_700_000_000_000;

/** Everything the temp socket owns, so a failing expectation still tears down. */
type FakePadi = {
  socketPath: string;
  close: () => Promise<void>;
};

/**
 * A padi far end that is not a padi: the frozen control core, served on a unix
 * socket, answering `hello` with the version it is told to claim.
 *
 * `serveOverStdio` with an explicit `transport` is the in-process serve — the
 * connection socket is BOTH halves (a duplex), the same shape `socketDuplexLink`
 * dials from the other side. No readiness banner, deliberately: the local
 * unix-socket rendezvous does not carry one (see `dialPadiHello`'s note), so a
 * banner here would test a discipline this leg does not have.
 */
function serveFakePadi(surfaceVersion: string): FakePadi {
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

  // `void` because the serve settles when the connection ends, and the
  // connection ends when the dial disposes — the teardown below closes the
  // listener and the runtime, which is what this test owns.
  const server: Server = createServer((conn) => {
    void serveOverStdio({
      group: padiControlSibling.group,
      handlers: runtime.handlers,
      transport: { read: conn, write: conn },
    });
  });
  server.listen(socketPath);

  return {
    socketPath,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
    live = serveFakePadi(PADI_SURFACE_VERSION);

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
    live = serveFakePadi(PADI_SURFACE_VERSION);

    const connection = await Effect.runPromise(connectPadi(live.socketPath));
    try {
      // The control face, called for real over the wire. The padi face is built
      // over the SAME dispatch (that is `padiClientOver`'s whole job) — its
      // members address `surface/padi/*`, which this far end deliberately does
      // not serve, so what is proved here is that the dispatch is live and the
      // faces are the ones a consumer holds, not that a fake padi is a padi.
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
    // A major ahead — the compatibility gate's whole reason to exist. Note the
    // frozen core still answered: the refusal is a JUDGEMENT on a readable
    // hello, never a decode failure.
    const ahead = `${Number(PADI_SURFACE_VERSION.split(".")[0]) + 1}.0`;
    live = serveFakePadi(ahead);

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
