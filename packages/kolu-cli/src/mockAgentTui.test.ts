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

/** Feed `chunks` to a single fixture process and collect what it submitted. */
async function drive(chunks: readonly string[]): Promise<string[]> {
  assertDaemonSpawnAllowed(
    "the mock agent TUI fixture (a short-lived node child)",
  );
  const child = spawn(process.execPath, [MOCK_TUI], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  try {
    for (const chunk of chunks) {
      child.stdin.write(chunk);
      // One turn of the event loop per chunk: the point is that the fixture sees
      // them as SEPARATE stdin events, which is what a split actually is.
      await new Promise((r) => setTimeout(r, 1));
    }
    await new Promise((r) => setTimeout(r, 250));
    return submitted(out);
  } finally {
    child.kill();
  }
}

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

    expect(await drive(chunks)).toEqual(expected);
  }, 120_000);

  it("delivers a payload fed ONE BYTE at a time", async () => {
    const { bytes, body } = payload(99);
    expect(await drive([...bytes])).toEqual([body]);
  }, 60_000);
});
