import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTROL_APP,
  CONTROL_FILE,
  CONTROL_PERSIST,
  __resetControlMemo,
  controlSocketPath,
  sshControlArgs,
} from "./controlOpts.ts";

const originalXdg = process.env.XDG_RUNTIME_DIR;

beforeEach(() => {
  __resetControlMemo();
});

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = originalXdg;
  __resetControlMemo();
});

describe("controlSocketPath", () => {
  it("lives under $XDG_RUNTIME_DIR when systemd gives us one", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(controlSocketPath()).toBe(`/run/user/1000/${CONTROL_APP}/%C`);
  });

  it("falls back to the fixed per-user /tmp path, never $TMPDIR", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const uid = process.getuid?.() ?? "shared";
    expect(controlSocketPath()).toBe(`/tmp/${CONTROL_APP}-${uid}/%C`);
  });

  it("treats an empty XDG_RUNTIME_DIR as absent", () => {
    process.env.XDG_RUNTIME_DIR = "";
    expect(controlSocketPath()).toMatch(/^\/tmp\//);
  });
});

describe("sshControlArgs", () => {
  it("renders the three multiplexing opts against a private dir", () => {
    process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "pf-xdg-"));
    expect(sshControlArgs()).toEqual([
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${controlSocketPath()}`,
      "-o",
      `ControlPersist=${CONTROL_PERSIST}`,
    ]);
  });

  it("crashes loudly when the control directory is not owner-only", () => {
    const xdg = mkdtempSync(join(tmpdir(), "pf-xdg-"));
    // Another local user could have pre-created the stable path with loose
    // permissions; anyone who can reach the socket can open channels on the
    // live ssh connection, so this must never be shrugged off.
    mkdirSync(join(xdg, CONTROL_APP), { mode: 0o777 });
    process.env.XDG_RUNTIME_DIR = xdg;
    expect(() => sshControlArgs()).toThrow(/owner-only/);
  });

  it("crashes loudly on a control path containing whitespace", () => {
    const xdg = mkdtempSync(join(tmpdir(), "pf xdg-"));
    process.env.XDG_RUNTIME_DIR = xdg;
    expect(() => sshControlArgs()).toThrow(/whitespace/);
  });
});

describe("the ControlPath convention shared with kolu", () => {
  // The point of the whole design: a forward opened here and a kolu terminal
  // mirror opened by @kolu/surface-remote must land on the SAME ssh master, and
  // they only do so if both spell the same ControlPath. The two are deliberately
  // separate code (this package has no kolu dependencies), so the agreement is
  // pinned here rather than assumed.
  const twin = readFileSync(
    join(import.meta.dirname, "../../surface-remote/src/controlMaster.ts"),
    "utf8",
  );

  it("uses the same runtime-socket app namespace as surface-remote", () => {
    expect(twin).toContain(`app: "${CONTROL_APP}"`);
  });

  it("uses the same socket filename token as surface-remote", () => {
    expect(twin).toContain(`file: "${CONTROL_FILE}"`);
  });

  it("uses the same ControlPersist window as surface-remote", () => {
    expect(twin).toContain(`CONTROL_PERSIST = "${CONTROL_PERSIST}"`);
  });
});
