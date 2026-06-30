/**
 * Sealed-dispatch guard — the structural proof that PR-0's escape hatches stay gone.
 *
 * "Hard-pin local / bypass `HostLocation` at a per-terminal lifecycle seam" must be a
 * COMPILE error, which means there must be NO symbol a caller can import to reach the
 * local endpoint directly. The disease was three importable hatches:
 *
 *   - the `localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION)` aliases (terminals.ts
 *     + surface.ts) — hard-pinned local endpoints;
 *   - the eight `*Local*` per-terminal helpers (`beginSleepLocal`, `discardLocalSleeping`,
 *     …) + `reapUnrepresentablePty` — direct local-impl entry points that never routed;
 *   - `resolveTerminalEndpoint` imported widely (router, surface, terminals) — the
 *     resolver any seam could call with a hardcoded `LOCAL_LOCATION`.
 *
 * This walks the SOURCE tree (non-test) and asserts each hatch is gone: no alias, no
 * `*Local*` export, and `resolveTerminalEndpoint` / the local endpoint instance reachable
 * only from their one sanctioned importer. A future seam that re-imports either symbol
 * trips this test — the seam-hunt is now mechanical.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      out.push(full);
  }
  return out;
}

const FILES = srcFiles(SRC_DIR).map((f) => ({
  rel: path.relative(SRC_DIR, f),
  content: readFileSync(f, "utf8"),
}));

/** The identifiers `content` imports via the brace-import form (multi-line aware).
 *  Distinguishes a real import from a name merely mentioned in a comment. */
function importedSymbols(content: string): Set<string> {
  const names = new Set<string>();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/gs;
  for (const m of content.matchAll(re)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const name = raw
        .replace(/\btype\b/, "")
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const FORBIDDEN_EXPORTS = [
  "beginSleepLocal",
  "wakeLocalTerminal",
  "discardLocalSleeping",
  "seedSleepingTerminal",
  "adoptLocalTerminal",
  "adoptLocalOrphan",
  "adoptLocalInventoryOrphan",
  "releaseSleptLocalPty",
  "reapUnrepresentablePty",
];

const RESOLVE_TS = path.join("terminalEndpoint", "resolve.ts");
const LOCAL_TS = path.join("terminalEndpoint", "local.ts");

describe("sealed terminal dispatch — no escape hatch survives", () => {
  it("no `*Local*` per-terminal helper is exported anywhere", () => {
    for (const { rel, content } of FILES) {
      for (const name of FORBIDDEN_EXPORTS) {
        const exportRe = new RegExp(
          `export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}\\b`,
        );
        expect(
          exportRe.test(content),
          `${rel} must not export the deleted helper \`${name}\``,
        ).toBe(false);
      }
    }
  });

  it("no `localEndpoint` hard-pinned alias is declared", () => {
    for (const { rel, content } of FILES) {
      expect(
        /\bconst\s+localEndpoint\s*=/.test(content),
        `${rel} must not alias a hard-pinned local endpoint`,
      ).toBe(false);
    }
  });

  it("`resolveTerminalEndpoint` is imported ONLY by the lifecycle façade (terminals.ts)", () => {
    for (const { rel, content } of FILES) {
      if (rel === "terminals.ts") continue; // the façade — the sole sanctioned importer
      expect(
        importedSymbols(content).has("resolveTerminalEndpoint"),
        `${rel} must not import resolveTerminalEndpoint — route through the façade instead`,
      ).toBe(false);
    }
  });

  it("the local endpoint INSTANCE is imported ONLY by the host registry (resolve.ts)", () => {
    for (const { rel, content } of FILES) {
      if (rel === RESOLVE_TS || rel === LOCAL_TS) continue; // the registry + its definer
      expect(
        importedSymbols(content).has("localTerminalEndpoint"),
        `${rel} must not import the local endpoint instance — it is package-private`,
      ).toBe(false);
    }
  });
});
