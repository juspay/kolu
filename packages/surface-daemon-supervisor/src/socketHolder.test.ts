/**
 * `socketHolders` — the OS socket-holder lookup leaf. The linux `/proc/net/unix`
 * + `/proc/<pid>/fd` parse is exercised here against a REAL child process holding
 * a REAL unix socket (the only faithful test); the darwin `lsof` path is verified
 * on a real mac in acceptance. Linux-only — skipped elsewhere.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { socketHolders } from "./socketHolder.ts";

const children: number[] = [];
afterEach(async () => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone
    }
  }
  await new Promise((r) => setTimeout(r, 20));
});

function spawnHolder(socketPath: string): Promise<number> {
  const script = `
    const net = require("node:net");
    const srv = net.createServer(() => {});
    srv.listen(process.argv[1], () => process.stdout.write("READY\\n"));
    setInterval(() => {}, 1 << 30);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, socketPath], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.on("error", reject);
    child.stdout?.on("data", (b: Buffer) => {
      if (b.toString().includes("READY") && child.pid !== undefined) {
        children.push(child.pid);
        resolve(child.pid);
      }
    });
  });
}

const onLinux = process.platform === "linux";

describe.skipIf(!onLinux)("socketHolders (linux /proc)", () => {
  it("names the exact pid + command holding a bound socket path", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);

    const holders = await socketHolders(socketPath);
    expect(holders.map((h) => h.pid)).toContain(pid);
    const holder = holders.find((h) => h.pid === pid);
    // The command label is read from /proc/<pid>/cmdline — a node invocation here.
    expect(holder?.command).toMatch(/node|-e/i);
  });

  it("returns empty for a path nobody holds", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    expect(await socketHolders(join(d, "nobody.sock"))).toEqual([]);
  });

  it("finds a holder whose socket PATH CONTAINS A SPACE (parses the /proc path column, not a truncated split)", async () => {
    // A caller-supplied `--pty-host-socket` path may contain spaces; the /proc/net/unix
    // parse must take the whole trailing path column, not `split(/\s+/)[7]`.
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const spaced = join(d, "with space");
    mkdirSync(spaced);
    const socketPath = join(spaced, "held.sock");
    const pid = await spawnHolder(socketPath);
    expect((await socketHolders(socketPath)).map((h) => h.pid)).toContain(pid);
  });

  it("stops naming the holder once it exits (no stale pid)", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);
    expect((await socketHolders(socketPath)).some((h) => h.pid === pid)).toBe(
      true,
    );

    process.kill(pid, "SIGKILL");
    children.splice(children.indexOf(pid), 1);
    // Wait for the kernel to drop the socket binding.
    await new Promise((r) => setTimeout(r, 80));
    expect((await socketHolders(socketPath)).some((h) => h.pid === pid)).toBe(
      false,
    );
  });
});
