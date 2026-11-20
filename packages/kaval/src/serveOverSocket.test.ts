import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import { drainForOverflow, spawnInput } from "./contractCorpus.testlib.ts";
import {
  createInProcessPtyHost,
  type PtyHostServed,
} from "./inProcessPtyHost.ts";
import { type PtyHostClient, ptyHostClientOver } from "./ptyHostClient.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";
import {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";
import { closeStream, openStream } from "./streamFrame.testlib.ts";

function makeServed(opts?: { dataMaxQueue?: number }): PtyHostServed {
  const { served } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    dataMaxQueue: opts?.dataMaxQueue,
    lifetime: { kind: "forever" },
  });
  return served;
}

async function connectTo(
  path: string,
): Promise<{ client: PtyHostClient; dispose: () => Promise<void> }> {
  const link = await unixSocketLink({
    group: ptyHostSurface.group,
    socketPath: path,
  });
  return {
    client: ptyHostClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

let listener: PtyHostSocketListener;
let socketPath: string;

const connect = () => connectTo(socketPath);

describeDaemon(
  "servePtyHostOverUnixSocket — real unix-socket round-trip",
  () => {
    beforeAll(async () => {
      socketPath = join(
        mkdtempSync(join(tmpdir(), "kolu-pty-sock-")),
        "pty-host.sock",
      );
      listener = await servePtyHostOverUnixSocket({
        socketPath,
        served: makeServed(),
        log: silentLog,
      });
    });

    afterAll(() => listener.close());

    it("binds the requested socket path", () => {
      expect(listener.socketPath).toBe(socketPath);
    });

    it("serves terminal.list over the socket (empty before any spawn)", async () => {
      const { client, dispose } = await connect();
      const { entries } = await Effect.runPromise(
        client.surface.terminal.list({}),
      );
      expect(entries).toEqual([]);
      await dispose();
    });

    it("serves the version handshake over the socket", async () => {
      const { client, dispose } = await connect();
      const v = await Effect.runPromise(client.surface.system.version({}));
      expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
      expect(v.pid).toBe(process.pid);
      await dispose();
    });

    it("accepts more than one independent client connection", async () => {
      const a = await connect();
      const b = await connect();
      expect(
        (await Effect.runPromise(a.client.surface.terminal.list({}))).entries,
      ).toEqual([]);
      expect(
        (await Effect.runPromise(b.client.surface.terminal.list({}))).entries,
      ).toEqual([]);
      await a.dispose();
      await b.dispose();
    });

    it("degrades to a no-op (never throws) when the path is already served", async () => {
      const second = await servePtyHostOverUnixSocket({
        socketPath,
        served: makeServed(),
        log: silentLog,
      });
      expect(() => second.close()).not.toThrow();
      const { client, dispose } = await connect();
      expect(
        (await Effect.runPromise(client.surface.terminal.list({}))).entries,
      ).toEqual([]);
      await dispose();
    });
  },
);

describeDaemon(
  "servePtyHostOverUnixSocket — `overflow` frame crosses the socket",
  () => {
    let ovfListener: PtyHostSocketListener;
    let ovfSocketPath: string;

    beforeAll(async () => {
      ovfSocketPath = join(
        mkdtempSync(join(tmpdir(), "kolu-pty-ovf-sock-")),
        "pty-host.sock",
      );
      ovfListener = await servePtyHostOverUnixSocket({
        socketPath: ovfSocketPath,
        served: makeServed({ dataMaxQueue: 1 }),
        log: silentLog,
      });
    });

    afterAll(() => ovfListener.close());

    it("yields a typed `overflow` frame to a slow subscriber over the real socket", async () => {
      const ctrl = await connectTo(ovfSocketPath);
      const attachConn = await connectTo(ovfSocketPath);
      const cwd = mkdtempSync(join(tmpdir(), "kolu-pty-ovf-cwd-"));
      const { id } = await Effect.runPromise(
        ctrl.client.surface.terminal.spawn(spawnInput(cwd)),
      );

      const iter = openStream(
        attachConn.client.surface.terminalAttach.get({ id }),
      );
      const snap = await iter.next();
      expect(snap.done).toBe(false);
      if (!snap.done) expect(snap.value.kind).toBe("snapshot");

      await Effect.runPromise(
        ctrl.client.surface.terminal.write({ id, data: "yes OVFLINE\n" }),
      );
      let text = "";
      for (let i = 0; i < 120; i++) {
        ({ text } = await Effect.runPromise(
          ctrl.client.surface.terminal.getScreenText({ id }),
        ));
        if (text.includes("OVFLINE")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(text).toContain("OVFLINE");
      await new Promise((r) => setTimeout(r, 500));

      const kinds = await drainForOverflow(iter, 5000);
      expect(kinds).toContain("overflow");

      closeStream(iter);
      await Effect.runPromise(ctrl.client.surface.terminal.kill({ id }));
      await ctrl.dispose();
      await attachConn.dispose();
    }, 20000);
  },
);
