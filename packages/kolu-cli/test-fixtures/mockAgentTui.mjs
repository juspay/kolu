#!/usr/bin/env node
/**
 * A scripted stand-in for an agent TUI — the thing the one-call submit is aimed
 * at, reduced to exactly the behaviours the submit doctrine turns on.
 *
 * A real Claude Code / grok session cannot be a CI fixture: it needs credentials,
 * it is not deterministic, and its timing is nobody's to pin. What CAN be pinned
 * is the CONTRACT a driven TUI presents, and this reproduces the three parts of
 * it that matter:
 *
 *   1. **Bracketed paste is not a submit.** Bytes between the paste markers land
 *      in the input box verbatim, newlines included — only a bare CR submits.
 *      This is why a multi-line brief must arrive as one paste, and why the Enter
 *      is separate.
 *   2. **A turn is noisy.** While working it emits a tick, so "output has been
 *      quiet for N ms" really does mean "not mid-turn" — the agent-agnostic half
 *      of the readiness predicate.
 *   3. **A turn ENDING CLEARS the input box.** This is the hazard the whole
 *      wait-before-typing choice exists for, and it is not hypothetical: a grok
 *      terminal ate a dispatched message exactly this way on 2026-08-17. Text
 *      typed mid-turn is announced as `<<CLEARED:…>>` and thrown away, so a test
 *      can prove the loss rather than assert it in prose.
 *
 * Plain `.mjs` so a PTY can run it with a bare `node <path>` — no loader, no
 * build step, nothing between the test's typed line and the process.
 *
 * Env knobs (all optional, all milliseconds):
 *   MOCK_BOOT_MS  — stay SILENT this long before the first prompt, reproducing
 *                   the gap between a shell exec'ing an agent and that agent
 *                   painting its first frame.
 *   MOCK_TURN_MS  — how long a turn lasts after a submit. 0 = answer instantly.
 *   MOCK_TICK_MS  — the working tick's cadence.
 *   MOCK_PROCESS_NAME
 *                 — present the process under this name (`process.title`), which
 *                   is what node-pty reports as the pty's FOREGROUND process and
 *                   what `kolu ls` prints. Set it to `claude` and padi sees an
 *                   agent RUNNING here — the pre-session identity a real agent
 *                   has from the moment the shell execs it, and the only signal
 *                   available before a transcript exists. Unset (the default) the
 *                   fixture is plain `node`, which is not a known agent command,
 *                   so a first message is refused. NOT milliseconds.
 *                   LINUX ONLY: darwin reports the exec'd path truncated to 16
 *                   chars instead of the title, so a caller there cannot present
 *                   an agent name this way (the leg that needs it is skipped).
 *   MOCK_PASTE_CHATTER_MS
 *                 — keep repainting this long AFTER a paste lands, without
 *                   submitting it. This is the state the settle window exists to
 *                   wait out (a TUI reflowing a big paste), and a TUI that
 *                   outlasts the caller's bound is what a settle-phase refusal
 *                   IS: the text is in the box and the Enter was withheld.
 */

const ms = (name, fallback) => {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${raw}`);
  return n;
};

const BOOT_MS = ms("MOCK_BOOT_MS", 0);
const TURN_MS = ms("MOCK_TURN_MS", 0);
const TICK_MS = ms("MOCK_TICK_MS", 100);
const PASTE_CHATTER_MS = ms("MOCK_PASTE_CHATTER_MS", 0);

// Set BEFORE any output, because the readiness fold can sample the foreground
// the instant the pty has a process. node-pty reports `process.title` verbatim,
// so this is how a fixture presents the same pre-session identity a real agent
// does — the thing that distinguishes "an agent is running here" from "a shell
// is sitting at a prompt" before either has said anything.
if (process.env.MOCK_PROCESS_NAME !== undefined) {
  process.title = process.env.MOCK_PROCESS_NAME;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** What is typed but NOT yet submitted — the input box. */
let box = "";
let pasting = false;

const out = (s) => process.stdout.write(s);
const prompt = () => out("\r\nMOCK> ");

function submit() {
  const message = box;
  box = "";
  out(`\r\n<<SUBMITTED:${JSON.stringify(message)}>>\r\n`);
  if (TURN_MS <= 0) {
    prompt();
    return;
  }
  const until = Date.now() + TURN_MS;
  const tick = setInterval(() => {
    if (Date.now() < until) {
      out(".");
      return;
    }
    clearInterval(tick);
    // THE HAZARD. Anything typed while the turn ran is discarded when it ends —
    // the send that delivered it reported success, and the message is gone.
    if (box !== "") {
      out(`\r\n<<CLEARED:${JSON.stringify(box)}>>\r\n`);
      box = "";
    }
    prompt();
  }, TICK_MS);
}

/** Keep painting for a while after a paste, WITHOUT submitting it.
 *
 *  A real TUI does not go quiet the instant a paste arrives — it reflows,
 *  re-renders, sometimes counts tokens — and the settle window exists to wait
 *  exactly that out. A fixture that always goes silent immediately can only ever
 *  prove the happy path; this is how the OTHER outcome is reachable: the text is
 *  in the box, the caller's bound expires, and the Enter is never sent. */
function chatterAfterPaste() {
  if (PASTE_CHATTER_MS <= 0) return;
  const until = Date.now() + PASTE_CHATTER_MS;
  const tick = setInterval(() => {
    if (Date.now() >= until) {
      clearInterval(tick);
      return;
    }
    out("~");
  }, TICK_MS);
}

/** How much of a marker could still be arriving — the longest proper prefix of
 *  either paste marker that `rest` ends with, or 0. A PTY hands stdin over in
 *  whatever chunks the kernel felt like, so a multi-line paste can split
 *  `\x1b[200~` down the middle; without this the two halves are matched by
 *  neither `indexOf` and land in the input box as literal escape garbage, which
 *  would fail the multiline proof with a message nobody typed. Held back and
 *  re-fed with the next chunk instead. */
function danglingMarkerPrefix(rest) {
  for (const marker of [PASTE_START, PASTE_END]) {
    for (let n = marker.length - 1; n > 0; n--) {
      if (rest.endsWith(marker.slice(0, n))) return n;
    }
  }
  return 0;
}

/** Bytes withheld from the previous chunk because they may be half a marker. */
let carry = "";

function feed(incoming) {
  const whole = carry + incoming;
  const held = danglingMarkerPrefix(whole);
  carry = held === 0 ? "" : whole.slice(whole.length - held);
  let rest = held === 0 ? whole : whole.slice(0, whole.length - held);
  while (rest.length > 0) {
    if (pasting) {
      const end = rest.indexOf(PASTE_END);
      if (end === -1) {
        // Inside a paste every byte is content — CR and LF included, which is
        // exactly why a pasted multi-line brief does not fire a half-written
        // prompt per line.
        box += rest;
        out(rest.replace(/\r?\n/g, "\r\n"));
        return;
      }
      const body = rest.slice(0, end);
      box += body;
      out(body.replace(/\r?\n/g, "\r\n"));
      pasting = false;
      chatterAfterPaste();
      rest = rest.slice(end + PASTE_END.length);
      continue;
    }
    const start = rest.indexOf(PASTE_START);
    if (start === 0) {
      pasting = true;
      rest = rest.slice(PASTE_START.length);
      continue;
    }
    const plain = start === -1 ? rest : rest.slice(0, start);
    for (const ch of plain) {
      if (ch === "\r" || ch === "\n") {
        submit();
      } else if (ch === "\x7f") {
        box = box.slice(0, -1);
        out("\b \b");
      } else {
        box += ch;
        out(ch);
      }
    }
    rest = start === -1 ? "" : rest.slice(plain.length);
  }
}

process.stdin.setRawMode?.(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
// Bytes that arrive before the first prompt are still input — a real TUI reads
// its tty from the moment it opens it, and swallowing them here would HIDE the
// boot race `MOCK_BOOT_MS` exists to reproduce rather than reproduce it.
process.stdin.on("data", feed);

setTimeout(() => {
  out("mock agent tui ready");
  prompt();
}, BOOT_MS);
