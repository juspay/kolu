import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import {
  type PadiDaemonClient,
  type PadiSurfaceClient,
  padiClientOver,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import {
  PADI_SURFACE_VERSION,
  type PadiHostInventory,
  type PadiTerminal,
  padiDaemonGroup,
  padiSurfaceSibling,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { AgentClient } from "@kolu/surface-remote";
import {
  directAgentDerivation,
  isLocalHost,
  makeSession,
  type SshProv,
  sshConnector,
} from "@kolu/surface-remote";
import { TEST_BINARY_CACHE } from "@kolu/surface-remote/agentDerivation.testutil";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { afterAll, describe, expect, it } from "vitest";

const SSH_HOST = process.env.KOLU_E2E_SSH_HOST;
const PADI_DRV = process.env.KOLU_E2E_PADI_DRV;

const enabled =
  SSH_HOST !== undefined &&
  SSH_HOST !== "" &&
  PADI_DRV !== undefined &&
  PADI_DRV !== "";
if (enabled && isLocalHost(SSH_HOST as string)) {
  throw new Error(
    `KOLU_E2E_SSH_HOST=${SSH_HOST} is loopback — that runs padi DIRECTLY (no ssh), a false green. Use a non-loopback alias routing to a real sshd.`,
  );
}
if (enabled && process.env.KOLU_E2E_SSH_DESTRUCTIVE_ACK !== "1") {
  throw new Error(
    `REFUSING: the ssh e2e is DESTRUCTIVE — it will killAll + DRAIN (build-swap) the padi ` +
      `on '${SSH_HOST}', killing its live terminals. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY ` +
      `if '${SSH_HOST}' is a DISPOSABLE test host (a pu box), never a workstation.`,
  );
}
if (enabled) {
  console.warn(
    `[ssh e2e] ⚠️  DESTRUCTIVE against '${SSH_HOST}': will killAll + drain its padi ` +
      `(its terminals WILL be killed). Ctrl-C now if that host is not disposable.`,
  );
}
const describeSsh = enabled ? describe : describe.skip;

const itSelfSsh =
  enabled && process.env.KOLU_E2E_SSH_TWO_BOX !== "1" ? it : it.skip;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function pct(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1] ?? Number.NaN;
}

const encodeProjectPath = (cwd: string): string => cwd.replace(/[/.]/g, "-");

type PadiActiveAgent = NonNullable<
  Extract<PadiTerminal, { state: "active" }>["agent"]
>;

async function currentAgent(
  padi: PadiSurfaceClient,
  id: TerminalId,
): Promise<PadiActiveAgent | null> {
  const rec = await Effect.runPromise(
    firstFrameOrUndefined<PadiTerminal>(
      padi.surface.terminals.get({ key: id }),
    ),
  );
  if (!rec || rec.state !== "active") return null;
  return rec.agent;
}

async function pollAgent(
  padi: PadiSurfaceClient,
  id: TerminalId,
  ok: (a: PadiActiveAgent) => boolean,
  timeoutMs: number,
): Promise<PadiActiveAgent | null> {
  const deadline = Date.now() + timeoutMs;
  let last: PadiActiveAgent | null = null;
  while (Date.now() < deadline) {
    last = await currentAgent(padi, id);
    if (last && ok(last)) return last;
    await sleep(250);
  }
  return last;
}

function procStatFields(pid: number): { ppid: number; pgrp: number } | null {
  let stat: string;
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const afterComm = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  return { ppid: Number(afterComm[1]), pgrp: Number(afterComm[2]) };
}

function foregroundCandidates(pid: number): number[] {
  const out = new Set<number>([pid]);
  const stat = procStatFields(pid);
  if (stat !== null) {
    if (Number.isInteger(stat.ppid) && stat.ppid > 0) out.add(stat.ppid);
    if (Number.isInteger(stat.pgrp) && stat.pgrp > 0) out.add(stat.pgrp);
  }
  return [...out];
}

function findByCmdline(needle: string): number | undefined {
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    let raw: Buffer;
    try {
      raw = fs.readFileSync(`/proc/${name}/cmdline`);
    } catch {
      continue;
    }
    const cmd = raw.toString("utf8").split("\0").filter(Boolean).join(" ");
    if (cmd === needle) return Number(name);
  }
  return undefined;
}

describeSsh("padiSurface consumed over ssh — the W3.1 named path", () => {
  const sessions: { destroy(): void }[] = [];
  const dial = () => {
    const s = makeSession<AgentClient, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector({
        surface: { ...padiSurfaceSibling, group: padiDaemonGroup },
        host: SSH_HOST as string,
        binary: "padi",
        extraArgs: [],
        localEnv: {},
        resolveDrvPath: async () =>
          directAgentDerivation(PADI_DRV as string, TEST_BINARY_CACHE),
      }),
      log: collectLogger((l) => console.log(`[host] ${l}`)),
    });
    sessions.push(s);
    return s;
  };

  const combinedOf = (s: {
    currentDispatch?(): SurfaceDispatch | undefined;
  }): PadiDaemonClient => {
    const dispatch = s.currentDispatch?.();
    if (dispatch === undefined)
      throw new Error("the pinned ssh session exposed no dispatch");
    return padiClientOver(dispatch);
  };

  afterAll(() => {
    for (const s of sessions.splice(0)) s.destroy();
  });

  it("provisions padi over ssh, handshakes the control core, and round-trips a terminal", async () => {
    const session = dial();
    await session.pin();
    const combined = combinedOf(session);
    session.markConnected();

    const hello = await Effect.runPromise(
      combined.control.surface.core.hello(),
    );
    console.log(
      `[ssh] hello: padiSurface=${hello.surfaceVersion} controlCore=${hello.controlCoreVersion} stateRoot=${hello.stateRoot}`,
    );
    expect(
      isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION),
    ).toBe(true);

    const padi = scopePadiSurface(combined);
    const { id } = await Effect.runPromise(
      padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: process.env.HOME,
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const attach = Stream.toAsyncIterable(
      padi.surface.terminalAttach.get({ id }),
    )[Symbol.asyncIterator]();
    const first = await attach.next();
    const firstFrame = first.value as TerminalAttachFrame;
    if (firstFrame.kind !== "snapshot")
      throw new Error(
        `terminalAttach answered "${firstFrame.kind}" where the contract promises a snapshot first`,
      );
    expect(typeof firstFrame.data).toBe("string");

    await Effect.runPromise(
      padi.surface.lifecycle.sendInput({ id, data: "echo SSHMARK\r" }),
    );
    let screen = "";
    for (let i = 0; i < 200 && !screen.includes("SSHMARK"); i++) {
      screen = await Effect.runPromise(padi.surface.screen.state({ id }));
      if (!screen.includes("SSHMARK")) await sleep(50);
    }
    expect(screen).toContain("SSHMARK");
    console.log("[ssh] terminal round-trip OK — echo landed over the ssh leg");

    const invIter = Stream.toAsyncIterable(
      padi.surface.hostInventory.get(undefined),
    )[Symbol.asyncIterator]();
    let inv = (await invIter.next()).value as PadiHostInventory;
    const invDeadline = Date.now() + 25_000;
    while (!inv.padis.some((p) => p.active) && Date.now() < invDeadline) {
      inv = (await invIter.next()).value as PadiHostInventory;
    }
    const activePadi = inv.padis.find((p) => p.active);
    expect(activePadi).toBeDefined();
    expect(inv.kavals.some((k) => k.held.active)).toBe(true);
    console.log(
      `[ssh] hostInventory over the hop: ${inv.kavals.length} kaval(s), ${inv.padis.length} padi(s), active padi socket=${activePadi?.socket}`,
    );
  }, 180_000);

  it("records typing-echo latency over the ssh leg (the W3 reference vs 4.36ms p99 local)", async () => {
    const session = dial();
    await session.pin();
    const combined = combinedOf(session);
    session.markConnected();
    const padi = scopePadiSurface(combined);
    const { id } = await Effect.runPromise(
      padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: process.env.HOME,
      }),
    );

    const iter = Stream.toAsyncIterable(
      padi.surface.terminalAttach.get({ id }),
    )[Symbol.asyncIterator]();
    await iter.next();

    const SAMPLES = Number(process.env.KOLU_BENCH_SAMPLES ?? 60);
    const WARMUP = 5;
    const latencies: number[] = [];
    for (let i = 0; i < SAMPLES + WARMUP; i++) {
      const ch = String.fromCharCode(97 + (i % 26));
      const t0 = process.hrtime.bigint();
      await Effect.runPromise(
        padi.surface.lifecycle.sendInput({ id, data: ch }),
      );

      let seen = false;
      const deadline = Date.now() + 5000;
      while (!seen && Date.now() < deadline) {
        const n = await iter.next();
        if (n.value?.kind === "delta" && n.value.data.includes(ch)) seen = true;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= WARMUP && seen) latencies.push(ms);
      await Effect.runPromise(
        padi.surface.lifecycle.sendInput({ id, data: "\r" }),
      );
      await sleep(10);
    }

    latencies.sort((a, b) => a - b);
    const report = {
      samples: latencies.length,
      p50: pct(latencies, 50).toFixed(2),
      p90: pct(latencies, 90).toFixed(2),
      p99: pct(latencies, 99).toFixed(2),
    };
    console.log(
      `[ssh] typing-echo over ssh — p50=${report.p50}ms p90=${report.p90}ms p99=${report.p99}ms (n=${report.samples}) — W3 reference; local baseline p99 4.36ms (padi-latency-baseline)`,
    );
    expect(latencies.length).toBeGreaterThan(10);
  }, 180_000);

  it("converges across a drain: a drained remote padi respawns and the leg recovers", async () => {
    const session = dial();
    await session.pin();
    let combined = combinedOf(session);
    session.markConnected();
    let padi = scopePadiSurface(combined);

    const helloBefore = await Effect.runPromise(
      combined.control.surface.core.hello(),
    );
    await Effect.runPromise(combined.control.surface.core.drain()).catch(
      () => {},
    );

    let recovered = false;
    const deadline = Date.now() + 60_000;
    while (!recovered && Date.now() < deadline) {
      try {
        const s2 = dial();
        await s2.pin();
        combined = combinedOf(s2);
        s2.markConnected();
        const helloAfter = await Effect.runPromise(
          combined.control.surface.core.hello(),
        );
        console.log(
          `[ssh] post-drain hello: startedAt before=${helloBefore.startedAt} after=${helloAfter.startedAt} (a fresh boot ⇒ respawn; same ⇒ re-adopt)`,
        );
        padi = scopePadiSurface(combined);
        const { id } = await Effect.runPromise(
          padi.surface.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: process.env.HOME,
          }),
        );
        await Effect.runPromise(
          padi.surface.lifecycle.sendInput({
            id,
            data: "echo RECOVERED\r",
          }),
        );
        let screen = "";
        for (let i = 0; i < 100 && !screen.includes("RECOVERED"); i++) {
          screen = await Effect.runPromise(padi.surface.screen.state({ id }));
          if (!screen.includes("RECOVERED")) await sleep(50);
        }
        recovered = screen.includes("RECOVERED");
      } catch {
        await sleep(1000);
      }
    }
    expect(recovered).toBe(true);
    console.log("[ssh] convergence OK — the leg recovered after a drain");
  }, 180_000);

  itSelfSsh(
    "surfaces a LIVE agent-state transition (awaiting_user → waiting) over the ssh leg [self-ssh only]",
    async () => {
      const session = dial();
      await session.pin();
      const combined = combinedOf(session);
      session.markConnected();
      const padi = scopePadiSurface(combined);

      const home = process.env.HOME;
      if (!home)
        throw new Error(
          "HOME unset — cannot locate padi's ~/.claude on the host",
        );
      const sessionsDir = path.join(home, ".claude", "sessions");
      const projectDir = path.join(
        home,
        ".claude",
        "projects",
        encodeProjectPath(home),
      );
      const sessionId = randomUUID();
      const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
      const plantedSessionFiles: string[] = [];
      let createdId: TerminalId | undefined;

      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(projectDir, { recursive: true });

      try {
        const { id } = await Effect.runPromise(
          padi.surface.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: home,
          }),
        );
        createdId = id;

        const sleepSecs = 700000 + Math.floor(Math.random() * 299999);
        const sleepCmd = `sleep ${sleepSecs}`;
        await Effect.runPromise(
          padi.surface.lifecycle.sendInput({ id, data: `${sleepCmd}\r` }),
        );

        let sleepPid: number | undefined;
        const findDeadline = Date.now() + 20_000;
        while (Date.now() < findDeadline && sleepPid === undefined) {
          sleepPid = findByCmdline(sleepCmd);
          if (sleepPid === undefined) await sleep(200);
        }
        if (sleepPid === undefined)
          throw new Error(
            `foreground '${sleepCmd}' never appeared in /proc — the PTY did not run it`,
          );
        await sleep(1500);
        const candidates = foregroundCandidates(sleepPid);
        console.log(
          `[ssh] agent-state fixture: sleepPid=${sleepPid} foreground-pid candidates=${candidates.join(",")}`,
        );

        const askLine = JSON.stringify({
          type: "assistant",
          timestamp: new Date().toISOString(),
          message: {
            stop_reason: "tool_use",
            model: "claude-opus-4-8",
            content: [
              { type: "tool_use", name: "AskUserQuestion", id: "tu_w31" },
            ],
            usage: {
              input_tokens: 1000,
              cache_creation_input_tokens: 2000,
              cache_read_input_tokens: 3000,
            },
          },
        });
        fs.writeFileSync(transcriptPath, `${askLine}\n`);

        const startedAt = Date.now();
        for (const pid of candidates) {
          const p = path.join(sessionsDir, `${pid}.json`);
          fs.writeFileSync(
            p,
            JSON.stringify({ pid: sleepPid, sessionId, cwd: home, startedAt }),
          );
          plantedSessionFiles.push(p);
        }

        const awaiting = await pollAgent(
          padi,
          id,
          (a) => a.kind === "claude-code" && a.state === "awaiting_user",
          60_000,
        );
        console.log(
          `[ssh] agent snapshot #1: kind=${awaiting?.kind} state=${awaiting?.state} contextTokens=${awaiting?.kind === "claude-code" ? awaiting.contextTokens : "n/a"}`,
        );
        expect(awaiting?.kind).toBe("claude-code");
        expect(awaiting?.state).toBe("awaiting_user");
        if (awaiting?.kind !== "claude-code")
          throw new Error("agent is not claude-code");
        const tokensBefore = awaiting.contextTokens;
        expect(tokensBefore).toBe(6000);

        const endTurnLine = JSON.stringify({
          type: "assistant",
          timestamp: new Date().toISOString(),
          message: {
            stop_reason: "end_turn",
            model: "claude-opus-4-8",
            usage: {
              input_tokens: 1000,
              cache_creation_input_tokens: 2000,
              cache_read_input_tokens: 9000,
            },
          },
        });
        fs.appendFileSync(transcriptPath, `${endTurnLine}\n`);

        const waiting = await pollAgent(
          padi,
          id,
          (a) =>
            a.kind === "claude-code" &&
            a.state === "waiting" &&
            a.contextTokens !== tokensBefore,
          60_000,
        );
        console.log(
          `[ssh] agent snapshot #2: kind=${waiting?.kind} state=${waiting?.state} contextTokens=${waiting?.kind === "claude-code" ? waiting.contextTokens : "n/a"}`,
        );
        expect(waiting?.kind).toBe("claude-code");
        expect(waiting?.state).toBe("waiting");
        if (waiting?.kind !== "claude-code")
          throw new Error("agent is not claude-code after mutation");
        expect(waiting.contextTokens).toBe(12000);
        expect(waiting.contextTokens).not.toBe(tokensBefore);
        console.log(
          `[ssh] agent-state transition OK over ssh — awaiting_user(${tokensBefore}) → waiting(${waiting.contextTokens})`,
        );
      } finally {
        if (createdId !== undefined)
          await Effect.runPromise(
            padi.surface.lifecycle.kill({ id: createdId }),
          ).catch(() => {});
        for (const p of plantedSessionFiles) fs.rmSync(p, { force: true });
        fs.rmSync(transcriptPath, { force: true });
      }
    },
    180_000,
  );

  itSelfSsh(
    "serves real file bytes over the ssh leg — text + binary, byte-exact, range-capable [self-ssh only]",
    async () => {
      const session = dial();
      await session.pin();
      const combined = combinedOf(session);
      session.markConnected();
      const padi = scopePadiSurface(combined);

      const tmpRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "kolu-ssh-preview-"),
      );
      try {
        const text = "hello over ssh\nline two\n";
        const blob = Buffer.from(
          Array.from({ length: 512 }, (_, i) => i % 256),
        );
        fs.writeFileSync(path.join(tmpRoot, "hello.txt"), text);
        fs.writeFileSync(path.join(tmpRoot, "blob.png"), blob);

        const t = await Effect.runPromise(
          padi.surface.preview.read({
            repoPath: tmpRoot,
            filePath: "hello.txt",
          }),
        );
        expect(t.status).toBe(200);
        const textCt = Object.entries(t.headers).find(
          ([k]) => k.toLowerCase() === "content-type",
        )?.[1];
        expect(textCt).toMatch(/^text\//);
        expect(Buffer.from(t.bodyBase64, "base64").toString("utf8")).toBe(text);
        console.log(
          `[ssh] preview text OK over the hop — ${text.length} bytes, ct=${textCt}`,
        );

        const b = await Effect.runPromise(
          padi.surface.preview.read({
            repoPath: tmpRoot,
            filePath: "blob.png",
          }),
        );
        expect(b.status).toBe(200);
        const blobCt = Object.entries(b.headers).find(
          ([k]) => k.toLowerCase() === "content-type",
        )?.[1];
        expect(blobCt).toBe("image/png");
        const got = Buffer.from(b.bodyBase64, "base64");
        expect(got.byteLength).toBe(blob.byteLength);
        expect(Buffer.compare(got, blob)).toBe(0);
        console.log(
          `[ssh] preview binary OK over the hop — ${got.byteLength} bytes byte-exact, ct=${blobCt}`,
        );

        const r = await Effect.runPromise(
          padi.surface.preview.read({
            repoPath: tmpRoot,
            filePath: "blob.png",
            range: "bytes=100-163",
          }),
        );
        expect(r.status).toBe(206);
        const cr = Object.entries(r.headers).find(
          ([k]) => k.toLowerCase() === "content-range",
        )?.[1];
        expect(cr).toBe("bytes 100-163/512");
        const slice = Buffer.from(r.bodyBase64, "base64");
        expect(slice.byteLength).toBe(64);
        expect(Buffer.compare(slice, blob.subarray(100, 164))).toBe(0);
        console.log(
          `[ssh] preview 206 range OK over the hop — ${cr}, 64 bytes byte-exact`,
        );
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
