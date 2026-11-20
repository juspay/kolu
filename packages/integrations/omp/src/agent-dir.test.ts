import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentDirResolution,
  normalizeProfileName,
  parseProfileFlag,
  resolveAgentDir,
} from "./agent-dir.ts";

const HOME = "/home/u";
const CWD = "/work/proj";

function probe(paths: readonly string[]): (candidate: string) => boolean {
  const present = new Set(paths);
  return (candidate) => present.has(candidate);
}

const base = {
  home: HOME,
  cwd: CWD,
  existsSync: probe([]),
};

function resolved(
  opts: Parameters<typeof resolveAgentDir>[0],
): AgentDirResolution {
  const result = resolveAgentDir(opts);
  if (result === null) throw new Error("expected a resolvable agent dir");
  return result;
}

describe("parseProfileFlag", () => {
  it("reads both spellings, first occurrence wins, and reports absence", () => {
    expect(parseProfileFlag(["omp", "--profile", "work"])).toBe("work");
    expect(parseProfileFlag(["omp", "--profile=work"])).toBe("work");
    expect(parseProfileFlag(["omp"])).toBeNull();
    expect(parseProfileFlag(["omp", "--profile"])).toBe("");
    expect(parseProfileFlag(["omp", "--profile", "a", "--profile", "b"])).toBe(
      "a",
    );
    expect(parseProfileFlag(["omp", "hi", "--profile", "work"])).toBe("work");
  });
});

describe("normalizeProfileName", () => {
  it("maps '' and 'default' to the implicit default profile", () => {
    expect(normalizeProfileName(undefined)).toBeUndefined();
    expect(normalizeProfileName("")).toBeUndefined();
    expect(normalizeProfileName("  ")).toBeUndefined();
    expect(normalizeProfileName("default")).toBeUndefined();
  });

  it("returns the name for a valid profile and null for one omp would refuse", () => {
    expect(normalizeProfileName("work")).toBe("work");
    expect(normalizeProfileName("work-2.x")).toBe("work-2.x");
    expect(normalizeProfileName("Work")).toBeNull();
    expect(normalizeProfileName("-work")).toBeNull();
    expect(normalizeProfileName("..")).toBeNull();
    expect(normalizeProfileName("work.")).toBeNull();
    expect(normalizeProfileName("CON")).toBeNull();
    expect(normalizeProfileName("x".repeat(65))).toBeNull();
  });
});

describe("resolveAgentDir — the default chain", () => {
  it("derives <home>/.omp/agent and its terminal-sessions dir", () => {
    expect(resolved({ ...base })).toEqual({
      agentDir: "/home/u/.omp/agent",
      breadcrumbDir: "/home/u/.omp/agent/terminal-sessions",
      source: "default",
    });
  });

  it("follows PI_CONFIG_DIR (omp's config-root name)", () => {
    expect(
      resolved({ ...base, env: { PI_CONFIG_DIR: ".omp-nightly" } }),
    ).toEqual({
      agentDir: "/home/u/.omp-nightly/agent",
      breadcrumbDir: "/home/u/.omp-nightly/agent/terminal-sessions",
      source: "default",
    });
    expect(resolved({ ...base, env: { PI_CONFIG_DIR: "" } }).agentDir).toBe(
      "/home/u/.omp/agent",
    );
  });

  it("resolves a relative PI_CODING_AGENT_DIR against the terminal cwd", () => {
    expect(
      resolved({
        ...base,
        env: { PI_CODING_AGENT_DIR: "agent-store" },
      }),
    ).toEqual({
      agentDir: path.resolve(CWD, "agent-store"),
      breadcrumbDir: path.resolve(CWD, "agent-store", "terminal-sessions"),
      source: "env",
    });
  });

  it("ignores a falsy PI_CODING_AGENT_DIR (omp's truthiness check)", () => {
    expect(resolved({ ...base, env: { PI_CODING_AGENT_DIR: "" } }).source).toBe(
      "default",
    );
  });

  it("honours kolu's override only in place of omp's own default", () => {
    expect(
      resolved({ ...base, agentDirOverride: "/fixtures/omp/agent" }),
    ).toEqual({
      agentDir: "/fixtures/omp/agent",
      breadcrumbDir: "/fixtures/omp/agent/terminal-sessions",
      source: "override",
    });
    expect(
      resolved({
        ...base,
        agentDirOverride: "/fixtures/omp/agent",
        env: { PI_CODING_AGENT_DIR: "/real/agent" },
      }).source,
    ).toBe("env");
  });
});

describe("resolveAgentDir — profiles", () => {
  it("flag beats env, and a profile root comes from the config root", () => {
    const env = { OMP_PROFILE: "from-env", PI_PROFILE: "from-pi" };
    expect(
      resolved({
        ...base,
        argv: ["omp", "--profile", "from-flag"],
        env,
      }),
    ).toEqual({
      agentDir: "/home/u/.omp/profiles/from-flag/agent",
      breadcrumbDir: "/home/u/.omp/profiles/from-flag/agent/terminal-sessions",
      source: "profile",
    });
    expect(resolved({ ...base, env }).agentDir).toBe(
      "/home/u/.omp/profiles/from-env/agent",
    );
    expect(resolved({ ...base, env: { PI_PROFILE: "from-pi" } }).agentDir).toBe(
      "/home/u/.omp/profiles/from-pi/agent",
    );
  });

  it("an explicitly-empty OMP_PROFILE selects the default even with PI_PROFILE set", () => {
    expect(
      resolved({
        ...base,
        env: { OMP_PROFILE: "", PI_PROFILE: "from-pi" },
      }),
    ).toEqual({
      agentDir: "/home/u/.omp/agent",
      breadcrumbDir: "/home/u/.omp/agent/terminal-sessions",
      source: "default",
    });
  });

  it("ignores PI_CODING_AGENT_DIR under a profile (omp derives the profile dir)", () => {
    expect(
      resolved({
        ...base,
        env: {
          OMP_PROFILE: "work",
          PI_CODING_AGENT_DIR: "/elsewhere/agent",
        },
      }),
    ).toEqual({
      agentDir: "/home/u/.omp/profiles/work/agent",
      breadcrumbDir: "/home/u/.omp/profiles/work/agent/terminal-sessions",
      source: "profile",
    });
  });

  it("answers null for a profile name omp itself refuses", () => {
    expect(
      resolveAgentDir({ ...base, env: { OMP_PROFILE: "Not Valid" } }),
    ).toBeNull();
    expect(
      resolveAgentDir({ ...base, argv: ["omp", "--profile", "CON"] }),
    ).toBeNull();
  });

  it("follows PI_CONFIG_DIR into the profile root", () => {
    expect(
      resolved({
        ...base,
        env: { PI_CONFIG_DIR: ".omp-nightly", OMP_PROFILE: "work" },
      }).agentDir,
    ).toBe("/home/u/.omp-nightly/profiles/work/agent");
  });
});

describe("resolveAgentDir — the XDG state dir", () => {
  const XDG = "/xdg-state";

  it("is used for the default profile only when the app root exists", () => {
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG },
        existsSync: probe([`${XDG}/omp`]),
      }),
    ).toEqual({
      agentDir: "/home/u/.omp/agent",
      breadcrumbDir: `${XDG}/omp/terminal-sessions`,
      source: "xdg",
    });
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG },
        existsSync: probe([]),
      }).source,
    ).toBe("default");
  });

  it("is NOT consulted for an overridden or env-named agent dir", () => {
    const existsSync = probe([`${XDG}/omp`]);
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG, PI_CODING_AGENT_DIR: "/real/agent" },
        existsSync,
      }).source,
    ).toBe("env");
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG },
        agentDirOverride: "/fixtures/agent",
        existsSync,
      }).source,
    ).toBe("override");
  });

  it("keys a profile on its OWN XDG directory, not the base app root", () => {
    const profileRoot = `${XDG}/omp/profiles/work`;
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG, OMP_PROFILE: "work" },
        existsSync: probe([profileRoot]),
      }),
    ).toEqual({
      agentDir: "/home/u/.omp/profiles/work/agent",
      breadcrumbDir: `${profileRoot}/terminal-sessions`,
      source: "profile-xdg",
    });
    expect(
      resolved({
        ...base,
        env: { XDG_STATE_HOME: XDG, OMP_PROFILE: "work" },
        existsSync: probe([`${XDG}/omp`]),
      }).breadcrumbDir,
    ).toBe("/home/u/.omp/profiles/work/agent/terminal-sessions");
  });
});
