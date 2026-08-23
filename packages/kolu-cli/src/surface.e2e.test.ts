/**
 * The `kolu surface` face, end to end — the SHIPPED launcher shape driven
 * against a REAL padi (which spawns its own kaval + PTYs), exactly the
 * processes an agent script runs.
 *
 * The unit sibling (`surfaceFace.test.ts`) pins the matrix arms that need no
 * live wire (dead endpoint · contradictory spelling · non-decoding input ·
 * list's dial-freedom). What is left that ONLY a live wire proves:
 *
 *  - **A refusal from a REAL padi rides exit 1 on stderr**, NOT merged into
 *    stdout (where a machine reader would have to sniff every answer), with
 *    the typed refusal still intact when it crosses back over ndjson.
 *  - **The whole agent protocol is there as argv** — create is the one leg
 *    shared with the native tree; everything AFTER the id exists is the
 *    surface face: get · wait_outputSettled · lifecycle_sendInput (text, then
 *    Enter as its OWN send) · screen_text · lifecycle_kill. This is the
 *    `kolu mcp` tool table, proven one process per verb.
 *
 * The spawn/dial/reap discipline itself is `./e2eDaemon.testlib.ts`'s (kill
 * by exact pid, never inherit the production `$PADI_SOCKET`, bind the
 * daemons to this process); this file composes it for the new face.
 */

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

/** One SHIPPED `kolu` invocation, to its exit: exactly what a calling agent's
 *  `exec kolu surface …` sees — exit code, stdout, stderr, no in-process
 *  anything. Each call is a long-lived fork like the daemons, leashed here
 *  once so no helper indirection can smuggle it past a bare `vitest`. */
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

/** One surface verb against THIS leg's padi, with the endpoint spelled once,
 *  at the ROOT — the shared-flag position an agent's script actually uses. */
const runSurface = (socketPath: string, argv: string[]) =>
  runKolu(["--socket", socketPath, "surface", ...argv]);

/** Run a verb expecting exit 0, parsing its single JSON answer. */
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
      const table = (await surfaceJson(padi.socketPath, ["list"])) as {
        verbs: { name: string; source: string; mutates: boolean }[];
        resources: { name: string }[];
      };
      const verbs = new Set(table.verbs.map((v) => v.name));
      // The gaps are the point: keys/get/watch/verbs are the introspection
      // plane; the seven ds_* members stay off, as does drainList.
      for (const name of [
        "lifecycle_create",
        "lifecycle_sendInput",
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
      ]) {
        expect(verbs.has(name), name).toBe(true);
      }
      expect(verbs.size).toBe(15);
      // And both shapes of introspection answer: the staggered resources.
      expect(table.resources.map((r) => r.name)).toEqual([
        "terminals",
        "urgency",
        "daemonStatus",
        "status",
        "identity",
      ]);
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
      // The refusal is VERBATIM typed ndjson — no `kolu surface: ` prefix —
      // because a prefix is a line an agent would have to strip before
      // JSON.parse; the refusal IS the answer, just on stderr with a 1.
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

      // create is the one leg borrowed from the NATIVE tree — the id this
      // whole story is about.
      const created = await runKolu([
        "--socket",
        padi.socketPath,
        "create",
        "--toplevel",
      ]);
      expect(created.code, created.stderr).toBe(0);
      const id = created.stdout.trim();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      // The resource plane names it back — a staggered keyed collection answers
      // the id through `keys`, and the id IS the key (the item value carries no
      // duplicate of it).
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

      // The shell prompt settles, then a command typed AS INPUT reads back AS
      // SCREEN — the read/write loop an agent run on `kolu mcp` already knows,
      // now one process per verb.
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

      // And the terminal leaves the world through the face, by the id it told.
      const killed = await runSurface(padi.socketPath, ["lifecycle_kill", id]);
      expect(killed.code, killed.stderr).toBe(0);
      const after = await surfaceJson(padi.socketPath, ["keys", "terminals"]);
      expect(JSON.stringify(after), JSON.stringify(after)).not.toContain(id);
    });

    it("the endpoint TRIO rides through: the same padi answers its own watch flags", {
      timeout: 120000,
    }, async () => {
      // One more domain, one sentence: --state-root IS this daemon's socket,
      // because that is `resolvePadiSocketPath(stateRoot)`. If the face wired
      // a second meaning for the flag, this leg would dial silence.
      const padi = await startPadi();
      const created = await runKolu([
        "--state-root",
        padi.stateRoot,
        "create",
        "--toplevel",
      ]);
      expect(created.code, created.stderr).toBe(0);
      const id = created.stdout.trim();
      const screen = await runSurface(padi.socketPath, [
        "screen_text",
        id,
        "--tail",
        "5",
      ]);
      expect(screen.code, screen.stderr).toBe(0);
    });
  },
);
