/**
 * The port scan against the REAL OS — the test the fixtures cannot be.
 *
 * Fixtures pin the parsers; they cannot pin the assumption that the parser is
 * being handed the shape it expects. That gap shipped a real bug: an earlier cut
 * of the darwin path looked for a header column called `pid`, and macOS 26.4
 * calls it **`process:pid`** — so every darwin scan threw, while every fixture
 * test stayed green. This suite closes that gap by spawning an actual listener
 * and asking the actual scanner about it, on whatever platform it runs.
 *
 * `describeDaemon`-gated, because it forks real processes and that is exactly
 * what the gate routes into its own CI node (#1334/#1375) — a bare `vitest` on a
 * workstation hosting a live kolu skips it. That costs nothing here: `ci::daemon`
 * is a required check on BOTH platforms, so this still runs where the platform
 * difference actually lives. The children are short-lived HTTP listeners, not
 * daemons, but the gate is about forking, not about lifetime.
 *
 * Verified by hand on both platforms before being written: x86_64-linux and
 * macOS 26.4 (aarch64-darwin, 21 ms per full scan).
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, expect, it } from "vitest";
import { type PortScanTarget, scanTerminalPorts } from "./portScan.ts";

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** Spawn a real HTTP listener bound to `host`, and resolve the port the kernel
 *  gave it. Port 0 + the child reporting back beats picking a number ourselves:
 *  there is no window in which another process could take the port we chose. */
function listener(
  host: string,
  opts: { viaShell?: boolean } = {},
): Promise<{ port: number; child: ChildProcess }> {
  // The runtime leash. This helper lives OUTSIDE the gated block, so the gate
  // cannot see it as covered by `describeDaemon` — and that is the point of the
  // leash: a helper is exactly how a fork gets smuggled past a gate.
  assertDaemonSpawnAllowed("a test HTTP listener");
  const script = `require("http").createServer((_,r)=>r.end("ok")).listen(0,"${host}",function(){console.log(this.address().port)})`;
  // `viaShell` puts a shell between us and the server, so the listener is a
  // GRANDCHILD — the ordinary shape of this feature (a shell in a PTY, an agent
  // running a dev server inside it), and the reason attribution is a subtree walk
  // rather than a direct-children check.
  const child = opts.viaShell
    ? spawn("/bin/sh", ["-c", `exec ${process.execPath} -e '${script}'`])
    : spawn(process.execPath, ["-e", script]);
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const port = Number.parseInt(out.trim(), 10);
      if (Number.isInteger(port) && port > 0) resolve({ port, child });
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      reject(
        new Error(`listener exited before reporting a port (code ${code})`),
      ),
    );
  });
}

/** Scan for this process's own subtree — the test process stands in for a
 *  terminal's root shell, which is exactly the relationship padi has to a PTY. */
async function scanSelf() {
  const target: PortScanTarget = { id: "self", rootPid: process.pid };
  const result = await scanTerminalPorts([target]);
  const ports = result.get("self");
  if (ports === undefined) {
    throw new Error("the scan returned no sample for the requested terminal");
  }
  return ports;
}

describeDaemon(`the port scan on this host (${process.platform})`, () => {
  it("finds a wildcard-bound listener in its subtree and marks it reachable", async () => {
    const { port } = await listener("0.0.0.0");
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, wildcard: true }),
    );
  });

  it("finds a loopback-bound listener and marks it as NOT reachable", async () => {
    // The distinction the whole feature turns on: this one needs a forward, the
    // one above does not. Getting `wildcard` backwards would offer a link that
    // resolves to the viewer's own machine.
    const { port } = await listener("127.0.0.1");
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, wildcard: false }),
    );
  });

  it("names the program, not the thread", async () => {
    // Node renames its main thread, so `/proc/<pid>/stat`'s `comm` reads
    // `MainThread` — measured. Every Node dev server would be labelled that.
    const { port } = await listener("0.0.0.0");
    const found = (await scanSelf()).find((p) => p.port === port);
    expect(found?.name).toBe("node");
  });

  it("finds a GRANDCHILD's listener (a server started from a shell)", async () => {
    const { port } = await listener("0.0.0.0", { viaShell: true });
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, wildcard: true }),
    );
  });

  it("reports a dual-stack listener ONCE", async () => {
    // A `::` bind shows up in both socket tables (linux: tcp + tcp6; darwin: a
    // `tcp46` row), so an un-folded scan would render two chips for one server.
    const script = `require("http").createServer((_,r)=>r.end("ok")).listen(0,function(){console.log(this.address().port)})`;
    const child = spawn(process.execPath, ["-e", script]);
    children.push(child);
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const p = Number.parseInt(out.trim(), 10);
        if (Number.isInteger(p) && p > 0) resolve(p);
      });
      child.on("error", reject);
    });

    const ports = await scanSelf();
    expect(ports.filter((p) => p.port === port)).toEqual([
      { port, name: "node", wildcard: true },
    ]);
  });

  it("drops a port once its server dies", async () => {
    const { port, child } = await listener("0.0.0.0");
    expect(await scanSelf()).toContainEqual(expect.objectContaining({ port }));

    child.kill("SIGKILL");
    await new Promise((done) => child.once("exit", done));
    // The socket may linger for a moment after the process goes; the scan is
    // re-derived from the OS each pass, so retry until the OS agrees rather than
    // asserting on one reading.
    for (let i = 0; i < 40; i++) {
      if (!(await scanSelf()).some((p) => p.port === port)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    expect(await scanSelf()).not.toContainEqual(
      expect.objectContaining({ port }),
    );
  });

  it("attributes a listener to the subtree that holds it, and no other", async () => {
    // Two sibling "terminals": the listener's own pid as one root, and an
    // unrelated process of ours as another. The first must see its port; the
    // second must not — that is what keeps one tile's chips off another's.
    const { port, child } = await listener("0.0.0.0");
    const stranger = spawn(process.execPath, [
      "-e",
      "setTimeout(()=>{},60000)",
    ]);
    children.push(stranger);
    await new Promise((done) => setTimeout(done, 200));

    const result = await scanTerminalPorts([
      { id: "holder", rootPid: child.pid! },
      { id: "stranger", rootPid: stranger.pid! },
    ]);
    expect(result.get("holder")).toContainEqual(
      expect.objectContaining({ port }),
    );
    expect(result.get("stranger")).toEqual([]);
  });

  // Gated twice, and both gates are the POINT rather than a convenience:
  //  - LINUX, because the blindness is a property of the `/proc/<pid>/fd` join.
  //    On darwin `netstat` reports every owner's pid regardless of user, so there
  //    is no per-pid permission wall to hit; running a linux assertion on macOS is
  //    the mistake that reddened the first darwin run of the port-forward suite.
  //  - NON-ROOT, because root can read every `/proc/<pid>/fd`, so the blind spot
  //    this provokes simply does not exist for it.
  it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
    "THROWS rather than reporting no ports when it cannot see a requested subtree",
    async () => {
      // pid 1 is root-owned, so `/proc/1/fd` is unreadable as a normal user —
      // a real, unfakeable blind spot. Reporting `[]` here would render byte
      // -identically to "this terminal serves nothing"
      // (`caught-error-must-not-collapse-to-empty`).
      await expect(
        scanTerminalPorts([{ id: "unreadable", rootPid: 1 }]),
      ).rejects.toThrow(/cannot list \/proc\/1\/fd/);
    },
  );

  it("returns an empty set — not a missing key — for a terminal whose root is gone", async () => {
    // The contract the sampler relies on to tell "serves nothing" from "could not
    // see": every requested id comes back.
    const result = await scanTerminalPorts([
      { id: "dead", rootPid: 0x7f_ff_ff_ff },
    ]);
    expect(result.has("dead")).toBe(true);
    expect(result.get("dead")).toEqual([]);
  });
});
