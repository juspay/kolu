/**
 * Typing-echo latency probe — the padi W1 baseline (owed by #1652, required
 * before W2.2 starts; see `docs/atlas/src/content/atlas/padi-latency-baseline.mdx`).
 *
 * WHAT IT MEASURES — the round-trip a single keystroke takes through the REAL
 * stack, entirely on **kolu-server's websocket wire** (`/rpc/ws`):
 *
 *     t0  ── lifecycle.sendInput({id, data: <char>})  (RPC dispatched from the client)
 *            │  kolu-server → kaval → PTY line discipline echoes the char → kaval →
 *            │  kolu-server → padiSurface.terminalAttach delta
 *     t1  ── the echoed char first appears in a `terminalAttach` delta frame
 *
 * latency = t1 − t0, both clocks read by THIS process (`process.hrtime.bigint()`),
 * so the number is a self-consistent monotonic delta — absolute skew is irrelevant.
 *
 * WHY BOTH CLOCK POINTS ARE ON KOLU-SERVER'S WIRE (not kaval's socket): W2.2
 * inserts the padi process BETWEEN kolu-server and kaval. A probe that dialled
 * kaval's unix socket directly would bypass the very hop W2.2 adds and report a
 * fake zero delta. Measuring `sendInput` → `terminalAttach` over kolu-server's
 * `/rpc/ws` puts both endpoints on the near side of the new hop, so W2.2 re-running
 * this IDENTICAL probe measures the added cost honestly (done-criterion (e): < 5ms
 * added p99 vs this baseline).
 *
 * The probe is a pure CLIENT: it connects to an already-running server (port via
 * `KOLU_BENCH_PORT`). `bench/run.sh` boots a private, nix-built kolu and invokes it;
 * re-run the whole thing with `just bench-typing-echo`.
 *
 * Config (env):
 *   KOLU_BENCH_PORT       server port (required)
 *   KOLU_BENCH_HOST       server host (default 127.0.0.1)
 *   KOLU_BENCH_TERMINALS  distinct terminals to spread samples over (default 5)
 *   KOLU_BENCH_SAMPLES    measured keystrokes per terminal (default 250)
 *   KOLU_BENCH_WARMUP     warmup keystrokes per terminal, discarded (default 50)
 *   KOLU_BENCH_TIMEOUT_MS per-keystroke echo timeout — fail loud (default 5000)
 *   KOLU_BENCH_INTERKEY_MS pacing gap between keystrokes, ms (default 2)
 *   KOLU_BENCH_OUT        write full JSON (incl. raw samples) to this path
 */

import fs from "node:fs";
import os from "node:os";
import { websocketLink } from "@kolu/surface/links/websocket";

// ── Config ────────────────────────────────────────────────────────────────
const HOST = process.env.KOLU_BENCH_HOST ?? "127.0.0.1";
const PORT = requireEnvInt("KOLU_BENCH_PORT");
const TERMINALS = envInt("KOLU_BENCH_TERMINALS", 5);
const SAMPLES = envInt("KOLU_BENCH_SAMPLES", 250);
const WARMUP = envInt("KOLU_BENCH_WARMUP", 50);
const TIMEOUT_MS = envInt("KOLU_BENCH_TIMEOUT_MS", 5000);
const INTERKEY_MS = envInt("KOLU_BENCH_INTERKEY_MS", 2);
const OUT = process.env.KOLU_BENCH_OUT;

// Rotating printable marker chars — a shell's readline echoes each typed
// character verbatim (raw-mode echo), so the char itself always appears in the
// echo frame. Rotating guards against matching a straggler from a prior key
// (the loop is serial, so there is never one outstanding — belt and braces).
const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BACKSPACE = "\x7f"; // DEL — readline erases the char, keeping the line ~1 wide

// ── The minimal slice of padiSurface this probe drives (typed, no `any`) ────
interface TerminalInfo {
  id: string;
  pid: number;
}
interface PadiWire {
  surface: {
    padi: {
      lifecycle: {
        create(input: { cwd?: string }): Promise<TerminalInfo>;
        kill(input: { id: string }): Promise<TerminalInfo>;
        killAll(input: Record<string, never>): Promise<void>;
        sendInput(input: { id: string; data: string }): Promise<void>;
      };
      terminalAttach: {
        get(
          input: { id: string },
          opts: { signal: AbortSignal },
        ): Promise<AsyncIterable<string>>;
      };
    };
  };
}

async function main(): Promise<void> {
  const url = `ws://${HOST}:${PORT}/rpc/ws`;
  const socket = new WebSocket(url);
  await openSocket(socket, url);
  const client = websocketLink(
    socket as unknown as Parameters<typeof websocketLink>[0],
  ) as unknown as PadiWire;
  const padi = client.surface.padi;

  const samplesMs: number[] = [];
  try {
    for (let term = 0; term < TERMINALS; term++) {
      const { id } = await padi.lifecycle.create({});
      const attach = new AttachReader();
      const abort = new AbortController();
      const iter = await padi.terminalAttach.get(
        { id },
        { signal: abort.signal },
      );
      const pump = attach.pump(iter);
      await attach.snapshotReady; // first frame is the screen snapshot — skip it

      let charIdx = 0;
      const total = WARMUP + SAMPLES;
      for (let k = 0; k < total; k++) {
        const ch = ALPHABET[charIdx++ % ALPHABET.length];
        const seen = attach.expect(ch);
        const t0 = process.hrtime.bigint();
        await padi.lifecycle.sendInput({ id, data: ch });
        const t1 = await withTimeout(seen, TIMEOUT_MS, ch, term, k);
        if (k >= WARMUP) samplesMs.push(Number(t1 - t0) / 1e6);
        // Housekeeping (not measured): erase the char so the readline buffer
        // stays ~1 wide and long-line redraws never pollute later samples.
        await padi.lifecycle.sendInput({ id, data: BACKSPACE });
        if (INTERKEY_MS > 0) await sleep(INTERKEY_MS);
      }

      abort.abort();
      await pump.catch(() => {});
      await padi.lifecycle.kill({ id }).catch(() => {});
      process.stderr.write(
        `terminal ${term + 1}/${TERMINALS}: ${SAMPLES} samples collected\n`,
      );
    }
  } finally {
    await padi.lifecycle.killAll({}).catch(() => {});
    socket.close();
  }

  report(samplesMs);
}

/** Reads the attach stream and resolves a waiter when the expected char echoes. */
class AttachReader {
  readonly snapshotReady: Promise<void>;
  private markSnapshot!: () => void;
  private pending: { ch: string; resolve: (t: bigint) => void } | null = null;

  constructor() {
    this.snapshotReady = new Promise((r) => {
      this.markSnapshot = r;
    });
  }

  /** Register the char to watch for; returns a promise of its arrival hrtime. */
  expect(ch: string): Promise<bigint> {
    return new Promise((resolve) => {
      this.pending = { ch, resolve };
    });
  }

  async pump(iter: AsyncIterable<string>): Promise<void> {
    let sawSnapshot = false;
    for await (const frame of iter) {
      const at = process.hrtime.bigint();
      if (!sawSnapshot) {
        sawSnapshot = true;
        this.markSnapshot();
        continue; // frame #1 is the scrollback snapshot, never a keystroke echo
      }
      const p = this.pending;
      if (p && frame.includes(p.ch)) {
        this.pending = null;
        p.resolve(at);
      }
    }
  }
}

// ── Stats + reporting ───────────────────────────────────────────────────────
/** Nearest-rank percentile on an ascending-sorted array: the value at rank
 *  ceil(p/100 · n). Deterministic and interpolation-free, so W2.2 compares
 *  like for like. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1];
}

function report(samplesMs: number[]): void {
  if (samplesMs.length === 0) throw new Error("bench collected zero samples");
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const result = {
    measurement: "typing-echo-latency",
    unit: "ms",
    clock: {
      start: "lifecycle.sendInput dispatched on kolu-server /rpc/ws",
      stop: "echoed char first seen in padiSurface.terminalAttach delta",
      note: "both clock points on kolu-server's websocket, near side of the hop padi (W2.2) inserts",
    },
    config: {
      host: HOST,
      port: PORT,
      terminals: TERMINALS,
      samplesPerTerminal: SAMPLES,
      warmupPerTerminal: WARMUP,
      interKeyMs: INTERKEY_MS,
    },
    env: {
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      hostname: os.hostname(),
    },
    samples: sorted.length,
    ms: {
      min: round(sorted[0]),
      p50: round(percentile(sorted, 50)),
      p90: round(percentile(sorted, 90)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted[sorted.length - 1]),
      mean: round(sum / sorted.length),
    },
    rawMs: sorted.map(round),
  };

  const { ms } = result;
  process.stderr.write(
    `\ntyping-echo latency over ${sorted.length} keystrokes (ms):\n` +
      `  p50=${ms.p50}  p90=${ms.p90}  p95=${ms.p95}  p99=${ms.p99}  (min=${ms.min} max=${ms.max} mean=${ms.mean})\n\n`,
  );
  const json = JSON.stringify(result, null, 2);
  if (OUT) {
    fs.writeFileSync(OUT, json);
    process.stderr.write(`wrote ${OUT}\n`);
  }
  process.stdout.write(`${json}\n`);
}

// ── Small helpers ────────────────────────────────────────────────────────────
function openSocket(socket: WebSocket, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(`websocket failed to open: ${url}`)),
      { once: true },
    );
  });
}

function withTimeout(
  p: Promise<bigint>,
  ms: number,
  ch: string,
  term: number,
  k: number,
): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `no echo of ${JSON.stringify(ch)} within ${ms}ms (terminal ${term}, keystroke ${k})`,
        ),
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got ${raw}`);
  return n;
}

function requireEnvInt(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") throw new Error(`${name} is required`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got ${raw}`);
  return n;
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
