import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import {
  updateCodexRollout,
  writeCodexFixture,
} from "../support/agent-mock-codex.ts";

test("Codex fixture waits out a transient SQLite writer lock", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-codex-lock-"));
  const fixture = writeCodexFixture({
    codexDir: dir,
    cwd: dir,
    state: "waiting",
  });
  const lockHolder = new Worker(
    `
        const { parentPort } = require("node:worker_threads");
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(${JSON.stringify(fixture.dbPath)});
        db.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
        parentPort.postMessage("LOCKED");
        setTimeout(() => {
          db.exec("COMMIT;");
          db.close();
        }, 300);
      `,
    { eval: true },
  );

  t.after(async () => {
    await lockHolder.terminate();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const exited = once(lockHolder, "exit");
  assert.deepEqual(await once(lockHolder, "message"), ["LOCKED"]);

  updateCodexRollout(fixture, {
    state: "waiting",
    inputTokens: 30_000,
    cachedInputTokens: 10_000,
  });

  assert.deepEqual(await exited, [0]);
  assert.match(
    fs.readFileSync(fixture.rolloutPath, "utf8"),
    /"input_tokens":30000/,
  );
});
