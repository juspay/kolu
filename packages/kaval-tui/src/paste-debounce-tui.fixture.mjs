const DEBOUNCE_MS = Number(process.env.FIXTURE_DEBOUNCE_MS ?? 120);
const BUSY_TICKS = Number(process.env.FIXTURE_BUSY_TICKS ?? 20);
const PASTE_START = process.env.FIXTURE_PASTE_START;
const PASTE_END = process.env.FIXTURE_PASTE_END;
if (!PASTE_START || !PASTE_END) {
  throw new Error(
    "fixture requires FIXTURE_PASTE_START / FIXTURE_PASTE_END (the bracketed-paste markers from @kolu/terminal-protocol)",
  );
}

let buf = "";
let staged = "";
let lastPasteEndMs = Number.NEGATIVE_INFINITY;
let submits = 0;

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function streamBusy(tag) {
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(".");
    if (++i >= BUSY_TICKS) {
      clearInterval(timer);
      process.stdout.write(`\nDONE ${tag}\n`);
    }
  }, 25);
}

if (process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.setEncoding("latin1");
process.stdin.resume();
process.stdout.write("READY\n");

process.stdin.on("data", (chunk) => {
  buf += chunk;

  for (;;) {
    const start = buf.indexOf(PASTE_START);
    if (start === -1) break;
    const end = buf.indexOf(PASTE_END, start + PASTE_START.length);
    if (end === -1) break;
    staged = buf.slice(start + PASTE_START.length, end);
    buf = buf.slice(0, start) + buf.slice(end + PASTE_END.length);
    lastPasteEndMs = nowMs();
  }

  for (;;) {
    const cr = buf.indexOf("\r");
    if (cr === -1) break;
    buf = buf.slice(0, cr) + buf.slice(cr + 1);
    const since = nowMs() - lastPasteEndMs;
    if (since < DEBOUNCE_MS) {
      process.stdout.write(`DROPPED(since=${Math.round(since)})\n`);
      continue;
    }
    submits += 1;
    process.stdout.write(
      `SUBMITTED#${submits} len=${staged.length} tail=${staged.slice(-8)}\n`,
    );
    const tag = `T${submits}`;
    staged = "";
    streamBusy(tag);
  }
});
