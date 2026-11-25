/**
 * The expression-bodied effect-apply ban — the Solid 2 cleanup trap.
 *
 * In Solid 2 an effect's APPLY phase returns its cleanup. The production build
 * stores whatever it is handed — the type check is compiled out — and calls it
 * as `f?.()` at the head of the next run. `undefined` and `null` are dropped,
 * but ANY other value throws a `TypeError` from inside the scheduler, which
 * escalates to `haltReactivity`: a permanent, nameless halt of the whole view.
 * The dev build instead throws at the FIRST run, with "callback returned an
 * invalid cleanup value". Either way the page stops updating.
 *
 * So a concise (expression) arrow body in an apply position is a loaded gun,
 * because the value of the last expression IS the return value:
 *
 *   createEffect(held, (held) => report(held));      // `report` is a SETTER:
 *                                                    // returns `false` → halt
 *   createEffect(anchor, () => composer.close());    // `close` is `() =>
 *                                                    // setTarget(null)` → a
 *                                                    // `null` dev throws on
 *
 * Both of those shipped in this repo and both are the real pre-fix text of a
 * defect this scan exists to have caught: the peek's scroll-back halt and the
 * comment composer's dev throw. On master the apply arm's return value was
 * merely the next run's `prev`, so this whole class is NEW with Solid 2.
 *
 * TypeScript cannot see it. A `Setter<boolean>` is assignable to
 * `(held: boolean) => void`, and `() => report(held)` is then typed `void` by
 * TypeScript's void-return rule — a rule no Solid type can close without
 * rejecting every legitimate `() => someVoidCall()`. Biome is not type-aware,
 * has no plugin in this repo, and a comment stating the rule (written the day
 * before, in `ui/SegmentedControl.tsx`) did not stop either defect. So the rule
 * is enforced the same way the `await`-on-a-face ban is: by scanning.
 *
 * **The positions.** The APPLY ARM — the second argument — of `createEffect`
 * and `createRenderEffect`, and the CALLBACK — the first argument — of
 * `createTrackedEffect`, `createReaction` and `onSettled`. The compute arm (the
 * first argument of `createEffect`) is deliberately NOT a position: its value is
 * the apply arm's input, so a concise body there is the normal spelling.
 *
 * **The rule.** An expression body in one of those positions is a hit. A block
 * body with an explicit `return <cleanup>` is the only sanctioned way to hand
 * back a cleanup, which is the whole point: "this returns a cleanup on purpose"
 * becomes something a reader (and a reviewer) can see. Three sites in the tree
 * legitimately return one and all three are written that way.
 *
 * **`async` is a hit whatever the body.** `createEffect(dep, async (v) => {
 * … })` and `onSettled(async () => { … })` answer with a Promise, braces or
 * not, so the block cannot save them: start the promise inside the body and
 * answer with nothing. An async COMPUTE arm is legitimate — Solid awaits it —
 * and the compute arm is not a position.
 *
 * **The `{ effect, error }` bundle.** `createEffect` and `createReaction` also
 * take a bundle instead of a bare function (`EffectBundle` in
 * `@solidjs/signals`'s `signals.d.ts`), and the runtime then reads
 * `effectFn.effect || effectFn`, so the `effect:` value is the apply arm with
 * the trap intact. The `error:` value is held to the same rule: its return is
 * discarded today, but it runs on the same queue in the same phase, an `async`
 * one detaches its own throw from the escalation path, and one rule for both
 * arms is what keeps the bundle from becoming the hole the rule is read
 * around. A method shorthand (`effect(v) { … }`) is already a block, and
 * passes unless it is async.
 *
 * **Matching the IMPORT, not the name.** Only names this file imports from
 * `solid-js` (or `@solidjs/signals` directly) are positions. `onSettled` in
 * particular is an ordinary English word already used as a callback PARAMETER in
 * this repo (`terminal/splitPanelState.ts`), and a scan that matched the bare
 * name would condemn it — a loud rule gets turned off, so this one is precise.
 * The destructured dynamic import (`const { onSettled } = await
 * import("solid-js")`, which a test uses) counts as an import too.
 *
 * **Residual risk.** An apply arm passed as a named reference
 * (`createEffect(dep, applyIt)`) is not inspected, and neither is one reached
 * through a re-export under a different module specifier. Three more shapes
 * walk past: a namespace import (`import * as solid`, then
 * `solid.createEffect(…)`), which this scan reads as a method call on an
 * object of its own; an arrow wrapped in parentheses or an `as` cast
 * (`createEffect(dep, ((v) => apply(v)) as Apply)`), whose `=>` is no longer
 * top-level in the argument; and a bundle arm written as a shorthand property
 * (`{ effect }`), which is a named reference under another spelling. All of
 * them are outside what a lexical scan can know; the shapes that actually
 * shipped are inside it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments, blankNonCode } from "./runEdges";

/** Position name → the 0-based argument index that is the apply/cleanup arm. */
const POSITIONS: ReadonlyMap<string, number> = new Map([
  ["createEffect", 1],
  ["createRenderEffect", 1],
  ["createTrackedEffect", 0],
  ["createReaction", 0],
  ["onSettled", 0],
]);

/** The modules whose exports are Solid's own. `solid-js` re-exports the signals
 *  package, and a few files reach for it directly. */
const SOLID_MODULE = /^(?:solid-js|@solidjs\/signals)$/;

/** `import { a, b as c } from "solid-js"` — the clause and the specifier. */
const IMPORT_CLAUSE =
  /import\s*(?:type\s+)?\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g;

/** `const { onSettled } = await import("solid-js")` — the dynamic spelling. */
const DYNAMIC_IMPORT =
  /\{([^{}]*)\}\s*=\s*(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;

export interface EffectCleanupHit {
  /** Repo-relative path, POSIX separators. Empty from the source-only scan. */
  readonly path: string;
  /** 1-based line number of the offending arrow. */
  readonly line: number;
  /** The position's function, e.g. `createEffect`. */
  readonly call: string;
  /** The offending text, trimmed and collapsed onto one line. */
  readonly text: string;
}

const lineOf = (code: string, index: number): number =>
  code.slice(0, index).split("\n").length;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Local name → the Solid export it stands for, for every Solid import in
 *  `code`. `import { createEffect as fx }` binds `fx` to `createEffect`. */
function solidLocals(code: string): Map<string, string> {
  const locals = new Map<string, string>();
  const take = (clause: string, specifier: string): void => {
    if (!SOLID_MODULE.test(specifier)) return;
    for (const part of clause.split(",")) {
      const [imported, local] = part.split(" as ").map((s) => s.trim());
      const exported = (imported ?? "").replace(/^type\s+/, "").trim();
      if (!POSITIONS.has(exported)) continue;
      locals.set(
        local !== undefined && local !== "" ? local : exported,
        exported,
      );
    }
  };
  for (const match of code.matchAll(IMPORT_CLAUSE))
    take(match[1] ?? "", match[2] ?? "");
  for (const match of code.matchAll(DYNAMIC_IMPORT))
    take(match[1] ?? "", match[2] ?? "");
  return locals;
}

/** The top-level, comma-separated members of the bracketed group opening at
 *  `open` — a call's arguments, or an object literal's properties — as
 *  `[start, end)` spans into `code`. `null` when the bracket never closes. */
function argumentSpans(
  code: string,
  open: number,
): readonly (readonly [number, number])[] | null {
  const spans: (readonly [number, number])[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        if (code.slice(start, i).trim() !== "") spans.push([start, i]);
        return spans;
      }
    } else if (ch === "," && depth === 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/** The index just past the `=>` of the arrow `arg` IS, or `null` when `arg` is
 *  not an arrow (a named reference, a `function` expression, a call). Only a
 *  top-level `=>` counts, so a default parameter value that is itself an arrow
 *  cannot be mistaken for the arrow's own. */
function arrowBodyStart(
  code: string,
  start: number,
  end: number,
): number | null {
  let depth = 0;
  for (let i = start; i < end - 1; i += 1) {
    const ch = code[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (depth === 0 && ch === "=" && code[i + 1] === ">") return i + 2;
  }
  return null;
}

/** The index of the `(` that calls the name ending at `after`, or `null` when
 *  the name is not called there. An explicit type-argument list
 *  (`createEffect<number>(…)`, `createEffect<A, B>(…)`) is stepped over; the
 *  `>` of an arrow type inside it is not read as the list's end, and a
 *  statement boundary abandons the search, so a bare `a < b` cannot be taken
 *  for a call. */
function callOpenParen(code: string, after: number): number | null {
  let i = after;
  while (/\s/.test(code[i] ?? "")) i += 1;
  if (code[i] === "<") {
    let depth = 0;
    for (; i < code.length; i += 1) {
      const ch = code[i] ?? "";
      if (ch === "<") depth += 1;
      else if (ch === ">" && code[i - 1] !== "=") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      } else if (ch === ";" || ch === "{" || ch === "}") return null;
    }
    if (depth !== 0) return null;
    while (/\s/.test(code[i] ?? "")) i += 1;
  }
  return code[i] === "(" ? i : null;
}

/** An offending arm: the index to report it at, and its text. */
interface ArmHit {
  readonly index: number;
  readonly text: string;
}

/** `async` as the arm's own modifier, rather than the head of a name. */
const ASYNC_ARM = /^async(?:[\s(<]|$)/;

/** The arm spanning `[start, end)`, inspected. `null` when it cannot hand back
 *  a value by accident: a synchronous braced body, a named reference, anything
 *  that is not a function literal at all. */
function armHit(code: string, start: number, end: number): ArmHit | null {
  const whole = code.slice(start, end);
  const text = whole.trim();
  const body = arrowBodyStart(code, start, end);
  const isFunction = body !== null || /^async\s+function\b/.test(text);
  if (ASYNC_ARM.test(text) && isFunction)
    return {
      index: start + whole.length - whole.trimStart().length,
      text: oneLine(whole),
    };
  if (body === null) return null;
  if (code.slice(body, end).trimStart().startsWith("{")) return null;
  return { index: body, text: oneLine(whole) };
}

/** A bundle property that runs in the effect phase: `effect: value`,
 *  `error(e) { … }` and their `async` spellings. */
const BUNDLE_ARM = /^\s*(?:(async)\s+)?(?:effect|error)\s*([:(])/;

/** Every offending arm of the apply position spanning `[start, end)`: the arm
 *  itself, or — when the position holds an `{ effect, error }` bundle — each of
 *  its two values. */
function applyArmHits(code: string, start: number, end: number): ArmHit[] {
  const brace = code.indexOf("{", start);
  if (brace === -1 || brace >= end || code.slice(start, brace).trim() !== "") {
    const hit = armHit(code, start, end);
    return hit === null ? [] : [hit];
  }
  const hits: ArmHit[] = [];
  for (const [from, to] of argumentSpans(code, brace) ?? []) {
    const property = code.slice(from, to);
    const match = BUNDLE_ARM.exec(property);
    if (match === null) continue;
    const text = oneLine(property);
    if (match[2] === "(") {
      // A method shorthand is a block body; only its `async` spelling answers
      // with a Promise.
      if (match[1] === undefined) continue;
      hits.push({
        index: from + property.length - property.trimStart().length,
        text,
      });
      continue;
    }
    const hit = armHit(code, from + match[0].length, to);
    if (hit !== null) hits.push({ index: hit.index, text });
  }
  return hits;
}

/** Every offending apply arm in `source`, with 1-based line numbers. Comments
 *  and string literals are blanked first — this ban is NAMED in prose in
 *  several files, including this one and its test. */
export function findEffectCleanupHits(source: string): EffectCleanupHit[] {
  const code = blankNonCode(source);
  // The import clause is read from the view that KEPT string literals: the
  // module specifier is the question, and both views share offsets.
  const locals = solidLocals(blankComments(source));
  if (locals.size === 0) return [];
  const hits: EffectCleanupHit[] = [];
  for (const [local, exported] of locals) {
    const call = new RegExp(`(^|[^.\\w$])${local}(?![\\w$])`, "g");
    for (const match of code.matchAll(call)) {
      const open = callOpenParen(code, match.index + match[0].length);
      if (open === null) continue;
      const spans = argumentSpans(code, open);
      const span = spans?.[POSITIONS.get(exported) ?? 0];
      if (span === undefined) continue;
      for (const hit of applyArmHits(code, span[0], span[1]))
        hits.push({
          path: "",
          line: lineOf(code, hit.index),
          call: exported,
          text: hit.text,
        });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Directories with nothing to police — the same shortlist the face scan uses. */
const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

/** Scan every TypeScript file under `packages/` and `website/` — production,
 *  tests and testlibs alike. A test that halts reactivity on its second run is
 *  not a lesser bug: it is the one that hides the others. */
export function collectEffectCleanupHits(repoRoot: string): EffectCleanupHit[] {
  const files: string[] = [];
  for (const root of ["packages", "website"]) {
    const dir = path.join(repoRoot, root);
    if (statSync(dir).isDirectory()) walk(dir, files);
  }
  const out: EffectCleanupHit[] = [];
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    for (const hit of findEffectCleanupHits(readFileSync(full, "utf8")))
      out.push({ ...hit, path: file });
  }
  return out;
}

/** Throw unless every apply arm is braced. There is no allowlist: a cleanup is
 *  spelled `return`, and a non-cleanup is spelled with a statement. */
export function validateEffectCleanupHits(
  hits: readonly EffectCleanupHit[],
): void {
  if (hits.length === 0) return;
  const lines = hits.map((h) => `  ${h.path}:${h.line}  ${h.call}  ${h.text}`);
  throw new Error(
    "an expression-bodied arrow in an effect's apply position — its value IS the " +
      "returned cleanup, so a setter's `false` or a helper's `null` halts " +
      "reactivity in prod and throws in dev:\n" +
      `${lines.join("\n")}\n` +
      "Give the arrow a BLOCK body. If it really does return a cleanup, say so " +
      "with an explicit `return`.",
  );
}
