import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listGuardSourceFiles,
  stripComments,
} from "./architectureGuardSources.testlib";

const CLIENT_SRC = dirname(fileURLToPath(import.meta.url));

const MEMBER_USE_RE =
  /\.(?:cells|collections)\.[A-Za-z_$][\w$]*\.use\(|\.entries\.use\(/g;

const FORBIDDEN_KEY_RE = /["']?\b(onError|authority|coalesceMs)\b["']?\s*:/;

function matchBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function scan(rawText: string, label: string): string[] {
  const text = stripComments(rawText);
  const g = new RegExp(MEMBER_USE_RE.source, "g");
  const hits: string[] = [];
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i] as string)) i++;
    if (text[i] !== "{") continue;
    const end = matchBrace(text, i);
    if (end === -1) continue;
    const bag = text.slice(i, end);
    const bad = FORBIDDEN_KEY_RE.exec(bag);
    if (bad) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push(`${label}:${line}: ${bad[1]}`);
    }
  }
  return hits;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of listGuardSourceFiles(CLIENT_SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(`${CLIENT_SRC}/`, "");
    for (const hit of scan(text, rel)) violations.push(hit);
  }
  return violations;
}

describe("surface policy use-site guard — no `onError`/`authority`/`coalesceMs` in any surface-member `.use({…})` bag (SR11: policy is declared on the spec, not the use-site)", () => {
  it("packages/client/src has no policy leaked onto a `.cells|.collections|.entries.…use({…})` bag — bags are bare or carry only `keys`", () => {
    expect(findViolations()).toEqual([]);
  });

  it("catches a leaked policy bag and ignores the legitimate shapes", () => {
    expect(
      scan(
        "const c = app.cells.preferences.use({ authority: 'local' });",
        "fx",
      ),
    ).toEqual(["fx:1: authority"]);
    expect(
      scan("const s = e.cells.session.use({ onError: (x) => f(x) });", "fx"),
    ).toEqual(["fx:1: onError"]);
    expect(
      scan(
        "const d = e.collections.daemonStatus.use({ keys: () => [k()] });",
        "fx",
      ),
    ).toEqual([]);
    expect(
      scan(
        "m.events.terminalExit.use(() => ({ id }), (c) => t(c), { onError: g });",
        "fx",
      ),
    ).toEqual([]);
    expect(scan("const p = app.cells.processMemory.use();", "fx")).toEqual([]);
    expect(
      scan('// surfaceApp.cells.buildInfo.use({ authority: "server" })', "fx"),
    ).toEqual([]);
    expect(
      scan("/* app.cells.preferences.use({ coalesceMs: 150 }) */", "fx"),
    ).toEqual([]);
    expect(
      scan('const s = e.cells.session.use({ "onError": h });', "fx"),
    ).toEqual(["fx:1: onError"]);
    expect(
      scan(
        'const d = e.collections.daemonStatus.use({ keys: () => ["onError"] });',
        "fx",
      ),
    ).toEqual([]);
  });
});
