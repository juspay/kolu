/**
 * The shipped scroll-FIFO teardown, driven the way the prepare step starts
 * the reader: a real `cat` on a `kolu-scroll-fifo-*` FIFO. The fire step is
 * deliberately skipped — that is the #2178 leak.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listProcesses } from "@kolu/daemon-test-gate/ciReap";
import { retireScrollFifo, SCROLL_FIFO_DIR_PREFIX } from "./scrollFifo.ts";

// The janitor's own listing, not a second `ps` call: a private copy here kept
// Node's 1 MiB default buffer and threw ENOBUFS on a busy CI box.
function catStillListed(fifoPath: string): boolean {
  return listProcesses().some(
    (p) => p.command.includes(fifoPath) && /\bcat\b/.test(p.command),
  );
}

test("retireScrollFifo kills the cat and removes the dir when the fire step never ran", async () => {
  const dir = mkdtempSync(join(tmpdir(), SCROLL_FIFO_DIR_PREFIX));
  const fifo = join(dir, "trigger");
  execFileSync("mkfifo", [fifo]);
  const cat = spawn("cat", [fifo], { stdio: "ignore" });
  const pid = cat.pid;
  assert.ok(pid !== undefined, "cat did not start");

  // A failed assertion must not leave the live `cat` behind: it holds this
  // process open, so the failure would surface as a hung lane, not a red one
  // (this file is also imported by every Cucumber process via `support/**`).
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !catStillListed(fifo)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(catStillListed(fifo), "cat never appeared on the FIFO");
    assert.ok(existsSync(dir), "fifo dir should exist before teardown");

    const result = await retireScrollFifo(fifo);

    assert.ok(
      result.killed.includes(pid),
      `expected to kill ${pid}, killed ${result.killed.join(",")}`,
    );
    assert.equal(result.removedDir, dir);
    assert.equal(existsSync(dir), false, "fifo dir must be gone");
    assert.equal(
      catStillListed(fifo),
      false,
      "no leftover cat …/kolu-scroll-fifo-…/trigger",
    );
  } finally {
    cat.kill("SIGKILL");
  }
});
