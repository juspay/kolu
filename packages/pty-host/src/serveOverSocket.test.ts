/**
 * Falsifiability test for the R-4 Phase 1 transport: the pty-host router served
 * over a REAL unix socket (`net.Server`) and consumed over a REAL `net.Socket`
 * via `stdioLink` — the exact path kolu-tui uses, minus the CLI formatting
 * (covered by @kolu/pty-tui's render test). A green run proves serveOverStdio +
 * stdioLink hold over a socket, not just the in-process loopback.
 */
import { mkdtempSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { Logger } from "kolu-shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";
import {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

type Client = ReturnType<typeof stdioLink<typeof ptyHostSurface.contract>>;

describe("servePtyHostOverUnixSocket — real unix-socket round-trip", () => {
  let listener: PtyHostSocketListener;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-pty-sock-")),
      "pty-host.sock",
    );
    const { router } = createInProcessPtyHost({
      log: silentLog,
      shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
      version: "test",
    });
    listener = await servePtyHostOverUnixSocket({
      socketPath,
      router,
      log: silentLog,
    });
  });

  afterAll(() => listener.close());

  function connect(): Promise<{ client: Client; dispose: () => void }> {
    return new Promise((resolve, reject) => {
      const socket: Socket = createConnection(socketPath, () => {
        socket.removeListener("error", reject);
        resolve({
          client: stdioLink<typeof ptyHostSurface.contract>({
            read: socket,
            write: socket,
          }),
          dispose: () => socket.destroy(),
        });
      });
      socket.once("error", reject);
    });
  }

  it("binds the requested socket path", () => {
    expect(listener.socketPath).toBe(socketPath);
  });

  it("serves terminal.list over the socket (empty before any spawn)", async () => {
    const { client, dispose } = await connect();
    const { entries } = await client.surface.terminal.list({});
    expect(entries).toEqual([]);
    dispose();
  });

  it("serves the version handshake over the socket", async () => {
    const { client, dispose } = await connect();
    const v = await client.surface.system.version({});
    expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(v.pid).toBe(process.pid);
    dispose();
  });

  it("accepts more than one independent client connection", async () => {
    const a = await connect();
    const b = await connect();
    expect((await a.client.surface.terminal.list({})).entries).toEqual([]);
    expect((await b.client.surface.terminal.list({})).entries).toEqual([]);
    a.dispose();
    b.dispose();
  });
});
