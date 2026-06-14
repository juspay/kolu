/**
 * Pure-logic unit tests for the `create` subcommand — no socket, no tty. The
 * spawn RPC round-trip (that the host accepts this composed input) is covered
 * e2e in `attach.test.ts` against a real in-process pty-host.
 */
import { describe, expect, it } from "vitest";
import {
  buildCreateInput,
  type CreateResult,
  formatCreate,
  formatCreateJson,
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
});

describe("formatCreateJson", () => {
  it("emits the raw {id,pid,cwd} object with the FULL id, parseable", () => {
    const json = formatCreateJson(RESULT);
    expect(JSON.parse(json)).toEqual(RESULT);
    // The full id is preserved for scripts (`jq -r .id`), not shortened.
    expect(json).toContain(RESULT.id);
  });
});
