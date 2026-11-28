/**
 * Antigravity CLI status detection — step definitions.
 *
 * Mocks a conversation by writing its transcript under the per-worker
 * `KOLU_ANTIGRAVITY_DIR`, then launches the fake `agy` binary (a bash copy
 * seeded by hooks.ts, kept resident with comm="agy"). When its conversation
 * starts the fake does what real `agy` does at that moment: it creates and
 * HOLDS OPEN `presence/<id>.lock`, and records its folder's conversation in
 * `cache/last_conversations.json`. Linux reads the open lock; macOS, which
 * cannot list a process's open files, reads the cache — so each platform
 * exercises its own path.
 *
 * The fake's program is written to a file in the scenario's temp directory
 * and only `<bin> <file>` is typed, so the marker it prints never appears in
 * the shell's echo.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type AntigravityFixture,
  antigravityFixturePaths,
  updateAntigravityTranscript,
  writeAntigravityTranscript,
} from "../support/agent-mock-antigravity.ts";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Built at runtime so no typed line can carry it. */
const UP_MARKER = ["agy", "e2e", "up"].join("-");

function antigravityDir(): string {
  const dir = process.env.KOLU_ANTIGRAVITY_DIR;
  if (!dir) throw new Error("KOLU_ANTIGRAVITY_DIR must be set");
  return dir;
}

let scratch: string | null = null;
let fixture: AntigravityFixture | null = null;

/** Remove the scenario's files but keep `presence/` and `cache/` themselves:
 *  kolu watches those directories once per process, and a deleted directory's
 *  watch stays dead. */
function cleanup(): void {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
  fixture = null;
  const dir = antigravityDir();
  const { lockPath, cachePath } = antigravityFixturePaths(dir);
  fs.rmSync(lockPath, { force: true });
  fs.rmSync(cachePath, { force: true });
  fs.rmSync(path.join(dir, "brain"), { recursive: true, force: true });
}

After({ tags: "@antigravity-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `AGY_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** Start the fake `agy` in a fresh scratch directory. It prints its up marker,
 *  waits for `goFile` when one is given (a conversation that starts later),
 *  then creates and holds the lock open on fd 3 and writes the directory
 *  cache (temp file, then rename) keyed by its own physical working directory.
 *  One OSC 2 makes a title event reconcile after the foreground moved; the
 *  trailing `:` keeps bash resident as the foreground process. */
async function startFakeAgy(
  world: KoluWorld,
  goFile: string | null,
): Promise<void> {
  const bin = process.env.KOLU_FAKE_AGY_BIN;
  if (!bin) throw new Error("KOLU_FAKE_AGY_BIN must be set");
  if (!scratch) throw new Error("No scratch directory — set one up first");
  const { conversationId, lockPath, cachePath } = antigravityFixturePaths(
    antigravityDir(),
  );
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const program = path.join(scratch, "fake-agy.sh");
  fs.writeFileSync(
    program,
    [
      `echo ${quote(UP_MARKER)}`,
      "printf '\\033]0;agy\\007'",
      ...(goFile
        ? [`while [ ! -e ${quote(goFile)} ]; do sleep 0.1; done`]
        : []),
      `exec 3>>${quote(lockPath)}`,
      `printf '{"%s":"%s"}\\n' "$(pwd -P)" ${quote(conversationId)} > ${quote(`${cachePath}.tmp`)}`,
      `mv ${quote(`${cachePath}.tmp`)} ${quote(cachePath)}`,
      "sleep 99999 ; :",
      "",
    ].join("\n"),
  );
  await cdTerminalInto(world, scratch);
  await world.page.keyboard.type(`${bin} ${program}`);
  await world.page.keyboard.press("Enter");
  await pollFor({
    observe: () => readBufferText(world.page, ACTIVE_TERMINAL),
    isDone: (buf) => (buf ?? "").includes(UP_MARKER),
    onTimeout: (last, ms) =>
      new Error(
        `Fake agy never printed its up marker after ${ms}ms: ${(last ?? "").slice(-400)}`,
      ),
    timeoutMs: POLL_TIMEOUT,
  });
}

function newScratch(): string {
  cleanup();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-agy-${process.pid}-`));
  return scratch;
}

When(
  "an Antigravity conversation is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    newScratch();
    fixture = writeAntigravityTranscript(
      antigravityDir(),
      state as AgentLifecycleState,
    );
    await startFakeAgy(this, null);
  },
);

/** A fresh `agy`: in the foreground, holding no conversation lock. Its
 *  conversation starts only when the scenario writes the go file — after the
 *  command-run reconcile ladder has run empty, so only the `presence/` watch
 *  can pick it up. */
When(
  "an Antigravity process is running with no conversation yet",
  async function (this: KoluWorld) {
    const dir = newScratch();
    await startFakeAgy(this, path.join(dir, "go"));
  },
);

When(
  "a conversation starts in the running Antigravity process with state {string}",
  function (this: KoluWorld, state: string) {
    if (!scratch) throw new Error("Start the process first");
    fixture = writeAntigravityTranscript(
      antigravityDir(),
      state as AgentLifecycleState,
    );
    fs.writeFileSync(path.join(scratch, "go"), "");
  },
);

When(
  "the Antigravity conversation state changes to {string}",
  function (this: KoluWorld, state: string) {
    if (!fixture) throw new Error("No Antigravity fixture — mock one first");
    updateAntigravityTranscript(fixture, state as AgentLifecycleState);
  },
);

async function observeIndicator(world: KoluWorld): Promise<{
  state: string | null;
  kind: string | null;
}> {
  return world.page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
    );
    return {
      state: el?.getAttribute("data-agent-state") ?? null,
      kind: el?.getAttribute("data-agent-kind") ?? null,
    };
  });
}

/** Asserts on the strength of the appended lines alone — no nudge — since a
 *  tile lit only by a nudge is broken the same way in production. */
Then(
  "the tile chrome should show an Antigravity indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "antigravity",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Antigravity indicator state "${expectedState}" (kind=antigravity), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
