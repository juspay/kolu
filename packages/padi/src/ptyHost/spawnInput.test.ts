import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MIRROR_SCROLLBACK, type PtyHostSystemInfo } from "kaval";
const CLIENT_VISIBLE_SCROLLBACK = 50_000;
import { AGENT_TOOLS_BAKE_ENV, TERMINAL_TOOLS_PATH_ENV } from "kolu-pty";
import {
  AGENT_DISTRO_PLUGINS_ENV,
  AI_PROFILE_ENV,
} from "../agentDistro/bake.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentSpawnEnv,
  composeSpawnInput,
  setSpawnServerVersion,
  type TerminalEnvSpec,
} from "./index.ts";

setSpawnServerVersion("9.9.9-test");

const RC_DIR = mkdtempSync(join(tmpdir(), "spawn-input-rc-"));

const KAVAL_SOCK = "/tmp/kaval-7692-501/pty-host.sock";

function spec(over: Partial<TerminalEnvSpec> = {}): TerminalEnvSpec {
  return {
    kavalSocket: KAVAL_SOCK,
    toolsPath: [],
    serverVersion: "9.9.9-test",
    ...over,
  };
}

function info(over: Partial<PtyHostSystemInfo> = {}): PtyHostSystemInfo {
  return {
    shell: "/bin/sh",
    home: "/home/test",
    platform: "linux",
    rcDir: RC_DIR,
    ...over,
  } as PtyHostSystemInfo;
}

describe("composeSpawnInput env layering", () => {
  let savedShell: string | undefined;
  let savedColorterm: string | undefined;
  let savedKavalSocket: string | undefined;
  let savedTerminalId: string | undefined;
  let savedSshAuthSock: string | undefined;

  beforeEach(() => {
    savedShell = process.env.SHELL;
    savedColorterm = process.env.COLORTERM;
    savedKavalSocket = process.env.KAVAL_SOCKET;
    savedTerminalId = process.env.KAVAL_TERMINAL_ID;
    savedSshAuthSock = process.env.SSH_AUTH_SOCK;
  });

  afterEach(() => {
    restore("SHELL", savedShell);
    restore("COLORTERM", savedColorterm);
    restore("KAVAL_SOCKET", savedKavalSocket);
    restore("KAVAL_TERMINAL_ID", savedTerminalId);
    restore("SSH_AUTH_SOCK", savedSshAuthSock);
  });

  it("koluIdentityEnv overrides a same-named cleanEnv (parent) key", () => {
    process.env.COLORTERM = "PARENT_SENTINEL";
    const input = composeSpawnInput({ id: "T-colorterm" }, info(), spec());
    expect(input.env.COLORTERM).toBe("truecolor");
  });

  it("plan.env (ZDOTDIR) survives over both cleanEnv and koluIdentityEnv", () => {
    process.env.SHELL = "/bin/zsh";
    const id = "T-zdotdir";
    const input = composeSpawnInput({ id }, info(), spec());
    expect(input.argv[0]).toBe("/bin/zsh");
    expect(input.env.ZDOTDIR).toBe(join(RC_DIR, `zdotdir-${id}`));
  });

  it("local env SHELL wins over system.info.shell (the local-host boundary)", () => {
    process.env.SHELL = "/bin/zsh";
    const input = composeSpawnInput(
      { id: "T-local-shell" },
      info({ shell: "/bin/dash" }),
      spec(),
    );
    expect(input.argv[0]).toBe("/bin/zsh");
  });

  it("stamps KAVAL_SOCKET with the daemon's own socket (the $TMUX convention)", () => {
    const input = composeSpawnInput({ id: "T-kaval-socket" }, info(), spec());
    expect(input.env.KAVAL_SOCKET).toBe(KAVAL_SOCK);
  });

  it("KAVAL_SOCKET is not clobbered by a same-named parent env key", () => {
    process.env.KAVAL_SOCKET = "/tmp/kaval-OUTER-501/pty-host.sock";
    const input = composeSpawnInput({ id: "T-nested" }, info(), spec());
    expect(input.env.KAVAL_SOCKET).toBe(KAVAL_SOCK);
  });

  it("stamps PADI_SOCKET with padi's own serving socket (the $KAVAL_SOCKET twin)", () => {
    const PADI_SOCK = "/run/user/1000/padi-abc123/padi.sock";
    const input = composeSpawnInput(
      { id: "T-padi-socket" },
      info(),
      spec({ padiSocket: PADI_SOCK }),
    );
    expect(input.env.PADI_SOCKET).toBe(PADI_SOCK);
  });

  it("omits PADI_SOCKET when padi's serving socket is unknown (autodiscovery covers it)", () => {
    const input = composeSpawnInput({ id: "T-no-padi" }, info(), spec());
    expect(input.env.PADI_SOCKET).toBeUndefined();
  });

  it("stamps the forwarded ssh-agent LINK over cleanEnv's SSH_AUTH_SOCK", () => {
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.DEAD";
    const LINK = "/run/user/1000/padi-9f2c1a4b8e0d6f37/ssh-auth.sock";

    const input = composeSpawnInput(
      { id: "T-ssh-auth-link" },
      info(),
      spec({ sshAuthSock: LINK }),
    );

    expect(input.env.SSH_AUTH_SOCK).toBe(LINK);
  });

  it("leaves SSH_AUTH_SOCK exactly as cleanEnv composed it when the spec has none", () => {
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.LOCAL";

    const input = composeSpawnInput({ id: "T-ssh-auth-local" }, info(), spec());

    expect(input.env.SSH_AUTH_SOCK).toBe("/tmp/ssh-XXXX/agent.LOCAL");
  });

  it("stamps KAVAL_TERMINAL_ID with the terminal's own id", () => {
    const input = composeSpawnInput({ id: "T-self-id" }, info(), spec());
    expect(input.env.KAVAL_TERMINAL_ID).toBe("T-self-id");
    expect(input.env.KAVAL_TERMINAL_ID).toBe(input.id);
  });

  it("re-stamps KAVAL_TERMINAL_ID over an inherited (outer) one — nested terminals get a fresh id", () => {
    process.env.KAVAL_TERMINAL_ID = "T-OUTER";
    const input = composeSpawnInput({ id: "T-inner" }, info(), spec());
    expect(input.env.KAVAL_TERMINAL_ID).toBe("T-inner");
  });

  it("resolves a real shell when the local env omits SHELL", () => {
    delete process.env.SHELL;
    const input = composeSpawnInput(
      { id: "T-fallback-shell" },
      info({ shell: "/bin/bash" }),
      spec(),
    );
    expect(input.argv[0]?.startsWith("/")).toBe(true);
  });
});

describe("composeSpawnInput agent toolchain (PATH injection)", () => {
  const TOOLS = "/run/user/1000/padi-9f2c1a4b8e0d6f37/tools/0";
  const TOOLS2 = "/run/user/1000/padi-9f2c1a4b8e0d6f37/tools/1";

  let savedPath: string | undefined;
  beforeEach(() => {
    savedPath = process.env.PATH;
  });
  afterEach(() => {
    restore("PATH", savedPath);
  });

  it("prepends the tool dirs to PATH so kolu's own CLIs resolve first", () => {
    const input = composeSpawnInput(
      { id: "T-tools" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    const entries = (input.env.PATH ?? "").split(":");
    expect(entries[0]).toBe(TOOLS);
    expect(entries[1]).toBe(TOOLS2);
  });

  it("keeps the user's own PATH — the toolchain merges, it does not replace", () => {
    const before = (
      composeSpawnInput({ id: "T-before" }, info(), spec()).env.PATH ?? ""
    ).split(":");
    const after = (
      composeSpawnInput({ id: "T-after" }, info(), spec({ toolsPath: [TOOLS] }))
        .env.PATH ?? ""
    ).split(":");
    for (const entry of before) expect(after).toContain(entry);
  });

  it("stamps KOLU_TERMINAL_TOOLS_PATH so the rcfile can re-assert after dotfile replay", () => {
    const input = composeSpawnInput(
      { id: "T-stamp" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    expect(input.env[TERMINAL_TOOLS_PATH_ENV]).toBe(`${TOOLS}:${TOOLS2}`);
  });

  it("never stamps the BAKE name into a terminal", () => {
    const input = composeSpawnInput(
      { id: "T-no-bake" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    expect(input.env[AGENT_TOOLS_BAKE_ENV]).toBeUndefined();
  });

  it("does not duplicate a dir already on PATH (a re-spawn can't grow it)", () => {
    process.env.PATH = `${TOOLS}:/usr/bin`;
    const input = composeSpawnInput(
      { id: "T-dedupe" },
      info(),
      spec({ toolsPath: [TOOLS] }),
    );
    const hits = (input.env.PATH ?? "")
      .split(":")
      .filter((e) => e === TOOLS).length;
    expect(hits).toBe(1);
  });

  it("leaves PATH and the stamp untouched when no toolchain is baked (from-source)", () => {
    const noPath = process.env.PATH;
    const empty = composeSpawnInput(
      { id: "T-bare" },
      info(),
      spec({ toolsPath: [] }),
    );
    expect(empty.env[TERMINAL_TOOLS_PATH_ENV]).toBeUndefined();
    expect(empty.env.PATH).toBe(noPath);
  });
});

describe("composeSpawnInput agent-distro layer", () => {
  const TOOLS = "/run/user/1000/padi-9f2c1a4b8e0d6f37/tools/0";
  const AGENTS = "/nix/store/ccc-agent-distro-vanilla-kolu/bin";
  const PLUGINS = "/nix/store/ddd-kolu-agent-plugin";

  let savedPath: string | undefined;
  let savedPlugins: string | undefined;
  beforeEach(() => {
    savedPath = process.env.PATH;
    savedPlugins = process.env[AGENT_DISTRO_PLUGINS_ENV];
    process.env.PATH = "/usr/bin:/bin";
  });
  afterEach(() => {
    restore("PATH", savedPath);
    restore(AGENT_DISTRO_PLUGINS_ENV, savedPlugins);
  });

  it("puts the package's bin/ AFTER kolu's own tools and before the user's PATH", () => {
    const input = composeSpawnInput(
      { id: "T-agents" },
      info(),
      spec({
        toolsPath: [TOOLS],
        agents: { binDir: AGENTS, plugins: PLUGINS, profiles: [] },
      }),
    );
    expect(input.env.PATH).toBe(`${TOOLS}:${AGENTS}:/usr/bin:/bin`);
  });

  it("rides the KOLU_TERMINAL_TOOLS_PATH stamp, so the rcfile re-asserts it after dotfiles", () => {
    const input = composeSpawnInput(
      { id: "T-agents-stamp" },
      info(),
      spec({
        toolsPath: [TOOLS],
        agents: { binDir: AGENTS, plugins: PLUGINS, profiles: [] },
      }),
    );
    expect(input.env[TERMINAL_TOOLS_PATH_ENV]).toBe(`${TOOLS}:${AGENTS}`);
  });

  it("stamps the agent dir even on a daemon with no baked toolchain", () => {
    const input = composeSpawnInput(
      { id: "T-agents-only" },
      info(),
      spec({
        agents: { binDir: AGENTS, plugins: PLUGINS, profiles: [] },
      }),
    );
    expect(input.env.PATH).toBe(`${AGENTS}:/usr/bin:/bin`);
    expect(input.env[TERMINAL_TOOLS_PATH_ENV]).toBe(AGENTS);
  });

  it("sets AGENT_DISTRO_PLUGINS to this kolu's plugin dir", () => {
    const input = composeSpawnInput(
      { id: "T-agents-plugins" },
      info(),
      spec({
        agents: { binDir: AGENTS, plugins: PLUGINS, profiles: [] },
      }),
    );
    expect(input.env[AGENT_DISTRO_PLUGINS_ENV]).toBe(PLUGINS);
  });

  it("exports the built profiles as AI_PROFILE, space-joined bottom to top", () => {
    const profile = (name: string) => ({
      reference: `github:me/${name}`,
      name,
      path: `/nix/store/ppp-${name}`,
    });
    const input = composeSpawnInput(
      { id: "T-agents-stack" },
      info(),
      spec({
        agents: agentSpawnEnv({
          bundle: "/s/package",
          profiles: [profile("juspay"), profile("ekala")],
          plugins: PLUGINS,
        }),
      }),
    );
    expect(input.env[AI_PROFILE_ENV]).toBe(
      "/nix/store/ppp-juspay /nix/store/ppp-ekala",
    );
    expect(input.env[AGENT_DISTRO_PLUGINS_ENV]).toBe(PLUGINS);
    expect(input.env.PATH).toBe("/s/package/bin:/usr/bin:/bin");
  });

  it("no profiles: AI_PROFILE is not set at all, and an inherited one is not carried", () => {
    const saved = process.env[AI_PROFILE_ENV];
    process.env[AI_PROFILE_ENV] = "github:somewhere/else";
    try {
      const input = composeSpawnInput(
        { id: "T-agents-stock" },
        info(),
        spec({
          agents: agentSpawnEnv({
            bundle: "/s/package",
            profiles: [],
            plugins: PLUGINS,
          }),
        }),
      );
      expect(AI_PROFILE_ENV in input.env).toBe(false);
      expect(input.env[AGENT_DISTRO_PLUGINS_ENV]).toBe(PLUGINS);
    } finally {
      restore(AI_PROFILE_ENV, saved);
    }
  });

  it("off means off: no agent dir, no plugins var, and an inherited one is not carried", () => {
    process.env[AGENT_DISTRO_PLUGINS_ENV] = "/somewhere/else";
    const input = composeSpawnInput(
      { id: "T-agents-off" },
      info(),
      spec({ toolsPath: [TOOLS] }),
    );
    expect(input.env.PATH).toBe(`${TOOLS}:/usr/bin:/bin`);
    expect(input.env[TERMINAL_TOOLS_PATH_ENV]).toBe(TOOLS);
    expect(input.env[AGENT_DISTRO_PLUGINS_ENV]).toBeUndefined();
  });
});

describe("composeSpawnInput mirror scrollback (the OOM-fix decouple)", () => {
  it("sends the small server-mirror scrollback, decoupled from the client's", () => {
    const input = composeSpawnInput({ id: "T-mirror" }, info(), spec());
    expect(input.scrollback).toBe(DEFAULT_MIRROR_SCROLLBACK);
    expect(input.scrollback).toBeLessThan(CLIENT_VISIBLE_SCROLLBACK);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
