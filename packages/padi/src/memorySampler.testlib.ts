/** Test-only osfacts binary fixture for the padi memory sampler.
 *
 * The production sampler has no dependency override. Tests instead exercise the
 * real `osfacts-client` spawn + V2 parser against this temporary executable.
 * Every fixture returns an explicit `restore` that puts `KOLU_OSFACTS_BIN` back
 * exactly as it found it and removes its files.
 */

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface OsfactsMemoryFixture {
  readonly readArgs: () => string;
  readonly restore: () => void;
}

/** Install a one-shot fake osfacts binary that emits the supplied V2 body. */
export function installOsfactsMemoryFixture(
  rows: readonly string[],
  version = 2,
): OsfactsMemoryFixture {
  const dir = mkdtempSync(join(tmpdir(), "padi-memory-osfacts-"));
  const bin = join(dir, "osfacts");
  const argsFile = join(dir, "args");
  const output = [`V\t${version}`, ...rows]
    .map((line) => `printf '%s\\n' ${shellQuote(line)}`)
    .join("\n");
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" > ${shellQuote(argsFile)}\n${output}\n`,
  );
  chmodSync(bin, 0o755);

  const previous = process.env.KOLU_OSFACTS_BIN;
  process.env.KOLU_OSFACTS_BIN = bin;
  return {
    readArgs: () => readFileSync(argsFile, "utf8").trim(),
    restore: () => {
      if (previous === undefined) delete process.env.KOLU_OSFACTS_BIN;
      else process.env.KOLU_OSFACTS_BIN = previous;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
