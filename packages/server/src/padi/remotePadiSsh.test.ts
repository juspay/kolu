/**
 * The ssh-leg e2e — `padiSurface` consumed over a REAL ssh hop (W3.1's named path).
 *
 * No local shortcut satisfies W3.1: this drives the exact stack a `KOLU_PADI_HOST`
 * binding rides — `getHostSession({ binary: "padi" })` (which runs the binary as
 * `padi --stdio` itself via `buildAgentCommand`) provisions padi's closure to the host
 * with Nix, runs `ssh <host> padi --stdio`
 * (fronting padi's durable daemon via `frontDaemonOverStdio`), and speaks the
 * combined `padiDaemonContract` over the ssh byte channel. It then handshakes the
 * frozen control core and round-trips a terminal, measures typing-echo latency over
 * the leg (the W3 reference), and proves adopt-or-respawn convergence across a drain.
 *
 * GUARDED: skipped unless the environment names a REAL non-loopback ssh host AND the
 * padi `.drv` to provision. A loopback host (`localhost`/`127.0.0.1`/`::1`) is a
 * FALSE green — `isLocalHost` runs the binary directly, no ssh — so this test
 * refuses those and demands an alias that routes to a real sshd:
 *
 *   KOLU_E2E_SSH_HOST   an ssh host/alias (NOT loopback) reaching a real sshd whose
 *                       user's Nix store this test can `nix copy` into.
 *   KOLU_E2E_PADI_DRV   the padi `.drv` to provision (e.g. `nix-instantiate .#padi`).
 *
 * Run on a `pu` box (or any host with a self-alias to its own sshd), never in the
 * from-source unit lane. Its transcript is W3.1's recorded pu-box evidence.
 *
 * TURNKEY: `just e2e-ssh` on a pu box builds the padi `.drv`, auto-picks the box's own
 * non-loopback 10.x IPv4, sets both env vars, and runs this suite. CI has NO ssh lane
 * (no sshd in the build sandbox), so THIS recipe is the only enforced run of the ssh
 * leg — deliberately, and noted as such in the PR (no silent coverage cap).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type PadiDaemonClient,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
  type PadiHostInventory,
  type PadiTerminal,
} from "@kolu/padi/surface";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import {
  isLocalHost,
  makeSession,
  type SshProv,
  sshConnector,
} from "@kolu/surface-remote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterAll, describe, expect, it } from "vitest";

const SSH_HOST = process.env.KOLU_E2E_SSH_HOST;
const PADI_DRV = process.env.KOLU_E2E_PADI_DRV;

// Guard: a real, non-loopback ssh host + a padi drv, or the whole suite skips. A
// loopback host would silently exercise the NON-ssh direct path — refuse it loudly.
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
// DESTRUCTIVE-ACK guard: this suite killAll's + DRAINS (swaps the build of) the padi on
// `KOLU_E2E_SSH_HOST` — it kills that host's terminals. Refuse LOUDLY without an explicit
// ack so a mistyped host can't murder a workstation's live terminals; the ack must be a
// conscious "yes, this host is disposable". Print a pre-flight naming exactly what dies.
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

// The agent-state test is SELF-SSH-ONLY: it plants fixtures in THIS box's $HOME/.claude
// and resolves the terminal's foreground pid from THIS box's /proc — valid only when padi
// runs on this box (SSH_HOST == the box's own IP). In two-box mode (KOLU_E2E_SSH_TWO_BOX=1,
// set by `just e2e-ssh-2box`) padi runs on the OTHER host, so it CANNOT match and must
// skip; the ssh TRANSPORT it exercises is already covered by the round-trip / latency /
// drain-converge tests, which are two-box-safe.
const itSelfSsh =
  enabled && process.env.KOLU_E2E_SSH_TWO_BOX !== "1" ? it : it.skip;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** nearest-rank percentile over sorted-ascending samples. */
function pct(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1] ?? Number.NaN;
}

// ── Agent-state (Padi/Dock) fixtures for the live-transition assertion ──────
//
// The claude adapter (running IN the remote padi over the ssh leg) reads
// `~/.claude/{sessions,projects}` on the host where padi runs, with no
// KOLU_CLAUDE_SESSIONS_DIR set. This suite's SELF-SSH binding means padi runs on
// THIS box, so the test writes those fixtures to THIS box's `$HOME/.claude`
// directly and the padi picks them up over its own fs.watch — no cross-host copy.
// The shapes below MATCH the code exactly (verified against
// `packages/integrations/claude-code/src/core.ts`):
//   - a session file `~/.claude/sessions/{fgpid}.json` = `{pid, sessionId, cwd,
//     startedAt}` (`readSessionFile`), matched by the terminal's FOREGROUND pid;
//   - a transcript `~/.claude/projects/<enc(cwd)>/<sessionId>.jsonl` whose NEWEST
//     entry sets the state (`deriveState`): an assistant `tool_use` whose only
//     pending tool is `AskUserQuestion` → `awaiting_user`; an assistant `end_turn`
//     → `waiting`; `message.usage` (input + cache_creation + cache_read) → the
//     running `contextTokens`.

/** Claude's project-dir key for a cwd — `encodeProjectPath` in core.ts
 *  (`cwd.replace(/[/.]/g, "-")`). Inlined (not imported) so this server test does
 *  not pull the claude package's Agent-SDK evaluation just for a one-liner. */
const encodeProjectPath = (cwd: string): string => cwd.replace(/[/.]/g, "-");

/** The active-arm agent value the `terminals` collection carries — the claude
 *  info union member (`kind: "claude-code"`, `state`, `contextTokens`, …). */
type PadiActiveAgent = NonNullable<
  Extract<PadiTerminal, { state: "active" }>["agent"]
>;

/** Read the terminal's CURRENT composed record off the `terminals` collection —
 *  each `get` opens a snapshot-then-delta stream whose first frame is the live
 *  value (the surface snapshot contract), so re-subscribing per poll reads fresh.
 *  Returns the live agent when the record is active, else null. */
async function currentAgent(
  padi: PadiSurfaceClient,
  id: TerminalId,
): Promise<PadiActiveAgent | null> {
  const rec = await firstFrameOrUndefined<PadiTerminal>(
    await padi.surface.terminals.get({ key: id }),
  );
  if (!rec || rec.state !== "active") return null;
  return rec.agent;
}

/** Poll the terminal's agent value until `ok` holds (agent-state resolution is
 *  async), bounded by `timeoutMs`. Returns the matched agent, or the last one
 *  seen for a diagnostic assertion when the deadline passes. */
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

/** Every candidate pid a kaval `tcgetpgrp` foreground sample could report for a
 *  foreground command: the process itself, its process-group leader (`pgrp` — what
 *  `tcgetpgrp` returns under interactive job control), and its parent shell
 *  (`ppid` — the fallback if job control is off and the shell stays the foreground
 *  group). Read from `/proc/<pid>/stat`, whose `comm` field can contain spaces and
 *  parens, so the numeric fields are parsed AFTER the last ')'. Planting the
 *  session file under every candidate makes the match robust to which one the
 *  daemon actually reports. */
function foregroundCandidates(pid: number): number[] {
  const out = new Set<number>([pid]);
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    // rest = [state, ppid, pgrp, session, …]
    const ppid = Number(rest[1]);
    const pgrp = Number(rest[2]);
    if (Number.isInteger(ppid) && ppid > 0) out.add(ppid);
    if (Number.isInteger(pgrp) && pgrp > 0) out.add(pgrp);
  } catch {
    // /proc entry vanished — the sole-pid candidate stands.
  }
  return [...out];
}

/** Find a process on THIS box (padi's host == the test's host, one PID namespace)
 *  whose full cmdline exactly equals `needle`. Used to resolve the foreground
 *  `sleep`'s pid — the pid the claude adapter keys its session lookup on. */
function findByCmdline(needle: string): number | undefined {
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    let raw: Buffer;
    try {
      raw = fs.readFileSync(`/proc/${name}/cmdline`);
    } catch {
      continue; // process exited between readdir and read
    }
    const cmd = raw.toString("utf8").split("\0").filter(Boolean).join(" ");
    if (cmd === needle) return Number(name);
  }
  return undefined;
}

describeSsh("padiSurface consumed over ssh — the W3.1 named path", () => {
  const sessions: { destroy(): void }[] = [];
  const dial = () => {
    // Post-S9 "a session over ssh" is `makeSession({ connectOnce: sshConnector(...) })`
    // (the deleted `getHostSession` pool). Each `dial()` OWNS its fresh session — the
    // convergence test's re-dial after a drain gets a genuinely new one, exactly as the
    // old pooled `getHostSession` handed back a fresh session once the pooled link died.
    const s = makeSession<PadiDaemonClient, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector<PadiDaemonContract>({
        host: SSH_HOST as string,
        binary: "padi",
        // `buildAgentCommand` already runs the binary as `padi --stdio` (host.ts) and
        // appends extraArgs AFTER it — so extraArgs must NOT re-pass `--stdio`.
        extraArgs: [],
        resolveDrvPath: async () => PADI_DRV as string,
      }),
      onLog: (line) => console.log(`[host] ${line}`),
    });
    sessions.push(s);
    return s;
  };

  afterAll(() => {
    for (const s of sessions.splice(0)) s.destroy();
  });

  it("provisions padi over ssh, handshakes the control core, and round-trips a terminal", async () => {
    const session = dial();
    // pin() runs resolveDrvPath → provisionAgent (nix copy --derivation + realise)
    // → ssh <host> padi --stdio → stdioLink. The remote padi (and its kaval) is
    // durable behind the front.
    const combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();

    const hello = await combined.surface.control.core.hello();
    console.log(
      `[ssh] hello: padiSurface=${hello.surfaceVersion} controlCore=${hello.controlCoreVersion} stateRoot=${hello.stateRoot}`,
    );
    expect(
      isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION),
    ).toBe(true);

    const padi = scopePadiSurface(combined);
    const { id } = await padi.surface.lifecycle.create({
      cwd: process.env.HOME,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // terminalAttach's first frame is the snapshot, relayed straight over ssh.
    const attach = (await padi.surface.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    const first = await attach.next();
    const firstFrame = first.value as TerminalAttachFrame;
    expect(firstFrame.kind).toBe("snapshot");
    expect(typeof firstFrame.data).toBe("string");

    await padi.surface.lifecycle.sendInput({ id, data: "echo SSHMARK\r" });
    let screen = "";
    for (let i = 0; i < 200 && !screen.includes("SSHMARK"); i++) {
      screen = await padi.surface.screen.state({ id });
      if (!screen.includes("SSHMARK")) await sleep(50);
    }
    expect(screen).toContain("SSHMARK");
    console.log("[ssh] terminal round-trip OK — echo landed over the ssh leg");

    // W3.2 — the `hostInventory` member answers over the REAL hop: the remote padi's
    // scan of its OWN host, re-served across ssh. This is what powers the dialog's
    // bound-host "Running daemons" list under a remote binding (before W3.2 it could
    // only ever show the machine kolu-server runs on). The cell subscription replays the
    // current value, then a frame per sample — iterate until the serving padi has marked
    // itself active (the sampler's T+0 anchor may precede the held kaval connecting).
    const invIter = (await padi.surface.hostInventory.get({}))[
      Symbol.asyncIterator
    ]();
    let inv = (await invIter.next()).value as PadiHostInventory;
    const invDeadline = Date.now() + 25_000; // spans two 10s sample intervals
    while (!inv.padis.some((p) => p.active) && Date.now() < invDeadline) {
      inv = (await invIter.next()).value as PadiHostInventory;
    }
    // The serving padi marks ITSELF active — the remote host's own scan re-served over
    // the hop, not kolu-server's local machine. (Its contract version now rides
    // `daemonInventory.boundPadi`, not this row.)
    const activePadi = inv.padis.find((p) => p.active);
    expect(activePadi).toBeDefined();
    // The kaval it holds is discovered + probed on the remote host (we just ran a
    // terminal there), and marked active — the "in use by kolu" row.
    expect(inv.kavals.some((k) => k.held.active)).toBe(true);
    console.log(
      `[ssh] hostInventory over the hop: ${inv.kavals.length} kaval(s), ${inv.padis.length} padi(s), active padi socket=${activePadi?.socket}`,
    );
  }, 180_000);

  it("records typing-echo latency over the ssh leg (the W3 reference vs 4.36ms p99 local)", async () => {
    const session = dial();
    const combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();
    const padi = scopePadiSurface(combined);
    const { id } = await padi.surface.lifecycle.create({
      cwd: process.env.HOME,
    });

    // Subscribe attach; skip the snapshot (frame 1). Each keystroke: clock at
    // sendInput, stop when the echoed char first appears in a delta.
    const iter = (await padi.surface.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    await iter.next(); // snapshot

    const SAMPLES = Number(process.env.KOLU_BENCH_SAMPLES ?? 60);
    const WARMUP = 5;
    const latencies: number[] = [];
    for (let i = 0; i < SAMPLES + WARMUP; i++) {
      const ch = String.fromCharCode(97 + (i % 26)); // a..z, echoed by the shell
      const t0 = process.hrtime.bigint();
      await padi.surface.lifecycle.sendInput({ id, data: ch });
      // Read deltas until the echoed char appears.
      let seen = false;
      const deadline = Date.now() + 5000;
      while (!seen && Date.now() < deadline) {
        const n = await iter.next();
        if (typeof n.value === "string" && n.value.includes(ch)) seen = true;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= WARMUP && seen) latencies.push(ms);
      await padi.surface.lifecycle.sendInput({ id, data: "\r" }); // clear the line buffer
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
    // No gate — network-dependent by design; just prove we measured real samples.
    expect(latencies.length).toBeGreaterThan(10);
  }, 180_000);

  it("converges across a drain: a drained remote padi respawns and the leg recovers", async () => {
    const session = dial();
    let combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();
    let padi = scopePadiSurface(combined);

    const helloBefore = await combined.surface.control.core.hello();
    // Drain the remote padi over the frozen control core (persist + exit; its kaval
    // + PTYs survive). The front's relay ends → the HostSession reconnects and
    // frontDaemonOverStdio respawns/re-adopts padi.
    await combined.surface.control.core.drain().catch(() => {
      // The link tears down mid-response — expected.
    });

    // Re-dial a FRESH spawn (a new getHostSession session — the pooled one saw its
    // link die). Poll until the control core answers again and a terminal works.
    let recovered = false;
    const deadline = Date.now() + 60_000;
    while (!recovered && Date.now() < deadline) {
      try {
        const s2 = dial();
        combined = (await s2.pin()) as PadiDaemonClient;
        s2.markConnected();
        const helloAfter = await combined.surface.control.core.hello();
        console.log(
          `[ssh] post-drain hello: startedAt before=${helloBefore.startedAt} after=${helloAfter.startedAt} (a fresh boot ⇒ respawn; same ⇒ re-adopt)`,
        );
        padi = scopePadiSurface(combined);
        const { id } = await padi.surface.lifecycle.create({
          cwd: process.env.HOME,
        });
        await padi.surface.lifecycle.sendInput({
          id,
          data: "echo RECOVERED\r",
        });
        let screen = "";
        for (let i = 0; i < 100 && !screen.includes("RECOVERED"); i++) {
          screen = await padi.surface.screen.state({ id });
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
      // FINDING 2's enforced coverage: prove the agent-state (Padi/Dock) pipeline
      // works over a REAL ssh binding, pinning a LIVE TRANSITION on disk — not just
      // first-snapshot presence. padi runs `startSensors` in-process on THIS box;
      // its claude adapter reads `~/.claude/{sessions,projects}` HERE (no
      // KOLU_CLAUDE_SESSIONS_DIR set). We drive a terminal's foreground to a known
      // `sleep`, plant the session file keyed on that foreground pid + an
      // AskUserQuestion transcript (→ awaiting_user), then MUTATE the transcript to
      // an assistant `end_turn` with a bumped token usage (→ waiting) and assert the
      // SAME `terminals` record transitions state AND its contextTokens changes.
      const session = dial();
      const combined = (await session.pin()) as PadiDaemonClient;
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

      // Pre-create the claude dirs so the adapter's `externalChanges.isPresent`
      // (`fs.existsSync(SESSIONS_DIR)`) holds on the sensor's FIRST reconcile and it
      // installs its SESSIONS_DIR watcher — so a session file planted LATER fires
      // that watcher and re-resolves. (A pre-existing real ~/.claude on the box only
      // helps this.)
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(projectDir, { recursive: true });

      try {
        const { id } = await padi.surface.lifecycle.create({ cwd: home });
        createdId = id;

        // Drive the foreground to a known long-running `sleep` — a stable, non-shell
        // foreground process group the claude adapter can key its session lookup on
        // (`resolveSession` matches by the terminal's FOREGROUND pid). A unique
        // duration makes the process findable in /proc by its exact cmdline.
        const sleepSecs = 700000 + Math.floor(Math.random() * 299999);
        const sleepCmd = `sleep ${sleepSecs}`;
        await padi.surface.lifecycle.sendInput({ id, data: `${sleepCmd}\r` });

        // Resolve the sleep's pid (== the foreground pid the daemon reports). Poll
        // until it appears — the shell needs a beat to exec it.
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
        // Let kaval's post-preexec foreground-sample burst capture the sleep before
        // we plant, so the reconcile that the plant triggers sees the sleep pid.
        await sleep(1500);
        const candidates = foregroundCandidates(sleepPid);
        console.log(
          `[ssh] agent-state fixture: sleepPid=${sleepPid} foreground-pid candidates=${candidates.join(",")}`,
        );

        // 1) Plant the AskUserQuestion transcript FIRST (so the watcher, once the
        // session file lands, finds it immediately), then the session file(s). The
        // newest entry is an assistant `tool_use` whose only pending tool is
        // AskUserQuestion → `deriveState` → awaiting_user; its usage sums to 6000.
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

        // Every candidate file carries the SAME `pid` field (a stable sessionKey =
        // `${sessionId}:${pid}:${startedAt}`), so whichever candidate the daemon's
        // foreground pid matches resolves to one identical session (no watcher
        // churn). cwd MUST equal the terminal's cwd so `findTranscriptPath` resolves
        // the transcript above.
        const startedAt = Date.now();
        for (const pid of candidates) {
          const p = path.join(sessionsDir, `${pid}.json`);
          fs.writeFileSync(
            p,
            JSON.stringify({ pid: sleepPid, sessionId, cwd: home, startedAt }),
          );
          plantedSessionFiles.push(p);
        }

        // Assert the FIRST snapshot: agent resolves to claude-code / awaiting_user.
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
        // Narrow to claude-code for the token read (the load-bearing baseline).
        if (awaiting?.kind !== "claude-code")
          throw new Error("agent is not claude-code");
        const tokensBefore = awaiting.contextTokens;
        expect(tokensBefore).toBe(6000);

        // 2) MUTATE the transcript on disk: append an assistant `end_turn` (→
        // waiting) whose usage sums to 12000 (a bumped contextTokens). Appending
        // makes it the NEWEST entry `deriveState` reads and fires the transcript
        // fs.watch → re-derive. The awaiting_user→waiting demote rides the adapter's
        // screen-scrape self-demote (the raw waiting emit is deferred to the ~1s
        // poll, which re-confirms no on-screen prompt over the bash/sleep screen and
        // republishes the raw `waiting`), so give it a generous deadline.
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
        // The LIVE delta — a first-snapshot-only check is explicitly insufficient.
        expect(waiting.contextTokens).toBe(12000);
        expect(waiting.contextTokens).not.toBe(tokensBefore);
        console.log(
          `[ssh] agent-state transition OK over ssh — awaiting_user(${tokensBefore}) → waiting(${waiting.contextTokens})`,
        );
      } finally {
        // Tear down the fixture: kill the terminal (its shell + the child sleep die
        // with it) and remove the planted session files + transcript.
        if (createdId !== undefined)
          await padi.surface.lifecycle.kill({ id: createdId }).catch(() => {});
        for (const p of plantedSessionFiles) {
          try {
            fs.rmSync(p, { force: true });
          } catch {
            /* best-effort cleanup */
          }
        }
        try {
          fs.rmSync(transcriptPath, { force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    },
    180_000,
  );

  itSelfSsh(
    "serves real file bytes over the ssh leg — text + binary, byte-exact, range-capable [self-ssh only]",
    async () => {
      // W3.2 PR "preview": the iframe preview route serves a remotely-bound file by
      // dialing `padiSurface.preview.read` over the binding (the old 501 is gone).
      // This proves that procedure forwards over a REAL ssh hop and returns the
      // file's exact bytes + honest headers — the wire leg the in-process unit tests
      // (`iframePreviewRoute.test.ts`) can't cover. SELF-SSH: padi runs on THIS box,
      // so the fixtures live on this box's disk (the same disk padi reads); a two-box
      // binding can't reach them, hence the self-ssh gate.
      const session = dial();
      const combined = (await session.pin()) as PadiDaemonClient;
      session.markConnected();
      const padi = scopePadiSurface(combined);

      const tmpRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "kolu-ssh-preview-"),
      );
      try {
        const text = "hello over ssh\nline two\n";
        // 512 bytes spanning every byte value (incl. high/non-UTF8 bytes), so a
        // base64 corruption on the wire would surface as a byte mismatch.
        const blob = Buffer.from(
          Array.from({ length: 512 }, (_, i) => i % 256),
        );
        fs.writeFileSync(path.join(tmpRoot, "hello.txt"), text);
        fs.writeFileSync(path.join(tmpRoot, "blob.png"), blob);

        // TEXT — whole-file 200, real text/* Content-Type, exact bytes over the hop.
        const t = await padi.surface.preview.read({
          repoPath: tmpRoot,
          filePath: "hello.txt",
        });
        expect(t.status).toBe(200);
        const textCt = Object.entries(t.headers).find(
          ([k]) => k.toLowerCase() === "content-type",
        )?.[1];
        expect(textCt).toMatch(/^text\//);
        expect(Buffer.from(t.bodyBase64, "base64").toString("utf8")).toBe(text);
        console.log(
          `[ssh] preview text OK over the hop — ${text.length} bytes, ct=${textCt}`,
        );

        // BINARY — whole-file 200, image/png, byte-exact round trip.
        const b = await padi.surface.preview.read({
          repoPath: tmpRoot,
          filePath: "blob.png",
        });
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

        // RANGE-CAPABLE — a bounded 206 (what the chunk loop drives) survives the
        // wire with its Content-Range + exact slice, so a `<video>` seek and the
        // route's chunked assembly both work remotely.
        const r = await padi.surface.preview.read({
          repoPath: tmpRoot,
          filePath: "blob.png",
          range: "bytes=100-163",
        });
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
