/**
 * The connect middle-hop for the Kaval-lifetime mirror (F6): `connectKaval`
 * reads `system.version` off a live kaval and copies its OPTIONAL `lifetime`
 * onto the connection `metadata` (`connect.ts` → `metadata.lifetime`). Because
 * `KavalConnectionMetadata.lifetime` is optional (a survivor predating the field
 * reports none), deleting that copy still type-checks — so the passthrough needs
 * a behavioural pin, not just the schema round-trip. This dials a REAL kaval over
 * a REAL unix socket (the exact `dialSocket` + `stdioLink` path production uses)
 * and asserts the served lifetime arrives on the metadata.
 */

import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@kolu/surface-daemon";
import {
  type PtyHostSocketListener,
  createInProcessPtyHost,
  servePtyHostOverUnixSocket,
} from "kaval";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectKaval } from "./connect.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

/** Serve a kaval whose resolved lifetime is `boundToPid` (the CI/smoke policy),
 *  so a copy of the value can be distinguished from the production `forever`. */
function serve(socketPath: string): Promise<PtyHostSocketListener> {
  const { servedRouter } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-connect-rc-")),
    lifetime: { kind: "boundToPid", pid: 4242 },
  });
  return servePtyHostOverUnixSocket({
    socketPath,
    router: servedRouter,
    log: silentLog,
  });
}

describe("connectKaval — mirrors the handshake lifetime onto the metadata", () => {
  let listener: PtyHostSocketListener;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-connect-sock-")),
      "pty-host.sock",
    );
    listener = await serve(socketPath);
  });

  afterAll(() => listener.close());

  it("carries the served lifetime through to metadata.lifetime", async () => {
    const conn = await connectKaval(socketPath);
    try {
      // The whole point of F6: this fails (undefined) if the `lifetime:
      // version.lifetime` copy in connect.ts is dropped, even though the type
      // stays green because the field is optional.
      expect(conn.metadata.lifetime).toEqual({ kind: "boundToPid", pid: 4242 });
      expect(conn.metadata.contractVersion).toBeTypeOf("string");
    } finally {
      conn.dispose();
    }
  });
});

describe("connectKaval — the handshake read is bounded (F2)", () => {
  it("rejects on the baked deadline when a peer accepts the socket but never answers system.version", async () => {
    // A foreign squatter (or wedged daemon) accepts the unix connection but sends
    // no oRPC reply — without a deadline the read would pend forever and hang boot,
    // and the gate-less-squatter recovery would never reach its foreign refusal.
    // `connectKaval` carries NO deadline override (fail-fast: no knobs), so this
    // drives the single baked 10s policy under FAKE timers — production and this test
    // run the same parameterless implementation, just with the clock advanced.
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-silent-")),
      "pty-host.sock",
    );
    const server = createServer(() => {
      // accept, then never respond
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    // Fake ONLY setTimeout so the real dial + version-send still progress over IO;
    // the deadline timer is the one thing under our control.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const outcome = connectKaval(socketPath).then(
        () => "resolved",
        (e: unknown) => (e as Error).message,
      );
      // Let the real dial complete and the deadline timer arm (setImmediate is not faked).
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(outcome).resolves.toMatch(/handshake read exceeded 10000ms/);
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });
});
