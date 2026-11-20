import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { prepareShellInit } from "kolu-pty";
import { afterEach, expect, it } from "vitest";
import { Effect } from "effect";
import { createPtyHost, type PtyHost, type PtyId } from "./ptyHost.ts";

const FIXTURE_BASH_PREEXEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "bash-preexec-0.6.0.fixture.sh",
);

const PROMPT = "KOLU_TEST_PROMPT>";
const PROMPT_MARK_RC = [
  `__kolu_test_prompt_mark() { printf '%s' '${PROMPT}'; }`,
  `PROMPT_COMMAND="__kolu_test_prompt_mark\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`,
].join("\n");

function retainedCommand(
  host: PtyHost,
  id: PtyId,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.map(host.subscribeCommandRun(id), (sub) => sub.retained),
    ),
  );
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  diagnose: () => string,
  ms = 20_000,
): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms)
      throw new Error(`waitFor timed out; screen:\n${diagnose()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

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
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  });

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

  async function runCommand(
    t: { id: string; promptCount: () => number; screen: () => string },
    command: string,
  ): Promise<void> {
    const before = t.promptCount();
    (host as PtyHost).write(t.id, `${command}\r`);
    await waitFor(() => t.promptCount() > before, t.screen);
  }

  const bashPreexecRc = [
    PROMPT_MARK_RC,
    `source '${FIXTURE_BASH_PREEXEC}'`,
    "",
  ].join("\n");

  const plainRc = `${PROMPT_MARK_RC}\n`;

  const SLOW = { timeout: 60_000 };

  it(
    "captures the FIRST command when the user rc loads bash-preexec (atuin) — #2119",
    SLOW,
    async () => {
      const t = spawnInteractiveBash(bashPreexecRc);
      await waitFor(() => t.promptCount() >= 1, t.screen);
      await runCommand(t, "echo t1");
      await waitFor(
        async () => (await retainedCommand(host!, t.id)) === "echo t1",
        t.screen,
      );
      expect(await retainedCommand(host!, t.id)).toBe("echo t1");
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
        async () => (await retainedCommand(host!, t.id)) === "echo t2",
        t.screen,
      );
      expect(await retainedCommand(host!, t.id)).toBe("echo t2");
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
        async () => (await retainedCommand(host!, t.id)) === "echo t1",
        t.screen,
      );
      expect(await retainedCommand(host!, t.id)).toBe("echo t1");
    },
  );
});
