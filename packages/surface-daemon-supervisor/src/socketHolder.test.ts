/**
 * The socket-holder leaf, in two halves.
 *
 * **The fold** (ungated, both platforms) pins the part this package still owns
 * after OSF4: turning osfacts' document into the three answers the recovery
 * acts on, and never collapsing them into one another. The OS reading itself
 * belongs to the binary now and is pinned by its own two-platform suite, so
 * there is nothing left here to fake.
 *
 * **The end-to-end pins** (gated, real child, real socket) prove the fold sits
 * on the REAL binary the composition roots inject — that osfacts, this fold,
 * and the pid the OS actually reports agree. A suite that only exercised the
 * fold against hand-written documents would prove the parse and nothing about
 * the path that runs.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import type { SocketHoldersReading } from "osfacts-client";
import { foldSocketHoldersReading } from "./socketHolder.ts";
import { testReadSocketHolders } from "./createEndpoint.testlib.ts";

/** kolu's own bake — this repo's suites, so this repo's env var. */
const readHolders = testReadSocketHolders("KOLU_OSFACTS_BIN");

function reading(over: Partial<SocketHoldersReading>): SocketHoldersReading {
  return { holders: [], procs: [], unreadable: [], errors: [], ...over };
}

describe("foldSocketHoldersReading — three answers, never one", () => {
  it("names every claimed holder, with its command", () => {
    expect(
      foldSocketHoldersReading(
        reading({
          holders: [
            { status: "claimed", pid: 4242 },
            { status: "claimed", pid: 4243 },
          ],
          procs: [{ pid: 4242, ppid: 1, name: "kaval" }],
        }),
      ),
    ).toEqual({
      kind: "holders",
      holders: [
        { pid: 4242, command: "kaval" },
        // Named by the OS, but its identity read lost the race — still a
        // holder, and still a kill candidate the handshake may confirm.
        { pid: 4243, command: "?" },
      ],
    });
  });

  it("reports a proven-empty document as `none`, the ONLY proof of freedom", () => {
    expect(foldSocketHoldersReading(reading({}))).toEqual({ kind: "none" });
  });

  /** The linux shape: the socket IS bound, and no pid we may inspect holds it. */
  it("keeps a bound-but-unnameable holder out of `none`", () => {
    const folded = foldSocketHoldersReading(
      reading({ holders: [{ status: "unclaimed" }] }),
    );

    expect(folded.kind).toBe("unattributed");
    expect(folded).not.toEqual({ kind: "none" });
  });

  /** The darwin shape: the search itself could not complete. */
  it("keeps a blind search out of `none`", () => {
    const folded = foldSocketHoldersReading(
      reading({
        errors: [
          {
            source: "darwin_proc_fds",
            facet: "socket_holders",
            code: "BLIND_OR_EMPTY",
          },
        ],
      }),
    );

    expect(folded.kind).toBe("unattributed");
    expect(folded).toMatchObject({
      detail: expect.stringContaining("darwin_proc_fds"),
    });
  });

  /** A named holder is an answer even when its NAME could not be read. That
   *  loss is the shape the verb really emits — a per-pid `U` row, not an
   *  `E … proc …` source error (which `SOCKET_HOLDERS_SOURCE_FACETS` no
   *  longer promises, because no reader can write one). */
  it("still names holders when the identity read lost one pid", () => {
    expect(
      foldSocketHoldersReading(
        reading({
          holders: [{ status: "claimed", pid: 7 }],
          unreadable: [{ pid: 7, facet: "proc", errno: "EACCES" }],
        }),
      ),
    ).toEqual({ kind: "holders", holders: [{ pid: 7, command: "?" }] });
  });

  /** An unclaimed row beside a claimed one does not weaken the claim: the
   *  recovery has a pid to handshake, which is what it needs. */
  it("prefers a named holder over an unattributed sibling row", () => {
    expect(
      foldSocketHoldersReading(
        reading({
          holders: [{ status: "unclaimed" }, { status: "claimed", pid: 9 }],
          procs: [{ pid: 9, ppid: 1, name: "kaval" }],
        }),
      ),
    ).toEqual({ kind: "holders", holders: [{ pid: 9, command: "kaval" }] });
  });
});

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
  // The runtime spawn leash at the fork site itself (F5): this helper forks a real,
  // long-lived child, so a gate-off vitest worker that reached it through indirection
  // throws here rather than forking. A no-op under the gate (where these tests run).
  assertDaemonSpawnAllowed("a socket-holder child");
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

/** Every pid the reading names, or `[]` on an arm that names nobody. */
async function heldPids(socketPath: string): Promise<number[]> {
  const reading = await readHolders(socketPath);
  return reading.kind === "holders" ? reading.holders.map((h) => h.pid) : [];
}

describeDaemon("the injected reader, against the real binary", () => {
  it("names the exact pid + command holding a bound socket path", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);

    const reading = await readHolders(socketPath);

    expect(reading.kind).toBe("holders");
    if (reading.kind !== "holders") return;
    const holder = reading.holders.find((h) => h.pid === pid);
    expect(holder).toBeDefined();
    // osfacts' short display name — the executable's basename, the same fact
    // on both platforms (the old reader said `cmdline` on linux and `lsof`'s
    // command name on darwin, so the two never agreed).
    expect(holder?.command).toMatch(/node/i);
  });

  it("names nobody for a path nobody ever bound", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));

    expect(await heldPids(join(d, "nobody.sock"))).toEqual([]);
  });

  it("finds a holder whose socket PATH CONTAINS A SPACE", async () => {
    // A caller-supplied `--pty-host-socket` path may contain spaces, and the
    // linux table emits that column unquoted — the parse rule a whitespace
    // split gets wrong, end to end through the real binary.
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const spaced = join(d, "with space");
    mkdirSync(spaced);
    const socketPath = join(spaced, "held.sock");
    const pid = await spawnHolder(socketPath);

    expect(await heldPids(socketPath)).toContain(pid);
  });

  it("stops naming the holder once it exits (no stale pid)", async () => {
    const d = mkdtempSync(join(tmpdir(), "sds-holder-"));
    const socketPath = join(d, "held.sock");
    const pid = await spawnHolder(socketPath);
    expect(await heldPids(socketPath)).toContain(pid);

    process.kill(pid, "SIGKILL");
    children.splice(children.indexOf(pid), 1);
    // Wait for the kernel to drop the socket binding. The FILE survives — a
    // reader answering from the filesystem would still name the dead pid.
    await new Promise((r) => setTimeout(r, 80));

    expect(await heldPids(socketPath)).not.toContain(pid);
  });
});
