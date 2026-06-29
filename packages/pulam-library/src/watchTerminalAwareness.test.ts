/**
 * `watchTerminalAwareness` — the shared per-terminal sensing leaf, driven beside
 * the code with a fake `PtyHostClient` (no daemon, no socket). These pin the
 * DANGER-ZONE invariant the first local-pulam cut violated: a leaf started over an
 * ALREADY-SEEDED record must NEVER re-seed or over-publish it (no fold-clobber).
 * The home seeds + publishes the record before calling the leaf; the leaf only
 * ever reacts to taps through the INJECTED sink. Plus: the cwd tap persists ONLY
 * cwd, a raw-output delta lights the injected activity hook (snapshot frame
 * skipped), and stop tears the taps down and forgets the terminal.
 *
 * Every fake stream is bound to a master abort so the leaf's teardown can never
 * hang the test (the real daemon path is covered end-to-end against a live kaval
 * in `packages/pulam/src/daemon.test.ts`).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyHostClient } from "kaval";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AwarenessValue, TerminalId } from "./schema.ts";
import type { AwarenessRecord, AwarenessSink } from "./sensors.ts";
import {
  type TerminalActivityTap,
  watchTerminalAwareness,
} from "./watchTerminalAwareness.ts";

const log = pino({ level: "silent" });
const ID = "term-leaf-1" as TerminalId;

type AttachFrame = { kind: "snapshot" | "delta"; data: string };

/** A controllable async stream standing in for one kaval per-terminal tap. `push`
 *  emits to the live subscriber; iteration ends on the per-call signal OR the
 *  test's master signal. */
function fakeTap<T>(master: AbortSignal) {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  const drain = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  master.addEventListener("abort", drain, { once: true });
  return {
    push(v: T): void {
      buffer.push(v);
      drain();
    },
    iterable(signal?: AbortSignal): AsyncIterable<T> {
      signal?.addEventListener("abort", drain, { once: true });
      return {
        async *[Symbol.asyncIterator]() {
          while (!master.aborted && !signal?.aborted) {
            const head = buffer.shift();
            if (head !== undefined) {
              yield head;
              continue;
            }
            await new Promise<void>((r) => {
              wake = r;
            });
          }
        },
      };
    },
  };
}

function fakeKaval(master: AbortSignal) {
  const cwd = new Map<string, ReturnType<typeof fakeTap<{ cwd: string }>>>();
  const attach = new Map<string, ReturnType<typeof fakeTap<AttachFrame>>>();
  const tapFor = <T>(
    m: Map<string, ReturnType<typeof fakeTap<T>>>,
    id: string,
  ): ReturnType<typeof fakeTap<T>> => {
    let t = m.get(id);
    if (!t) {
      t = fakeTap<T>(master);
      m.set(id, t);
    }
    return t;
  };
  // title / commandRun / foreground are wired but never emit in these tests.
  const silent = () => ({
    get: async (_i: { id: string }, o?: { signal?: AbortSignal }) =>
      fakeTap<unknown>(master).iterable(o?.signal),
  });
  const client = {
    surface: {
      cwd: {
        get: async (i: { id: string }, o?: { signal?: AbortSignal }) =>
          tapFor(cwd, i.id).iterable(o?.signal),
      },
      title: silent(),
      commandRun: silent(),
      foreground: silent(),
      terminalAttach: {
        get: async (i: { id: string }, o?: { signal?: AbortSignal }) =>
          tapFor(attach, i.id).iterable(o?.signal),
      },
    },
  } as unknown as PtyHostClient;
  return {
    client,
    cwdTap: (id: string) => tapFor(cwd, id),
    attachTap: (id: string) => tapFor(attach, id),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function waitUntil(
  pred: () => boolean | Promise<boolean>,
  ms = 2000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await sleep(10);
  }
  throw new Error("waitUntil: condition never held");
}

/** A RESTORED record — the persisted half a home rebuilt from disk (cwd / git /
 *  lastAgentCommand / agentSession), with the live half reset. `git` is left null
 *  so the git sensor's correct async re-resolve of a non-repo cwd to null is not
 *  mistaken for a clobber; the assertions key on `lastAgentCommand` / `agentSession`
 *  / `lastActivityAt`, which NO sensor touches on a quiet terminal. */
function restoredRecord(cwd: string): AwarenessRecord {
  const meta: AwarenessValue = {
    cwd,
    git: null,
    lastAgentCommand: "claude --resume conv-abc",
    agentSession: { kind: "claude-code", id: "conv-abc" },
    lastActivityAt: 999,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  };
  return { pid: 4321, meta, currentAgent: null };
}

/** A sink that applies each mutation to `record.meta` (the apply-and-read-back
 *  contract) and RECORDS every call, so a test can assert exactly which writes the
 *  leaf drove — and that it drove none on start. */
function spySink(record: AwarenessRecord) {
  const calls: Array<"persisted" | "live"> = [];
  const sink: AwarenessSink = {
    updateServerMetadata: (_r, mutate) => {
      mutate(record.meta);
      calls.push("persisted");
    },
    updateServerLiveMetadata: (_r, mutate) => {
      mutate(record.meta);
      calls.push("live");
    },
    readScreenText: async () => "",
  };
  return { sink, calls };
}

describe("watchTerminalAwareness — the shared per-terminal sensing leaf", () => {
  let master: AbortController;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    master = new AbortController();
    stop = null;
  });
  afterEach(() => {
    stop?.();
    stop = null;
    master.abort(); // close every fake stream so the test can't hang
  });

  it("performs NO write on start — it never re-seeds/over-publishes the restored record (no fold-clobber)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "leaf-noclobber-"));
    const record = restoredRecord(cwd);
    const { sink, calls } = spySink(record);
    const activity: TerminalActivityTap = {
      noteOutput: () => {},
      forget: () => {},
    };
    const kaval = fakeKaval(master.signal);

    stop = watchTerminalAwareness({
      kaval: kaval.client,
      id: ID,
      record,
      sink,
      activity,
      log,
    });

    // SYNCHRONOUSLY after start: the leaf published NO seed. A fresh-seed publish
    // (the old createPulam.watchTerminal behavior) would show up here as a write.
    expect(calls).toEqual([]);

    // Let the git sensor resolve the non-repo cwd (to null) and the agent/foreground
    // reconcile fire. None of these touch the RESTORED resume inputs on a quiet
    // terminal (no commandRun tap, no agent present), so they survive intact —
    // proof the leaf never reset the persisted half.
    await sleep(120);
    expect(record.meta.lastAgentCommand).toBe("claude --resume conv-abc");
    expect(record.meta.agentSession).toEqual({
      kind: "claude-code",
      id: "conv-abc",
    });
    expect(record.meta.lastActivityAt).toBe(999);
  });

  it("persists ONLY cwd through the injected sink on a cwd tap (rest of the restored half intact)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "leaf-cwd-"));
    const record = restoredRecord(cwd);
    const { sink } = spySink(record);
    const kaval = fakeKaval(master.signal);

    stop = watchTerminalAwareness({
      kaval: kaval.client,
      id: ID,
      record,
      sink,
      activity: { noteOutput: () => {}, forget: () => {} },
      log,
    });

    const moved = join(cwd, "sub");
    kaval.cwdTap(ID).push({ cwd: moved });
    await waitUntil(() => record.meta.cwd === moved);

    // cwd moved; the rest of the restored persisted half is untouched by the cwd tap.
    expect(record.meta.cwd).toBe(moved);
    expect(record.meta.lastAgentCommand).toBe("claude --resume conv-abc");
    expect(record.meta.agentSession).toEqual({
      kind: "claude-code",
      id: "conv-abc",
    });
  });

  it("lights the injected activity hook on a raw-output delta, skipping the snapshot frame", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "leaf-activity-"));
    const record = restoredRecord(cwd);
    const { sink } = spySink(record);
    let notes = 0;
    const activity: TerminalActivityTap = {
      noteOutput: () => {
        notes++;
      },
      forget: () => {},
    };
    const kaval = fakeKaval(master.signal);

    stop = watchTerminalAwareness({
      kaval: kaval.client,
      id: ID,
      record,
      sink,
      activity,
      log,
    });

    // The snapshot frame is the existing screen, not motion — it must NOT light.
    kaval.attachTap(ID).push({ kind: "snapshot", data: "screen" });
    await sleep(40);
    expect(notes).toBe(0);

    // A delta is one pulse of output.
    kaval.attachTap(ID).push({ kind: "delta", data: "new bytes" });
    await waitUntil(() => notes >= 1);
    expect(notes).toBe(1);
  });

  it("forgets the terminal and tears the taps down on stop (no activity after stop)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "leaf-stop-"));
    const record = restoredRecord(cwd);
    const { sink } = spySink(record);
    let notes = 0;
    let forgotten = 0;
    const activity: TerminalActivityTap = {
      noteOutput: () => {
        notes++;
      },
      forget: () => {
        forgotten++;
      },
    };
    const kaval = fakeKaval(master.signal);

    const stopLeaf = watchTerminalAwareness({
      kaval: kaval.client,
      id: ID,
      record,
      sink,
      activity,
      log,
    });
    kaval.attachTap(ID).push({ kind: "delta", data: "x" });
    await waitUntil(() => notes >= 1);

    stopLeaf();
    expect(forgotten).toBe(1);

    // After stop the output tap is aborted — a further delta must not light it.
    const before = notes;
    kaval.attachTap(ID).push({ kind: "delta", data: "after-stop" });
    await sleep(40);
    expect(notes).toBe(before);
  });
});
