import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuoteArg } from "@kolu/shell-quote";
import { vi } from "vitest";

const SPAWN_BUDGET_MS = 30_000;

export const PAUSED_FIXTURE_TIMEOUT_MS = SPAWN_BUDGET_MS + 5_000;

export interface OsfactsMemoryFixture {
  readonly awaitStarted: () => Promise<void>;
  readonly readArgs: () => string;
  readonly release: () => void;
}

export interface OsfactsMemoryFixtureSpec {
  readonly rows: readonly string[];
  readonly version?: number;
  readonly paused?: boolean;
}

interface InstalledOsfactsMemoryFixture extends OsfactsMemoryFixture {
  readonly restore: () => Promise<void>;
}

function installOsfactsMemoryFixture(
  spec: OsfactsMemoryFixtureSpec,
): InstalledOsfactsMemoryFixture {
  const dir = mkdtempSync(join(tmpdir(), "padi-memory-osfacts-"));
  const bin = join(dir, "osfacts");
  const argsFile = join(dir, "args");
  const startedFile = join(dir, "started");
  const releaseFile = join(dir, "release");
  const finishedFile = join(dir, "finished");
  const output = [`V\t${spec.version ?? 2}`, ...spec.rows]
    .map((line) => `printf '%s\\n' ${shellQuoteArg(line)}`)
    .join("\n");
  const pause = spec.paused
    ? `: > ${shellQuoteArg(startedFile)}\nwhile [ ! -e ${shellQuoteArg(releaseFile)} ]; do sleep 0.01; done\n`
    : "";
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" > ${shellQuoteArg(argsFile)}\n${pause}${output}\n: > ${shellQuoteArg(finishedFile)}\n`,
  );
  chmodSync(bin, 0o755);

  const previous = process.env.KOLU_OSFACTS_BIN;
  process.env.KOLU_OSFACTS_BIN = bin;
  const release = () => writeFileSync(releaseFile, "");
  return {
    awaitStarted: () =>
      vi.waitFor(
        () => {
          if (!existsSync(startedFile))
            throw new Error("osfacts fixture has not started");
        },
        { timeout: SPAWN_BUDGET_MS, interval: 25 },
      ),
    readArgs: () => readFileSync(argsFile, "utf8").trim(),
    release,
    restore: async () => {
      try {
        if (existsSync(startedFile) && !existsSync(finishedFile)) {
          release();
          await vi.waitFor(
            () => {
              if (!existsSync(finishedFile))
                throw new Error("osfacts still running");
            },
            { timeout: SPAWN_BUDGET_MS, interval: 25 },
          );
        }
      } finally {
        if (previous === undefined) delete process.env.KOLU_OSFACTS_BIN;
        else process.env.KOLU_OSFACTS_BIN = previous;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export async function withOsfactsMemoryFixture<T>(
  spec: OsfactsMemoryFixtureSpec,
  body: (fixture: OsfactsMemoryFixture) => Promise<T>,
): Promise<T> {
  const fixture = installOsfactsMemoryFixture(spec);
  try {
    return await body(fixture);
  } finally {
    await fixture.restore();
  }
}
