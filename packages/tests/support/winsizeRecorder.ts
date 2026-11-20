import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pollFor } from "./poll.ts";
import { padiCall } from "./rpcWire.ts";

export const WINSIZE_MARK = "kolu-e2e-winsize";

const RECORD_LINE = new RegExp(`${WINSIZE_MARK} (\\d+) (\\d+)x(\\d+)`, "g");

const SCREEN_TAIL = 200;

const RECORDER_START_TIMEOUT = 20_000;

const RECORDER_SOURCE = `"use strict";
var out = process.stdout;
var MARK = "kolu-e2e" + "-winsize";
var LIFETIME = 900000;
var seq = 0;

function say() {
  var cols = out.columns || 0;
  var rows = out.rows || 0;
  out.write(
    "\\r" + MARK + " " + ("000" + seq).slice(-3) + " " + cols + "x" + rows +
      "\\u001b[K\\r\\n"
  );
  seq++;
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", function (buf) {
  if (buf.indexOf(3) !== -1) process.exit(0);
});

out.write("\\u001b[2J\\u001b[3J\\u001b[H");
say();
out.on("resize", say);
setTimeout(function () {
  process.exit(0);
}, LIFETIME);
`;

let recorderDir: string | null = null;

function recorderScript(): string {
  if (!recorderDir) {
    recorderDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-winsize-"));
    fs.writeFileSync(path.join(recorderDir, "recorder.cjs"), RECORDER_SOURCE);
  }
  return path.join(recorderDir, "recorder.cjs");
}

export function removeRecorderScript(): void {
  if (!recorderDir) return;
  fs.rmSync(recorderDir, { recursive: true, force: true });
  recorderDir = null;
}

export interface Winsize {
  seq: number;
  cols: number;
  rows: number;
}

export const formatWinsizes = (sizes: readonly Winsize[]): string =>
  sizes.length === 0
    ? "(nothing — the program never printed)"
    : sizes.map((s) => `#${s.seq} ${s.cols}x${s.rows}`).join(" → ");

async function daemonScreen(terminalId: string): Promise<string> {
  const text = await padiCall("screen/text", {
    id: terminalId,
    tail: SCREEN_TAIL,
  });
  if (typeof text !== "string") {
    throw new Error(
      `padi answered screen.text for ${terminalId} with ${typeof text}, not text`,
    );
  }
  return text;
}

export async function readWinsizes(terminalId: string): Promise<Winsize[]> {
  const screen = await daemonScreen(terminalId);
  const bySeq = new Map<number, Winsize>();
  for (const match of screen.matchAll(RECORD_LINE)) {
    const seq = Number(match[1]);
    bySeq.set(seq, { seq, cols: Number(match[2]), rows: Number(match[3]) });
  }
  const sizes = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  sizes.forEach((size, index) => {
    if (size.seq !== index) {
      throw new Error(
        `the size record for terminal ${terminalId} has a hole in it at #${index}: ` +
          `${formatWinsizes(sizes)} — the screen no longer holds the whole record, ` +
          "so nothing can be counted from it",
      );
    }
  });
  return sizes;
}

export async function startRecorder(terminalId: string): Promise<Winsize> {
  const script = recorderScript();
  await padiCall("lifecycle/sendInput", {
    id: terminalId,
    data: `'${process.execPath}' '${script}'\r`,
  });

  let sizes: Winsize[];
  try {
    sizes = await pollFor({
      observe: () => readWinsizes(terminalId),
      isDone: (seen) => seen.length > 0,
      timeoutMs: RECORDER_START_TIMEOUT,
      intervalMs: 250,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `the size recorder never printed in terminal ${terminalId} within ${elapsedMs}ms`,
        ),
    });
  } catch (error) {
    throw new Error(
      `the size recorder never started in terminal ${terminalId} — this scenario ` +
        "cannot say anything about what its program was told. The daemon's screen " +
        `last showed:\n${await quoteDaemonScreen(terminalId)}`,
      { cause: error },
    );
  }
  const first = sizes[0];
  if (!first) throw new Error("unreachable: polled for a non-empty record");
  return first;
}

async function quoteDaemonScreen(terminalId: string): Promise<string> {
  try {
    const screen = await daemonScreen(terminalId);
    return screen.trimEnd().split("\n").slice(-12).join("\n");
  } catch (error) {
    return `(the daemon's screen could not be read: ${String(error)})`;
  }
}
