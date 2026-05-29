import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { createPtyHost, getScreenText, type PtyHost } from "./ptyHost.ts";

// @xterm packages ship CJS only — same interop as ptyHost.ts.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

/** Write data to a terminal and wait for it to be processed. */
function writeAndFlush(
  term: InstanceType<typeof Terminal>,
  data: string,
): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("getScreenText", () => {
  function createTerminal(
    opts: { cols?: number; rows?: number } = {},
  ): InstanceType<typeof Terminal> {
    return new Terminal({
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      allowProposedApi: true,
    });
  }

  it("returns empty lines for a fresh terminal", () => {
    const term = createTerminal({ rows: 3 });
    const text = getScreenText(term.buffer.active);
    expect(text.trim()).toBe("");
    term.dispose();
  });

  it("returns written text", async () => {
    const term = createTerminal();
    await writeAndFlush(term, "hello world\r\nsecond line\r\n");
    const text = getScreenText(term.buffer.active);
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
    term.dispose();
  });

  it("respects startLine and endLine range", async () => {
    const term = createTerminal({ rows: 10 });
    await writeAndFlush(term, "line0\r\nline1\r\nline2\r\nline3\r\n");
    const text = getScreenText(term.buffer.active, 1, 3);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
    term.dispose();
  });

  it("clamps out-of-bounds range", async () => {
    const term = createTerminal({ rows: 5 });
    await writeAndFlush(term, "only line\r\n");
    const text = getScreenText(term.buffer.active, -5, 1000);
    expect(text).toContain("only line");
    term.dispose();
  });
});

// ── PTY host (real node-pty children) ──────────────────────────────────

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A minimal env that lets `/bin/sh` find `sleep` etc. */
const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function firstEvent(
  iter: AsyncIterable<string>,
  ms = 3000,
): Promise<string> {
  const it = iter[Symbol.asyncIterator]();
  const result = await Promise.race([
    it.next(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout waiting for event")), ms),
    ),
  ]);
  if (result.done) throw new Error("stream ended before any event");
  return result.value;
}

describe("createPtyHost", () => {
  let host: PtyHost;

  afterEach(() => {
    host?.dispose();
  });

  it("spawns a shell and mirrors its output", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'hello mirror\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(pid).toBeGreaterThan(0);
    await waitFor(() => host.getScreenText(id).includes("hello mirror"));
    expect(host.getScreenText(id)).toContain("hello mirror");
  });

  it("delivers live output to attach() deltas", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'live delta\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const { deltas } = host.attach(id);
    let seen = "";
    const it = deltas[Symbol.asyncIterator]();
    // Drain chunks until the marker appears (or the stream stalls).
    while (!seen.includes("live delta")) {
      const next = await Promise.race([
        it.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 2000),
        ),
      ]);
      if (next.done) break;
      seen += next.value;
    }
    expect(seen).toContain("live delta");
  });

  it("carries already-parsed output in the attach snapshot", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'snap content\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenState(id).includes("snap content"));
    const { snapshot } = host.attach(id);
    expect(snapshot).toContain("snap content");
  });

  it("resolves exitPromise with the child's exit code", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await host.exitPromise(id)).toBe(7);
  });

  it("publishes cwd on OSC 7", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf '\\033]7;file://localhost/tmp/host-osc7\\033\\\\'; sleep 0.5",
      ],
      env: shellEnv,
      cwd: "/tmp",
    });
    const cwd = await firstEvent(host.subscribeCwd(id));
    expect(cwd).toBe("/tmp/host-osc7");
    expect(host.getCwd(id)).toBe("/tmp/host-osc7");
  });

  it("publishes the exact command line on OSC 633;E", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;git status\\033\\\\'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await firstEvent(host.subscribeCommandRun(id))).toBe("git status");
  });

  it("publishes title changes on OSC 0/2", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]2;my title\\033\\\\'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await firstEvent(host.subscribeTitle(id))).toBe("my title");
  });

  it("routes write() to the child and lists live PTYs", async () => {
    host = createPtyHost({ log: silentLog });
    // A long-lived shell reading commands from its stdin (the PTY): a
    // written `echo` command runs and prints the marker — robust to whether
    // the tty echoes input.
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toEqual([
      expect.objectContaining({ id, pid, cwd: "/tmp" }),
    ]);
    host.write(id, "echo kolu_write_ok\n");
    await waitFor(() => host.getScreenText(id).includes("kolu_write_ok"));
    expect(host.getScreenText(id)).toContain("kolu_write_ok");
    expect(host.getProcess(id)).toBeTypeOf("string");
    host.kill(id);
    await host.exitPromise(id);
  });

  it("removes the PTY from list() after kill", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toHaveLength(1);
    host.kill(id);
    await host.exitPromise(id);
    expect(host.list()).toHaveLength(0);
  });

  it("vends a per-PTY handle that delegates to the host", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const handle = host.handle(id);
    expect(handle.pid).toBe(pid);
    expect(handle.cwd).toBe("/tmp");
    expect(typeof handle.process).toBe("string");
    host.kill(id);
    await host.exitPromise(id);
  });
});
