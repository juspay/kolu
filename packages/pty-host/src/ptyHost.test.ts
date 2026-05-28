/**
 * Integration tests for `@kolu/pty-host` — real `node-pty` children +
 * `@xterm/headless` mirrors. Covers the cuts the daemon supervisor and
 * the reattach path depend on: snapshot-then-delta attach, multi-client
 * fan-out, OSC-driven cwd/title/command streams, screen-state
 * serialization, the exit lifecycle, and teardown.
 *
 * These spawn `/bin/sh` and drive OSC sequences via `printf`, so they're
 * integration tests (a PTY is allocated), not pure units — but they run
 * in well under a second each.
 */
import { describe, expect, it } from "vitest";
import { createPtyHost, getScreenText, type PtyHost } from "./ptyHost.ts";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function makeHost(): PtyHost {
  // biome-ignore lint/suspicious/noExplicitAny: test-only minimal Logger shape
  return createPtyHost({ log: silentLogger as any });
}

// Inherit the real PATH so `sleep`/`printf` resolve regardless of the host
// distro (on NixOS coreutils are not under /usr/bin:/bin).
const BASE_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  PS1: "$ ",
  TERM: "xterm-256color",
};

/** Spawn a shell that stays alive (so the PTY persists for assertions). */
function spawnSleeper(host: PtyHost, args: string[] = ["-c", "sleep 60"]) {
  return host.spawn({
    shell: "/bin/sh",
    args,
    env: BASE_ENV,
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    scrollback: 1000,
  });
}

/** First value from an async iterable, or `undefined` after `ms`. */
async function firstWithin<T>(
  iter: AsyncIterable<T>,
  ms: number,
): Promise<T | undefined> {
  const it = iter[Symbol.asyncIterator]();
  const next = await Promise.race([
    it.next(),
    new Promise<IteratorResult<T>>((r) =>
      setTimeout(() => r({ value: undefined as never, done: true }), ms),
    ),
  ]);
  return next.done ? undefined : next.value;
}

const tick = () => new Promise((r) => setTimeout(r, 50));
/** Longer settle for output to traverse node-pty → headless mirror. */
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("createPtyHost — spawn", () => {
  it("returns an id + pid; honors a caller-supplied id", () => {
    const host = makeHost();
    const auto = spawnSleeper(host);
    expect(auto.id).toMatch(/.+/);
    expect(auto.pid).toBeGreaterThan(0);

    const withId = host.spawn({
      id: "fixed-id-123",
      shell: "/bin/sh",
      args: ["-c", "sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    expect(withId.id).toBe("fixed-id-123");
    host.dispose();
  });

  it("rejects a duplicate id", () => {
    const host = makeHost();
    host.spawn({
      id: "dup",
      shell: "/bin/sh",
      args: ["-c", "sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    expect(() =>
      host.spawn({
        id: "dup",
        shell: "/bin/sh",
        args: ["-c", "sleep 60"],
        env: BASE_ENV,
        cwd: "/tmp",
      }),
    ).toThrow(/already in use/);
    host.dispose();
  });

  it("seeds cwd from spawn opts", () => {
    const host = makeHost();
    const { id } = spawnSleeper(host);
    expect(host.getCwd(id)).toBe("/tmp");
    host.dispose();
  });
});

describe("createPtyHost — attach (snapshot then deltas)", () => {
  it("yields a string snapshot, then live output deltas", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf MARKER_ABC; sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    const { snapshot, deltas } = await host.attach(id);
    expect(typeof snapshot).toBe("string");
    // The shell's output arrives as a live delta.
    const chunk = await firstWithin(deltas, 1500);
    expect(chunk).toMatch(/MARKER_ABC/);
    host.dispose();
  });

  it("late attach sees prior output in the snapshot, not as a delta", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf EARLY_OUTPUT; sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    await settle(); // let EARLY_OUTPUT land in the headless mirror
    const { snapshot } = await host.attach(id);
    expect(snapshot).toMatch(/EARLY_OUTPUT/);
    host.dispose();
  });

  it("fans out live deltas to multiple attachers", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 0.2; printf FANOUT; sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    const a = await host.attach(id);
    const b = await host.attach(id);
    const [ca, cb] = await Promise.all([
      firstWithin(a.deltas, 2000),
      firstWithin(b.deltas, 2000),
    ]);
    expect(ca).toMatch(/FANOUT/);
    expect(cb).toMatch(/FANOUT/);
    host.dispose();
  });

  it("attach to an unknown id rejects", async () => {
    const host = makeHost();
    await expect(host.attach("nope")).rejects.toThrow(/unknown id/);
    host.dispose();
  });
});

describe("createPtyHost — OSC metadata streams", () => {
  it("subscribeCwd emits the cwd parsed from OSC 7", async () => {
    const host = makeHost();
    // Emit OSC 7 (file://host/path) then idle.
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "sleep 0.3; printf '\\033]7;file://h/tmp/wd\\033\\\\'; sleep 60",
      ],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    const cwd = await firstWithin(host.subscribeCwd(id), 2000);
    expect(cwd).toBe("/tmp/wd");
    expect(host.getCwd(id)).toBe("/tmp/wd");
    host.dispose();
  });

  it("subscribeTitle emits the OSC 2 title", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 0.3; printf '\\033]2;my-title\\033\\\\'; sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    const title = await firstWithin(host.subscribeTitle(id), 2000);
    expect(title).toBe("my-title");
    host.dispose();
  });

  it("subscribeCommandRun emits the OSC 633;E payload", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "sleep 0.3; printf '\\033]633;E;git status\\033\\\\'; sleep 60",
      ],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    const cmd = await firstWithin(host.subscribeCommandRun(id), 2000);
    expect(cmd).toBe("git status");
    host.dispose();
  });
});

describe("createPtyHost — control verbs", () => {
  it("write reaches the shell (echoed back via attach)", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-i"],
      env: { ...BASE_ENV, PS1: "" },
      cwd: "/tmp",
    });
    const { deltas } = await host.attach(id);
    host.write(id, "printf WRITE_OK\n");
    // Collect output for a moment, assert the echo/output shows up.
    const seen: string[] = [];
    const it = deltas[Symbol.asyncIterator]();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !seen.join("").includes("WRITE_OK")) {
      const n = await Promise.race([
        it.next(),
        new Promise<IteratorResult<string>>((r) =>
          setTimeout(() => r({ value: "", done: false }), 200),
        ),
      ]);
      if (!n.done && n.value) seen.push(n.value);
    }
    expect(seen.join("")).toMatch(/WRITE_OK/);
    host.dispose();
  });

  it("write/resize/kill on an unknown id are no-ops (no throw)", () => {
    const host = makeHost();
    expect(() => host.write("ghost", "x")).not.toThrow();
    expect(() => host.resize("ghost", 10, 10)).not.toThrow();
    expect(() => host.kill("ghost")).not.toThrow();
    host.dispose();
  });

  it("resize updates the headless grid (no throw, screen-state still serializes)", () => {
    const host = makeHost();
    const { id } = spawnSleeper(host);
    host.resize(id, 120, 40);
    expect(typeof host.getScreenState(id)).toBe("string");
    host.dispose();
  });
});

describe("createPtyHost — exit lifecycle", () => {
  it("exitPromise resolves with the child's exit code", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    expect(await host.exitPromise(id)).toBe(7);
    host.dispose();
  });

  it("exitPromise on an unknown id resolves to -1", async () => {
    const host = makeHost();
    expect(await host.exitPromise("nope")).toBe(-1);
    host.dispose();
  });

  it("onDispose hook fires when the PTY is killed", async () => {
    const host = makeHost();
    let disposed = false;
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
      onDispose: () => {
        disposed = true;
      },
    });
    host.kill(id);
    await host.exitPromise(id);
    await tick();
    expect(disposed).toBe(true);
    host.dispose();
  });

  it("a killed PTY drops out of list()", async () => {
    const host = makeHost();
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
    await tick();
    const ids = host.list().map((e) => e.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
    host.dispose();
  });
});

describe("createPtyHost — introspection", () => {
  it("list reports id/pid/cwd/lastActivity for live PTYs", () => {
    const host = makeHost();
    const { id, pid } = spawnSleeper(host);
    const entry = host.list().find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry?.pid).toBe(pid);
    expect(entry?.cwd).toBe("/tmp");
    expect(typeof entry?.lastActivity).toBe("number");
    host.dispose();
  });

  it("getProcess returns the foreground process name", () => {
    const host = makeHost();
    const { id } = spawnSleeper(host);
    expect(typeof host.getProcess(id)).toBe("string");
    expect(host.getProcess("ghost")).toBeUndefined();
    host.dispose();
  });

  it("getForegroundPid returns a positive pid or undefined", () => {
    const host = makeHost();
    const { id } = spawnSleeper(host);
    const fg = host.getForegroundPid(id);
    expect(fg === undefined || fg > 0).toBe(true);
    expect(host.getForegroundPid("ghost")).toBeUndefined();
    host.dispose();
  });

  it("getScreenText extracts plain text from the buffer", async () => {
    const host = makeHost();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'TEXT_LINE\\n'; sleep 60"],
      env: BASE_ENV,
      cwd: "/tmp",
    });
    await settle();
    expect(host.getScreenText(id)).toMatch(/TEXT_LINE/);
    expect(host.getScreenText("ghost")).toBe("");
    host.dispose();
  });

  it("getScreenState returns VT escapes (or empty for unknown id)", () => {
    const host = makeHost();
    const { id } = spawnSleeper(host);
    expect(typeof host.getScreenState(id)).toBe("string");
    expect(host.getScreenState("ghost")).toBe("");
    host.dispose();
  });
});

describe("createPtyHost — dispose", () => {
  it("tears down every PTY", () => {
    const host = makeHost();
    spawnSleeper(host);
    spawnSleeper(host);
    expect(host.list().length).toBe(2);
    host.dispose();
    expect(host.list().length).toBe(0);
  });
});

describe("getScreenText helper", () => {
  it("joins buffer lines and clamps the range", () => {
    const buffer = {
      length: 3,
      getLine: (i: number) => ({
        translateToString: () => `line${i}`,
      }),
    };
    expect(getScreenText(buffer)).toBe("line0\nline1\nline2");
    expect(getScreenText(buffer, 1, 2)).toBe("line1");
    // Out-of-range start/end clamp to the buffer bounds.
    expect(getScreenText(buffer, -5, 99)).toBe("line0\nline1\nline2");
  });

  it("treats missing lines as empty strings", () => {
    const buffer = {
      length: 2,
      getLine: (i: number) =>
        i === 0 ? { translateToString: () => "a" } : undefined,
    };
    expect(getScreenText(buffer)).toBe("a\n");
  });
});
