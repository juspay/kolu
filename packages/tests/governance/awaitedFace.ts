import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankCommentsAndStrings } from "./runEdges";

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";
const FACE = "(?:surface|procedures)";
const DOT = String.raw`\s*\??\.\s*`;
const REF = `${IDENT}(?:${DOT}${IDENT}|\\([^()]*\\))*`;

const AWAITED_FACE_CALL = new RegExp(
  `\\bawait\\s+${REF}${DOT}${FACE}${DOT}${IDENT}${DOT}${IDENT}\\s*\\(`,
  "g",
);

const FACE_BINDING = new RegExp(
  `\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*${REF}${DOT}${FACE}\\b`,
  "g",
);

const FACE_DESTRUCTURE = new RegExp(
  `\\b(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*=\\s*${REF}${DOT}${FACE}\\b`,
  "g",
);

const ANY_DESTRUCTURE = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=/g;

const AWAITED_NAME = new RegExp(`\\bawait\\s+(${IDENT})\\b`, "g");

export interface AwaitedFaceHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

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

export function findAwaitedFaceCalls(source: string): AwaitedFaceHit[] {
  const code = blankCommentsAndStrings(source);
  const hits: AwaitedFaceHit[] = [];
  for (const match of code.matchAll(AWAITED_FACE_CALL)) {
    hits.push({
      path: "",
      line: lineOf(code, match.index),
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }

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

const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

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
