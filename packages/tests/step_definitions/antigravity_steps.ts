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
 *
 * Opening a conversation that ALREADY exists creates nothing in `presence/`.
 * Real `agy` then replaces a file in its top directory within about a second
 * (and again at every submit); kolu's watch on that directory is what finds
 * the lock held. The open-existing and switch fakes copy that order: replace
 * the cache, wait a second (so the cache's wake has come and gone before the
 * lock is held), open the lock, wait a second, replace a top-directory file.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type AntigravityFixture,
  antigravityFixturePaths,
  CONVERSATION_IDS,
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

/** The file the fake replaces in `agy`'s top directory. Invented name. */
const topFile = (): string => path.join(antigravityDir(), "fake-summaries.bin");

/** Remove the scenario's files but keep `presence/`, `cache/` and the top
 *  directory themselves: kolu watches those once per process, and a deleted
 *  directory's watch stays dead. */
function cleanup(): void {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
  fixture = null;
  const dir = antigravityDir();
  for (const slot of ["first", "second"] as const) {
    fs.rmSync(antigravityFixturePaths(dir, slot).lockPath, { force: true });
  }
  fs.rmSync(antigravityFixturePaths(dir).cachePath, { force: true });
  fs.rmSync(topFile(), { force: true });
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

/** Program lines for the fake, each doing one thing real `agy` was seen to
 *  do. Paths are the fixture's. */
const fake = {
  /** Wait until the scenario writes `file`. */
  waitFor: (file: string): string =>
    `while [ ! -e ${quote(file)} ]; do sleep 0.1; done`,
  /** Create the lock and hold it open on fd 3 — a NEW conversation. */
  createAndHold: (lockPath: string): string => `exec 3>>${quote(lockPath)}`,
  /** Hold an EXISTING lock on fd 3, creating and touching nothing. */
  openExisting: (lockPath: string): string => `exec 3<${quote(lockPath)}`,
  /** Let go of whatever fd 3 holds. */
  release: "exec 3<&-",
  /** Name this folder's conversation in the directory cache: temp file, then
   *  rename, keyed by the physical working directory. */
  replaceCache: (cachePath: string, id: string): string[] => [
    `printf '{"%s":"%s"}\\n' "$(pwd -P)" ${quote(id)} > ${quote(`${cachePath}.tmp`)}`,
    `mv ${quote(`${cachePath}.tmp`)} ${quote(cachePath)}`,
  ],
  /** Replace a file in the top directory: temp file, then rename. */
  replaceTopFile: (): string[] => [
    `printf x > ${quote(`${topFile()}.tmp`)}`,
    `mv ${quote(`${topFile()}.tmp`)} ${quote(topFile())}`,
  ],
};

/** Start the fake `agy` in a fresh scratch directory running `body`. It
 *  prints its up marker first; one OSC 2 makes a title event reconcile after
 *  the foreground moved; the trailing `:` keeps bash resident as the
 *  foreground process. */
async function startFakeAgy(world: KoluWorld, body: string[]): Promise<void> {
  const bin = process.env.KOLU_FAKE_AGY_BIN;
  if (!bin) throw new Error("KOLU_FAKE_AGY_BIN must be set");
  if (!scratch) throw new Error("No scratch directory — set one up first");
  const { lockPath, cachePath } = antigravityFixturePaths(antigravityDir());
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const program = path.join(scratch, "fake-agy.sh");
  fs.writeFileSync(
    program,
    [
      `echo ${quote(UP_MARKER)}`,
      "printf '\\033]0;agy\\007'",
      ...body,
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

/** A new conversation, created and held at once, as at a first prompt. */
function startNew(lockPath: string, cachePath: string): string[] {
  return [
    fake.createAndHold(lockPath),
    ...fake.replaceCache(cachePath, CONVERSATION_IDS.first),
  ];
}

When(
  "an Antigravity conversation is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    newScratch();
    fixture = writeAntigravityTranscript(
      antigravityDir(),
      state as AgentLifecycleState,
    );
    await startFakeAgy(this, startNew(fixture.lockPath, fixture.cachePath));
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
    const { lockPath, cachePath } = antigravityFixturePaths(antigravityDir());
    await startFakeAgy(this, [
      fake.waitFor(path.join(dir, "go")),
      ...startNew(lockPath, cachePath),
    ]);
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

/** A conversation that already exists — its lock file and transcript are on
 *  disk — and an `agy` that will open it, as `agy --conversation=<id>` does,
 *  once the scenario writes the go file. Until then it holds nothing. */
When(
  "an Antigravity process is running that will open an existing conversation with state {string}",
  async function (this: KoluWorld, state: string) {
    const dir = newScratch();
    fixture = writeAntigravityTranscript(
      antigravityDir(),
      state as AgentLifecycleState,
      { existingLock: true },
    );
    await startFakeAgy(this, [
      fake.waitFor(path.join(dir, "go")),
      ...fake.replaceCache(fixture.cachePath, fixture.conversationId),
      "sleep 1",
      fake.openExisting(fixture.lockPath),
      "sleep 1",
      ...fake.replaceTopFile(),
    ]);
  },
);

When(
  "the running Antigravity process opens the existing conversation",
  function (this: KoluWorld) {
    if (!scratch) throw new Error("Start the process first");
    fs.writeFileSync(path.join(scratch, "go"), "");
  },
);

/** An `agy` holding conversation A, and a conversation B that already exists.
 *  When the scenario writes the go file the fake switches to B, as the
 *  `/resume` picker does. */
When(
  "an Antigravity process holds a conversation with state {string} and another exists with state {string}",
  async function (this: KoluWorld, stateA: string, stateB: string) {
    const dir = newScratch();
    fixture = writeAntigravityTranscript(
      antigravityDir(),
      stateA as AgentLifecycleState,
    );
    const other = writeAntigravityTranscript(
      antigravityDir(),
      stateB as AgentLifecycleState,
      { slot: "second", existingLock: true },
    );
    await startFakeAgy(this, [
      ...startNew(fixture.lockPath, fixture.cachePath),
      fake.waitFor(path.join(dir, "go")),
      ...fake.replaceCache(other.cachePath, other.conversationId),
      "sleep 1",
      fake.release,
      fake.openExisting(other.lockPath),
      "sleep 1",
      ...fake.replaceTopFile(),
    ]);
  },
);

When(
  "the running Antigravity process switches to the other conversation",
  function (this: KoluWorld) {
    if (!scratch) throw new Error("Start the process first");
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
