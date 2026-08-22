/** The rasteriser hand-off, tested against a FAKE thread.
 *
 *  What is under test is the QUEUE, not the picture: `sceneToPng` serialises
 *  every render onto one warm worker, so the interesting failure is a worker
 *  that never answers. The real one cannot be made to hang on demand — the
 *  wasm region is a black box and the render is measured in milliseconds — so
 *  `node:worker_threads` is mocked and each case chooses which thread replies.
 *  Everything else (the deadline, the kill, the retire, the lock) is the
 *  module's own code.
 *
 *  The rasteriser itself is exercised for real by `render.smoke.ts`, which
 *  needs the Nix font closure and writes a file. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { buildPngScene as BuildPngScene } from "./png.ts";

/** Bytes a healthy thread posts back. Not a real PNG — nothing here decodes
 *  it; it only has to arrive intact. */
const PNG = new Uint8Array([137, 80, 78, 71]);

/** Every fake thread built during a case, oldest first — the assertion surface
 *  for "the wedged one was killed and a NEW one served the next render". */
const threads: FakeWorker[] = [];

/** Threads (by creation order) that receive a document and never answer —
 *  what an uninterruptible wasm region looks like from the main thread. */
const wedge = new Set<number>();

type Listener = (arg: never) => void;

class FakeWorker {
  readonly index = threads.length;
  readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;
  /** Net `ref()` minus `unref()`. Starts at -1 because `rasteriser()` unrefs a
   *  thread the moment it builds one, so an idle thread never holds the loop
   *  open; a case asserts the count is back there when a render ends. */
  refs = 0;

  constructor() {
    threads.push(this);
  }
  on(event: string, fn: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(event, set);
    return this;
  }
  once(event: string, fn: Listener): this {
    const wrapped = ((arg: never) => {
      this.off(event, wrapped);
      fn(arg);
    }) as Listener;
    return this.on(event, wrapped);
  }
  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, arg: unknown): void {
    for (const fn of [...(this.listeners.get(event) ?? [])])
      (fn as (a: unknown) => void)(arg);
  }
  ref(): void {
    this.refs += 1;
  }
  unref(): void {
    this.refs -= 1;
  }
  postMessage(): void {
    if (wedge.has(this.index)) return;
    queueMicrotask(() => this.emit("message", { ok: true, png: PNG }));
  }
  async terminate(): Promise<number> {
    this.terminated = true;
    // The real `terminate` raises `exit` asynchronously; the module must not
    // depend on that having happened yet, so raise it a turn late here too.
    queueMicrotask(() => this.emit("exit", 1));
    return 1;
  }
}

vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));

/** A FRESH copy of the module per case.
 *
 *  `png.ts` deliberately holds two pieces of process-global state — the warm
 *  thread and the serialising lock — so cases sharing one import would be
 *  reading each other's threads. Re-importing is the only honest way to ask
 *  "what does a cold process do here", and it is a harness move rather than a
 *  seam in the module: nothing in production re-imports it. */
const load = async () => {
  vi.resetModules();
  return await import("./png.ts");
};

/** A minimal legal document — one cell, so the case is about the hand-off
 *  rather than the layout. */
const scene = (buildPngScene: typeof BuildPngScene) =>
  buildPngScene({
    grid: {
      cols: 1,
      lines: [
        {
          cells: [
            {
              col: 0,
              chars: "x",
              width: 1,
              fg: { kind: "default" },
              bg: { kind: "default" },
              bold: false,
              italic: false,
              dim: false,
              underline: false,
              inverse: false,
            },
          ],
        },
      ],
    },
    theme: { foreground: "#c5c8c6", background: "#1d1f21" },
    label: "t",
    brand: "kolu",
    fontSize: 15,
  });

describe("sceneToPng", () => {
  beforeEach(() => {
    threads.length = 0;
    wedge.clear();
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("kills a wedged rasteriser and serves the NEXT screenshot from a fresh thread", async () => {
    const { buildPngScene, sceneToPng } = await load();
    // The first thread receives the document and never answers. Without a
    // deadline that promise never settles — and because the module's lock
    // chains off it, nothing queued behind it ever renders either: ONE hung
    // render would wedge every screenshot for the life of the process.
    wedge.add(0);

    // The expectation is attached BEFORE the clock moves: a rejection with no
    // listener yet is an unhandled rejection, and the file would then fail for
    // the harness's timing rather than for anything the module did.
    const stuck = expect(sceneToPng(scene(buildPngScene))).rejects.toThrow(
      /did not answer within/,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await stuck;

    const dead = threads[0];
    expect(dead?.terminated).toBe(true);
    // Unref'd on the way out: a killed render must not be the reason a
    // shutting-down daemon stays open.
    expect(dead?.refs).toBe(-1);

    // The point of the whole case: the queue survived the wedge.
    await expect(sceneToPng(scene(buildPngScene))).resolves.toEqual(PNG);
    expect(threads).toHaveLength(2);
    expect(threads[1]).not.toBe(dead);
  });

  it("keeps ONE warm thread across renders — the wasm and the faces are paid once", async () => {
    const { buildPngScene, sceneToPng } = await load();
    await expect(sceneToPng(scene(buildPngScene))).resolves.toEqual(PNG);
    await expect(sceneToPng(scene(buildPngScene))).resolves.toEqual(PNG);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.terminated).toBe(false);
  });

  it("refuses a scene built any other way than buildPngScene, before the hop", async () => {
    const { buildPngScene, sceneToPng } = await load();
    const wrong = {
      ...scene(buildPngScene),
      font: { family: "Comic Sans", size: 15 },
    };
    await expect(sceneToPng(wrong)).rejects.toThrow(/must come from/);
    // A document the guard refuses never costs a thread hand-off — so no
    // worker was built at all.
    expect(threads).toHaveLength(0);
  });
});
