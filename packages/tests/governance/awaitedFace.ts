/**
 * The `await`-on-a-member-face ban — B8a.
 *
 * A `@kolu/surface` member face returns descriptions, not results: a unary verb
 * at `client.surface.<ns>.<verb>(x)` (or `client.procedures.<ns>.<verb>(x)`)
 * hands back an `Effect`, and a streaming verb hands back a `Stream`. Neither is
 * a `PromiseLike`.
 *
 * `await` on a non-thenable is LEGAL TypeScript. It evaluates to the value
 * unchanged. So `await client.surface.lifecycle.kill({ id })` compiles, passes
 * every type check, reads exactly like the pre-Effect code it replaced — and
 * does nothing at all. The call is never dispatched.
 *
 * That is not a hypothetical. Converting the face turned up four of these in
 * docs-facing example code and one in a daemon-gated acceptance test, where it
 * had silently disabled the drain the test existed to prove. Each was invisible
 * to `tsc`, to `biome`, and to review, because the line that is wrong is the line
 * that used to be right.
 *
 * Biome is not type-aware and TypeScript does not error on a non-thenable
 * `await`, so the rule is enforced the same way the run-edge budget is: by
 * scanning. The pattern is deliberately NARROW — `await` applied DIRECTLY to a
 * face call, with nothing between the two but a plain reference path. The
 * legitimate spellings are untouched:
 *
 *   - `await Effect.runPromise(client.surface.ns.verb(x))` — a call goes through
 *     a run, and a `(` intervenes, so it does not match;
 *   - `yield* client.surface.ns.verb(x)` — composition, no `await`;
 *   - `Stream.runHead(client.surface.cell.get(undefined))` — same.
 *
 * A `.surface`/`.procedures` property that is NOT a member face (a local object
 * that happens to use the name) would be a false positive. None exists today,
 * and the fix if one appears is to rename the local — the face's two names are
 * framework vocabulary, and shadowing them is its own hazard.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankNonCode } from "./runEdges";

/** `await <path>.surface.<ns>.<verb>(` — or `.procedures.`. The segment between
 *  `await` and the face name admits only a reference path (identifiers, dots),
 *  so any intervening CALL — `Effect.runPromise(`, `unwrap(` — fails to match. */
const AWAITED_FACE_CALL =
  /\bawait\s+[A-Za-z_$][A-Za-z0-9_$.]*\.(?:surface|procedures)\.[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g;

export interface AwaitedFaceHit {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  /** The offending text, trimmed. */
  readonly text: string;
}

/** Every `await`-on-a-face in `source`, with 1-based line numbers. Comments and
 *  string literals are blanked first (this ban is NAMED in prose in several
 *  files, including this one). */
export function findAwaitedFaceCalls(source: string): AwaitedFaceHit[] {
  const code = blankNonCode(source);
  const hits: AwaitedFaceHit[] = [];
  for (const match of code.matchAll(AWAITED_FACE_CALL)) {
    const before = code.slice(0, match.index);
    const line = before.split("\n").length;
    hits.push({ path: "", line, text: match[0].trim() });
  }
  return hits;
}

/** Directories with nothing to police. Deliberately SHORTER than the run-edge
 *  scan's list: `example` trees are consumer code people COPY, so a silently
 *  dead call there is worse than one inside a package, not exempt from it. */
const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

/** Scan EVERY TypeScript file under `packages/` — production, tests, testlibs
 *  and examples alike. Tests are in scope here where they are out of scope for
 *  the run-edge budget, and the difference is the point: a test IS a legitimate
 *  process edge, so it may RUN an effect, but a test that silently fails to
 *  dispatch the call it is asserting about is not a lesser bug than a production
 *  one — it is the bug that hides the others. One such test shipped green while
 *  the drain it existed to prove never fired. */
export function collectAwaitedFaceCalls(repoRoot: string): AwaitedFaceHit[] {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  const out: AwaitedFaceHit[] = [];
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    const source = readFileSync(full, "utf8");
    for (const hit of findAwaitedFaceCalls(source))
      out.push({ ...hit, path: file });
  }
  return out;
}

/** Throw unless nothing awaits a member face. There is no allowlist: unlike a
 *  run edge, this pattern has no legitimate instance to argue for. */
export function validateAwaitedFaceCalls(
  hits: readonly AwaitedFaceHit[],
): void {
  if (hits.length === 0) return;
  const lines = hits.map((h) => `  ${h.path}:${h.line}  ${h.text}`);
  throw new Error(
    "`await` applied to a member-face call — the call returns an `Effect`, not a " +
      "Promise, so awaiting it yields the description and NEVER DISPATCHES:\n" +
      `${lines.join("\n")}\n` +
      "Compose it (`yield*` inside an `Effect.gen`), or run it at a sanctioned " +
      "edge (`Effect.runPromise(...)`) if this really is a process/UI boundary.",
  );
}
