import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { expect, it, vi } from "vitest";
import { Effect } from "effect";

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

describeDaemon(
  "spawn handler — init-file rollback on host.spawn failure",
  () => {
    it("removes the files it wrote when host.spawn throws, leaving rcDir empty", async () => {
      const rcDir = mkdtempSync(join(tmpdir(), "kolu-spawnfail-"));
      const client = createInProcessPtyHost({
        log: silentLog,
        rcDir,
        lifetime: { kind: "forever" },
      }).client;
      await expect(
        Effect.runPromise(
          client.surface.terminal.spawn({
            argv: ["/bin/bash"],
            cwd: rcDir,
            env: {},
            initFiles: [
              { name: "bashrc-fail", content: "export X=1" },
              { name: join("zdotdir-fail", ".zshrc"), content: "export Y=2" },
            ],
          }),
        ),
      ).rejects.toThrow(/forced spawn failure/);
      expect(existsSync(join(rcDir, "bashrc-fail"))).toBe(false);
      expect(existsSync(join(rcDir, "zdotdir-fail"))).toBe(false);
      expect(readdirSync(rcDir)).toEqual([]);
    });
  },
);
