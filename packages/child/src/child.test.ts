import { expect, test } from "vitest";

import { Hung, run, start } from "./child.ts";

test("a child that never ran answers with the system's own reason, and takes nothing down with it", async () => {
  const child = start("/nonexistent/olai-test/not-a-program");

  expect(await child.unstartable).toContain("ENOENT");
  expect(child.failed()?.includes("ENOENT")).toBe(true);
});

test("a child that started never settles unstartable", async () => {
  const child = start(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"]);
  try {
    const settled = await Promise.race([
      child.unstartable.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 250)),
    ]);
    expect(settled).toBe("still waiting");
    expect(child.failed()).toBeUndefined();
  } finally {
    child.kill("SIGKILL");
    await child.closed;
  }
});

test("stderr is drained by default, so a pipe nobody reads cannot block", async () => {
  const child = start(process.execPath, [
    "-e",
    "process.stderr.write('from stderr\\n')",
  ]);
  const close = await child.wait(5_000, "stderr writer");
  expect(close.code).toBe(0);
  expect(child.err()).toContain("from stderr");
  expect(child.said()).toContain("from stderr");
});

test("stdout is not drained by default: it is often a protocol", async () => {
  const child = start(
    process.execPath,
    ["-e", "process.stdout.write('from stdout\\n')"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks: Array<string> = [];
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => chunks.push(chunk));
  await child.wait(5_000, "stdout writer");
  expect(chunks.join("")).toContain("from stdout");
  expect(child.out()).toBe("");
  expect(child.said()).toBe("");
});

test("opting into draining stdout fills the box", async () => {
  const child = start(
    process.execPath,
    ["-e", "process.stdout.write('hello\\n')"],
    {
      drain: { stdout: true },
    },
  );
  await child.wait(5_000, "drained stdout");
  expect(child.out()).toContain("hello");
});

test("wait throws Hung with what the child said, rather than answering false", async () => {
  const child = start(process.execPath, [
    "-e",
    "process.stderr.write('still here\\n'); setTimeout(() => {}, 10_000)",
  ]);
  try {
    await new Promise<void>((resolve, reject) => {
      const look = () => {
        if (child.err().includes("still here")) resolve();
      };
      child.stderr?.on("data", look);
      look();
      void child.closed.then(() =>
        reject(
          new Error(
            `the sleeper exited before it said anything:\n${child.said()}`,
          ),
        ),
      );
    });
    try {
      await child.wait(200, "the sleeper");
      throw new Error("wait should have hung");
    } catch (cause) {
      expect(cause).toBeInstanceOf(Hung);
      if (!(cause instanceof Hung)) return;
      expect(cause.said).toContain("still here");
      expect(cause.message).toContain("the sleeper");
    }
  } finally {
    child.kill("SIGKILL");
    await child.closed;
  }
});

test("wait resolves from the listener attached at spawn, even when the child is already gone", async () => {
  const child = start(process.execPath, ["-e", "process.exit(7)"]);
  const close = await child.wait(5_000, "already gone");
  expect(close.code).toBe(7);
});

test("kill of a gone child is ESRCH, and ESRCH is success", async () => {
  const child = start(process.execPath, ["-e", "process.exit(0)"]);
  await child.closed;
  expect(() => child.kill("SIGTERM")).not.toThrow();
});

test("stop escalates from SIGTERM to SIGKILL when the child ignores the first", async () => {
  // A shell that traps SIGTERM, not a JS process: a JS process that listens
  // for SIGTERM would exit on it and make this a SIGTERM success, never
  // exercising the escalation. Echo first so
  // the trap is installed before we signal — a spawn-then-kill race
  // would otherwise SIGTERM a shell that had not trapped yet.
  const child = start(
    "sh",
    ["-c", 'trap "" TERM; echo ready; while true; do :; done'],
    {
      drain: { stdout: true },
    },
  );
  await new Promise<void>((resolve, reject) => {
    const look = () => {
      if (child.out().includes("ready")) resolve();
    };
    child.stdout?.on("data", look);
    look();
    void child.closed.then(() =>
      reject(
        new Error(`the trapper exited before it was ready:\n${child.said()}`),
      ),
    );
  });
  const close = await child.stop({ graceMs: 200 });
  expect(close.signal).toBe("SIGKILL");
});

test("run answers ok for a child that printed and exited 0", async () => {
  const result = await run(process.execPath, [
    "-e",
    "process.stdout.write('hi\\n')",
  ]);
  expect(result.ok).toBe(true);
  expect(result.code).toBe(0);
  expect(result.out).toContain("hi");
  expect(result.said).toContain("hi");
});

test("run answers with stderr when the child exits non-zero", async () => {
  const result = await run(process.execPath, [
    "-e",
    "process.stderr.write('nope\\n'); process.exit(3)",
  ]);
  expect(result.ok).toBe(false);
  expect(result.code).toBe(3);
  expect(result.said).toContain("nope");
});

test("run answers the exec failure rather than throwing it", async () => {
  const result = await run("/nonexistent/olai-test/not-a-program");
  expect(result.ok).toBe(false);
  expect(result.said).toContain("ENOENT");
});

test("run refuses when the child said more than maxBuffer, quoting the tail", async () => {
  const cap = 64 * 1024;
  const result = await run(
    process.execPath,
    ["-e", "process.stdout.write('H'.repeat(100 * 1024))"],
    { maxBuffer: cap },
  );
  expect(result.ok).toBe(false);
  expect(result.said).toContain("said more than");
  expect(result.said).toContain(`${cap} bytes`);
  expect(result.said).toContain("tail quoted");
  expect(result.out.length).toBe(cap);
  expect(result.out).toBe("H".repeat(cap));
});

test("run throws Hung on a hang, with what the child said", async () => {
  try {
    await run(
      process.execPath,
      [
        "-e",
        "process.stderr.write('working\\n'); setTimeout(() => {}, 10_000)",
      ],
      { timeout: 3_000 },
    );
    throw new Error("run should have hung");
  } catch (cause) {
    expect(cause).toBeInstanceOf(Hung);
    if (!(cause instanceof Hung)) return;
    expect(cause.said).toContain("working");
    expect(cause.message).toContain("did not finish");
  }
});

test("process groups stop descendants that ignore SIGTERM", async () => {
  const script = `const {spawn}=require('node:child_process');
    spawn(process.execPath,['-e','process.on("SIGTERM",()=>{}); process.stdout.write("ready"); setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});
    setInterval(()=>{},1000);`;
  const child = start(process.execPath, ["-e", script], { processGroup: true });
  try {
    await new Promise<void>((resolve) =>
      child.stdout!.once("data", () => resolve()),
    );
    const close = await child.stop({ graceMs: 50 });
    expect(close.signal).toBe("SIGTERM");
  } finally {
    child.kill("SIGKILL");
  }
});
