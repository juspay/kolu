/**
 * Pins the yesterday-daemon fixture itself — real live pid, owner-only dir,
 * optional accepting socket, optional previous-shape session on a state-root.
 * Mutate-to-prove: drop the live child and `isHolderLive` fails; loosen dir
 * perms and the production gate refuses (covered in pidGate tests).
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { gatePid, isHolderLive } from "@kolu/surface-daemon";
import { KAVAL_GATE_FILE, PTY_HOST_SOCK_FILE } from "kaval";
import { plantYesterdayDaemon } from "./yesterdayDaemon.fixture.testlib.ts";

const planted: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  for (const d of planted.splice(0)) await d.dispose();
});

describeDaemon("yesterday-daemon fixture", () => {
  it("plants a live child + current-shape gate in an owner-only dir with an accepting socket", async () => {
    const d = await plantYesterdayDaemon();
    planted.push(d);

    expect(d.pid).toBeTypeOf("number");
    expect(isHolderLive(d.pid as number)).toBe(true);
    expect(gatePid(d.gatePath)).toBe(d.pid);
    expect(readFileSync(d.gatePath, "utf8").trim()).toBe(String(d.pid));

    const st = lstatSync(d.dir);
    expect(st.isDirectory()).toBe(true);
    // Owner-only (no group/other bits) — same privacy the production gate demands.
    expect(st.mode & 0o077).toBe(0);

    expect(d.gatePath.endsWith(KAVAL_GATE_FILE)).toBe(true);
    expect(d.socketPath.endsWith(PTY_HOST_SOCK_FILE)).toBe(true);
    expect(existsSync(d.socketPath)).toBe(true);
  });

  it("plants a foreign gate shape without claiming a parsable pid", async () => {
    const d = await plantYesterdayDaemon({
      gate: { kind: "foreign", content: '{"format":2,"pid":999}\n' },
      withSocket: false,
    });
    planted.push(d);

    // Foreign content is unparsable by today's gatePid (decimal-only).
    expect(gatePid(d.gatePath)).toBeUndefined();
    expect(readFileSync(d.gatePath, "utf8")).toContain('"format":2');
    // The live child is still held so recycle tests can observe its fate.
    expect(d.pid).toBeTypeOf("number");
    expect(isHolderLive(d.pid as number)).toBe(true);
  });

  it("plants a previous-shape session under a private state-root", async () => {
    const previousSession = {
      terminals: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          // Pre-discriminant / pre-location shape — no state, no location.
          cwd: "/work/old",
          git: null,
        },
      ],
      savedAt: 1_700_000_000_000,
    };
    const d = await plantYesterdayDaemon({
      session: previousSession,
      withSocket: false,
      gate: { kind: "absent" },
    });
    planted.push(d);

    expect(d.stateRoot).toBeTypeOf("string");
    expect(d.confPath).toBeTypeOf("string");
    const raw = JSON.parse(readFileSync(d.confPath as string, "utf8")) as {
      session: typeof previousSession;
    };
    expect(raw.session.terminals[0]?.cwd).toBe("/work/old");
    expect(raw.session.terminals[0]).not.toHaveProperty("state");
    expect(raw.session.terminals[0]).not.toHaveProperty("location");
  });

  it("dispose reaps the child and removes the rendezvous dir", async () => {
    const d = await plantYesterdayDaemon();
    const pid = d.pid as number;
    await d.dispose();
    expect(isHolderLive(pid)).toBe(false);
    expect(existsSync(d.dir)).toBe(false);
  });
});
