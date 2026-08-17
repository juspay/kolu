/**
 * The e2e fixture's own input fold, probed where a real PTY is cruellest: at the
 * chunk boundary.
 *
 * `submit.e2e.test.ts` leans on `mockAgentTui.mjs` to tell the truth about what a
 * driven TUI received — every one of its assertions reads a `<<SUBMITTED:…>>`
 * line the fixture printed. A fixture that mangles its input is therefore not a
 * flaky test, it is a WRONG one: it would report a message nobody sent. stdin
 * from a pty arrives in whatever chunks the kernel felt like, so the fold has to
 * survive a bracketed-paste marker split anywhere inside it.
 *
 * ONE process, many payloads: the fixture is spawned once and fed the same
 * marker-bearing payload split at EVERY index, each carrying its own ordinal so a
 * mangled one is identified rather than merely counted. Exhaustive over 2-way
 * splits, plus the byte-at-a-time extreme, which is every split at once.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const MOCK_TUI = resolve(SRC, "../test-fixtures/mockAgentTui.mjs");

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** A multi-line brief, wrapped the way the shared send policy wraps one, plus
 *  the bare CR that submits it — the exact byte sequence a `submit: true` puts on
 *  the wire. `n` rides in the body so a mangled payload names itself. */
const payload = (n: number): { bytes: string; body: string } => {
  const body = `brief ${n}\nsecond line ${n}`;
  return { bytes: `${PASTE_START}${body}${PASTE_END}\r`, body };
};

/** Every message the fixture announced as submitted, in order. */
const submitted = (out: string): string[] =>
  [...out.matchAll(/<<SUBMITTED:(.*?)>>/g)].map((m) =>
    JSON.parse(m[1] ?? '""'),
  );

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Feed `chunks` to a single fixture process and collect everything it wrote —
 *  the raw stream, so a caller can ask what was submitted AND what merely
 *  painted.
 *
 *  `until` is POLLED, never slept for. A fixed window is a race against node's
 *  own startup: on a loaded darwin CI box this collected the empty string,
 *  because the child had not printed its first byte yet — a green fixture
 *  reported as a red one. `thenMs` is the extra window a test wants AFTER its
 *  condition is met, which is a different thing entirely: an observation
 *  interval, measured from a known state rather than from a guess. */
async function driveRaw(
  chunks: readonly string[],
  opts: {
    env?: Record<string, string>;
    until: (out: string) => boolean;
    thenMs?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  assertDaemonSpawnAllowed(
    "the mock agent TUI fixture (a short-lived node child)",
  );
  const child = spawn(process.execPath, [MOCK_TUI], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...opts.env },
  });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  try {
    for (const chunk of chunks) {
      child.stdin.write(chunk);
      // One turn of the event loop per chunk: the point is that the fixture sees
      // them as SEPARATE stdin events, which is what a split actually is.
      await sleep(1);
    }
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    while (Date.now() < deadline && !opts.until(out)) await sleep(25);
    if (opts.thenMs !== undefined) await sleep(opts.thenMs);
    return out;
  } finally {
    child.kill();
  }
}

/** Feed `chunks` to a single fixture process and collect what it submitted,
 *  waiting for exactly the `expected` count to arrive rather than for a clock. */
const drive = async (
  chunks: readonly string[],
  expected: number,
): Promise<string[]> =>
  submitted(
    await driveRaw(chunks, {
      until: (out) => submitted(out).length >= expected,
      // A short settle AFTER the count is met, so an EXTRA submission — the
      // failure a bare count would miss — still lands inside the window.
      thenMs: 150,
    }),
  );

describeDaemon("mockAgentTui — the fold survives any chunk boundary", () => {
  it("delivers every payload intact when split at EVERY index", async () => {
    // The finding under test: a claim that the holdback misses the 5-byte END
    // prefix `\x1b[201`, so a split just before `~` leaks the marker into the
    // message. That split is index `len-1` of a payload ending `…\x1b[201~\r`,
    // and it is one of the cases below — so this either reproduces it or
    // retires it, rather than either reviewer being taken at their word.
    const one = payload(0).bytes;
    const chunkSets = Array.from({ length: one.length - 1 }, (_, i) => i + 1);

    const expected: string[] = [];
    const chunks: string[] = [];
    chunkSets.forEach((at, n) => {
      const { bytes, body } = payload(n);
      chunks.push(bytes.slice(0, at), bytes.slice(at));
      expected.push(body);
    });

    expect(await drive(chunks, expected.length)).toEqual(expected);
  }, 120_000);

  it("delivers a payload fed ONE BYTE at a time", async () => {
    const { bytes, body } = payload(99);
    expect(await drive([...bytes], 1)).toEqual([body]);
  }, 60_000);

  it("keeps painting after a paste when asked, holding the text UNSUBMITTED", async () => {
    // The state a settle-phase refusal is made of, reproduced at the fixture
    // level so the e2e that depends on it is not the first thing to find out
    // whether it works: a TUI still busy taking the paste, with the message
    // sitting in the box. Both halves are asserted — the noise (without which
    // the settle wait would simply succeed) and the silence about submitting
    // (without which there would be nothing left to recover).
    const { body } = payload(7);
    const out = await driveRaw([`${PASTE_START}${body}${PASTE_END}`], {
      env: { MOCK_PASTE_CHATTER_MS: "4000", MOCK_TICK_MS: "50" },
      // The ECHO is the known state: the child is up and has taken the paste.
      // Only then is a window meaningful — before it, an empty stream says
      // nothing about the chatter and everything about node's startup.
      until: (seen) => seen.includes("brief 7"),
      thenMs: 400,
    });
    expect(out).toContain("~");
    expect(submitted(out)).toEqual([]);
  }, 60_000);

  it("chatters only when asked — the default fixture goes quiet at once", async () => {
    // Every other proof in this file and in `submit.e2e.test.ts` reads a quiet
    // terminal as "the TUI took it". A fixture that chattered by default would
    // turn all of them into timing races.
    const { bytes } = payload(8);
    const out = await driveRaw([bytes], {
      until: (seen) => submitted(seen).length >= 1,
      thenMs: 400,
    });
    expect(out).not.toContain("~");
  }, 60_000);
});
