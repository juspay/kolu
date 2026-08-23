/** Test-only osfacts binary fixture for the padi memory sampler.
 *
 * The production sampler has no dependency override. Tests instead exercise the
 * real `osfacts-client` spawn + V2 parser against this temporary executable.
 * The scoped helper puts `KOLU_OSFACTS_BIN` back exactly as it found it and
 * removes its files after the callback settles.
 */

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

/** How long the fake osfacts may take to actually be RUNNING.
 *
 *  Starting it is a real process launch — `node_modules`-free `/bin/sh`, but a
 *  launch — and vitest's `waitFor` default of 1s measures the box rather than
 *  the sampler. Nothing in this package runs beside it (`fileParallelism:
 *  false`, and `test-daemon` passes `--workspace-concurrency=1`), but the CI
 *  lane runs sibling pipeline recipes on the same host, so a launch competes
 *  with whatever nix build or e2e run is live there. On the darwin lane the
 *  file's ten cases take 1.6–2.6s in total when healthy; one loaded run missed
 *  the 1s launch window and reddened `ci::daemon@aarch64-darwin`
 *  (juspay/kolu#2176). A spawn that has not happened in 30s is a real hang;
 *  anything short of that is the machine being busy. */
const SPAWN_BUDGET_MS = 30_000;

/** What a case using a PAUSED fixture must pass as its own timeout.
 *
 *  `awaitStarted()`'s budget is only real if the enclosing case outlives it,
 *  and this package sets no `testTimeout`, so vitest's 5s default would kill
 *  the case first — capping the wait at 5s and reporting a hang exactly where
 *  the budget above exists to say "the box is busy". Deriving the case timeout
 *  from the budget keeps the two from drifting apart again; the headroom is
 *  because equal-length timers race. */
export const PAUSED_FIXTURE_TIMEOUT_MS = SPAWN_BUDGET_MS + 5_000;

export interface OsfactsMemoryFixture {
  /** Resolve once the fake osfacts has started and is holding at the pause. */
  readonly awaitStarted: () => Promise<void>;
  readonly readArgs: () => string;
  readonly release: () => void;
}

export interface OsfactsMemoryFixtureSpec {
  readonly rows: readonly string[];
  readonly version?: number;
  /** Hold the fake osfacts at a barrier until `release()`, so a case can mutate
   *  state mid-read. A case that sets this MUST pass
   *  {@link PAUSED_FIXTURE_TIMEOUT_MS} as its own timeout — it is the only
   *  shape that waits on a spawn, and vitest's 5s default would otherwise kill
   *  the case before `awaitStarted()`'s budget is up. */
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

/** Run a callback against one fake osfacts binary and always restore its
 * process-wide environment and temporary files after the callback settles. */
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
