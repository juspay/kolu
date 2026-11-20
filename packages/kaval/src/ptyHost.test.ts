import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  ANSWERED_DEVICE_QUERIES,
  isTerminalQueryResponse,
  SILENT_DEVICE_QUERIES,
} from "@kolu/terminal-protocol";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect, type Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPtyHost,
  foregroundNameFromArgv,
  HEADLESS_TERM_ID,
  isDynamicLoader,
  type PtyHost,
  type PtyId,
  readBufferRange,
  readProcCmdline,
  resolveScreenExtent,
} from "./ptyHost.ts";
import {
  boundScreenCells,
  SCREEN_CELLS_MAX_CELLS,
  SCREEN_CELLS_MAX_ROWS,
} from "./ptyHostSurface.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { runScopedSync, subscribeFrames } from "./streamFrame.testlib.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

function writeAndFlush(
  term: InstanceType<typeof Terminal>,
  data: string,
): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("readBufferRange", () => {
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
    const text = readBufferRange(term.buffer.active, {
      start: 0,
      end: term.buffer.active.length,
    });
    expect(text.trim()).toBe("");
    term.dispose();
  });

  it("returns written text", async () => {
    const term = createTerminal();
    await writeAndFlush(term, "hello world\r\nsecond line\r\n");
    const text = readBufferRange(term.buffer.active, {
      start: 0,
      end: term.buffer.active.length,
    });
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
    term.dispose();
  });

  it("respects the start and end of the range", async () => {
    const term = createTerminal({ rows: 10 });
    await writeAndFlush(term, "line0\r\nline1\r\nline2\r\nline3\r\n");
    const text = readBufferRange(term.buffer.active, { start: 1, end: 3 });
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
    term.dispose();
  });

  it("clamps out-of-bounds range", async () => {
    const term = createTerminal({ rows: 5 });
    await writeAndFlush(term, "only line\r\n");
    const text = readBufferRange(term.buffer.active, { start: -5, end: 1000 });
    expect(text).toContain("only line");
    term.dispose();
  });
});

describe("resolveScreenExtent", () => {
  it("resolves a tail to the last N lines of the buffer", () => {
    expect(resolveScreenExtent(100, 24, { kind: "tail", lines: 2 })).toEqual({
      start: 98,
      end: 100,
    });
  });

  it("clamps a tail larger than the buffer to the whole buffer", () => {
    expect(resolveScreenExtent(4, 24, { kind: "tail", lines: 1000 })).toEqual({
      start: 0,
      end: 4,
    });
  });

  it("resolves a viewport to a tail of the live grid's own height", () => {
    expect(resolveScreenExtent(100, 24, { kind: "viewport" })).toEqual({
      start: 76,
      end: 100,
    });
  });

  it("resolves an absent extent, and an explicit `full`, to the whole buffer", () => {
    expect(resolveScreenExtent(100, 24)).toEqual({ start: 0, end: 100 });
    expect(resolveScreenExtent(100, 24, { kind: "full" })).toEqual({
      start: 0,
      end: 100,
    });
  });

  it("clamps an out-of-bounds range rather than reading past the buffer", () => {
    expect(
      resolveScreenExtent(10, 24, {
        kind: "range",
        startLine: -5,
        endLine: 1000,
      }),
    ).toEqual({ start: 0, end: 10 });
  });
});

describe("boundScreenCells", () => {
  it("leaves an ordinary screen alone — the cap is a ceiling, not a resize", () => {
    expect(boundScreenCells(24, 80)).toEqual({ rows: 24, cols: 80 });
    expect(boundScreenCells(50, 120)).toEqual({ rows: 50, cols: 120 });
  });

  it("trims rows to the row cap — the axis a caller can name", () => {
    expect(boundScreenCells(2000, 80)).toEqual({
      rows: SCREEN_CELLS_MAX_ROWS,
      cols: 80,
    });
  });

  it("trims COLUMNS to hold the area, which the row cap alone never did", () => {
    const wide = boundScreenCells(200, 1000);
    expect(wide.rows).toBe(200);
    expect(wide.rows * wide.cols).toBeLessThanOrEqual(SCREEN_CELLS_MAX_CELLS);
    expect(wide).toEqual({ rows: 200, cols: 130 });
  });

  it("lets the two axes trade — a wide terminal keeps its width at fewer rows", () => {
    expect(boundScreenCells(80, 300)).toEqual({ rows: 80, cols: 300 });
    expect(boundScreenCells(2000, 300).cols).toBe(130);
  });

  it("keeps the full width of an empty read rather than dividing by no rows", () => {
    expect(boundScreenCells(0, 200)).toEqual({ rows: 0, cols: 200 });
  });
});

describe("foregroundNameFromArgv", () => {
  const cases: {
    name: string;
    argv: string[];
    expected: string | undefined;
  }[] = [
    {
      name: "glibc loader, program only",
      argv: ["ld-linux-x86-64.so.2", "/nix/store/x/libexec/opencode"],
      expected: "/nix/store/x/libexec/opencode",
    },
    {
      name: "glibc loader reached by its full store path",
      argv: [
        "/nix/store/g/lib/ld-linux-x86-64.so.2",
        "/nix/store/x/libexec/opencode",
      ],
      expected: "/nix/store/x/libexec/opencode",
    },
    {
      name: "glibc loader with --argv0 and --library-path",
      argv: [
        "ld-linux-x86-64.so.2",
        "--argv0",
        "opencode",
        "--library-path",
        "/a",
        "/nix/store/x/libexec/opencode",
      ],
      expected: "/nix/store/x/libexec/opencode",
    },
    {
      name: "musl loader",
      argv: ["ld-musl-x86_64.so.1", "/nix/store/x/libexec/opencode"],
      expected: "/nix/store/x/libexec/opencode",
    },
    {
      name: "bare ld.so",
      argv: ["ld.so", "/nix/store/x/libexec/opencode"],
      expected: "/nix/store/x/libexec/opencode",
    },
    {
      name: "non-loader argv[0] is left alone",
      argv: ["opencode", "--model", "x"],
      expected: undefined,
    },
    {
      name: "loader with no program",
      argv: ["ld-linux-x86-64.so.2"],
      expected: undefined,
    },
    {
      name: "loader with only bare flags",
      argv: ["ld-linux-x86-64.so.2", "--list", "--inhibit-cache"],
      expected: undefined,
    },
    { name: "empty argv", argv: [], expected: undefined },
  ];

  it.each(cases)("$name", ({ argv, expected }) => {
    expect(foregroundNameFromArgv(argv)).toBe(expected);
  });
});

describe("isDynamicLoader", () => {
  it("reads an absent name as not-a-loader, never throws", () => {
    expect(isDynamicLoader(undefined)).toBe(false);
    expect(isDynamicLoader("ld-linux-x86-64.so.2")).toBe(true);
  });
});

describeDaemon("readProcCmdline", () => {
  it.skipIf(process.platform !== "linux")(
    "reads a live child's argv from /proc",
    async () => {
      const code = "setTimeout(() => {}, 10000)";
      const child = spawn(process.execPath, ["-e", code, "kolu-argv-arg"]);
      try {
        await waitFor(() => readProcCmdline(child.pid!) !== undefined);
        const argv = readProcCmdline(child.pid!);
        expect(argv?.[0]).toBe(process.execPath);
        expect(argv?.slice(1)).toEqual(["-e", code, "kolu-argv-arg"]);
      } finally {
        child.kill();
      }
    },
  );

  it.skipIf(process.platform !== "linux")(
    "returns undefined for a pid that cannot be read",
    () => {
      expect(readProcCmdline(2 ** 30)).toBeUndefined();
    },
  );
});

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function retainedCommand(
  host: PtyHost,
  id: PtyId,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.map(host.subscribeCommandRun(id), (sub) => sub.retained),
    ),
  );
}

async function firstEvent<T>(
  stream: Stream.Stream<T, unknown>,
  ms = 3000,
): Promise<T> {
  const frames = subscribeFrames(stream);
  try {
    return await frames.next(ms);
  } finally {
    frames.close();
  }
}

describeDaemon("createPtyHost", () => {
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

  it("viewport reads only the visible screen (the host's own rows)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "for i in $(seq 1 30); do printf 'L%02d\\n' $i; done; sleep 1",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 10,
      cols: 80,
    });
    await waitFor(() => host.getScreenText(id).includes("L30"));

    const full = host.getScreenText(id);
    expect(full).toContain("L01");
    expect(full).toContain("L30");

    const viewport = host.getScreenText(id, { kind: "viewport" });
    expect(viewport).toContain("L30");
    expect(viewport).not.toContain("L01");
  });

  it("delivers live output to attach() deltas", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'live delta\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          let seen = "";
          while (!seen.includes("live delta")) {
            const item = yield* Effect.promise(() => frames.next(2000));
            if (item.kind === "bytes") seen += item.data;
          }
          frames.close();
          expect(seen).toContain("live delta");
        }),
      ),
    );
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
    const { snapshot } = runScopedSync(host.attach(id));
    expect(snapshot).toContain("snap content");
  });

  it("keeps a wrapped URL on the cursor line intact across a narrowing resize", async () => {
    const url =
      "https://example.com/path/to/a/really/long/resource?query=value&another=thing&more=stuff&x=12";
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", `printf '%s' '${url}'; sleep 30`],
      env: shellEnv,
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    const joinedScreen = () => host.getScreenText(id).replace(/\n/g, "");
    await waitFor(() => joinedScreen().includes(url));
    host.resize(id, 40, 24);
    expect(joinedScreen()).toContain(url);
  });

  it("exit() succeeds with the child's exit code", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await Effect.runPromise(host.exit(id))).toBe(7);
  });

  it("still resolves the real exit code after the PTY is torn down", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await Effect.runPromise(host.exit(id))).toBe(5);
    expect(host.list()).toHaveLength(0);
    expect(await Effect.runPromise(host.exit(id))).toBe(5);
  });

  it("exit for an id the tombstone no longer holds FAILS instead of fabricating 0 (K7)", async () => {
    host = createPtyHost({ log: silentLog });
    await expect(
      Effect.runPromise(host.exit("00000000-0000-0000-0000-000000000000")),
    ).rejects.toMatchObject({ _tag: "PtyNotFound" });
  });

  it("a PTY gone between the two liveness checks throws the TAGGED PtyNotFound (K6)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 0"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.has(id)).toBe(true);
    await Effect.runPromise(host.exit(id));
    await waitFor(() => !host.has(id));
    let thrown: unknown;
    try {
      host.handle(id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ _tag: "PtyNotFound", id });
    await expect(
      Effect.runPromise(Effect.scoped(host.attach(id))),
    ).rejects.toMatchObject({ _tag: "PtyNotFound" });
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
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sub = yield* host.subscribeCommandRun(id);
          expect(sub.retained).toBeUndefined();
          expect(yield* Effect.promise(() => firstEvent(sub.marks))).toBe(
            "git status",
          );
        }),
      ),
    );
  });

  it("retains the last command line so a late reader catches up", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;codex\\033\\\\'; sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(async () => (await retainedCommand(host, id)) === "codex");
    expect(await retainedCommand(host, id)).toBe("codex");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("seeds the retained command from the argv for a command-rooted PTY", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(
      async () => (await retainedCommand(host, id)) === "/bin/sh -c 'sleep 5'",
    );
    expect(await retainedCommand(host, id)).toBe("/bin/sh -c 'sleep 5'");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("does not seed a title (the title tap is live-only, no snapshot replay)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(
      async () => (await retainedCommand(host, id)) === "/bin/sh -c 'sleep 5'",
    );
    expect(host.getTitle(id)).toBe("");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("a live 633;E mark overrides the command-rooted seed (precedence)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;git status\\033\\\\'; sleep 0.5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(
      async () => (await retainedCommand(host, id)) === "git status",
    );
    expect(await retainedCommand(host, id)).toBe("git status");
  });

  it("does NOT seed a command for a shell-rooted PTY (regression guard)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await retainedCommand(host, id)).toBeUndefined();
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

  it("samples foregroundPid from OUTPUT alone — no OSC hook needed", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "echo working; sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sub = yield* host.subscribeForeground(id);
          const frames = subscribeFrames(sub.samples);
          const sample = yield* Effect.promise(() =>
            frames.until((s) => s.foregroundPid !== undefined, 3000),
          );
          frames.close();
          expect(sample.foregroundPid).toBe(pid);
        }),
      ),
    );
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("trims the headless mirror to its configured scrollback under heavy output", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf 'FIRSTLINE\\n'; for i in $(seq 1 400); do printf 'fill%s\\n' \"$i\"; done; printf 'LASTLINE\\n'; sleep 30",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 24,
      scrollback: 50,
    });
    await waitFor(() => host.getScreenText(id).includes("LASTLINE"));
    const text = host.getScreenText(id);
    expect(text).toContain("LASTLINE");
    expect(text).not.toContain("FIRSTLINE");
    expect(text.split("\n").length).toBeLessThan(120);
  });

  it("still serves the live jobs at a small mirror (metadata, scrape tail, cold-attach repaint)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf '\\033]7;file://localhost/tmp/deep\\033\\\\'; for i in $(seq 1 400); do printf 'fill%s\\n' \"$i\"; done; printf 'TAILMARK\\n'; sleep 30",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 24,
      scrollback: 50,
    });
    await waitFor(() => host.getCwd(id) === "/tmp/deep");
    expect(host.getCwd(id)).toBe("/tmp/deep");
    await waitFor(() => host.getScreenText(id).includes("TAILMARK"));
    expect(host.getScreenText(id, { kind: "tail", lines: 24 })).toContain(
      "TAILMARK",
    );
    expect(runScopedSync(host.attach(id)).snapshot).toContain("TAILMARK");
  });

  it("answers XTVERSION (CSI > q) so a querying child is unblocked", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033[>0q'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes(HEADLESS_TERM_ID));
    expect(host.getScreenText(id)).toContain(HEADLESS_TERM_ID);
  });

  it("consumes XTVERSION with Ps > 0 without writing a reply", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033[>1qSENTINEL_DONE'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("SENTINEL_DONE"));
    expect(host.getScreenText(id)).not.toContain(HEADLESS_TERM_ID);
  });

  it("routes write() to the child and lists live PTYs", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "IFS= read -r line; printf 'received:%s\\n' \"$line\"; sleep 5",
      ],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toEqual([
      expect.objectContaining({ id, pid, cwd: "/tmp" }),
    ]);
    host.write(id, "kolu_write_ok\n");
    await waitFor(() =>
      host.getScreenText(id).includes("received:kolu_write_ok"),
    );
    expect(host.getScreenText(id)).toContain("received:kolu_write_ok");
    expect(host.getProcess(id)).toBeTypeOf("string");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
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
    await Effect.runPromise(host.exit(id));
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
    await Effect.runPromise(host.exit(id));
  });

  it("announces a spawn on the inventory feed as `created`", async () => {
    host = createPtyHost({ log: silentLog });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const inv = yield* host.subscribeInventory();
          expect(inv.entries).toEqual([]);
          const frames = subscribeFrames(inv.deltas);
          const { id, pid } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => frames.next(3000))).toEqual({
            kind: "created",
            entry: expect.objectContaining({ id, pid, cwd: "/tmp" }),
          });
          frames.close();
          host.kill(id);
          yield* host.exit(id);
        }),
      ),
    );
  });

  it("announces a teardown on the inventory feed as `exited`", async () => {
    host = createPtyHost({ log: silentLog });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const inv = yield* host.subscribeInventory();
          const frames = subscribeFrames(inv.deltas);
          const { id } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => frames.next(3000))).toMatchObject({
            kind: "created",
          });
          host.kill(id);
          yield* host.exit(id);
          expect(yield* Effect.promise(() => frames.next(3000))).toEqual({
            kind: "exited",
            id,
          });
          frames.close();
        }),
      ),
    );
  });

  it("fans the inventory feed out to multiple independent subscribers", async () => {
    host = createPtyHost({ log: silentLog });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const a = subscribeFrames((yield* host.subscribeInventory()).deltas);
          const b = subscribeFrames((yield* host.subscribeInventory()).deltas);
          const { id } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => a.next(3000))).toMatchObject({
            kind: "created",
          });
          expect(yield* Effect.promise(() => b.next(3000))).toMatchObject({
            kind: "created",
          });
          a.close();
          b.close();
          host.kill(id);
          yield* host.exit(id);
        }),
      ),
    );
  });
});

describeDaemon("device-query contract — suppressed ⇄ answered pairing", () => {
  function freshHeadless(): InstanceType<typeof Terminal> {
    return new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  }

  async function repliesTo(
    term: InstanceType<typeof Terminal>,
    query: string,
  ): Promise<string[]> {
    const got: string[] = [];
    const sub = term.onData((d: string) => got.push(d));
    await writeAndFlush(term, query);
    sub.dispose();
    return got;
  }

  it("every reply the headless natively emits is a shape the client filter suppresses", async () => {
    const term = freshHeadless();
    for (const { name, query } of ANSWERED_DEVICE_QUERIES) {
      const replies = await repliesTo(term, query);
      expect(replies.length, `${name}: headless must answer`).toBeGreaterThan(
        0,
      );
      for (const reply of replies) {
        expect(
          isTerminalQueryResponse(reply),
          `${name}: reply ${JSON.stringify(reply)} must match the suppressed grammars`,
        ).toBe(true);
      }
    }
    term.dispose();
  });

  it("the hand-rolled XTVERSION reply is a shape the client filter suppresses", () => {
    expect(isTerminalQueryResponse(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`)).toBe(
      true,
    );
  });

  it("colour and window-report queries are uniformly silent — the headless answers none", async () => {
    const term = freshHeadless();
    for (const { name, query } of SILENT_DEVICE_QUERIES) {
      const replies = await repliesTo(term, query);
      expect(replies, `${name}: expected uniform silence`).toEqual([]);
    }
    term.dispose();
  });

  it("a colour query through a real PTY yields silence, never reply garbage", async () => {
    const host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]11;?\\007'; printf 'OSC_SENTINEL'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          let raw = "";
          while (!raw.includes("OSC_SENTINEL")) {
            const item = yield* Effect.promise(() => frames.next(2500));
            if (item.kind === "bytes") raw += item.data;
          }
          frames.close();
          expect(raw).toContain("OSC_SENTINEL");
          expect(raw).not.toContain("rgb:");
        }),
      ),
    );
    host.dispose();
  });
});

describeDaemon("attach() reconnect-storm defenses", () => {
  let host: PtyHost;

  afterEach(() => {
    vi.restoreAllMocks();
    host?.dispose();
  });

  it("does zero work for an attach on an already-interrupted fiber", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'abort marker\\n'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenState(id).includes("abort marker"));

    const serializeSpy = vi.spyOn(SerializeAddon.prototype, "serialize");
    const exit = Effect.runSyncExit(
      Effect.scoped(
        Effect.flatMap(Effect.interrupt, () =>
          host.attach(id, { resizeTo: { cols: 37, rows: 11 } }),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(serializeSpy).not.toHaveBeenCalled();
  });

  it("does not resize the shared PTY for an attach on an already-interrupted fiber", async () => {
    const wide = "W".repeat(60);
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", `printf '${wide}\\n'; sleep 1`],
      env: shellEnv,
      cwd: "/tmp",
      cols: 100,
      rows: 30,
    });
    await waitFor(() => host.getScreenText(id).includes(wide));

    Effect.runSyncExit(
      Effect.scoped(
        Effect.flatMap(Effect.interrupt, () =>
          host.attach(id, { resizeTo: { cols: 37, rows: 11 } }),
        ),
      ),
    );

    expect(host.getScreenText(id)).toContain(wide);
  });

  it("coalesces a burst of attaches within one publish-epoch into one serialize", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'idle marker\\n'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("idle marker"));

    const serializeSpy = vi.spyOn(SerializeAddon.prototype, "serialize");
    const snaps = Array.from(
      { length: 25 },
      () => runScopedSync(host.attach(id)).snapshot,
    );

    expect(serializeSpy).toHaveBeenCalledTimes(1);
    for (const s of snaps) expect(s).toContain("idle marker");
  });

  it("re-serializes after new output ends the epoch (cache cleared on publish)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      env: shellEnv,
      cwd: "/tmp",
    });
    host.write(id, "echo first\n");
    await waitFor(() => host.getScreenText(id).includes("first"));

    const serializeSpy = vi.spyOn(SerializeAddon.prototype, "serialize");
    runScopedSync(host.attach(id));
    runScopedSync(host.attach(id));
    expect(serializeSpy).toHaveBeenCalledTimes(1);

    host.write(id, "echo second\n");
    await waitFor(() => host.getScreenText(id).includes("second"));
    const { snapshot } = runScopedSync(host.attach(id));
    expect(serializeSpy).toHaveBeenCalledTimes(2);
    expect(snapshot).toContain("second");
  });

  it("re-serializes after a resize reflows the mirror (cache cleared on resize)", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'WIDEMARK%083d\\n' 0; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("WIDEMARK"));

    const serializeSpy = vi.spyOn(SerializeAddon.prototype, "serialize");
    const first = runScopedSync(host.attach(id)).snapshot;
    expect(serializeSpy).toHaveBeenCalledTimes(1);

    serializeSpy.mockClear();
    host.resize(id, 120, 24);
    const second = (await Effect.runPromise(Effect.scoped(host.attach(id))))
      .snapshot;

    expect(serializeSpy).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
  });
});
