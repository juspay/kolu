import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import {
  daemonEnv as daemonEnvIn,
  e2eRuntimeRoot,
  KOLU_MAIN,
  type Padi,
  reapPadi,
  spawnPadi,
  TSX_LOADER,
  waitForPadi,
} from "./e2eDaemon.testlib.ts";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

const RUNTIME = e2eRuntimeRoot("surface-e2e");
beforeAll(() => RUNTIME.enter());
afterAll(() => RUNTIME.leave());

const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  daemonEnvIn(RUNTIME.root, extra);

const spawned: Padi[] = [];
async function startPadi(): Promise<Padi> {
  const p = spawnPadi({
    runtimeRoot: RUNTIME.root,
    stateRoot: mkdtempSync(join(tmpdir(), "kolu-surface-e2e-sr-")),
  });
  spawned.push(p);
  await waitForPadi(p.socketPath);
  return p;
}

const children: import("node:child_process").ChildProcess[] = [];
afterEach(async () => {
  for (const c of children.splice(0))
    if (c.exitCode === null) c.kill("SIGKILL");
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reapPadi(p);
  }
}, 30000);

function runKolu(
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  assertDaemonSpawnAllowed("a real `kolu` process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_LOADER, KOLU_MAIN, ...argv],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: daemonEnv(),
      },
    );
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const runSurface = (socketPath: string, argv: string[]) =>
  runKolu(["--socket", socketPath, "surface", ...argv]);

async function surfaceJson(
  socketPath: string,
  argv: string[],
): Promise<unknown> {
  const run = await runSurface(socketPath, argv);
  expect(
    run.code,
    `kolu surface ${argv.join(" ")}: stderr was ${run.stderr}`,
  ).toBe(0);
  return JSON.parse(run.stdout);
}

describeDaemon(
  "kolu surface — the agent protocol as argv, against a real padi",
  () => {
    it("`list` projects the whole parity table through the shipped launcher", {
      timeout: 60000,
    }, async () => {
      const padi = await startPadi();
      const table = (await surfaceJson(padi.socketPath, [
        "list",
        "--json",
      ])) as {
        verbs: { name: string; source: string; mutates: boolean }[];
        resources: { name: string; member: string }[];
      };
      const verbs = new Set(table.verbs.map((v) => v.name));
      for (const name of [
        "lifecycle_create",
        "lifecycle_sendInput",
        "agent_say",
        "lifecycle_kill",
        "wait_outputSettled",
        "wait_agentState",
        "watch_open",
        "watch_next",
        "watch_close",
        "screen_text",
        "screen_image",
        "screen_history",
        "fs_listAll",
        "fs_readFile",
        "git_getStatus",
        "git_getDiff",
        "diagnostics_read",
      ]) {
        expect(verbs.has(name), name).toBe(true);
      }
      expect(verbs.size).toBe(17);
      expect(table.resources.map((r) => r.name)).toEqual([
        "get terminals",
        "keys terminals",
        "get urgency",
        "get daemonStatus",
        "keys daemonStatus",
        "get status",
        "get identity",
      ]);
      expect([...new Set(table.resources.map((r) => r.member))]).toEqual([
        "terminals",
        "urgency",
        "daemonStatus",
        "status",
        "identity",
      ]);
    });

    it("`diagnostics_read` on a running padi prints children, stalls and watchers", {
      timeout: 60000,
    }, async () => {
      const padi = await startPadi();
      const answer = (await surfaceJson(padi.socketPath, [
        "diagnostics_read",
      ])) as {
        children?: { rows: { kind: string }[] };
        stalls?: { resolutionMs: number };
        watchers?: { rows: unknown[] };
      };
      expect(
        answer.children?.rows.length,
        JSON.stringify(answer),
      ).toBeGreaterThan(0);
      expect(answer.stalls?.resolutionMs).toBeGreaterThan(0);
      expect(Array.isArray(answer.watchers?.rows)).toBe(true);
    });

    it("a refusal from the live padi is exit 1, typed, on STDERR — stdout holds no lie", {
      timeout: 60000,
    }, async () => {
      const padi = await startPadi();
      const run = await runSurface(padi.socketPath, [
        "screen_text",
        "00000000-0000-4000-8000-000000000000",
      ]);
      expect(run.code, run.stderr).toBe(1);
      expect(
        run.stdout,
        "stdout must carry nothing a machine could read as an answer",
      ).toBe("");
      const refusal = JSON.parse(run.stderr) as {
        _tag: string;
        message?: string;
      };
      expect(refusal._tag, JSON.stringify(refusal)).toBe("TerminalNotFound");
    });

    it("the whole agent protocol, one process per verb: get → settle → input → read → kill", {
      timeout: 240000,
    }, async () => {
      const padi = await startPadi();

      const created = await runSurface(padi.socketPath, [
        "lifecycle_create",
        "--input",
        JSON.stringify({
          placement: { kind: "toplevel" },
          cwd: process.cwd(),
        }),
      ]);
      expect(created.code, created.stderr).toBe(0);
      const createdOut = JSON.parse(created.stdout) as { id?: unknown };
      expect(
        createdOut.id,
        `lifecycle_create's stdout: ${created.stdout}`,
      ).toMatch(/^[0-9a-f-]{36}$/);
      const id = createdOut.id as string;

      const keys = await surfaceJson(padi.socketPath, ["keys", "terminals"]);
      expect(JSON.stringify(keys), JSON.stringify(keys)).toContain(id);
      const item = (await surfaceJson(padi.socketPath, [
        "get",
        "terminals",
        id,
      ])) as { cwd: string };
      expect(item.cwd, "the keyed item is the terminal the create ran as").toBe(
        process.cwd(),
      );

      const marker = "surface-face-round-trip-ok";
      const first = (await surfaceJson(padi.socketPath, [
        "wait_outputSettled",
        id,
        "--idleMs",
        "1500",
        "--timeoutMs",
        "60000",
      ])) as { result: string };
      expect(first.result).toBe("met");
      await surfaceJson(padi.socketPath, [
        "lifecycle_sendInput",
        id,
        "--text",
        `echo ${marker}`,
      ]);
      await surfaceJson(padi.socketPath, [
        "lifecycle_sendInput",
        id,
        "--key",
        "Enter",
      ]);
      const settled = (await surfaceJson(padi.socketPath, [
        "wait_outputSettled",
        id,
        "--idleMs",
        "1200",
        "--timeoutMs",
        "60000",
      ])) as { result: string };
      expect(settled.result).toBe("met");
      const screen = await runSurface(padi.socketPath, [
        "screen_text",
        id,
        "--tail",
        "40",
      ]);
      expect(screen.code, screen.stderr).toBe(0);
      expect(screen.stdout).toContain(marker);

      const killed = await runSurface(padi.socketPath, ["lifecycle_kill", id]);
      expect(killed.code, killed.stderr).toBe(0);
      const after = await surfaceJson(padi.socketPath, ["keys", "terminals"]);
      expect(JSON.stringify(after), JSON.stringify(after)).not.toContain(id);
    });

    it("`--state-root` spells the same padi on this face too — no --socket needed", {
      timeout: 120000,
    }, async () => {
      const padi = await startPadi();
      const listed = await runKolu([
        "--state-root",
        padi.stateRoot,
        "surface",
        "list",
      ]);
      expect(listed.code, listed.stderr).toBe(0);
      expect(listed.stdout).toContain("screen_text");
      const created = await runSurface(padi.socketPath, [
        "lifecycle_create",
        "--input",
        JSON.stringify({ placement: { kind: "toplevel" } }),
      ]);
      expect(created.code, created.stderr).toBe(0);
      const { id } = JSON.parse(created.stdout) as { id: string };
      const screen = await runKolu([
        "--state-root",
        padi.stateRoot,
        "surface",
        "screen_text",
        id,
        "--tail",
        "5",
      ]);
      expect(screen.code, screen.stderr).toBe(0);
    });

    it("Ctrl-C during an UNBOUNDED wait answers 130 — the waiter's signal is live", {
      timeout: 240000,
    }, async () => {
      const padi = await startPadi();
      const created = await runSurface(padi.socketPath, [
        "lifecycle_create",
        "--input",
        JSON.stringify({ placement: { kind: "toplevel" } }),
      ]);
      expect(created.code, created.stderr).toBe(0);
      const { id } = JSON.parse(created.stdout) as { id: string };
      assertDaemonSpawnAllowed("a real `kolu` process, mid-wait");
      const child = spawn(
        process.execPath,
        [
          "--import",
          TSX_LOADER,
          KOLU_MAIN,
          "--socket",
          padi.socketPath,
          "surface",
          "wait_outputSettled",
          "--input",
          JSON.stringify({ id, idleMs: 300000 }),
        ],
        { stdio: ["ignore", "pipe", "pipe"], env: daemonEnv() },
      );
      children.push(child);
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => (stdout += c));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => (stderr += c));
      const answered = new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? -1));
      });
      setTimeout(() => child.kill("SIGINT"), 5000);
      const begun = Date.now();
      const code = await answered;
      expect(code, stderr).toBe(130);
      expect(Date.now() - begun, `stdout: ${stdout}`).toBeLessThan(30000);
    });
  },
);
