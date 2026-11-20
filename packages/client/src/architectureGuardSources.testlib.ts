import { globSync, statSync } from "node:fs";
import { join } from "node:path";

const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

export function listGuardSourceFiles(target: string): string[] {
  if (!statSync(target).isDirectory())
    return isSourceFile(target) ? [target] : [];
  return globSync("**/*.{ts,tsx}", {
    cwd: target,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(target, rel));
}

type LexState = "code" | "lineComment" | "blockComment" | "'" | '"' | "`";

export function stripComments(text: string): string {
  const out = text.split("");
  let state: LexState = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") state = "lineComment";
      else if (c === "/" && n === "*") state = "blockComment";
      else if (c === "'" || c === '"' || c === "`") state = c;
      if (state === "lineComment" || state === "blockComment") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      }
      continue;
    }
    if (state === "lineComment") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "blockComment") {
      if (c === "*" && n === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        state = "code";
      } else if (c !== "\n") out[i] = " ";
      continue;
    }
    if (c === "\\") i++;
    else if (c === state) state = "code";
  }
  return out.join("");
}
