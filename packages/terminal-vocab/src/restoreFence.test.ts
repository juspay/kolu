/**
 * The EXECUTE-PATH FENCE, as a grep law.
 *
 * **PTY output is a sensor. Nothing that executes may read a value whose
 * provenance is PTY bytes.**
 *
 * The forgery this PR closes was not one bad function — it was a *permission*:
 * a value read off a shell's `OSC 633;E` mark was allowed to travel into a
 * persisted restore target and be typed on wake. A schema can make the old
 * shape unspellable, but nothing in the type system stops the next feature from
 * importing the mark and starting again. This test is that missing rule.
 *
 * Two laws, both mechanical:
 *
 *   1. The wire mark (`commandRun`) is reachable from exactly the files that
 *      carry it — kaval's producer, padi's bridge, and the sensor that turns its
 *      head into a shim hint. A new consumer anywhere under `packages/` fails
 *      here, even if its types are sound.
 *   2. The recent-agents MRU writer (`trackRecentAgent`) is called from exactly
 *      one production site — the endpoint's LIVE-agent arm. A mark can never feed
 *      it.
 *
 * Plus the compile-time half: `TerminalEvent` has no `commandRun` arm, so the
 * fold cannot even be handed one.
 */

import fs from "node:fs";
import path from "node:path";
import { AgentMemorySchema, type TerminalEvent } from "./schema.ts";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
// Production source only: `packages/tests` is the e2e harness (it TYPES marks
// into terminals on purpose), so a mention there is not a consumer.
const SOURCE_ROOTS = ["packages"];
const EXCLUDED_DIRS = ["packages/tests"];

/** Every non-test source file, repo-relative with forward slashes. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|testlib)\.(ts|tsx)$/.test(entry.name)) continue;
      out.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  };
  for (const root of SOURCE_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out.filter(
    (rel) => !EXCLUDED_DIRS.some((dir) => rel.startsWith(`${dir}/`)),
  );
}

/** Files whose CODE (not prose) mentions `needle` — a comment naming a concept
 *  is documentation, not a dependency. */
function filesMatching(needle: string): string[] {
  return sourceFiles().filter((rel) =>
    fs
      .readFileSync(path.join(REPO_ROOT, rel), "utf8")
      .split("\n")
      .some(
        (line) =>
          line.includes(needle) &&
          !line.trimStart().startsWith("//") &&
          !line.trimStart().startsWith("*") &&
          !line.trimStart().startsWith("/*"),
      ),
  );
}

describe("PTY output is a sensor — the execute-path fence", () => {
  it("only the mark's carrier files may mention `commandRun`", () => {
    // kaval produces the wire mark (and serves it), padi's bridge forwards it,
    // and the sensor takes its head basename. The shell-side emitter writes a raw
    // OSC sequence, so it needs no mention of the stream. Anything else here is a
    // new consumer of PTY bytes and must be argued in review.
    expect(filesMatching("commandRun").sort()).toEqual([
      "packages/kaval/src/inProcessPtyHost.ts",
      "packages/kaval/src/ptyHost.ts",
      "packages/kaval/src/ptyHostSurface.ts",
      "packages/padi/src/terminalEndpoint/local.ts",
      "packages/padi/src/terminalWorkspace/sensors.ts",
    ]);
  });

  it("the recent-agents MRU has exactly one production writer, fed by detection", () => {
    expect(filesMatching("trackRecentAgent").sort()).toEqual([
      "packages/padi/src/activity/activity.ts",
      "packages/padi/src/terminalEndpoint/local.ts",
    ]);
  });

  it("only kaval (and padi's one bridge) may read the retained mark", () => {
    expect(filesMatching("getLastCommand").sort()).toEqual([
      "packages/kaval/src/ptyHost.ts",
    ]);
  });

  it("compile-time: `TerminalEvent` has no commandRun arm to hand the fold", () => {
    type CommandRunArm = Extract<TerminalEvent, { kind: "commandRun" }>;
    const _pin: CommandRunArm extends never ? true : false = true;
    expect(_pin).toBe(true);
  });

  it("schema: the remembered memory pair has no launch line", () => {
    expect(Object.keys(AgentMemorySchema.fields).sort()).toEqual([
      "lastActivityAt",
      "promptedAt",
    ]);
  });
});
