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
import { drainForOverflow, spawnInput } from "./contractCorpus.testlib.ts";
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

function makeRouter(opts?: { dataMaxQueue?: number }) {
  const { servedRouter } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    dataMaxQueue: opts?.dataMaxQueue,
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

// The `overflow` control frame must survive the REAL socket + oRPC
// serialization boundary — not just the in-process loopback that
// `inProcessPtyHost.test.ts` exercises. This is the exact attach transport
// kaval-tui / pulam / kolu-server consume, so a serialization or schema mistake
// in the `{ kind: "overflow" }` variant would only ever surface here. The
// listener gets its OWN host bound to a 1-deep data queue so the slow-subscriber
// drop is deterministic; the shared listener above keeps the default cap.
describe("servePtyHostOverUnixSocket — `overflow` frame crosses the socket", () => {
  let ovfListener: PtyHostSocketListener;
  let ovfSocketPath: string;

  beforeAll(async () => {
    ovfSocketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-pty-ovf-sock-")),
      "pty-host.sock",
    );
    ovfListener = await servePtyHostOverUnixSocket({
      socketPath: ovfSocketPath,
      router: makeRouter({ dataMaxQueue: 1 }),
      log: silentLog,
    });
  });

  afterAll(() => ovfListener.close());

  it("yields a typed `overflow` frame to a slow subscriber over the real socket", async () => {
    // Two SEPARATE connections. `ctrl` drives the terminal (spawn / write /
    // getScreenText / kill); `attachConn` carries ONLY the un-drained attach
    // stream. They must not share a socket: a saturated attach stream
    // backpressures its whole connection, so a shared-socket `getScreenText`
    // would deadlock behind the very stream we are deliberately not reading.
    const ctrl = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath: ovfSocketPath,
    });
    const attachConn = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath: ovfSocketPath,
    });
    const cwd = mkdtempSync(join(tmpdir(), "kolu-pty-ovf-cwd-"));
    const { id } = await ctrl.client.surface.terminal.spawn(spawnInput(cwd));

    // Pull the snapshot — that starts the source generator (it subscribes to
    // the data channel) — then STOP reading. Unlike the in-process loopback, a
    // few chunks won't trip the drop here: the server drains the 1-deep channel
    // straight into the socket's kernel buffer. We need a CONTINUOUS flood so
    // the kernel buffer fills, the server's socket write backpressures, and the
    // channel then overflows its 1-deep bound while we look away.
    const ac = new AbortController();
    const iter = (
      await attachConn.client.surface.terminalAttach.get(
        { id },
        { signal: ac.signal },
      )
    )[Symbol.asyncIterator]();
    const snap = await iter.next();
    expect(snap.done).toBe(false);
    if (!snap.done) expect(snap.value.kind).toBe("snapshot");

    // `yes` floods the PTY without bound; the drop sheds the wedged attach
    // subscriber while the screen mirror (a separate, always-drained consumer)
    // keeps flowing, so `getScreenText` over `ctrl` still answers.
    await ctrl.client.surface.terminal.write({ id, data: "yes OVFLINE\n" });
    let text = "";
    for (let i = 0; i < 120; i++) {
      ({ text } = await ctrl.client.surface.terminal.getScreenText({ id }));
      if (text.includes("OVFLINE")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(text).toContain("OVFLINE");
    // Give the flood a beat to saturate the attach socket and latch the drop
    // before we start reading.
    await new Promise((r) => setTimeout(r, 500));

    // Drain: a typed `overflow` frame must arrive over the socket — eventually,
    // after the buffered deltas. The bound is generous because the kernel socket
    // buffer drains many laggard frames before the bounded queue trips the drop.
    const kinds = await drainForOverflow(iter, 5000);
    expect(kinds).toContain("overflow");

    ac.abort();
    await ctrl.client.surface.terminal.kill({ id });
    ctrl.dispose();
    attachConn.dispose();
  }, 20000);
});
