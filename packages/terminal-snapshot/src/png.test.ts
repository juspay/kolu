import { beforeEach, describe, expect, it, vi } from "vitest";
import type { buildPngScene as BuildPngScene } from "./png.ts";
import type { SnapshotScene } from "./scene.ts";

const PNG = new Uint8Array([137, 80, 78, 71]);

const threads: FakeWorker[] = [];

const wedge = new Set<number>();

const IDLE_REFS = -1;

type Listener = (arg: never) => void;

class FakeWorker {
  readonly index = threads.length;
  readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;
  refCount = 0;

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
    this.refCount += 1;
  }
  unref(): void {
    this.refCount -= 1;
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

const load = async () => {
  vi.resetModules();
  return await import("./png.ts");
};

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
    wedge.add(0);

    const stuck = expect(sceneToPng(scene(buildPngScene))).rejects.toThrow(
      /did not answer within/,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await stuck;

    const dead = threads[0];
    expect(dead?.terminated).toBe(true);
    expect(dead?.refCount).toBe(IDLE_REFS);

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
      font: {
        family: "Comic Sans" as SnapshotScene["font"]["family"],
        size: 15,
      },
    };
    await expect(sceneToPng(wrong)).rejects.toThrow(/must come from/);
    expect(threads).toHaveLength(0);
  });
});
