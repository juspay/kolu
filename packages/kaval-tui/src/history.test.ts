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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const label = (i: number) => `H${String(i).padStart(4, "0")}`;

async function waitFor(fn: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const { servedRouter, client } = createInProcessPtyHost({
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
    router: servedRouter,
    log: silentLog,
  });
  void client;
  conn = await connectPtyHost(socketPath);
});

afterAll(async () => {
  await conn.client.surface.terminal.killAll({});
  conn.dispose();
  await listener.close();
});

describe("history verb over a real socket (the kaval-tui history path)", () => {
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
      (await conn.client.surface.terminal.getScreenText({ id })).text.includes(
        label(1199),
      ),
    );

    // The bounded attach snapshot does NOT carry the oldest lines...
    const { snapshot } = await (async () => {
      const s = conn.client.surface.terminalAttach.get({ id });
      const it = (await s)[Symbol.asyncIterator]();
      const first = await it.next();
      return { snapshot: (first.value as { data: string }).data };
    })();
    expect(snapshot).not.toContain(label(0));

    // `--lines N` path: one self-seeded page (before omitted) of the older lines
    // just above the screen — non-empty, and older than the newest content.
    const page = await conn.client.surface.terminal.getHistory({ id, max: 50 });
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
        before,
        max: 500,
      });
      if (res.chunk === "") break;
      if (res.chunk.includes(label(0))) reachedOldest = true;
      before = res.topLine;
      if (res.exhausted) break;
    }
    expect(reachedOldest).toBe(true);
    expect(before).toBe(0);
  });
});
