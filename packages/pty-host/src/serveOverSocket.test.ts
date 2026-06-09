/**
 * Falsifiability test for the R-4 Phase 1 transport: the pty-host router served
 * over a REAL unix socket (`net.Server`) and consumed over a REAL `net.Socket`
 * via `stdioLink` — the exact path kolu-tui uses, minus the CLI formatting
 * (covered by @kolu/pty-tui's render test). A green run proves serveOverStdio +
 * stdioLink hold over a socket, not just the in-process loopback.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { Logger } from "kolu-shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type ptyHostSurface,
} from "./ptyHostSurface.ts";
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
    const { servedRouter } = createInProcessPtyHost({
      log: silentLog,
      shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
      version: "test",
    });
    listener = await servePtyHostOverUnixSocket({
      socketPath,
      router: servedRouter,
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

  it("refuses to delete an existing regular file at the socket path (no data loss)", async () => {
    // `--pty-host-socket` is an arbitrary path; if it names the user's own
    // regular file we must warn and noop, NOT `rmSync` it. A connect() probe
    // against a regular file fails (ENOTSOCK), which must not be read as "stale
    // socket → safe to delete".
    const filePath = join(
      mkdtempSync(join(tmpdir(), "kolu-pty-file-")),
      "important.txt",
    );
    writeFileSync(filePath, "precious user data");
    const { servedRouter } = createInProcessPtyHost({
      log: silentLog,
      shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
      version: "test",
    });
    const l = await servePtyHostOverUnixSocket({
      socketPath: filePath,
      router: servedRouter,
      log: silentLog,
    });
    // The file is untouched (not unlinked, contents intact) and nothing bound.
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("precious user data");
    expect(() => l.close()).not.toThrow();
    expect(existsSync(filePath)).toBe(true);
  });

  it("degrades to a no-op (never throws) when the path is already served", async () => {
    // A second instance racing for the same path must NOT crash the caller (the
    // e2e harness boots many servers sharing the default socket). It resolves to
    // a harmless no-op while the original keeps serving.
    const { servedRouter } = createInProcessPtyHost({
      log: silentLog,
      shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
      version: "test",
    });
    const second = await servePtyHostOverUnixSocket({
      socketPath,
      router: servedRouter,
      log: silentLog,
    });
    expect(() => second.close()).not.toThrow();
    // the original listener is untouched and still serving
    const { client, dispose } = await connect();
    expect((await client.surface.terminal.list({})).entries).toEqual([]);
    dispose();
  });
});
