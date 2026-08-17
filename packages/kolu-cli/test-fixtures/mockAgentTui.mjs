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

function feed(chunk) {
  let rest = chunk;
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
