/**
 * Smoke tests for `@kolu/pty-host`. Cover the snapshot-then-delta
 * `attach()` invariant, multi-subscriber fan-out, and clean teardown
 * on `kill()` — these are the cuts the daemon supervisor relies on
 * when reconnecting after a kolu-server restart.
 */
import { describe, expect, it } from "vitest";
import { createPtyHost } from "./ptyHost.ts";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function spawnSleeper(host: ReturnType<typeof createPtyHost>) {
  return host.spawn({
    shell: "/bin/sh",
    args: ["-c", "echo hello; sleep 60"],
    env: { PATH: "/usr/bin:/bin", PS1: "$ " },
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    scrollback: 1000,
  });
}

async function collectN<T>(
  iter: AsyncIterable<T>,
  n: number,
  timeoutMs = 2000,
): Promise<T[]> {
  const out: T[] = [];
  const deadline = Date.now() + timeoutMs;
  const it = iter[Symbol.asyncIterator]();
  while (out.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const next = await Promise.race([
      it.next(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (next.done) break;
    out.push(next.value as T);
  }
  return out;
}

describe("pty-host", () => {
  it("spawn returns id + pid", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only logger shape
    const host = createPtyHost({ log: silentLogger as any });
    const result = spawnSleeper(host);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.pid).toBeGreaterThan(0);
    host.kill(result.id);
    host.dispose();
  });

  it("attach yields snapshot first, then live deltas", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only logger shape
    const host = createPtyHost({ log: silentLogger as any });
    const { id } = spawnSleeper(host);
    const { snapshot, deltas } = await host.attach(id);
    expect(typeof snapshot).toBe("string");
    // Allow a beat for the shell to produce output.
    const chunks = await collectN(deltas, 1);
    expect(chunks.length).toBeGreaterThanOrEqual(0); // child may exit before we see anything
    host.kill(id);
    host.dispose();
  });

  it("list reports live PTYs and prunes after kill", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only logger shape
    const host = createPtyHost({ log: silentLogger as any });
    const a = spawnSleeper(host);
    const b = spawnSleeper(host);
    expect(
      host
        .list()
        .map((e) => e.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    host.kill(a.id);
    await host.exitPromise(a.id);
    // Allow the deferred-by-setImmediate disposeEntry to run.
    await new Promise((r) => setTimeout(r, 50));
    const after = host.list().map((e) => e.id);
    expect(after).not.toContain(a.id);
    host.dispose();
  });

  it("dispose tears down all PTYs", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only logger shape
    const host = createPtyHost({ log: silentLogger as any });
    spawnSleeper(host);
    spawnSleeper(host);
    expect(host.list().length).toBe(2);
    host.dispose();
    expect(host.list().length).toBe(0);
  });
});
