import { describe, expect, it } from "vitest";
import { type DaemonSpawnConfig, survivableSpawnDriver } from "./driver.ts";

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

  it("strategy:detached forces a detached fork even under a systemd session", async () => {
    // The dev/e2e case: INVOCATION_ID is set (shell is in a systemd session) but
    // we run kaval from source, so systemd-run would strip the env — force
    // detached.
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, strategy: "detached" },
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
});
