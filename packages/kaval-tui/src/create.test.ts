/**
 * Pure-logic unit tests for the `create` subcommand — no socket, no tty. The
 * spawn RPC round-trip (that the host accepts this composed input) is covered
 * e2e in `attach.test.ts` against a real in-process pty-host.
 */
import { describe, expect, it } from "vitest";
import {
  buildCreateInput,
  buildRemoteCreateInput,
  type CreateResult,
  formatCreate,
  newPtyId,
} from "./create.ts";

describe("buildCreateInput", () => {
  it("composes a fully-specified plain-shell input — argv=[$SHELL], no rcfiles", () => {
    const input = buildCreateInput({
      id: "abc",
      cwd: "/work",
      env: { SHELL: "/bin/zsh", FOO: "bar" },
    });
    expect(input).toEqual({
      id: "abc",
      argv: ["/bin/zsh"],
      cwd: "/work",
      env: { SHELL: "/bin/zsh", FOO: "bar" },
      initFiles: [],
    });
  });

  it("falls back to /bin/sh when the env names no SHELL", () => {
    const input = buildCreateInput({ id: "x", cwd: "/", env: { FOO: "bar" } });
    expect(input.argv).toEqual(["/bin/sh"]);
  });

  it("runs the given command verbatim instead of $SHELL", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/zsh" },
      command: ["htop", "-d", "5"],
    });
    // argv IS the command — the shell is not consulted when one is passed.
    expect(input.argv).toEqual(["htop", "-d", "5"]);
  });

  it("ignores an empty command (no positional) and uses $SHELL", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/zsh" },
      command: [],
    });
    expect(input.argv).toEqual(["/bin/zsh"]);
  });

  it("drops undefined env values (ProcessEnv holes), keeps defined ones", () => {
    const input = buildCreateInput({
      id: "x",
      cwd: "/",
      env: { SHELL: "/bin/sh", KEEP: "1", GONE: undefined },
    });
    expect(input.env).toEqual({ SHELL: "/bin/sh", KEEP: "1" });
    expect("GONE" in input.env).toBe(false);
  });

  it("passes the caller-minted id straight through (so the host echoes ours)", () => {
    const id = newPtyId();
    expect(buildCreateInput({ id, cwd: "/", env: {} }).id).toBe(id);
  });
});

describe("buildRemoteCreateInput", () => {
  // The remote (`--host`) composer must use the REMOTE host's facts (from
  // `system.info`), not this CLI's process facts — a local cwd/env/$SHELL would
  // be wrong on another machine (and a wholesale local env leaks secrets).
  const localEnv = {
    SHELL: "/usr/bin/fish", // local login shell — must NOT reach the remote
    HOME: "/home/laptop-user", // local home — must NOT reach the remote
    AWS_SECRET_ACCESS_KEY: "shhh", // a local secret — must NOT be shipped
    TERM: "xterm-256color", // presentation — safe to carry
    LANG: "en_US.UTF-8", // presentation — safe to carry
  };
  const host = {
    shell: "/bin/bash",
    home: "/home/prod",
    path: "/run/current-system/sw/bin:/usr/bin:/bin",
  };

  it("uses the host's shell + home + PATH, never the local ones", () => {
    const input = buildRemoteCreateInput({ id: "r1", host, localEnv });
    expect(input.argv).toEqual(["/bin/bash"]); // host shell, not /usr/bin/fish
    expect(input.cwd).toBe("/home/prod"); // host home, not /home/laptop-user
    expect(input.env.HOME).toBe("/home/prod");
    expect(input.env.SHELL).toBe("/bin/bash");
    // The host's PATH — so the remote shell can find external commands (a shell
    // with no PATH exits 127 on the first one, killing the PTY instantly).
    expect(input.env.PATH).toBe("/run/current-system/sw/bin:/usr/bin:/bin");
  });

  it("ships ONLY presentation env + host shell/home/PATH — no wholesale local env / secrets", () => {
    const input = buildRemoteCreateInput({ id: "r1", host, localEnv });
    // The local secret never crosses the wire.
    expect("AWS_SECRET_ACCESS_KEY" in input.env).toBe(false);
    // Presentation vars are carried (they describe the attaching terminal).
    expect(input.env.TERM).toBe("xterm-256color");
    expect(input.env.LANG).toBe("en_US.UTF-8");
    // The whole env is exactly host-derived HOME/SHELL/PATH + the passthrough set.
    expect(input.env).toEqual({
      HOME: "/home/prod",
      SHELL: "/bin/bash",
      PATH: "/run/current-system/sw/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
    });
  });

  it("falls back to a baseline PATH when the host reports none (older daemon)", () => {
    const input = buildRemoteCreateInput({
      id: "r1",
      host: { shell: "/bin/bash", home: "/home/prod" }, // no path
      localEnv: {},
    });
    // Not empty — a usable baseline covering NixOS + FHS, so the remote shell
    // still finds the common tools instead of dying on the first command.
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
});

describe("newPtyId", () => {
  it("mints a fresh, unique id each call", () => {
    const a = newPtyId();
    const b = newPtyId();
    expect(a).not.toBe(b);
    // v4 uuid shape (the form kolu-server / `list` show a short prefix of).
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
    // A cwd carrying a newline + raw ESC sequence (an attacker-influenceable cwd
    // — the daemon echoes back whatever it spawned in) must not break the line
    // or paint terminal control effects: `sanitizeCell` collapses the controls.
    const evil: CreateResult = {
      id: "a8f1c2d3-1111-2222-3333-444455556666",
      pid: 12843,
      cwd: "/home/u/co\nde\x1b[31m",
    };
    const line = formatCreate(evil, { program: "ba\x1bsh", home: "/home/u" });
    expect(line).toBe("spawned a8f1c2d3 · ba sh · ~/co de [31m (pid 12843)");
    // No raw ESC or newline survives into the human line.
    expect(line).not.toMatch(/[\x00-\x1f\x7f]/);
  });
});
