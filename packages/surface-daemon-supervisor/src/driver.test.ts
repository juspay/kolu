import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DaemonSpawnConfig, survivableSpawnDriver } from "./driver.ts";

interface Captured {
  command: string;
  args: string[];
  options: {
    detached: boolean;
    stdio: "ignore" | Array<"ignore" | number>;
    env?: Record<string, string>;
  };
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

  it("with stderrLog under systemd: does NOT wire a crash-catcher file — journald holds stderr (P0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drv-log-"));
    const logFile = join(dir, "d.stderr.log");
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, stderrLog: logFile },
      { env: { INVOCATION_ID: "x" }, spawnProcess, unitSuffix: () => "U" },
    );
    await driver.spawn();
    // Attached spawns keep parent-owned stderr (journald), so no file arg + no `.old` rotation.
    const c = only(calls);
    expect(c.command).toBe("systemd-run");
    expect(c.args.some((a) => a.includes("StandardError"))).toBe(false);
    expect(existsSync(`${logFile}.old`)).toBe(false);
  });

  it("with stderrLog off systemd: hands a real stderr fd (stdout/stdin ignored) and rotates the prior capture to .old (P0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drv-log-"));
    const logFile = join(dir, "d.stderr.log");
    writeFileSync(logFile, "prior\n"); // seed a prior boot to exercise rotate-on-boot
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, stderrLog: logFile },
      { env: { PATH: "/usr/bin" }, spawnProcess },
    );
    await driver.spawn();
    const stdio = only(calls).options.stdio as unknown[];
    expect(stdio[0]).toBe("ignore");
    expect(stdio[1]).toBe("ignore");
    expect(typeof stdio[2]).toBe("number");
    expect(existsSync(`${logFile}.old`)).toBe(true);
    expect(readFileSync(`${logFile}.old`, "utf8")).toBe("prior\n");
    // Owner-only (0600) — the crash-catcher can hold sensitive stderr, never world-readable.
    expect(statSync(logFile).mode & 0o777).toBe(0o600);
  });

  it("with stderrLog off systemd: creates the crash-catcher dir OWNER-ONLY (0700) — kaval's private-dir guard refuses 0755 (P0 regression)", async () => {
    const parent = mkdtempSync(join(tmpdir(), "drv-perm-"));
    // The crash-catcher dir can be the daemon's OWN runtime home (kaval-<digest>/), which
    // kaval refuses unless owner-only. A bare `mkdir` under umask 022 → 0755 → kaval refuses →
    // padi never boots. The dir must not exist yet, so the spine creates it.
    const crashDir = join(parent, "kaval-digest");
    const logFile = join(crashDir, "kaval.log");
    const { spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, stderrLog: logFile },
      { env: { PATH: "/usr/bin" }, spawnProcess },
    );
    await driver.spawn();
    // umask never masks owner bits, so 0700 stays 0700; a bare mkdir's 0755 would FAIL this.
    expect(statSync(crashDir).mode & 0o777).toBe(0o700);
  });

  it("off systemd (non-fromSource), spawns detached+unref with cfg.env ALONE — no parent env layered (#1872 parity)", async () => {
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(cfg, {
      // The supervisor's own parent env — an orchestrator's ambient identity vars in
      // production. It must NOT ride into the daemon (and every PTY it spawns).
      env: { PATH: "/usr/bin", FOO: "bar" }, // no INVOCATION_ID
      spawnProcess,
    });
    await driver.spawn();

    const c = only(calls);
    expect(c.command).toBe("/nix/store/abc/bin/kaval");
    expect(c.args).toEqual(["--socket", "/run/user/1000/kaval/pty-host.sock"]);
    expect(c.options.detached).toBe(true);
    expect(c.unrefd).toBe(true);
    // The child env is cfg.env ALONE — parity with the systemd branch's `--setenv`
    // (which overlays cfg.env on systemd's own manager env, never the supervisor's).
    // The parent's PATH/FOO do NOT layer under it: that ambient leak is the #1872 class.
    expect(c.options.env).toEqual({ XDG_RUNTIME_DIR: "/run/user/1000" });
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

  it("fromSource DOES layer the parent env under cfg.env (dev: the from-source daemon needs the nix-shell env)", async () => {
    // The ONE caller that opts INTO parent layering — `just dev` runs kaval from a
    // nix-shell whose store paths / dev vars the daemon genuinely needs. cfg.env still
    // wins on overlap. Production (non-fromSource) never takes this path, so no ambient
    // identity var can leak there.
    const { calls, spawnProcess } = capture();
    const driver = survivableSpawnDriver(
      { ...cfg, fromSource: true },
      { env: { PATH: "/dev/shell/bin", FOO: "bar" }, spawnProcess }, // no INVOCATION_ID → detached
    );
    await driver.spawn();
    expect(only(calls).options.env).toEqual({
      PATH: "/dev/shell/bin",
      FOO: "bar",
      XDG_RUNTIME_DIR: "/run/user/1000", // cfg.env, layered on top
    });
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
