/**
 * Pin that `portScan.ts` loads under Node's real ESM resolver — the path
 * production tsx/node takes. Vitest/esbuild rewrites named imports and will
 * happily leave a missing export as `undefined` until a call site runs; Node
 * throws `SyntaxError: does not provide export` at module evaluation. That
 * gap boot-looped a deploy after a bad `@kolu/terminal-vocab/schema` import.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("portScan module loadability (Node ESM)", () => {
  it("evaluates under node --import tsx without a missing-export SyntaxError", () => {
    const portScanUrl = new URL("./portScan.ts", import.meta.url).href;
    // Absolute path to this package's tsx (workspace-resolved), not PATH.
    const tsxLoader = fileURLToPath(
      new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(portScanUrl)});`,
      ],
      {
        encoding: "utf8",
        env: process.env,
        cwd: fileURLToPath(new URL("..", import.meta.url)),
      },
    );
    expect(
      result.status,
      `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    ).toBe(0);
  });
});
