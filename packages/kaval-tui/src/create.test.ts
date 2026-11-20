import { describe, expect, it } from "vitest";
import {
  buildCreateInput,
  buildRemoteCreateInput,
  type CreateResult,
  formatCreate,
  newPtyId,
} from "./create.ts";

describe("buildCreateInput", () => {
  const SOCK = "/tmp/kaval-501/pty-host.sock";

  it("composes a fully-specified plain-shell input from the canonical base — argv=[$SHELL], no rcfiles", () => {
    const input = buildCreateInput({
      id: "abc",
      cwd: "/work",
      env: { SHELL: "/bin/zsh", FOO: "bar" },
      kavalSocket: SOCK,
    });
    expect(input).toEqual({
      id: "abc",
      argv: ["/bin/zsh"],
      commandRooted: false,
      cwd: "/work",
      env: {
        SHELL: "/bin/zsh",
        KAVAL_SOCKET: SOCK,
        KAVAL_TERMINAL_ID: "abc",
      },
      initFiles: [],
    });
    expect("FOO" in input.env).toBe(false);
  });

  it("falls back to /bin/sh when the env names no SHELL", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { FOO: "bar" },
      kavalSocket: SOCK,
    });
    expect(input.argv).toEqual(["/bin/sh"]);
  });

  it("runs the given command verbatim instead of $SHELL", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/zsh" },
      command: ["htop", "-d", "5"],
      kavalSocket: SOCK,
    });
    expect(input.argv).toEqual(["htop", "-d", "5"]);
    expect(input.commandRooted).toBe(true);
  });

  it("ignores an empty command (no positional) and uses $SHELL", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/zsh" },
      command: [],
      kavalSocket: SOCK,
    });
    expect(input.argv).toEqual(["/bin/zsh"]);
  });

  it("composes ONLY the canonical allowlist base, dropping arbitrary caller vars and holes", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: {
        HOME: "/home/u",
        PATH: "/usr/bin",
        SHELL: "/bin/sh",
        USER: "u",
        LANG: "en_US.UTF-8",
        DISPLAY: undefined,
        NOT_CANONICAL: "1",
        AWS_SECRET_ACCESS_KEY: "shhh",
      },
      kavalSocket: SOCK,
    });
    expect(input.env).toEqual({
      HOME: "/home/u",
      PATH: "/usr/bin",
      SHELL: "/bin/sh",
      USER: "u",
      LANG: "en_US.UTF-8",
      KAVAL_SOCKET: SOCK,
      KAVAL_TERMINAL_ID: "x",
    });
    expect("NOT_CANONICAL" in input.env).toBe(false);
    expect("AWS_SECRET_ACCESS_KEY" in input.env).toBe(false);
    expect("DISPLAY" in input.env).toBe(false);
  });

  it("--env round-trips env names that collide with Object.prototype keys (constructor/prototype/__proto__)", () => {
    const extraEnv: Record<string, string> = Object.create(null);
    const pairs: [string, string][] = [
      ["constructor", "c"],
      ["prototype", "p"],
      ["__proto__", "pp"],
    ];
    for (const [k, v] of pairs) {
      extraEnv[k] = v;
    }
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/sh" },
      extraEnv,
      kavalSocket: SOCK,
    });
    expect(
      Object.getOwnPropertyDescriptor(input.env, "constructor")?.value,
    ).toBe("c");
    expect(Object.getOwnPropertyDescriptor(input.env, "prototype")?.value).toBe(
      "p",
    );
    expect(Object.getOwnPropertyDescriptor(input.env, "__proto__")?.value).toBe(
      "pp",
    );
  });

  it("--env additions (extraEnv) re-add a dropped var and can override a base var", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/sh", PATH: "/usr/bin" },
      extraEnv: { FOO: "bar", PATH: "/custom/bin" },
      kavalSocket: SOCK,
    });
    expect(input.env.FOO).toBe("bar");
    expect(input.env.PATH).toBe("/custom/bin");
  });

  it("stamps KAVAL_TERMINAL_ID with the terminal's own id, overwriting an inherited one", () => {
    const input = buildCreateInput({
      id: "fresh",
      cwd: "/",
      env: { KAVAL_TERMINAL_ID: "OUTER" },
      kavalSocket: SOCK,
    });
    expect(input.env.KAVAL_TERMINAL_ID).toBe("fresh");
    expect(input.env.KAVAL_TERMINAL_ID).toBe(input.id);
  });

  it("stamps KAVAL_SOCKET, overwriting any value inherited from the env", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { KAVAL_SOCKET: "/tmp/kaval-OUTER-501/pty-host.sock" },
      kavalSocket: SOCK,
    });
    expect(input.env.KAVAL_SOCKET).toBe(SOCK);
  });

  it("passes the caller-minted id straight through (so the host echoes ours)", () => {
    const id = newPtyId();
    expect(
      buildCreateInput({ id, cwd: "/", env: {}, kavalSocket: SOCK }).id,
    ).toBe(id);
  });

  it.each([
    { mode: "shell mode (plain $SHELL)", command: undefined },
    {
      mode: "command mode (`create -- claude`, the #1872 field repro)",
      command: ["claude"],
    },
  ])("does not forward the caller's CLAUDE_CODE_* identity vars — $mode (data-loss guard, #1872)", ({
    command,
  }) => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: {
        SHELL: "/bin/bash",
        CLAUDE_CODE_CHILD_SESSION: "1",
        CLAUDECODE: "1",
        CLAUDE_CODE_SESSION_ID: "abc",
      },
      command,
      kavalSocket: SOCK,
    });
    expect("CLAUDE_CODE_CHILD_SESSION" in input.env).toBe(false);
    expect("CLAUDECODE" in input.env).toBe(false);
    expect("CLAUDE_CODE_SESSION_ID" in input.env).toBe(false);
  });
});

describe("buildRemoteCreateInput", () => {
  const localEnv = {
    SHELL: "/usr/bin/fish",
    HOME: "/home/laptop-user",
    AWS_SECRET_ACCESS_KEY: "shhh",
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
  };
  const host = {
    shell: "/bin/bash",
    home: "/home/prod",
    path: "/run/current-system/sw/bin:/usr/bin:/bin",
  };

  it("uses the host's shell + home + PATH, never the local ones", () => {
    const input = buildRemoteCreateInput({ id: "r1", host, localEnv });
    expect(input.argv).toEqual(["/bin/bash"]);
    expect(input.cwd).toBe("/home/prod");
    expect(input.env.HOME).toBe("/home/prod");
    expect(input.env.SHELL).toBe("/bin/bash");
    expect(input.env.PATH).toBe("/run/current-system/sw/bin:/usr/bin:/bin");
  });

  it("ships ONLY presentation env + host shell/home/PATH — no wholesale local env / secrets", () => {
    const input = buildRemoteCreateInput({ id: "r1", host, localEnv });
    expect("AWS_SECRET_ACCESS_KEY" in input.env).toBe(false);
    expect(input.env.TERM).toBe("xterm-256color");
    expect(input.env.LANG).toBe("en_US.UTF-8");
    expect(input.env).toEqual({
      HOME: "/home/prod",
      SHELL: "/bin/bash",
      PATH: "/run/current-system/sw/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      KAVAL_TERMINAL_ID: "r1",
    });
  });

  it("falls back to a baseline PATH when the host reports none (older daemon)", () => {
    const input = buildRemoteCreateInput({
      id: "r1",
      host: { shell: "/bin/bash", home: "/home/prod" },
      localEnv: {},
    });
    expect(input.env.PATH).toContain("/run/current-system/sw/bin");
    expect(input.env.PATH).toContain("/usr/bin");
  });

  it("falls back to /bin/sh when the host reports no shell", () => {
    const input = buildRemoteCreateInput({
      id: "r1",
      host: { shell: "", home: "/home/prod" },
      localEnv: {},
    });
    expect(input.argv).toEqual(["/bin/sh"]);
    expect(input.env.SHELL).toBe("/bin/sh");
  });

  it("runs a given command verbatim, still in the host's home with host env", () => {
    const input = buildRemoteCreateInput({
      id: "r1",
      host,
      localEnv,
      command: ["htop", "-d", "5"],
    });
    expect(input.argv).toEqual(["htop", "-d", "5"]);
    expect(input.cwd).toBe("/home/prod");
    expect(input.env.HOME).toBe("/home/prod");
  });

  it("applies --env additions on the remote path too (flag behaves the same with --host)", () => {
    const input = buildRemoteCreateInput({
      id: "r1",
      host,
      localEnv,
      extraEnv: { FOO: "bar", PATH: "/custom/bin" },
    });
    expect(input.env.FOO).toBe("bar");
    expect(input.env.PATH).toBe("/custom/bin");
    expect("AWS_SECRET_ACCESS_KEY" in input.env).toBe(false);
  });

  it("--env round-trips a __proto__ key on the remote path too (null-proto base, codex F3)", () => {
    const extraEnv: Record<string, string> = Object.create(null);
    extraEnv.__proto__ = "pp";
    const input = buildRemoteCreateInput({
      id: "r1",
      host,
      localEnv,
      extraEnv,
    });
    expect(Object.getOwnPropertyDescriptor(input.env, "__proto__")?.value).toBe(
      "pp",
    );
  });
});

describe("newPtyId", () => {
  it("mints a fresh, unique id each call", () => {
    const a = newPtyId();
    const b = newPtyId();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

const RESULT: CreateResult = {
  id: "a8f1c2d3-1111-2222-3333-444455556666",
  pid: 12843,
  cwd: "/home/u/code/kolu",
};

describe("formatCreate", () => {
  it("renders the short id, program basename, tildeified cwd, and pid", () => {
    expect(formatCreate(RESULT, { program: "/bin/zsh", home: "/home/u" })).toBe(
      "spawned a8f1c2d3 · zsh · ~/code/kolu (pid 12843)",
    );
  });

  it("shows a passed command's basename as the program", () => {
    expect(formatCreate(RESULT, { program: "htop", home: "/home/u" })).toBe(
      "spawned a8f1c2d3 · htop · ~/code/kolu (pid 12843)",
    );
  });

  it("leaves the cwd absolute when it is outside home", () => {
    expect(formatCreate(RESULT, { program: "/bin/bash", home: "/other" })).toBe(
      "spawned a8f1c2d3 · bash · /home/u/code/kolu (pid 12843)",
    );
  });

  it("strips control bytes from the cwd and program so the line can't be injected", () => {
    const evil: CreateResult = {
      id: "a8f1c2d3-1111-2222-3333-444455556666",
      pid: 12843,
      cwd: "/home/u/co\nde\x1b[31m",
    };
    const line = formatCreate(evil, { program: "ba\x1bsh", home: "/home/u" });
    expect(line).toBe("spawned a8f1c2d3 · ba sh · ~/co de [31m (pid 12843)");
    expect(line).not.toMatch(/[\x00-\x1f\x7f]/);
  });
});
