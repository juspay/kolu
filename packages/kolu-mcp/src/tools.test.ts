import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

const BANNED_ROOTS = [
  "@kolu/padi-client/dial",
  "@kolu/padi-client/watch",
  "@kolu/padi-client/rendezvous",
  "@kolu/padi/remote-dial",
  "@kolu/padi/read",
  "@kolu/padi/cliClient",
  "@kolu/surface/links",
  "@kolu/surface/mirror",
  "@kolu/surface-remote",
  "@kolu/surface-daemon",
  "@kolu/surface-daemon-supervisor",
  "kolu-pty",
] as const;

const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*from\s+["']([^"']+)["']/gm;

describe("the tool table's tree-load fence", () => {
  it("no table module holds a top-level VALUE import of transport machinery", () => {
    const toolsSource = readFileSync(join(SRC, "tools.ts"), "utf8");
    const toolModules = [
      "tools.ts",
      ...toolsSource.matchAll(/(?:from\s+)?["'](\.\/[^"']+)["']/g),
    ].map((m) => (typeof m === "string" ? m : m[1]!));
    expect(
      toolModules.length,
      "tools.ts holds the whole table — a tool module imported nowhere is not mounted",
    ).toBeGreaterThanOrEqual(7);

    const offenders: string[] = [];
    for (const file of toolModules) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const match of source.matchAll(VALUE_IMPORT)) {
        const specifier = match[1];
        if (
          specifier &&
          BANNED_ROOTS.some(
            (root) => specifier === root || specifier.startsWith(`${root}/`),
          )
        ) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      `a table module statically loads transport: ${offenders.join(", ")} — ` +
        `move the import INSIDE its handler (await import at call time), or give the ` +
        `pure concept a padi subpath of its own (the containingTerminal/watchScope precedent)`,
    ).toEqual([]);
  });
});
