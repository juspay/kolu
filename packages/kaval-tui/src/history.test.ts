/**
 * Smoke test for `kaval-tui history` against a REAL kaval over a unix socket:
 * the older-scrollback read the subcommand pages. Exercises the two shapes the
 * command issues — a single self-seeded page (`--lines N`, `before` omitted) and
 * the full paged dump (`before` = each reply's `topLine`, to exhaustion) — and
 * proves it reaches content the bounded attach snapshot does NOT carry, which is
 * the whole reason the verb exists. The verb's arithmetic (the seam guarantee,
 * eviction, fidelity) is pinned in kaval's `ptyHostHistory.test.ts`; this proves
 * the wire path the CLI actually uses.
 */

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
/** The dial is scoped now; the suite owns a scope for the connection's life. */
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
  await conn.client.surface.terminal.killAll({});
  await Effect.runPromise(Scope.close(connScope, Exit.void));
  await listener.close();
});

describeDaemon(
  "history verb over a real socket (the kaval-tui history path)",
  () => {
    it("serves older scrollback beyond the bounded attach snapshot", async () => {
      // Print 1200 deterministic lines — well past the bounded snapshot — then hold.
      const id = newPtyId();
      await conn.client.surface.terminal.spawn(
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
      );
      await waitFor(async () =>
        (
          await conn.client.surface.terminal.getScreenText({ id })
        ).text.includes(label(1199)),
      );

      // The bounded attach snapshot does NOT carry the oldest lines. Read it
      // through the shared first-frame primitive, which takes the member
      // `Stream` itself: `Stream.runHead` establishes the subscription, takes
      // the snapshot, and interrupts the rest.
      const first = await firstFrameOrThrow(
        conn.client.surface.terminalAttach.get({ id }),
        "attach ended without yielding a snapshot frame",
      );
      if (first.kind !== "snapshot")
        throw new Error(`expected a snapshot first frame, got "${first.kind}"`);
      expect(first.data).not.toContain(label(0));

      // `--lines N` path: one self-seeded page (before omitted) of the older lines
      // just above the screen — non-empty, and older than the newest content. The
      // pager sends no epoch, so every reply is a `chunk` arm.
      const page = await conn.client.surface.terminal.getHistory({
        id,
        max: 50,
      });
      if (page.kind !== "chunk") throw new Error("expected a chunk reply");
      expect(page.chunk).not.toBe("");
      expect(page.chunk).not.toContain(label(1199));

      // Full-dump path: page from the screen top to the oldest retained line; the
      // union of pages must reach the very first line the snapshot omitted.
      let before: number | undefined;
      let reachedOldest = false;
      let guard = 0;
      for (;;) {
        if (guard++ > 100) throw new Error("history paging did not terminate");
        const res = await conn.client.surface.terminal.getHistory({
          id,
          // Absent, never an explicit `undefined` — `before` is
          // `Schema.optionalKey` and the wire rejects the latter (PLAN #17).
          // Spelled the same way the shipped pager spells it, so this smoke
          // test keeps proving the shipped call shape.
          ...(before === undefined ? {} : { before }),
          max: 500,
        });
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
