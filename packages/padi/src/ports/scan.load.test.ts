import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ports/scan module loadability (Node ESM)", () => {
  it("evaluates under node --import tsx without a missing-export SyntaxError", () => {
    const portScanUrl = new URL("./scan.ts", import.meta.url).href;
    const tsxLoader = fileURLToPath(
      new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url),
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
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
      },
    );
    expect(
      result.status,
      `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    ).toBe(0);
  });
});
