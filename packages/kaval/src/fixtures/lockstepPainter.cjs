"use strict";

const out = process.stdout;

const num = (name, fallback) => {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
};

const BURST = num("LOCKSTEP_BURST_TICKS", 12);
const TICK_MS = num("LOCKSTEP_TICK_MS", 50);
const STATUS_ROW = num("LOCKSTEP_STATUS_ROW", 25);
const REPAINT_LINES = num("LOCKSTEP_REPAINT_LINES", 6);
const FLOOD_CHARS = num("LOCKSTEP_FLOOD_CHARS", 0);

const SAVE_CURSOR = "\u001b7";
const RESTORE_CURSOR = "\u001b8";
const ERASE_TO_END_OF_LINE = "\u001b[K";
const ERASE_TO_END_OF_SCREEN = "\u001b[0J";
const cursorTo = (row, col) => `\u001b[${row};${col}H`;
const cursorUp = (n) => `\u001b[${n}A`;

let tick = 0;
let epoch = 0;
let left = 0;
let timer = null;

function rows() {
  return out.rows || 24;
}

function write(s) {
  out.write(s);
}

// The quiet marker names the SIZE the program went quiet at, never a count of
// resizes: SIGWINCH is a standard signal and standard signals do not queue, so
// two ioctls landing close together are delivered as one and a counter silently
// skips a number. The size is the fact the waiter actually wants anyway.
function stop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  left = 0;
  write(`${cursorTo(rows(), 1)}IDLE ${out.columns}x${rows()}\r\n`);
}

function paint() {
  tick += 1;
  write(
    `${SAVE_CURSOR}${cursorTo(STATUS_ROW, 1)}status ${tick} at ${out.columns}x${rows()}${ERASE_TO_END_OF_LINE}${RESTORE_CURSOR}`,
  );
  write(`${cursorTo(rows(), 1)}log ${tick}\r\n`);
  left -= 1;
  if (left <= 0) stop();
}

function burst() {
  left = BURST;
  if (timer === null) timer = setInterval(paint, TICK_MS);
}

process.on("SIGWINCH", () => {
  epoch += 1;
  let body = "";
  for (let i = 0; i < REPAINT_LINES; i++) {
    const end = i === REPAINT_LINES - 1 ? "" : "\r\n";
    body += `repaint ${epoch}.${i} at ${out.columns}x${rows()}${end}`;
  }
  write(`${cursorUp(REPAINT_LINES)}${ERASE_TO_END_OF_SCREEN}${body}`);
  stop();
});

if (FLOOD_CHARS > 0) {
  process.on("SIGWINCH", () => {
    write(`${"F".repeat(FLOOD_CHARS)}\r\n`);
    write(`${cursorTo(rows(), 1)}IDLE ${out.columns}x${rows()}\r\n`);
  });
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", burst);
burst();
