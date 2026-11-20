import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inMemoryChannel } from "@kolu/surface/server";
import type {
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { afterEach, expect, it, vi } from "vitest";

const seen: string[] = [];

const quietAdapter = (
  kind: "claude-code" | "codex",
): AgentAdapter<number, AgentInfoShape> => ({
  kind,
  resolveSessions: (state) => {
    if (state.foregroundPid !== undefined) seen.push(`${kind} looked`);
    return [];
  },
  sessionKey: (session) => String(session),
  sessionStartedAt: () => null,
  createWatcher: () => ({ destroy() {} }),
});

vi.mock("kolu-agents", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    AGENT_PLUGINS: {
      claude: { adapter: quietAdapter("claude-code") },
      codex: { adapter: quietAdapter("codex") },
    },
  };
});
// `vi.mock` is hoisted above static imports, and the sensor module reads the
// registry at import time.
const { startSensors } = await import("./sensors.ts");

const SHELL_PID = 4_101;

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

const dirs: string[] = [];
afterEach(() => {
  seen.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

it("says the terminal has been read once, after the last detector's first pass, and not at install", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "padi-first-pass-"));
  dirs.push(cwd);
  const foreground = inMemoryChannel<ForegroundSample>();
  const stop = startSensors(
    "t1" as TerminalId,
    {
      pid: SHELL_PID,
      cwd,
      commandRooted: false,
      signals: {
        cwd: inMemoryChannel<string>(),
        title: inMemoryChannel<string>(),
        commandRun: inMemoryChannel<string>(),
        foreground,
        ports: inMemoryChannel<TerminalPorts>(),
        grid: inMemoryChannel<TerminalGrid>(),
        screenSettled: inMemoryChannel<void>(),
        submitted: inMemoryChannel<void>(),
      },
      log: pino({ level: "silent" }),
      onAgentsRead: () => seen.push("read"),
    },
    () => {},
  );
  try {
    await flush();
    expect(seen).toEqual([]);

    foreground.publish({ process: "bash", foregroundPid: SHELL_PID });
    await flush();
    expect(seen.slice(0, 2).sort()).toEqual([
      "claude-code looked",
      "codex looked",
    ]);
    expect(seen.slice(2)).toEqual(["read"]);

    foreground.publish({ process: "vim", foregroundPid: SHELL_PID + 1 });
    await flush();
    expect(seen.filter((one) => one === "read")).toHaveLength(1);
  } finally {
    stop();
  }
});
