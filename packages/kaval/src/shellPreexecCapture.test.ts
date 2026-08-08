/**
 * The OSC 633;E command-capture contract under a REAL interactive bash on a
 * real PTY — including a hostile-but-popular dotfile environment: bash-preexec
 * (what atuin / ble.sh / oh-my-bash install), which takes over the DEBUG trap
 * at the first prompt.
 *
 * Repro for #2119: with bash-preexec in the user's rc, the FIRST command of
 * every shell was never marked — and an agent launch is typically the first
 * command (kolu's own restore resume-writes always are), so those terminals
 * silently never earned a resumable restoreTarget.
 *
 * These tests drive the genuine production surface end to end: the wrapper
 * rcfile `prepareShellInit` plans (kolu-pty), an interactive bash spawned on a
 * node-pty PTY, and kaval's own OSC 633 parse observed via `getLastCommand`.
 * A pipe-based harness cannot express this — bash-preexec refuses to dispatch
 * when stdout is not a tty, and PROMPT_COMMAND/readline need a real prompt
 * cycle — hence a PTY test here rather than in kolu-pty's subprocess suite.
 *
 * The bash-preexec fixture is a verbatim vendored copy of v0.6.0 (MIT,
 * https://github.com/rcaloras/bash-preexec) so the test is hermetic: it must
 * not depend on the developer's dotfiles or a store path.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { prepareShellInit } from "kolu-pty";
import { afterEach, expect, it } from "vitest";
import { createPtyHost, type PtyHost } from "./ptyHost.ts";

const FIXTURE_BASH_PREEXEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "bash-preexec-0.6.0.fixture.sh",
);

/** A distinctive prompt so the tests can count completed prompt cycles. */
const PROMPT = "KOLU_TEST_PROMPT>";

/** Wait for `fn`, failing with `diagnose()`'s output in the error — a CI box
 *  can't be attached to, so the timeout itself must say what the shell showed. */
async function waitFor(
  fn: () => boolean,
  diagnose: () => string,
  ms = 20_000,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms)
      throw new Error(`waitFor timed out; screen:\n${diagnose()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Interactive bash resolved from PATH (the nix devshell's, never /bin/bash —
 *  `selectShellInit` keys on the `/bash` suffix, which both spell). */
function resolveBash(): string {
  const bash = execFileSync("/bin/sh", ["-c", "command -v bash"], {
    encoding: "utf8",
  }).trim();
  if (!bash) throw new Error("no bash on PATH");
  return bash;
}

describeDaemon("OSC 633;E capture in a real interactive bash", () => {
  let host: PtyHost | undefined;
  const tempDirs: string[] = [];

  afterEach(() => {
    host?.dispose();
    host = undefined;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Spawn an interactive bash through the REAL spawn plan: a temp HOME whose
   *  `.bashrc` is `userRc`, the wrapper rcfile from `prepareShellInit`
   *  materialised verbatim, and the shell on a genuine PTY. */
  function spawnInteractiveBash(userRc: string): {
    id: string;
    promptCount: () => number;
    screen: () => string;
  } {
    const bash = resolveBash();
    const home = mkdtempSync(join(tmpdir(), "kaval-preexec-home-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kaval-preexec-rc-"));
    tempDirs.push(home, rcDir);
    writeFileSync(join(home, ".bashrc"), userRc);
    const plan = prepareShellInit({
      shell: bash,
      home,
      terminalId: "preexec-capture-test",
      rcDir,
    });
    for (const f of plan.initFiles) {
      writeFileSync(join(rcDir, f.name), f.content);
    }
    host ??= createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: bash,
      args: plan.args,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TERM: "xterm-256color",
        HOME: home,
        ...plan.env,
      },
      cwd: home,
    });
    const screen = () => (host as PtyHost).getScreenText(id);
    const promptCount = () => screen().split(PROMPT).length - 1;
    return { id, promptCount, screen };
  }

  /** Type one command at the current prompt and wait for the next prompt —
   *  i.e. a full read → execute → prompt cycle, like a user at the keyboard. */
  async function runCommand(
    t: { id: string; promptCount: () => number; screen: () => string },
    command: string,
  ): Promise<void> {
    const before = t.promptCount();
    (host as PtyHost).write(t.id, `${command}\r`);
    await waitFor(() => t.promptCount() > before, t.screen);
  }

  /** The user rc of an atuin-style setup: bash-preexec sourced from the rc,
   *  exactly as `atuin init bash` arranges (bash-preexec first, then hooks). */
  const bashPreexecRc = [
    `PS1='${PROMPT} '`,
    `source '${FIXTURE_BASH_PREEXEC}'`,
    "",
  ].join("\n");

  /** A plain rc — no DEBUG-trap contenders. */
  const plainRc = `PS1='${PROMPT} '\n`;

  // Generous per-test timeouts: a cold CI box pays real startup cost for an
  // interactive bash (replayed /etc/profile and all), and the inner waitFors
  // carry the screen in their failure — a vitest-level timeout would say
  // nothing. 60s per test dwarfs any loaded-box stall.
  const SLOW = { timeout: 60_000 };

  it(
    "captures the FIRST command when the user rc loads bash-preexec (atuin) — #2119",
    SLOW,
    async () => {
      const t = spawnInteractiveBash(bashPreexecRc);
      await waitFor(() => t.promptCount() >= 1, t.screen);
      await runCommand(t, "echo t1");
      // The agent-launch slot: command #1. Before the fix, bash-preexec's
      // first-prompt DEBUG-trap takeover left its dispatch gate closed for
      // exactly this command, and the mark never fired.
      await waitFor(
        () => (host as PtyHost).getLastCommand(t.id) === "echo t1",
        t.screen,
      );
      expect((host as PtyHost).getLastCommand(t.id)).toBe("echo t1");
    },
  );

  it(
    "captures subsequent commands under bash-preexec (harness sanity)",
    SLOW,
    async () => {
      const t = spawnInteractiveBash(bashPreexecRc);
      await waitFor(() => t.promptCount() >= 1, t.screen);
      await runCommand(t, "echo t1");
      await runCommand(t, "echo t2");
      await waitFor(
        () => (host as PtyHost).getLastCommand(t.id) === "echo t2",
        t.screen,
      );
      expect((host as PtyHost).getLastCommand(t.id)).toBe("echo t2");
    },
  );

  it(
    "captures the FIRST command with a plain rc (no bash-preexec)",
    SLOW,
    async () => {
      const t = spawnInteractiveBash(plainRc);
      await waitFor(() => t.promptCount() >= 1, t.screen);
      await runCommand(t, "echo t1");
      await waitFor(
        () => (host as PtyHost).getLastCommand(t.id) === "echo t1",
        t.screen,
      );
      expect((host as PtyHost).getLastCommand(t.id)).toBe("echo t1");
    },
  );
});
