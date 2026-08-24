import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { afterAll, describe, expect, it } from "vitest";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-pi-root-test-"));

const { parseSessionDirFlag, readProcessSnapshot, resolveSessionDir } =
  await import("./session-root.ts");

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const base = {
  home: tmpHome,
  defaultAgentDir: path.join(tmpHome, "agent"),
  cwd: "/work/proj",
};

describe("parseSessionDirFlag", () => {
  it("reads both spellings and ignores others", () => {
    expect(parseSessionDirFlag(["pi", "--session-dir", "/x"])).toBe("/x");
    expect(parseSessionDirFlag(["pi", "--session-dir=/y"])).toBe("/y");
    expect(parseSessionDirFlag(["pi"])).toBeNull();
    expect(parseSessionDirFlag(["pi", "--session", "abc"])).toBeNull();
    expect(parseSessionDirFlag(["pi", "--session-dir"])).toBeNull();
  });
});

describe("resolveSessionDir", () => {
  it("falls to the default <agentDir>/sessions with no overrides", () => {
    const r = resolveSessionDir({ ...base, argv: ["pi"], env: {} });
    expect(r).toEqual({
      dir: path.join(tmpHome, "agent", "sessions"),
      source: "default",
      layout: "tree",
    });
  });

  it("flag beats env beats settings beats default — pi's precedence", () => {
    const settingsAgentDir = path.join(tmpHome, "s-agent");
    fs.mkdirSync(settingsAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsAgentDir, "settings.json"),
      JSON.stringify({ sessionDir: path.join(tmpHome, "from-settings") }),
    );
    const env = {
      PI_CODING_AGENT_SESSION_DIR: path.join(tmpHome, "from-env"),
      PI_CODING_AGENT_DIR: settingsAgentDir,
    };
    expect(resolveSessionDir({ ...base, argv: ["pi"], env }).dir).toBe(
      path.join(tmpHome, "from-env"),
    );
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi", "--session-dir", path.join(tmpHome, "from-flag")],
        env,
      }).dir,
    ).toBe(path.join(tmpHome, "from-flag"));
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi"],
        env: { PI_CODING_AGENT_DIR: settingsAgentDir },
      }),
    ).toEqual({
      dir: path.join(tmpHome, "from-settings"),
      source: "settings",
      layout: "flat",
    });
  });

  it("any redirect is FLAT; the default chain is TREE", () => {
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi", "--session-dir", "/x"],
        env: {},
      }).layout,
    ).toBe("flat");
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi"],
        env: { PI_CODING_AGENT_SESSION_DIR: "/y" },
      }).layout,
    ).toBe("flat");
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi"],
        env: { PI_CODING_AGENT_DIR: "/z" },
      }).layout,
    ).toBe("tree");
  });

  it("PI_CODING_AGENT_DIR moves the session store (it is NOT config-only)", () => {
    const r = resolveSessionDir({
      ...base,
      argv: ["pi"],
      env: { PI_CODING_AGENT_DIR: path.join(tmpHome, "custom-agent") },
    });
    expect(r.dir).toBe(path.join(tmpHome, "custom-agent", "sessions"));
  });

  it("expands ~ and absolutizes relative values against the cwd", () => {
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi"],
        env: { PI_CODING_AGENT_SESSION_DIR: "~/store" },
      }).dir,
    ).toBe(path.join(tmpHome, "store"));
    expect(
      resolveSessionDir({
        ...base,
        argv: ["pi", "--session-dir", "rel-store"],
        env: {},
      }).dir,
    ).toBe(path.resolve("/work/proj", "rel-store"));
  });

  it("a corrupt settings.json is skipped (logged), not an answer", () => {
    const dir = path.join(tmpHome, "bad-settings-agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "settings.json"), "not-json{{{");
    const r = resolveSessionDir({
      ...base,
      argv: ["pi"],
      env: { PI_CODING_AGENT_DIR: dir },
    });
    expect(r).toEqual({
      dir: path.join(dir, "sessions"),
      source: "default",
      layout: "tree",
    });
  });
});

describe("readProcessSnapshot", () => {
  describeDaemon("reads a child's exec-time argv + env", () => {
    // NOTE: /proc/<pid>/environ reflects the EXEC-TIME env only (a setenv
    // after start does not reach it) — which is also exactly the pi-launch env
    // kolu needs. Tests therefore spawn a child carrying the marker rather
    // than mutating this process's own env. (describeDaemon-gated: the child
    // is a real fork, so this case runs only where forks are allowed.)
    it("returns the launch env and argv", () => {
      if (process.platform !== "linux" && process.platform !== "darwin") return;
      const child = spawn(
        process.execPath,
        ["-e", "setTimeout(()=>{}, 30_000)"],
        { env: { ...process.env, KOLU_PI_SNAPSHOT_MARKER: "present" } },
      );
      try {
        expect(child.pid).toBeDefined();
        const snap = readProcessSnapshot(child.pid!);
        expect(snap).not.toBeNull();
        expect(snap?.argv.length).toBeGreaterThan(0);
        if (process.platform === "linux") {
          expect(snap?.env.KOLU_PI_SNAPSHOT_MARKER).toBe("present");
        } else {
          // Darwin: macOS redacts even same-user environment maps from ps
          // — env is {} by OS policy (documented in session-root.ts).
          expect(snap?.env.KOLU_PI_SNAPSHOT_MARKER).toBeUndefined();
        }
      } finally {
        child.kill();
      }
    });
  });

  it("returns null for a pid that does not exist", () => {
    expect(readProcessSnapshot(2 ** 22)).toBeNull();
  });
});

// The end-to-end of the chain: with env shaped exactly like a harnessed pi
// (only PI_CODING_AGENT_DIR set — the launch pattern that produced the /
// tmp/pi-agent-* blind spot), resolution lands inside it.
describe("resolveSessionDir — the harness pattern", () => {
  it("resolves <PI_CODING_AGENT_DIR>/sessions", () => {
    const r = resolveSessionDir({
      ...base,
      argv: ["pi", "--model", "litellm/x"],
      env: { PI_CODING_AGENT_DIR: "/tmp/pi-agent-XXXXXX" },
    });
    expect(r).toEqual({
      dir: "/tmp/pi-agent-XXXXXX/sessions",
      source: "default",
      layout: "tree",
    });
  });
});
