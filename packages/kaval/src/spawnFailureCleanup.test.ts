/**
 * The spawn handler's init-file rollback when `host.spawn` itself throws.
 *
 * The host materialises the client's `initFiles` BEFORE node-pty forks, and
 * registers their cleanup as the PTY's `onDispose`. If the fork throws, that
 * `onDispose` never fires — so the handler must remove the files it wrote
 * inline before rethrowing, or a failed spawn leaks wrapper rc files under
 * `rcDir`. node-pty doesn't throw synchronously for bad shells/cwds (the
 * failure surfaces async on the child), so we mock the primitive to make
 * `spawn` throw deterministically and assert the disk is clean.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Mock the primitive so `createPtyHost().spawn` throws synchronously. Only the
// members the spawn path touches need to exist; `has`/`list` back the handler's
// existence guard and are harmless no-ops here.
vi.mock("./ptyHost.ts", () => ({
  createPtyHost: () => ({
    spawn: () => {
      throw new Error("forced spawn failure");
    },
    has: () => false,
    list: () => [],
  }),
}));

import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import type { Logger } from "@kolu/surface-daemon";

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("spawn handler — init-file rollback on host.spawn failure", () => {
  it("removes the files it wrote when host.spawn throws, leaving rcDir empty", async () => {
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-spawnfail-"));
    const client = createInProcessPtyHost({ log: silentLog, rcDir }).client;
    await expect(
      client.surface.terminal.spawn({
        argv: ["/bin/bash"],
        cwd: rcDir,
        env: {},
        // One flat + one nested file (the zsh ZDOTDIR shape) so the prune of
        // the dir the write created is exercised on the failure path too.
        initFiles: [
          { name: "bashrc-fail", content: "export X=1" },
          { name: join("zdotdir-fail", ".zshrc"), content: "export Y=2" },
        ],
      }),
    ).rejects.toThrow(/forced spawn failure/);
    expect(existsSync(join(rcDir, "bashrc-fail"))).toBe(false);
    expect(existsSync(join(rcDir, "zdotdir-fail"))).toBe(false);
    expect(readdirSync(rcDir)).toEqual([]);
  });
});
