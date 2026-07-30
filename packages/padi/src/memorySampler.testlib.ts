/** Test-only osfacts binary fixture for the padi memory sampler.
 *
 * The production sampler has no dependency override. Tests instead exercise the
 * real `osfacts-client` spawn + V2 parser against this temporary executable.
 * Every fixture returns an explicit `restore` that puts `KOLU_OSFACTS_BIN` back
 * exactly as it found it and removes its files.
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

export interface OsfactsMemoryFixture {
  readonly hasStarted: () => boolean;
  readonly readArgs: () => string;
  readonly release: () => void;
  readonly restore: () => Promise<void>;
}

/** Install a one-shot fake osfacts binary that emits the supplied V2 body. */
export function installOsfactsMemoryFixture(
  rows: readonly string[],
  version = 2,
  options: { readonly paused?: boolean } = {},
): OsfactsMemoryFixture {
  const dir = mkdtempSync(join(tmpdir(), "padi-memory-osfacts-"));
  const bin = join(dir, "osfacts");
  const argsFile = join(dir, "args");
  const startedFile = join(dir, "started");
  const releaseFile = join(dir, "release");
  const finishedFile = join(dir, "finished");
  const output = [`V\t${version}`, ...rows]
    .map((line) => `printf '%s\\n' ${shellQuoteArg(line)}`)
    .join("\n");
  const pause = options.paused
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
    hasStarted: () => existsSync(startedFile),
    readArgs: () => readFileSync(argsFile, "utf8").trim(),
    release,
    restore: async () => {
      try {
        if (existsSync(startedFile) && !existsSync(finishedFile)) {
          release();
          await vi.waitFor(() => {
            if (!existsSync(finishedFile))
              throw new Error("osfacts still running");
          });
        }
      } finally {
        if (previous === undefined) delete process.env.KOLU_OSFACTS_BIN;
        else process.env.KOLU_OSFACTS_BIN = previous;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
