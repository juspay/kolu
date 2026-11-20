import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "kaval";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect, Exit, Scope } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Connection, connectPtyHost } from "./connect.ts";
import { buildCreateInput, newPtyId } from "./create.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

let listener: PtyHostSocketListener;
let conn: Connection;
let connScope: Scope.Closeable;

const label = (i: number) => `H${String(i).padStart(4, "0")}`;

async function waitFor(fn: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const { served, client } = createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-hist-shell-")),
    lifetime: { kind: "forever" },
  });
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "kolu-hist-sock-")),
    "pty-host.sock",
  );
  listener = await servePtyHostOverUnixSocket({
    socketPath,
    served,
    log: silentLog,
  });
  void client;
  connScope = Scope.makeUnsafe();
  conn = await Effect.runPromise(
    Scope.provide(connectPtyHost(socketPath), connScope),
  );
});

afterAll(async () => {
  await Effect.runPromise(conn.client.surface.terminal.killAll({}));
  await Effect.runPromise(Scope.close(connScope, Exit.void));
  await listener.close();
});

describeDaemon(
  "history verb over a real socket (the kaval-tui history path)",
  () => {
    it("serves older scrollback beyond the bounded attach snapshot", async () => {
      const id = newPtyId();
      await Effect.runPromise(
        conn.client.surface.terminal.spawn(
          buildCreateInput({
            id,
            cwd: tmpdir(),
            env: process.env,
            command: [
              "/bin/sh",
              "-c",
              "i=0; while [ $i -lt 1200 ]; do printf 'H%04d\\n' $i; i=$((i+1)); done; sleep 30",
            ],
            kavalSocket: "/tmp/kaval-test/pty-host.sock",
          }),
        ),
      );
      await waitFor(async () =>
        (
          await Effect.runPromise(
            conn.client.surface.terminal.getScreenText({ id }),
          )
        ).text.includes(label(1199)),
      );

      const first = await Effect.runPromise(
        firstFrameOrThrow(
          conn.client.surface.terminalAttach.get({ id }),
          "attach ended without yielding a snapshot frame",
        ),
      );
      if (first.kind !== "snapshot")
        throw new Error(`expected a snapshot first frame, got "${first.kind}"`);
      expect(first.data).not.toContain(label(0));

      const page = await Effect.runPromise(
        conn.client.surface.terminal.getHistory({
          id,
          max: 50,
        }),
      );
      if (page.kind !== "chunk") throw new Error("expected a chunk reply");
      expect(page.chunk).not.toBe("");
      expect(page.chunk).not.toContain(label(1199));

      let before: number | undefined;
      let reachedOldest = false;
      let guard = 0;
      for (;;) {
        if (guard++ > 100) throw new Error("history paging did not terminate");
        const res = await Effect.runPromise(
          conn.client.surface.terminal.getHistory({
            id,
            ...(before === undefined ? {} : { before }),
            max: 500,
          }),
        );
        if (res.kind !== "chunk")
          throw new Error("pager should never be stale");
        if (res.chunk === "") break;
        if (res.chunk.includes(label(0))) reachedOldest = true;
        before = res.topLine;
        if (res.exhausted) break;
      }
      expect(reachedOldest).toBe(true);
      expect(before).toBe(0);
    });
  },
);
