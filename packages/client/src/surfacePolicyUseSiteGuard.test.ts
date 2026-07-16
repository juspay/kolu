/**
 * NEGATIVE-PROPERTY PIN (SR11 — client error policy is DECLARED, not hand-wired): no
 * surface-member `.use(...)` options bag in `packages/client/src` carries `onError`,
 * `authority`, or `coalesceMs`. Those moved onto the member SPEC (`client.onError` /
 * `client.authority` / `client.coalesceMs` on `koluSurface` + `padiSurface`) and route
 * through the ONE `interpretClientError`, so a use-site's bag is now EMPTY (a bare cell
 * `.use()`) or carries ONLY the genuine per-site `keys` reactive filter for a
 * collection. This test is the residual fence that keeps a stray policy from creeping
 * back onto a use-site.
 *
 * The precise line the pin draws:
 *  - A surface member call is `x.cells.<m>.use(`, `x.collections.<m>.use(`, or
 *    `x.entries.use(` — the bound `.use(policy)` hooks off `app` / `padiMap` /
 *    `padiMap.entry(host)`.
 *  - Only the SINGLE-ARG OPTIONS BAG form is a violation: a `.use(` whose first
 *    argument is an object literal (`.use({ … })`). The `events.terminalExit.use(
 *    inputFn, handler, { onError })` POSITIONAL form (its `onError` is arg-3 site
 *    wiring — an inputFn + handler + custom NOT_FOUND swallow, intrinsic, NOT a
 *    declared policy) is deliberately EXCLUDED: its first arg is a `(`, not a `{`,
 *    and `events.*` isn't a scanned member prefix either.
 *  - `keys` in a collection bag is FINE (a genuine per-site reactive filter, not a
 *    policy) — only `onError` / `authority` / `coalesceMs` are forbidden.
 *
 * The ONE interpreter (`interpretClientError`, `wire.ts`) is where policy is READ; it
 * has no member `.use(` bag of its own, so nothing there trips this. Scope: the whole
 * `packages/client/src` tree (non-test).
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "./architectureGuardSources.testlib";

const CLIENT_SRC = dirname(fileURLToPath(import.meta.url)); // packages/client/src

/** A surface-member `.use(` call opener — `x.cells.<m>.use(`, `x.collections.<m>.use(`,
 *  or the membership `x.entries.use(`. Matches the member access prefix so an
 *  unrelated `.use(` (a router, a primitive with the same verb) never trips the scan. */
const MEMBER_USE_RE =
  /\.(?:cells|collections)\.[A-Za-z_$][\w$]*\.use\(|\.entries\.use\(/g;

/** The forbidden policy keys — declared on the member SPEC now, never a use-site bag.
 *  Matches only in KEY POSITION (the word, optionally quoted, immediately followed by
 *  `:`), so a real `onError:` / `"onError":` property is CAUGHT while the same word
 *  appearing as a string VALUE (`keys: () => ["onError"]`) is ignored — the false
 *  positive that motivated (and is better handled here than by) blanking string bodies. */
const FORBIDDEN_KEY_RE = /["']?\b(onError|authority|coalesceMs)\b["']?\s*:/;

/** Replace every `//`-line and `/* … *​/`-block COMMENT body with spaces (newlines
 *  preserved, so byte offsets and line numbers are unchanged), leaving STRING bodies
 *  intact — a guard scans CODE, not the prose in a docstring (which legitimately shows
 *  `…use({ authority: "server" })`). Escapes and the three quote kinds are honoured so a
 *  `//` inside a string is not mistaken for a comment.
 *
 *  Why NOT blank string bodies too (codex F5, considered and rejected): a real
 *  QUOTED key — `.use({ "onError": h })` — is a string token `"onError"` and a genuine
 *  forbidden use the guard MUST catch, so blanking string bodies would silence it (a
 *  false NEGATIVE). The false-positive it would prevent — a full `.use({ onError })`
 *  snippet living INSIDE a string literal — does not occur in `packages/client/src` and,
 *  if it ever did, fails LOUD (a red test a dev fixes), never silent. A regression guard
 *  must prefer a loud false-positive over a silent false-negative, so comments-only +
 *  the KEY-POSITION {@link FORBIDDEN_KEY_RE} (which ignores a forbidden word appearing as
 *  a string VALUE, e.g. `keys: ["onError"]`) is the right trade. A full AST lint would
 *  be disproportionate for this fence.
 *
 *  KNOWN GAP (accepted): a member ALIASED before `.use()` (`const c = app.cells.x;
 *  c.use({ onError })`) — no in-repo code does that, and the primary enforcement is
 *  structural (a migrated member declares its policy on the spec, so a use-site bag is a
 *  review-visible regression, not the sole line of defence). Removing the option keys
 *  from the bound `.use()` type is NOT the fix — it would break the legitimate NON-policy
 *  use-site `onError` path a member WITHOUT a declared policy still relies on. */
function blankComments(text: string): string {
  const out = text.split("");
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") state = "line";
      else if (c === "/" && n === "*") state = "block";
      else if (c === "'" || c === '"' || c === "`") state = c;
      if (state === "line" || state === "block") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      }
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        state = "code";
      } else if (c !== "\n") out[i] = " ";
      continue;
    }
    // Inside a string literal — leave bytes intact; honour escapes and the closer.
    if (c === "\\") i++;
    else if (c === state) state = "code";
  }
  return out.join("");
}

/** From `text[open]` (which MUST be `{`), return the index just past the matching
 *  `}` — a brace-depth walk that skips `'`/`"`/`` ` `` string bodies so a brace
 *  inside a string literal never miscounts. Returns `-1` if unbalanced (a truncated
 *  file). Sufficient for the tiny option bags here. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\")
        i++; // skip an escaped char inside the string
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

/** Every violating member-`.use({ … })` bag in `text`, reported as
 *  `"<label>:<line>: <key>"`. Only a SINGLE-ARG options bag (first arg `{`) is
 *  considered; a positional/bare `.use(` is skipped. */
function scan(rawText: string, label: string): string[] {
  const text = blankComments(rawText);
  const g = new RegExp(MEMBER_USE_RE.source, "g");
  const hits: string[] = [];
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    // First non-space char after the `.use(` opener.
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i] as string)) i++;
    if (text[i] !== "{") continue; // positional handler / bare `.use()` — allowed
    const end = matchBrace(text, i);
    if (end === -1) continue;
    const bag = text.slice(i, end);
    const bad = FORBIDDEN_KEY_RE.exec(bag);
    if (bad) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push(`${label}:${line}: ${bad[1]}`); // the key word, not the trailing `:`
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

  // The scanner's own competence — it MUST catch a forbidden single-arg bag, IGNORE a
  // collection bag carrying only `keys` (even a `keys: () => [...]` value with a `)` in
  // it), IGNORE the `events.*.use(inputFn, handler, {onError})` positional form, and
  // IGNORE a bare `.use()`.
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
    // `keys` only — allowed, even with a `)` inside the value.
    expect(
      scan(
        "const d = e.collections.daemonStatus.use({ keys: () => [k()] });",
        "fx",
      ),
    ).toEqual([]);
    // Positional event form (`onError` is arg-3, not a member options bag) — ignored.
    expect(
      scan(
        "m.events.terminalExit.use(() => ({ id }), (c) => t(c), { onError: g });",
        "fx",
      ),
    ).toEqual([]);
    // Bare use — ignored.
    expect(scan("const p = app.cells.processMemory.use();", "fx")).toEqual([]);
    // A use-site pattern INSIDE A COMMENT — ignored (a guard scans code, not prose).
    expect(
      scan('// surfaceApp.cells.buildInfo.use({ authority: "server" })', "fx"),
    ).toEqual([]);
    expect(
      scan("/* app.cells.preferences.use({ coalesceMs: 150 }) */", "fx"),
    ).toEqual([]);
    // A QUOTED forbidden KEY is still a leaked policy — CAUGHT (codex F5). The
    // key-position regex matches `"onError":` the same as bare `onError:`.
    expect(
      scan('const s = e.cells.session.use({ "onError": h });', "fx"),
    ).toEqual(["fx:1: onError"]);
    // A forbidden word appearing as a string VALUE (not a key) — IGNORED (codex F5): the
    // key-position regex requires a trailing `:`, which a value has no business having.
    expect(
      scan(
        'const d = e.collections.daemonStatus.use({ keys: () => ["onError"] });',
        "fx",
      ),
    ).toEqual([]);
  });
});
