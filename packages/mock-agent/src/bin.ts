/**
 * kolu-mock-agent — a stand-in for a real coding agent (claude / codex /
 * opencode / grok), run INSIDE a kolu terminal by the e2e harness.
 *
 * It exists so agent-state scenarios are geography-free: instead of the test
 * process planting fixture files (which don't cross an ssh bind), a real
 * foreground process in the terminal writes its OWN session artifacts at the
 * REAL default paths under whatever `$HOME` that box's PTY host resolved. The
 * padi on the SAME box reads those paths. Local and remote become the same test.
 *
 * Which kind it impersonates is BAKED as `argv[2]` by the Nix wrapper (`bin/
 * claude` / `bin/codex` / `bin/opencode` / `bin/grok`), so the terminal
 * invocation's head basename is `claude`/`codex`/`opencode`/`grok` — which is
 * exactly what the preexec command-name detector (`parseAgentCommand` →
 * `lastAgentCommandName`, see anyagent) keys on. It then reads the tiny stdin
 * grammar in `protocol.ts` (one line per command, delivered over the PTY) and
 * stays resident as the foreground process — like a real agent — until
 * `quit` / EOF.
 */

import { createInterface } from "node:readline";
import { ClaudeAgent } from "./claude.ts";
import { CodexAgent } from "./codex.ts";
import { GrokAgent } from "./grok.ts";
import { OpenCodeAgent } from "./opencode.ts";
import { type MockKind, parseCommand } from "./protocol.ts";
import { PROMPT_TEMPLATES } from "./prompts.ts";

/** Re-fire the current artifacts' watcher signal on a cadence tighter than the
 *  server's poll so a single dropped inotify event can't wedge detection —
 *  the in-process replacement for the old test-side `onTick` nudges. */
const NUDGE_INTERVAL_MS = 200;

/** How long after `quit` the agent keeps re-firing the deletion signal before
 *  exiting — long enough that a dropped delete event is recovered by a later
 *  tick. */
const REMOVAL_NUDGE_MS = 2000;

function makeKind(kind: string): MockKind {
  switch (kind) {
    case "claude":
      return new ClaudeAgent();
    case "codex":
      return new CodexAgent();
    case "opencode":
      return new OpenCodeAgent();
    case "grok":
      return new GrokAgent();
    default:
      throw new Error(
        `kolu-mock-agent: unknown kind '${kind}' (expected claude|codex|opencode|grok)`,
      );
  }
}

function main(): void {
  const kind = process.argv[2];
  if (!kind) throw new Error("kolu-mock-agent: missing kind argument");
  // `--shim` reproduces an npm-shimmed CLI: the kernel foreground name stays a
  // generic interpreter, so detection must ride the preexec command-name hint
  // ALONE (the #673 shim path). Default (no flag) presents as a native install.
  const shim = process.argv.includes("--shim");
  const agent = makeKind(kind);
  const emitTitle = () => process.stdout.write(`\x1b]0;${kind}\x07`);

  // node-pty derives a terminal's foreground process name from
  // `/proc/<pgrp>/cmdline` (argv[0]); on Linux `process.title` rewrites that
  // memory, so setting it to the kind makes `readForegroundBasename() === kind`
  // — the native-install detection branch (`matchesAgent`'s comm arm). A shim
  // leaves a generic `node` name so only the command-name arm can match. This is
  // a robust, persistent signal (no reconcile can clear it), unlike the preexec
  // hint; the hint is the cross-platform fallback (macOS reads the real exec
  // path, which `process.title` can't change).
  process.title = shim ? "node" : kind;

  let started = false;
  // After `quit` the agent has removed its artifacts but keeps re-firing the
  // deletion signal until this deadline, so a dropped delete event can't leave
  // the indicator wedged; then it exits and the terminal returns to the shell.
  let exitDeadline: number | null = null;
  const nudgeTimer = setInterval(() => {
    if (started) agent.nudge();
    if (exitDeadline !== null && Date.now() >= exitDeadline) {
      clearInterval(nudgeTimer);
      process.exit(0);
    }
  }, NUDGE_INTERVAL_MS);
  // The nudge timer must not keep the process alive on its own; the stdin
  // reader (and the terminal) own the lifetime.
  nudgeTimer.unref();

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (raw) => {
    const cmd = parseCommand(raw);
    if (!cmd) return;
    if (cmd.verb === "quit") {
      agent.remove();
      // Keep re-firing the deletion signal for a bounded window (the timer's
      // `agent.nudge()` now takes the removed branch), then exit — robust
      // against a dropped delete event, and finally hands the shell back.
      exitDeadline = Date.now() + REMOVAL_NUDGE_MS;
      return;
    }
    if (cmd.verb === "state") {
      agent.setState(cmd.state, cmd.opts);
      started = true;
      // The launch title can race ahead of the first artifact write. Re-emit
      // after each state change so the server resolves against fresh files/DB.
      emitTitle();
      // Acknowledge so the harness can wait for the write to have happened
      // before it starts polling the UI (deterministic, no sleep).
      process.stdout.write(`MOCK-AGENT-STATE ${cmd.state}\n`);
      return;
    }
    if (cmd.verb === "paint") {
      const lines = PROMPT_TEMPLATES[cmd.template];
      if (!lines) {
        process.stdout.write(
          `MOCK-AGENT-ERROR unknown template '${cmd.template}'\n`,
        );
        return;
      }
      // Print the prompt onto the PTY as the foreground agent would, so kolu's
      // server-side screen scrape sees it. No ack line — anything written here
      // lands on the scraped screen, and a trailing marker would push the
      // load-bearing footer out of the screen tail; the harness waits for the
      // prompt's own text to render instead.
      for (const line of lines) process.stdout.write(`${line}\n`);
      return;
    }
    // Unknown verb — loud, so a typo'd command in a scenario fails visibly
    // rather than silently no-op'ing.
    process.stdout.write(`MOCK-AGENT-ERROR unknown command '${cmd.raw}'\n`);
  });
  // EOF (terminal closed / killAll) → remove artifacts then exit. Without
  // `remove()`, a killed mock leaves session files under the fixture HOME that
  // can poison the next scenario's match (especially codex/opencode fixed ids
  // and grok's active_sessions map).
  rl.on("close", () => {
    if (started) agent.remove();
    clearInterval(nudgeTimer);
    process.exit(0);
  });

  // Emit one OSC 2 title so kolu's terminal parser fires a foreground re-sample
  // + reconcile now that this process is the settled foreground — the moment
  // detection reads either signal (mirrors the real agents' title emission and
  // the old fakes' `printf '\033]0;<kind>\007'`).
  emitTitle();
  // Announce readiness so the launch step can wait for a settled foreground
  // process before sending the first command.
  process.stdout.write(`MOCK-AGENT-READY ${kind}\n`);
}

main();
