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
import { networkInterfaces } from "node:os";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, expect, it, vi } from "vitest";
import { scanSubtreePorts } from "./scan.ts";

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** Spawn a real HTTP listener bound to `host`, and resolve the port the kernel
 *  gave it. Port 0 + the child reporting back beats picking a number ourselves:
 *  there is no window in which another process could take the port we chose. */
function listener(
  host?: string,
  opts: { viaShell?: boolean } = {},
): Promise<{ port: number; child: ChildProcess }> {
  // The runtime leash. This helper lives OUTSIDE the gated block, so the gate
  // cannot see it as covered by `describeDaemon` — and that is the point of the
  // leash: a helper is exactly how a fork gets smuggled past a gate.
  assertDaemonSpawnAllowed("a test HTTP listener");
  // No `host` means the DUAL-STACK form (`listen(0)` binds `::`), which is its own
  // test case — so it rides this helper rather than a hand-rolled copy that would
  // skip the fork leash above and the exit-rejection below.
  const bind = host === undefined ? "0" : `0,"${host}"`;
  const script = `require("http").createServer((_,r)=>r.end("ok")).listen(${bind},function(){console.log(this.address().port)})`;
  // `viaShell` puts a shell between us and the server, so the listener is a
  // GRANDCHILD — the ordinary shape of this feature (a shell in a PTY, an agent
  // running a dev server inside it), and the reason attribution is a subtree walk
  // rather than a direct-children check.
  //
  // The node path and the script ride as POSITIONAL ARGUMENTS (`$0`, `$1`) rather
  // than interpolated into the command string. Nothing is quoted by hand, so a
  // path containing a space — `/Users/My Name/…`, entirely ordinary on macOS —
  // cannot split into two words and turn this into a different command.
  const child = opts.viaShell
    ? spawn("/bin/sh", ["-c", 'exec "$0" -e "$1"', process.execPath, script])
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

/** One IPv4 address of a real, non-loopback interface on this box — the only way
 *  to exhibit an `interface`-scoped bind, since the address has to be one the
 *  kernel will actually accept a bind on. `undefined` on a box that has none. */
function routableAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return undefined;
}

/** Scan for this process's own subtree — the test process stands in for a
 *  terminal's root shell, which is exactly the relationship padi has to a PTY. */
async function scanSelf() {
  const result = await scanSubtreePorts([process.pid]);
  const ports = result.get(process.pid);
  if (ports === undefined) {
    throw new Error("the scan returned no sample for the requested root pid");
  }
  return ports;
}

describeDaemon(`the port scan on this host (${process.platform})`, () => {
  it("finds an any-address listener in its subtree and scopes it `any`", async () => {
    const { port } = await listener("0.0.0.0");
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, scope: "any" }),
    );
  });

  it("finds a loopback-bound listener and scopes it `loopback`", async () => {
    // The distinction the whole feature turns on: this one needs a forward, the
    // one above does not. Getting `scope` backwards would offer a link that
    // resolves to the viewer's own machine.
    const { port } = await listener("127.0.0.1");
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, scope: "loopback" }),
    );
  });

  it("scopes a listener bound to ONE routable interface as `interface`", async () => {
    // The third scope, and the one a boolean could not spell. It matters because
    // BOTH forward mechanisms dial `127.0.0.1` on the far side: a door opened for
    // this listener would come up and then refuse every connection through it. So
    // this must not read as `loopback`, and — since it answers off-box without a
    // door — it must not read as needing one either.
    const address = routableAddress();
    if (address === undefined) {
      // A box with no non-loopback interface (a sealed sandbox) cannot exhibit
      // the case. Skipping is honest; asserting something else is not.
      return;
    }
    const { port } = await listener(address);
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, scope: "interface" }),
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
      expect.objectContaining({ port, scope: "any" }),
    );
  });

  it("reports a dual-stack listener ONCE", async () => {
    // A `::` bind shows up in both socket tables (linux: tcp + tcp6; darwin: a
    // `tcp46` row), so an un-folded scan would render two chips for one server.
    const { port } = await listener();

    const ports = await scanSelf();
    expect(ports.filter((p) => p.port === port)).toEqual([
      { port, name: "node", scope: "any" },
    ]);

    // The dual-stack BYTE fidelity — that `::` is read from the v6 slot and not
    // narrowed to `0.0.0.0` — deliberately is NOT asserted here, because it
    // cannot be: `PortInfo` carries `{port, name, scope}` and never the
    // address, so both spellings arrive identical at this layer. That is the
    // whole reason the darwin helper's own install check binds a dual-stack
    // socket and inspects the emitted hex (`packages/port-scan/native/default.nix`),
    // where the
    // `insi_vflag` ordering it guards actually lives.
  });

  it("tells the v4-MAPPED loopback from the v4-mapped ANY address", async () => {
    // `::ffff:127.0.0.1` and `::ffff:0.0.0.0` differ in four bytes and mean
    // opposite things, and every classification bug in this area has been one of
    // them read as the other. Live rather than fixture because the two platforms
    // arrive at these bytes by completely different routes: linux reads the
    // mapped form literally out of `/proc/net/tcp6`, while darwin's helper has to
    // pick the right half of a union using `insi_vflag`.
    const mappedLoopback = await listener("::ffff:127.0.0.1");
    const mappedWildcard = await listener("::ffff:0.0.0.0");

    const ports = await scanSelf();
    expect(ports.find((p) => p.port === mappedLoopback.port)).toEqual(
      expect.objectContaining({ port: mappedLoopback.port, scope: "loopback" }),
    );
    expect(ports.find((p) => p.port === mappedWildcard.port)).toEqual(
      expect.objectContaining({ port: mappedWildcard.port, scope: "any" }),
    );

    mappedLoopback.child.kill();
    mappedWildcard.child.kill();
  });

  it("drops a port once its server dies", async () => {
    const { port, child } = await listener("0.0.0.0");
    expect(await scanSelf()).toContainEqual(expect.objectContaining({ port }));

    child.kill("SIGKILL");
    await new Promise((done) => child.once("exit", done));
    // The socket may linger a moment after the process goes, so retry until the OS
    // agrees. `vi.waitFor` (the repo's mechanism for this) keeps the assertion ON
    // the success path — the hand-rolled loop it replaced `return`ed early, so a
    // pass could not be told from "observed the drop".
    await vi.waitFor(
      async () =>
        expect(await scanSelf()).not.toContainEqual(
          expect.objectContaining({ port }),
        ),
      { timeout: 5_000, interval: 50 },
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

    const result = await scanSubtreePorts([child.pid!, stranger.pid!]);
    expect(result.get(child.pid!)).toContainEqual(
      expect.objectContaining({ port }),
    );
    expect(result.get(stranger.pid!)).toEqual([]);
  });

  // Gated twice, and both gates are the POINT rather than a convenience:
  //  - LINUX, because the blindness is a property of the `/proc/<pid>/fd` join.
  //    Darwin does no fd walk at all — `lsof` reports the owning pid with the
  //    listener — so there is no per-pid permission wall to hit there; running a
  //    linux assertion on macOS is the mistake that reddened the first darwin run
  //    of the port-forward suite.
  //  - NON-ROOT, because root can read every `/proc/<pid>/fd`, so the blind spot
  //    this provokes simply does not exist for it.
  it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
    "THROWS rather than reporting no ports when it cannot see a requested subtree",
    async () => {
      // pid 1 is root-owned, so `/proc/1/fd` is unreadable as a normal user —
      // a real, unfakeable blind spot. Reporting `[]` here would render byte
      // -identically to "this terminal serves nothing"
      // (`caught-error-must-not-collapse-to-empty`).
      await expect(scanSubtreePorts([1])).rejects.toThrow(
        /cannot list \/proc\/1\/fd/,
      );
    },
  );

  it("returns an empty set — not a missing key — for a root pid that is gone", async () => {
    // The contract the sampler relies on to tell "serves nothing" from "could not
    // see": every requested pid comes back.
    const dead = 0x7f_ff_ff_ff;
    const result = await scanSubtreePorts([dead]);
    expect(result.has(dead)).toBe(true);
    expect(result.get(dead)).toEqual([]);
  });
});
