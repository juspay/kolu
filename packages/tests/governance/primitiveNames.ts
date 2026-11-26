/**
 * The unnamed-primitive ban — every reactive primitive carries a name.
 *
 * Solid 2's dev diagnostics address a source by its owner path: a finding
 * reads `ownerPath` + the primitive's name. A primitive bound to a declarator
 * takes that declarator's name for free — `const rows = createMemo(…)` is
 * reported as `rows`. One that is NOT bound to a declarator has no name to
 * take, so it is reported as the bare kind (`computed`, `signal`, `store`),
 * and every such primitive under an unnamed root collapses into ONE bucket.
 *
 * That is not a cosmetic loss. In the dev-mode e2e lane a single nameless
 * bucket absorbed 5 549 diagnostic events from a dozen distinct factories —
 * `WIDE_SCOPE_DEPS` from a works fold, `UNSTABLE_MEMO_OUTPUT` from three
 * empty-list memos and a relay-tear warning from the dock census, all under
 * the same `—` / `computed` row. Nothing in the report could say which file
 * to open. Naming them splits the bucket into per-memo, per-file findings; it
 * is the prerequisite that makes every other finding addressable.
 *
 * So the rule: a reactive primitive that YIELDS A NODE other code reads, and
 * is not bound to a `const`/`let`/`var` declarator, MUST pass a `name` IN ITS
 * OPTIONS ARGUMENT. The common shapes this catches are `return createMemo(…)`
 * straight out of a factory, a primitive handed to a property of an object
 * literal, and one passed as an argument to another call
 * (`makePersisted(createSignal(…), …)`, where the name has to come from the
 * caller).
 *
 * **There is no allowlist.** The two spellings that pass are both one line of
 * work: give the primitive a declarator and return it on the next line, or
 * pass `{ name: "…" }`. Either way the diagnostic gets an address.
 *
 * **The primitives, and WHERE their options sit** (`@solidjs/signals@2.0.4`:
 * `signals.d.ts`, `map.d.ts`, `deferred.d.ts`, `store/index.d.ts`,
 * `store/projection.d.ts`, `store/optimistic.d.ts`):
 *
 * | Primitive | Options argument |
 * | --- | --- |
 * | `createSignal`, `createOptimistic`, `createMemo`, `createDeferred` | 2nd |
 * | `mapArray`, `repeat` | 3rd |
 * | `createProjection` | 3rd (`fn, seed, options`) |
 * | `createStore`, `createOptimisticStore` | 2nd for the VALUE form, 3rd for the function (projection) form |
 *
 * **The effect primitives are deliberately OUT of scope** — `createEffect`,
 * `createRenderEffect`, `createTrackedEffect`, `createReaction`. An effect
 * yields no node for anyone to read, and its findings are already addressed:
 * the compiler carries a location for them, so the dev lane's rows read
 * `App.tsx:426:7 effect` / `Terminal.tsx:1393:7 effect` (Run A). No effect
 * finding was ever location-less. The gap review 41 §3 found was
 * declarator-less VALUE nodes, whose rows carry neither a name nor a `loc`,
 * and that is exactly what this scan closes. Banning nameless effects would
 * instead tax all 169 of them with hand-written names the compiler can never
 * supply.
 *
 * **The position is checked, not merely the presence of a `name`.** A `name`
 * in the wrong argument is not an options bag: `createProjection(fn, { name },
 * …)` hands the object over as the SEED, and the function form of
 * `createStore` does the same. Both read as named to a position-blind scan
 * and are nameless at runtime, so the scan resolves each call's options index
 * — for the two store factories, from whether the first argument is a
 * function literal — and looks for the `name` only there.
 *
 * `createSelector` and `createAsync` are NOT covered: `@solidjs/signals`
 * 2.0.4 exports neither. Add them here if a later Solid brings them back.
 *
 * **Scope: every `.ts`/`.tsx` file under `packages/` and `website/` except
 * `*.test.ts` / `*.test.tsx` / `*.test-d.ts`** — the same tree, and the same
 * `node:fs` walk, as the effect-cleanup ban next door, minus the test files.
 * That exclusion is a claim: a test's primitives never appear in the dev
 * lane's report of the PRODUCT, and a diagnostics test has a positive reason
 * to build a nameless primitive on purpose — `canvas/canvasStrictReads.test.tsx`
 * and `ui/resizableStrictReads.test.tsx` each construct one through an IIFE
 * precisely to assert what a location-less finding looks like. Testlibs
 * (`*.testlib.ts`) are NOT excluded: they are libraries compiled alongside
 * production source.
 *
 * **Matched by IMPORT, not by name.** A local called `createStore` that came
 * from somewhere other than Solid is not this scan's business, and a renamed
 * import (`import { createMemo as memo }`) is.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments, blankNonCode } from "./runEdges";

/** The primitives this ban covers, and the 0-based index of the argument that
 *  is their options bag. `"store"` is the two store factories, whose options
 *  sit second for the value form and third for the function (projection)
 *  form — see the header's table. */
const OPTIONS_INDEX: ReadonlyMap<string, number | "store"> = new Map<
  string,
  number | "store"
>([
  ["createSignal", 1],
  ["createOptimistic", 1],
  ["createMemo", 1],
  ["createDeferred", 1],
  ["mapArray", 2],
  ["repeat", 2],
  ["createProjection", 2],
  ["createStore", "store"],
  ["createOptimisticStore", "store"],
]);

/** The modules whose exports are Solid's own. `solid-js` re-exports the
 *  signals package, `solid-js/store` the store, and a few files reach for
 *  `@solidjs/signals` directly. */
const SOLID_MODULE = /^(?:solid-js(?:\/store)?|@solidjs\/signals)$/;

/** `import { a, b as c } from "solid-js"` — the clause and the specifier. */
const IMPORT_CLAUSE =
  /import\s*(?:type\s+)?\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g;

/** `const { createMemo } = await import("solid-js")` — the dynamic spelling. */
const DYNAMIC_IMPORT =
  /\{([^{}]*)\}\s*=\s*(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;

export interface PrimitiveNameHit {
  /** Repo-relative path, POSIX separators. Empty from the source-only scan. */
  readonly path: string;
  /** 1-based line number of the call. */
  readonly line: number;
  /** The primitive, e.g. `createMemo`. */
  readonly call: string;
  /** The call's head, trimmed and collapsed onto one line. */
  readonly text: string;
}

const lineOf = (code: string, index: number): number =>
  code.slice(0, index).split("\n").length;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Local name → the Solid primitive it stands for, for every Solid import in
 *  `code`. `import { createMemo as memo }` binds `memo` to `createMemo`. */
function solidLocals(code: string): Map<string, string> {
  const locals = new Map<string, string>();
  const take = (clause: string, specifier: string): void => {
    if (!SOLID_MODULE.test(specifier)) return;
    for (const part of clause.split(",")) {
      const [imported, local] = part.split(" as ").map((s) => s.trim());
      const exported = (imported ?? "").replace(/^type\s+/, "").trim();
      if (!OPTIONS_INDEX.has(exported)) continue;
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

/** The top-level, comma-separated arguments of the call opening at `open`, as
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

/** The index of the `(` that calls the name ending at `after`, or `null` when
 *  the name is not called there. An explicit type-argument list
 *  (`createSignal<number>(…)`) is stepped over; a statement boundary abandons
 *  the search, so a bare `a < b` cannot be taken for a call. */
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

/** A `const`/`let`/`var` declarator whose initialiser starts right where the
 *  call does: a plain name, a destructuring pattern, either with a type
 *  annotation. `const [value, setValue] = createSignal(…)` is the whole
 *  reason this ban has an exemption at all — that declarator IS the name. */
const DECLARATOR =
  /\b(?:const|let|var)\s+(?:\[[^\]]*\]|\{[^{}]*\}|[\w$]+)\s*(?::[^=;]*)?=\s*$/;

/** Whether the call at `start` is bound to a declarator. Only the text since
 *  the last line break plus the preceding line is read: a declarator's name
 *  and its `=` sit on the call's own line in every spelling biome produces. */
function hasDeclarator(code: string, start: number): boolean {
  return DECLARATOR.test(code.slice(Math.max(0, start - 400), start));
}

/** A top-level `name` property of the object literal spanning `[start, end)`,
 *  or of nothing when the span is not an object literal. Both spellings
 *  count: `name: "rows"` and the shorthand `name` a factory that takes the
 *  name from its caller passes. */
function carriesName(code: string, start: number, end: number): boolean {
  const text = code.slice(start, end).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return false;
  const inner = text.slice(1, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (depth === 0 && /^name\s*(?::|,|$)/.test(inner.slice(i).trim())) {
      const before = inner.slice(0, i).trimEnd().slice(-1);
      if (before === "" || !/[\w$.]/.test(before)) return true;
    }
  }
  return false;
}

/** Whether the argument spanning `[start, end)` is a function literal — an
 *  arrow or a `function` expression. The two store factories take their
 *  options third when their first argument is one (the projection form) and
 *  second when it is a plain value. */
function isFunctionArgument(code: string, start: number, end: number): boolean {
  const text = code.slice(start, end).trim();
  if (/^(?:async\s+)?function\b/.test(text)) return true;
  let depth = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    const ch = text[i] ?? "";
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (depth === 0 && ch === "=" && text[i + 1] === ">") return true;
  }
  return false;
}

/** The 0-based index of `exported`'s options argument for THIS call. */
function optionsIndexOf(
  exported: string,
  code: string,
  spans: readonly (readonly [number, number])[],
): number {
  const declared = OPTIONS_INDEX.get(exported);
  if (declared !== "store") return declared ?? 1;
  const first = spans[0];
  return first !== undefined && isFunctionArgument(code, first[0], first[1])
    ? 2
    : 1;
}

/** Every unnamed, declarator-less primitive in `source`, with 1-based line
 *  numbers. Comments and string literals are blanked first — this ban is
 *  NAMED in prose in several files, including this one and its test. */
export function findPrimitiveNameHits(source: string): PrimitiveNameHit[] {
  const code = blankNonCode(source);
  // The import clause is read from the view that KEPT string literals: the
  // module specifier is the question, and both views share offsets.
  const locals = solidLocals(blankComments(source));
  if (locals.size === 0) return [];
  const hits: PrimitiveNameHit[] = [];
  for (const [local, exported] of locals) {
    const call = new RegExp(`(^|[^.\\w$])${local}(?![\\w$])`, "g");
    for (const match of code.matchAll(call)) {
      const nameStart = match.index + match[0].length - local.length;
      const open = callOpenParen(code, match.index + match[0].length);
      if (open === null) continue;
      if (hasDeclarator(code, nameStart)) continue;
      const spans = argumentSpans(code, open);
      if (spans === null) continue;
      const options = spans[optionsIndexOf(exported, code, spans)];
      if (options !== undefined && carriesName(code, options[0], options[1]))
        continue;
      hits.push({
        path: "",
        line: lineOf(code, nameStart),
        call: exported,
        text: oneLine(code.slice(nameStart, Math.min(open + 60, code.length))),
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Directories with nothing to police — the same shortlist the sibling scans
 *  use. */
const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

/** `foo.test.ts`, `foo.test.tsx`, `foo.test-d.ts` — see the header's scope
 *  claim. */
const TEST_FILE = /\.test(?:-d)?\.tsx?$/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !TEST_FILE.test(entry))
      out.push(full);
  }
}

/** Scan every TypeScript file under `packages/` and `website/`. */
export function collectPrimitiveNameHits(repoRoot: string): PrimitiveNameHit[] {
  const files: string[] = [];
  for (const root of ["packages", "website"]) {
    const dir = path.join(repoRoot, root);
    if (statSync(dir).isDirectory()) walk(dir, files);
  }
  const out: PrimitiveNameHit[] = [];
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    for (const hit of findPrimitiveNameHits(readFileSync(full, "utf8")))
      out.push({ ...hit, path: file });
  }
  return out;
}

/** Throw unless every declarator-less primitive carries a name. */
export function validatePrimitiveNameHits(
  hits: readonly PrimitiveNameHit[],
): void {
  if (hits.length === 0) return;
  const lines = hits.map((h) => `  ${h.path}:${h.line}  ${h.call}  ${h.text}`);
  throw new Error(
    "a reactive primitive with neither a declarator nor a `name` — Solid's dev " +
      "diagnostics report it as the bare kind, so it folds into one nameless " +
      "bucket with every other anonymous primitive under the same owner:\n" +
      `${lines.join("\n")}\n` +
      'Bind it to a `const` and return that, or pass `{ name: "…" }`.',
  );
}
