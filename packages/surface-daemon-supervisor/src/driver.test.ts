import { describe, expect, it } from "vitest";
import {
  type DaemonSpawnConfig,
  type EphemeralSpawnDeps,
  ephemeralSpawnDriver,
  survivableSpawnDriver,
} from "./driver.ts";

interface Captured {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: "ignore"; env?: Record<string, string> };
  unrefd: boolean;
}

function capture(): {
  calls: Captured[];
  spawnProcess: NonNullable<
    Parameters<typeof survivableSpawnDriver>[1]
  >["spawnProcess"];
} {
  const calls: Captured[] = [];
  const spawnProcess = (
    command: string,
    args: string[],
    options: Captured["options"],
  ) => {
    const rec: Captured = { command, args, options, unrefd: false };
    calls.push(rec);
    return {
      unref() {
        rec.unrefd = true;
      },
    };
  };
  return { calls, spawnProcess };
}

/** Assert exactly one spawn was recorded and return it (narrowed). */
function only(calls: Captured[]): Captured {
  expect(calls).toHaveLength(1);
  const c = calls[0];
  if (!c) throw new Error("no spawn recorded");
  return c;
}

const cfg: DaemonSpawnConfig = {
  binPath: "/nix/store/abc/bin/kaval",
  args: ["--socket", "/run/user/1000/kaval/pty-host.sock"],
  env: { XDG_RUNTIME_DIR: "/run/user/1000" },
  unitPrefix: "kaval",
};

describe("survivableSpawnDriver — the INVOCATION_ID gate", () => {
  it("under systemd, re-launches through systemd-run --user with a unique unit, --collect, --setenv, and the absolute bin path", async () => {
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(cfg, {
      env: { INVOCATION_ID: "deadbeef" },
      spawnProcess,
      unitSuffix: () => "UNIQ",
    });
    await driver.spawn();

    const c = only(calls);
    expect(c.command).toBe("systemd-run");
    expect(c.args).toEqual([
      "--user",
      "--collect",
      "--unit",
      "kaval-UNIQ",
      "--setenv",
      "XDG_RUNTIME_DIR=/run/user/1000",
      "/nix/store/abc/bin/kaval",
      "--socket",
      "/run/user/1000/kaval/pty-host.sock",
    ]);
    expect(c.options.detached).toBe(true);
    expect(c.unrefd).toBe(true);
  });

  it("gives each spawn a fresh unit name so a lingering dead unit can't block a reused name", async () => {
    const { calls, spawnProcess } = capture();
    let n = 0;
    const driver = survivableSpawnDriver(cfg, {
      env: { INVOCATION_ID: "x" },
      spawnProcess,
      unitSuffix: () => `s${(n += 1)}`,
    });
    await driver.spawn();
    await driver.spawn();
    const units = calls.map((c) => c.args[c.args.indexOf("--unit") + 1]);
    expect(units).toEqual(["kaval-s1", "kaval-s2"]);
  });

  it("off systemd, spawns the bin directly, detached+unref, with the forwarded env layered on", async () => {
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(cfg, {
      env: { PATH: "/usr/bin", FOO: "bar" }, // no INVOCATION_ID
      spawnProcess,
    });
    await driver.spawn();

    const c = only(calls);
    expect(c.command).toBe("/nix/store/abc/bin/kaval");
    expect(c.args).toEqual(["--socket", "/run/user/1000/kaval/pty-host.sock"]);
    expect(c.options.detached).toBe(true);
    expect(c.unrefd).toBe(true);
    // forwarded env wins over inherited
    expect(c.options.env).toMatchObject({
      PATH: "/usr/bin",
      FOO: "bar",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });
  });

  it("fromSource forces a detached fork even under a systemd session", async () => {
    // The dev/e2e case: INVOCATION_ID is set (shell is in a systemd session) but
    // we run kaval from source, so systemd-run would strip the env — force
    // detached.
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, fromSource: true },
      { env: { INVOCATION_ID: "deadbeef" }, spawnProcess },
    );
    await driver.spawn();
    expect(only(calls).command).toBe("/nix/store/abc/bin/kaval");
  });

  it("treats an empty INVOCATION_ID as not-under-systemd", async () => {
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(cfg, {
      env: { INVOCATION_ID: "" },
      spawnProcess,
    });
    await driver.spawn();
    expect(only(calls).command).toBe("/nix/store/abc/bin/kaval");
  });

  it("rejects (rather than throwing an uncaught exception) when the real fork fails", async () => {
    // No `spawnProcess` seam → the real `node:child_process` spawn. A
    // nonexistent binary emits `error` (ENOENT) ASYNCHRONOUSLY on the child;
    // the driver must turn that into a rejection (which the endpoint maps to
    // `dead`), not let it escape as the uncaught exception that would take the
    // supervising process down (#F4).
    const driver = survivableSpawnDriver({
      binPath: "/nonexistent/definitely/not/a/real/kaval-binary",
      args: [],
      env: {},
      unitPrefix: "kaval",
      fromSource: true, // force the detached branch, skip systemd-run
    });
    await expect(driver.spawn()).rejects.toMatchObject({ code: "ENOENT" });
  });
});

interface EphemeralChild {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: "ignore"; env?: Record<string, string> };
  unrefd: boolean;
  signals: Array<NodeJS.Signals | number | undefined>;
}

/** A capture seam for the ephemeral driver: records each spawn AND the signals
 *  each child receives. `killThrows` simulates killing an already-dead child.
 *  The parent-exit hook is captured per-test via the driver's `onParentExit`
 *  dep, so no real `process` listener is touched. */
function captureEphemeral(opts: { killThrows?: boolean } = {}): {
  calls: EphemeralChild[];
  spawnProcess: NonNullable<EphemeralSpawnDeps["spawnProcess"]>;
} {
  const calls: EphemeralChild[] = [];
  const spawnProcess = (
    command: string,
    args: string[],
    options: EphemeralChild["options"],
  ) => {
    const rec: EphemeralChild = {
      command,
      args,
      options,
      unrefd: false,
      signals: [],
    };
    calls.push(rec);
    return {
      unref() {
        rec.unrefd = true;
      },
      kill(signal?: NodeJS.Signals | number) {
        if (opts.killThrows) throw new Error("kill ESRCH (already gone)");
        rec.signals.push(signal);
        return true;
      },
    };
  };
  return { calls, spawnProcess };
}

const ephCfg: DaemonSpawnConfig = {
  binPath: "/nix/store/abc/bin/pulam",
  args: [
    "--kaval",
    "/run/user/1000/kaval-7692/pty-host.sock",
    "--socket",
    "/x",
  ],
  env: { XDG_RUNTIME_DIR: "/run/user/1000" },
  unitPrefix: "pulam",
};

describe("ephemeralSpawnDriver — dies with its parent, self-recycling", () => {
  it("spawns a plain child (no systemd-run), detached:false + unref", async () => {
    const cap = captureEphemeral();
    const driver = ephemeralSpawnDriver(ephCfg, {
      env: { INVOCATION_ID: "deadbeef" }, // even under systemd: NEVER systemd-run
      spawnProcess: cap.spawnProcess,
      onParentExit: () => {},
    });
    await driver.spawn();
    expect(cap.calls).toHaveLength(1);
    const c = cap.calls[0];
    expect(c?.command).toBe("/nix/store/abc/bin/pulam");
    expect(c?.options.detached).toBe(false);
    expect(c?.unrefd).toBe(true);
  });

  it("recycles: a second spawn SIGTERMs the prior child before launching fresh", async () => {
    const cap = captureEphemeral();
    const driver = ephemeralSpawnDriver(ephCfg, {
      spawnProcess: cap.spawnProcess,
      onParentExit: () => {},
    });
    await driver.spawn();
    await driver.spawn();
    expect(cap.calls).toHaveLength(2);
    // The first child was SIGTERMed (the recycle), the second is still live.
    expect(cap.calls[0]?.signals).toEqual(["SIGTERM"]);
    expect(cap.calls[1]?.signals).toEqual([]);
  });

  it("swallows a kill that throws (the prior child already died)", async () => {
    const cap = captureEphemeral({ killThrows: true });
    const driver = ephemeralSpawnDriver(ephCfg, {
      spawnProcess: cap.spawnProcess,
      onParentExit: () => {},
    });
    await driver.spawn();
    // The recycle's kill throws (dead child) — must not propagate; the fresh
    // spawn still happens.
    await expect(driver.spawn()).resolves.toBeUndefined();
    expect(cap.calls).toHaveLength(2);
  });

  it("death-pact: the registered parent-exit hook SIGTERMs the current child", async () => {
    const cap = captureEphemeral();
    let exitHandler: (() => void) | undefined;
    const driver = ephemeralSpawnDriver(ephCfg, {
      spawnProcess: cap.spawnProcess,
      onParentExit: (h) => {
        exitHandler = h;
      },
    });
    await driver.spawn();
    await driver.spawn(); // recycle — the CURRENT child is calls[1]
    expect(exitHandler).toBeTypeOf("function");
    exitHandler?.(); // parent exits
    // The current child is reaped on exit; the prior (calls[0]) was already
    // reaped by the recycle.
    expect(cap.calls[1]?.signals).toEqual(["SIGTERM"]);
  });
});
