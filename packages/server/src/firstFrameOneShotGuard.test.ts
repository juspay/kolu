/**
 * NEGATIVE-PROPERTY PIN (SR6 — adopt before you mint): no production consumer
 * open-codes a ONE-SHOT first-frame advance of an async stream where the existing
 * primitive fits. A snapshot-then-delta stream (a cell sub, a present-key
 * collection `get`, a `keys` stream, kaval's yields-once `exit` stream) OPENS with
 * its snapshot frame, so "read the first frame and stop" has one home:
 * `firstFrameOrThrow` / `firstFrameOrUndefined` (`@kolu/surface/first-frame`).
 * Hand-advancing the iterator instead — `for await (…) return frame` — is the
 * defect this adoption sweep deleted (kaval-tui's `readExitCode` and `consumeExit`,
 * SR6), and this test is the residual fence that keeps it deleted.
 *
 * THE SHAPE THE GUARD FLAGS (precise, AST — not a regex that a nested `(` in the
 * header would fool): a `for await (X of Y)` loop whose body reaches an
 * UNCONDITIONAL `return` or unlabeled `break` as a TOP-LEVEL statement (a direct
 * child of the loop body, not nested inside an `if`/`switch`/`try`). Such a loop
 * always exits on its first iteration → it consumes exactly one frame → it is a
 * one-shot first-frame advance. A snapshot-then-delta consumer never trips this:
 * its exits are CONDITIONAL (an `if (msg.kind === "overflow") break`, an
 * `if (m !== null) return`), nested inside a conditional, so the loop keeps
 * iterating — exactly why the primitive (which closes the iterator after one
 * frame) can't fit it, and why the guard must not flag it.
 *
 * SCOPE: `kaval-tui/src` + `server/src` — the two consumer trees where a surface
 * one-shot read occurs (kaval-tui's `exit` reads; server's `readPadiMemoryOnce`).
 * The sweep confirmed padi/client hold no such site, and a purely-syntactic scan
 * of those large trees would risk flagging a NON-surface one-shot the primitive
 * doesn't serve — so the scope is the two trees the property actually lives in.
 *
 * ALLOW-LIST: a genuine one-shot the primitive CANNOT express marks itself with a
 * `first-frame-guard:allow — <reason>` comment on (or just above) the `for await`.
 * The one standing entry is `readPadiMemoryOnce` (server/src/index.ts): its
 * empty-stream case returns a typed `PADI_MEMORY_READ_ERROR` sentinel and logs a
 * distinct line — a branch neither `firstFrameOrThrow` (throw) nor
 * `firstFrameOrUndefined` (undefined) can carry. The snapshot-then-delta sites need
 * no marker: the AST rule already excludes them (their exits are conditional).
 */

import { parse } from "@babel/parser";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_SRC = dirname(fileURLToPath(import.meta.url)); // packages/server/src
const PACKAGES = join(SERVER_SRC, "..", ".."); // packages/
const SCANNED_TREES = [join(PACKAGES, "kaval-tui", "src"), SERVER_SRC];

/** The sanctioned opt-out: a genuine one-shot the primitive can't express. Must
 *  carry a reason after the marker (the `—`), so an allow-list entry is never a
 *  silent mute. */
const ALLOW_MARKER = /first-frame-guard:allow\s*[—-]/;

/** A non-test `.ts`/`.tsx` source file. */
const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

function listSourceFiles(tree: string): string[] {
  return globSync("**/*.{ts,tsx}", {
    cwd: tree,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(tree, rel));
}

/** Recursively visit every AST node reachable through object/array properties. */
function walk(
  node: unknown,
  visit: (n: Record<string, unknown>) => void,
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.type === "string") visit(rec);
  for (const key of Object.keys(rec)) {
    if (
      key === "loc" ||
      key === "leadingComments" ||
      key === "trailingComments"
    )
      continue;
    walk(rec[key], visit);
  }
}

/** The direct statements of a loop body — the block's children, or the single
 *  braceless body statement. A top-level `return`/unlabeled `break` among them
 *  means the loop always exits on its first frame. */
function bodyStatements(
  body: Record<string, unknown>,
): Record<string, unknown>[] {
  if (body.type === "BlockStatement" && Array.isArray(body.body))
    return body.body as Record<string, unknown>[];
  return [body];
}

function isOneShotForAwait(node: Record<string, unknown>): boolean {
  if (node.type !== "ForOfStatement" || node.await !== true) return false;
  const body = node.body as Record<string, unknown>;
  return bodyStatements(body).some(
    (s) =>
      s.type === "ReturnStatement" ||
      (s.type === "BreakStatement" && s.label == null),
  );
}

/** The `for await` at 1-based `line` is allow-listed if the marker sits on that
 *  line or on the contiguous comment lines directly above it. */
function isAllowListed(lines: string[], line: number): boolean {
  if (ALLOW_MARKER.test(lines[line - 1] ?? "")) return true;
  for (let i = line - 2; i >= 0; i--) {
    const t = lines[i]?.trim() ?? "";
    if (t === "") continue;
    if (!(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))) break;
    if (ALLOW_MARKER.test(t)) return true;
  }
  return false;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const tree of SCANNED_TREES) {
    for (const file of listSourceFiles(tree)) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      const ast = parse(text, {
        sourceType: "module",
        plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
      });
      const rel = file.replace(`${PACKAGES}/`, "");
      walk(ast.program, (node) => {
        if (!isOneShotForAwait(node)) return;
        const line = (node.loc as { start: { line: number } } | undefined)
          ?.start.line;
        if (line !== undefined && isAllowListed(lines, line)) return;
        violations.push(`${rel}:${line ?? "?"}`);
      });
    }
  }
  return violations;
}

describe("first-frame one-shot guard — no open-coded one-shot first-frame advance where the primitive fits (SR6)", () => {
  it("kaval-tui/src + server/src open-code no one-shot `for await (…) return/break`; the yields-once first-frame read rides `firstFrameOrThrow`/`firstFrameOrUndefined`", () => {
    expect(findViolations()).toEqual([]);
  });

  // The detector's own competence: it flags a genuine one-shot and IGNORES a
  // snapshot-then-delta loop whose exits are conditional — the exact distinction
  // the guard turns on. A false-either-way detector would pass this block empty.
  it("flags an unconditional one-shot and spares a conditional-exit delta loop", () => {
    const collect = (src: string): string[] => {
      const ast = parse(src, { sourceType: "module", plugins: ["typescript"] });
      const hits: string[] = [];
      walk(ast.program, (n) => {
        if (isOneShotForAwait(n))
          hits.push(String((n.loc as { start: { line: number } }).start.line));
      });
      return hits;
    };
    // one-shot: braced return, braceless return, and settle-then-return.
    expect(
      collect(
        "async function f(){ for await (const m of await c.g({i})) { return m.x; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect("async function f(){ for await (const m of s) return m; }"),
    ).toEqual(["1"]);
    expect(
      collect(
        "async function f(){ for await (const _m of s) { g(); return; } }",
      ),
    ).toEqual(["1"]);
    // delta loop: every exit is nested in an `if` → keeps iterating → NOT flagged.
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m.k==='o') break; await w(m.d); } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m!==null) return m; buf+=m; } }",
      ),
    ).toEqual([]);
  });
});
