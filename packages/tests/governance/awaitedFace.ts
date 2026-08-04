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
 * scanning. TWO shapes are looked for.
 *
 * **1. The direct await** — `await` applied to a face call with nothing between
 * the two but a reference path (`await client.entry(A).procedures.ns.verb(x)`).
 * The legitimate spellings are untouched, and that is what lets the scan exist:
 *
 *   - `await Effect.runPromise(client.surface.ns.verb(x))` — the await lands on
 *     a run, whose parens NEST, so the path grammar cannot swallow it;
 *   - `yield* client.surface.ns.verb(x)` — composition, no `await`;
 *   - `Stream.runHead(client.surface.cell.get(undefined))` — same.
 *
 * **2. The await through a binding** — the two dodges the direct pattern misses,
 * both of which type-check and both of which silently never dispatch:
 *
 *   - the ALIAS: `const verb = client.surface.ns.verb; await verb(x)`;
 *   - the STORED DESCRIPTION: `const p = client.surface.ns.verb(x); await p`.
 *
 * A name bound to anything that STARTS as a face path is marked, and then any
 * `await <that name>` in the same file is a hit. Banning the binding itself —
 * the simpler rule — was rejected: three legitimate non-call face bindings exist
 * today (`surfaceAppProbe`'s `identity?.info` narrowing, the map harness's
 * per-member cast, a `.test-d.ts` type pin), each of which then CALLS or
 * composes the value. Marking is precise where a ban would be merely loud, and a
 * loud rule gets turned off.
 *
 * Destructuring is marked too, including `const { surface } = client` — the
 * face's two names are framework vocabulary, so a local binding of either name
 * is treated as the face wherever it came from.
 *
 * **Residual risk, stated so nobody mistakes this for a proof.** The marking is
 * one hop and one file: `const a = c.surface.ns.verb; const b = a; await b(x)`
 * escapes, so does an alias `export`ed and awaited in another module, and so
 * does a face handed to a helper that awaits its own parameter. A `.surface`
 * property that is NOT a member face would be a false positive; none exists
 * today, and the fix is to rename the local rather than to soften the scan. This
 * raises the cost of the dodge; a determined dodger still has room.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankNonCode } from "./runEdges";

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";
const FACE = "(?:surface|procedures)";
/** `.` or `?.`, with whitespace either side — a face path may wrap a line. */
const DOT = String.raw`\s*\??\.\s*`;
/** A reference path. Admits a CALL segment with no nested parens, so
 *  `client.entry(A).rpc` reads as one path — while `Effect.runPromise(c.surface
 *  .ns.verb(x))`, whose parens nest, cannot be read as one and so is not one. */
const REF = `${IDENT}(?:${DOT}${IDENT}|\\([^()]*\\))*`;

/** `await <path>.surface.<ns>.<verb>(` — or `.procedures.`. */
const AWAITED_FACE_CALL = new RegExp(
  `\\bawait\\s+${REF}${DOT}${FACE}${DOT}${IDENT}${DOT}${IDENT}\\s*\\(`,
  "g",
);

/** `const <name> = <path>.surface…` — the alias and the stored description
 *  alike, since both begin with a face path and only the trailing `(x)` tells
 *  them apart; neither may be awaited. */
const FACE_BINDING = new RegExp(
  `\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*${REF}${DOT}${FACE}\\b`,
  "g",
);

/** `const { verb } = <path>.surface.ns` — every name it binds is face-valued. */
const FACE_DESTRUCTURE = new RegExp(
  `\\b(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*=\\s*${REF}${DOT}${FACE}\\b`,
  "g",
);

/** Any destructure at all — inspected for a binding NAMED `surface` or
 *  `procedures`, which is the face by its own framework name whatever the right
 *  hand side is (`const { surface } = client`). */
const ANY_DESTRUCTURE = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=/g;

const AWAITED_NAME = new RegExp(`\\bawait\\s+(${IDENT})\\b`, "g");

export interface AwaitedFaceHit {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  /** The offending text, trimmed. */
  readonly text: string;
}

/** The names a destructuring pattern binds: `{ a, b: c, ...rest }` → a, c, rest. */
function boundNames(pattern: string): string[] {
  const names: string[] = [];
  for (const part of pattern.split(",")) {
    const target = part.includes(":")
      ? (part.split(":").pop() ?? "")
      : part.replace("...", "");
    const name = new RegExp(`^\\s*(${IDENT})`).exec(target)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

const lineOf = (code: string, index: number): number =>
  code.slice(0, index).split("\n").length;

/** Every `await`-on-a-face in `source`, with 1-based line numbers. Comments and
 *  string literals are blanked first (this ban is NAMED in prose in several
 *  files, including this one). */
export function findAwaitedFaceCalls(source: string): AwaitedFaceHit[] {
  const code = blankNonCode(source);
  const hits: AwaitedFaceHit[] = [];
  for (const match of code.matchAll(AWAITED_FACE_CALL)) {
    hits.push({
      path: "",
      line: lineOf(code, match.index),
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }

  /** Face-valued name → the line it was bound on, so a hit can cite it. */
  const faceBound = new Map<string, number>();
  const bind = (name: string, index: number): void => {
    if (!faceBound.has(name)) faceBound.set(name, lineOf(code, index));
  };
  for (const match of code.matchAll(FACE_BINDING))
    bind(match[1] ?? "", match.index);
  for (const match of code.matchAll(FACE_DESTRUCTURE))
    for (const name of boundNames(match[1] ?? "")) bind(name, match.index);
  for (const match of code.matchAll(ANY_DESTRUCTURE))
    for (const name of boundNames(match[1] ?? ""))
      if (name === "surface" || name === "procedures") bind(name, match.index);

  for (const match of code.matchAll(AWAITED_NAME)) {
    const name = match[1] ?? "";
    const boundAt = faceBound.get(name);
    if (boundAt === undefined) continue;
    hits.push({
      path: "",
      line: lineOf(code, match.index),
      text: `await ${name} — \`${name}\` is bound to a member face at line ${boundAt}`,
    });
  }
  return hits.sort((a, b) => a.line - b.line);
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
    "`await` applied to a member face — directly, or through a name bound to one. " +
      "A member call returns an `Effect`, not a Promise, so awaiting it yields the " +
      "description and NEVER DISPATCHES:\n" +
      `${lines.join("\n")}\n` +
      "Compose it (`yield*` inside an `Effect.gen`), or run it at a sanctioned " +
      "edge (`Effect.runPromise(...)`) if this really is a process/UI boundary.",
  );
}
