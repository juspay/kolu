/**
 * Falsifiability test for the R-4 Phase 1 transport: the pty-host router
 * served over a REAL unix socket and consumed over a REAL `net.Socket` via
 * `unixSocketLink` — the exact path kaval-tui uses, minus the CLI formatting
 * (covered by kaval-tui's render test). A green run proves the
 * pty-host's contract-wrapped router holds over the socket transport, not
 * just the in-process loopback. The transport hardening itself (stale-inode
 * clearing, regular-file/EACCES refusals, dir privacy) is pinned generically
 * in `@kolu/surface`'s `unix-socket.test.ts`; here we pin the kolu wrapper's
 * promise — a usable listener on success, a harmless no-op on refusal.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import type { Logger } from "@kolu/surface-daemon";
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

function makeRouter() {
  const { servedRouter } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
  });
  return servedRouter;
}

const connect = () =>
  unixSocketLink<typeof ptyHostSurface.contract>({ socketPath });

let listener: PtyHostSocketListener;
let socketPath: string;

describe("servePtyHostOverUnixSocket — real unix-socket round-trip", () => {
  beforeAll(async () => {
    socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-pty-sock-")),
      "pty-host.sock",
    );
    listener = await servePtyHostOverUnixSocket({
      socketPath,
      router: makeRouter(),
      log: silentLog,
    });
  });

  afterAll(() => listener.close());

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

  it("degrades to a no-op (never throws) when the path is already served", async () => {
    // A second instance racing for the same path must NOT crash the caller
    // (the e2e harness boots many servers sharing the default socket). It
    // resolves to a harmless no-op while the original keeps serving.
    const second = await servePtyHostOverUnixSocket({
      socketPath,
      router: makeRouter(),
      log: silentLog,
    });
    expect(() => second.close()).not.toThrow();
    // the original listener is untouched and still serving
    const { client, dispose } = await connect();
    expect((await client.surface.terminal.list({})).entries).toEqual([]);
    dispose();
  });
});
