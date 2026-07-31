import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { updateCodexRollout, writeCodexFixture } from "./agent-mock-codex.ts";

test("Codex fixture waits out a transient SQLite writer lock", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-codex-lock-"));
  const fixture = writeCodexFixture({
    codexDir: dir,
    cwd: dir,
    state: "waiting",
  });
  const lockHolder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { DatabaseSync } from "node:sqlite";
        const db = new DatabaseSync(${JSON.stringify(fixture.dbPath)});
        db.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
        console.log("LOCKED");
        setTimeout(() => {
          db.exec("COMMIT;");
          db.close();
        }, 300);
      `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  t.after(() => {
    if (lockHolder.exitCode === null) lockHolder.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let stdout = "";
  let stderr = "";
  lockHolder.stdout.setEncoding("utf8");
  lockHolder.stderr.setEncoding("utf8");
  lockHolder.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  lockHolder.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    const onData = () => {
      if (stdout.includes("LOCKED")) resolve();
    };
    lockHolder.stdout.on("data", onData);
    lockHolder.once("error", reject);
    lockHolder.once("exit", (code) => {
      if (!stdout.includes("LOCKED")) {
        reject(
          new Error(
            `SQLite lock holder exited before locking (code=${code}): ${stderr}`,
          ),
        );
      }
    });
  });

  updateCodexRollout(fixture, {
    state: "waiting",
    inputTokens: 30_000,
    cachedInputTokens: 10_000,
  });

  if (lockHolder.exitCode === null) {
    await new Promise<void>((resolve, reject) => {
      lockHolder.once("error", reject);
      lockHolder.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`SQLite lock holder exited ${code}: ${stderr.trim()}`),
          );
      });
    });
  }
  assert.equal(lockHolder.exitCode, 0, stderr);
  assert.match(
    fs.readFileSync(fixture.rolloutPath, "utf8"),
    /"input_tokens":30000/,
  );
});
