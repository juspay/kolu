import { type ChildProcess, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { scanPorts } from "./scan.ts";

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function listener(
  host?: string,
  opts: { viaShell?: boolean } = {},
): Promise<{ port: number; child: ChildProcess }> {
  assertDaemonSpawnAllowed("a test HTTP listener");
  const bind = host === undefined ? "0" : `0,"${host}"`;
  const script = `require("http").createServer((_,r)=>r.end("ok")).listen(${bind},function(){console.log(this.address().port)})`;
  // The node path and the script reach the shell as ENVIRONMENT VALUES, never
  // interpolated into the command text: the `-c` string is a constant and both
  // expansions are quoted, so a path containing a space — `/Users/My Name/…`,
  // entirely ordinary on macOS — cannot split into two words and turn this
  // into a different command. They cannot ride as `$0`/`$1` positionals either
  // (the shape this used to have): `js/shell-command-injection-from-environment`
  // (code-scanning alert 49) taints EVERY argv element of an `sh -c` call —
  // however safely quoted — because the analyzer cannot see how the command
  // text uses them. The env channel is the one it can prove stays data.
  const child = opts.viaShell
    ? spawn(
        "/bin/sh",
        ["-c", 'exec "$KOLU_SCAN_LIVE_NODE" -e "$KOLU_SCAN_LIVE_SRC"'],
        {
          env: {
            ...process.env,
            KOLU_SCAN_LIVE_NODE: process.execPath,
            KOLU_SCAN_LIVE_SRC: script,
          },
        },
      )
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

function routableAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return undefined;
}

async function scanSelf() {
  const result = await Effect.runPromise(scanPorts([process.pid]));
  const ports = result.byRoot.get(process.pid);
  if (ports === undefined || ports === "blind") {
    throw new Error(
      `the scan returned ${ports === undefined ? "no sample" : "blind"} for its own pid`,
    );
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
    const { port } = await listener("127.0.0.1");
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, scope: "loopback" }),
    );
  });

  it("scopes a listener bound to ONE routable interface as `interface`", async () => {
    const address = routableAddress();
    if (address === undefined) {
      return;
    }
    const { port } = await listener(address);
    const ports = await scanSelf();
    expect(ports).toContainEqual(
      expect.objectContaining({ port, scope: "interface" }),
    );
  });

  it("tells a V6 loopback listener from a v4 one — the production defect", async () => {
    const v6 = await listener("::1");
    const v4 = await listener("127.0.0.1");
    const ports = await scanSelf();

    expect(ports.find((p) => p.port === v6.port)).toEqual(
      expect.objectContaining({ scope: "loopback", family: "v6" }),
    );
    expect(ports.find((p) => p.port === v4.port)).toEqual(
      expect.objectContaining({ scope: "loopback", family: "v4" }),
    );

    v6.child.kill();
    v4.child.kill();
  });

  it("names the program, not the thread", async () => {
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
    const { port } = await listener();

    const ports = await scanSelf();
    expect(ports.filter((p) => p.port === port)).toEqual([
      {
        port,
        name: "node",
        command: expect.stringContaining("-e"),
        scope: "any",
        family: expect.any(String),
      },
    ]);
  });

  it("tells the v4-MAPPED loopback from the v4-mapped ANY address", async () => {
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
    await vi.waitFor(
      async () =>
        expect(await scanSelf()).not.toContainEqual(
          expect.objectContaining({ port }),
        ),
      { timeout: 5_000, interval: 50 },
    );
  });

  it("attributes a listener to the subtree that holds it, and no other", async () => {
    const { port, child } = await listener("0.0.0.0");
    const stranger = spawn(process.execPath, [
      "-e",
      "setTimeout(()=>{},60000)",
    ]);
    children.push(stranger);
    await new Promise((done) => setTimeout(done, 200));

    const result = await Effect.runPromise(
      scanPorts([child.pid!, stranger.pid!]),
    );
    expect(result.byRoot.get(child.pid!)).toContainEqual(
      expect.objectContaining({ port }),
    );
    expect(result.byRoot.get(stranger.pid!)).toEqual([]);
    expect(result.host.claimed).toContainEqual(
      expect.objectContaining({ port }),
    );
  });

  it("names the listener's command line, not just its program", async () => {
    const { port } = await listener("127.0.0.1");
    const found = (await scanSelf()).find((p) => p.port === port);
    expect(found?.command).toContain("createServer");
    expect(found?.command.startsWith(process.execPath)).toBe(true);
  });

  it("sees a DETACHED listener on the host that no requested subtree holds", async () => {
    assertDaemonSpawnAllowed("a detached test HTTP listener");
    const script = `require("http").createServer((_,r)=>r.end("ok")).listen(0,"127.0.0.1",function(){console.log(process.pid+" "+this.address().port)})`;
    const shell = spawn(
      "/bin/sh",
      ["-c", '"$KOLU_SCAN_LIVE_NODE" -e "$KOLU_SCAN_LIVE_SRC" &'],
      {
        env: {
          ...process.env,
          KOLU_SCAN_LIVE_NODE: process.execPath,
          KOLU_SCAN_LIVE_SRC: script,
        },
      },
    );
    const { pid, port } = await new Promise<{ pid: number; port: number }>(
      (resolve, reject) => {
        let out = "";
        shell.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const [pidText, portText] = out.trim().split(" ");
          const pid = Number.parseInt(pidText ?? "", 10);
          const port = Number.parseInt(portText ?? "", 10);
          if (pid > 0 && port > 0) resolve({ pid, port });
        });
        shell.on("error", reject);
      },
    );
    try {
      const result = await Effect.runPromise(scanPorts([process.pid]));
      expect(result.byRoot.get(process.pid)).not.toContainEqual(
        expect.objectContaining({ port }),
      );
      expect(result.host.claimed).toContainEqual(
        expect.objectContaining({ port, scope: "loopback", name: "node" }),
      );
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports a requested subtree it cannot see as BLIND, not as no ports",
    async () => {
      const result = await Effect.runPromise(scanPorts([1]));
      expect(result.byRoot.get(1)).toBe("blind");
      expect(result.host.status).toBe("known");
    },
  );

  it("returns an empty set — not a missing key — for a root pid that is gone", async () => {
    const dead = 0x7f_ff_ff_ff;
    const result = await Effect.runPromise(scanPorts([dead]));
    expect(result.byRoot.has(dead)).toBe(true);
    expect(result.byRoot.get(dead)).toEqual([]);
  });
});
