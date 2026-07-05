// A scripted stand-in for a TUI agent (Claude Code / Codex) that reproduces the
// ONE failure mode the canonical two-command submit exists to fix: a bracketed
// paste is staged on the prompt line, and an Enter (`\r`) arriving within a short
// DEBOUNCE window of the paste's end is SILENTLY DROPPED — the prompt sits
// staged, unsent. An Enter that arrives AFTER the window submits. `send` bakes in
// NO grace: the caller sends the paste, OBSERVES the TUI settle (`wait --until
// idle`, past DEBOUNCE), THEN sends the Enter as its own command, so the submit
// lands past the debounce instead of inside it. Real not mocked: this runs in a
// real PTY spawned by the kaval host; the acceptance test drives it with the real
// send byte-plan (paste, then — after the observed settle — a separate Enter).
//
// It reads raw stdin, reassembles bracketed pastes across chunk boundaries (a
// multi-KB paste arrives in several socket reads), and prints one line per event
// the test asserts against:
//   READY                                   — booted, listening
//   DROPPED(since=<ms>)                      — an Enter fell inside the debounce
//   SUBMITTED#<n> len=<chars> tail=<last8>   — an Enter submitted the staged text
// A submit then streams a short burst of output (the "busy"/mid-turn state), with
// stdin still read throughout — so a submit fired at a busy agent is never lost.

const DEBOUNCE_MS = Number(process.env.FIXTURE_DEBOUNCE_MS ?? 120);
// How many 25ms ticks the mid-turn "busy" burst runs before it prints DONE.
// Parameterized so a test that needs a DETERMINISTICALLY busy agent (the second
// prompt must land while the first turn is still streaming) can hold the burst
// open long past its own submit, instead of racing the default ~500ms window.
const BUSY_TICKS = Number(process.env.FIXTURE_BUSY_TICKS ?? 20);
// The bracketed-paste markers are passed in by the test from the SAME
// `@kolu/terminal-protocol` constants `planSend` wraps text with — so the
// fixture can't drift from what the shipped code emits (it recognizes exactly
// what `send` sends). This runs as plain `node`, so it takes them as env rather
// than importing the TS package; fail loud if the test forgot to pass them.
const PASTE_START = process.env.FIXTURE_PASTE_START;
const PASTE_END = process.env.FIXTURE_PASTE_END;
if (!PASTE_START || !PASTE_END) {
  throw new Error(
    "fixture requires FIXTURE_PASTE_START / FIXTURE_PASTE_END (the bracketed-paste markers from @kolu/terminal-protocol)",
  );
}

let buf = ""; // unconsumed raw input, latin1 (byte-faithful)
let staged = ""; // the prompt buffered from the most recent paste
let lastPasteEndMs = Number.NEGATIVE_INFINITY;
let submits = 0;

// A monotonic clock in ms — hrtime, so it can't skew backward mid-test.
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

// Emit a burst of output (BUSY_TICKS × 25ms) to model a mid-turn "busy" agent.
// stdin keeps being read while this runs (Node's data events fire regardless),
// so a paste+submit landing during the burst is still staged and submitted.
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

  // Drain every COMPLETE bracketed paste first — staging the latest, and marking
  // when it ended so the debounce below can measure the Enter against it. An
  // incomplete paste (END not yet arrived) is left in `buf` for the next chunk.
  for (;;) {
    const start = buf.indexOf(PASTE_START);
    if (start === -1) break;
    const end = buf.indexOf(PASTE_END, start + PASTE_START.length);
    if (end === -1) break; // paste still arriving; wait for more bytes
    staged = buf.slice(start + PASTE_START.length, end);
    buf = buf.slice(0, start) + buf.slice(end + PASTE_END.length);
    lastPasteEndMs = nowMs();
  }

  // Then handle any Enter bytes left in the stream. An Enter within DEBOUNCE_MS
  // of the paste end is dropped (the bug); a later one submits (what --submit's
  // grace guarantees).
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
