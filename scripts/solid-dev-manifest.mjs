/**
 * THE ONE SOURCE for every string the Solid-diagnostics lane keys on
 * (`ci::e2e-solid-dev`), extracted from the INSTALLED Solid development runtime
 * at build time so no copy of these strings is ever typed by hand.
 *
 * Run as `node scripts/solid-dev-manifest.mjs <client-package-dir> <out.json>`,
 * from a tree whose `<client-package-dir>/node_modules` resolves the client's
 * own `solid-js` / `@solidjs/web` / `@solidjs/signals`. It writes
 *
 *     { "marker": "<console footer text>", "warnings": ["<prefix>", …] }
 *
 * which `default.nix` checks both client dists against (`mkClientDist`) and
 * ships at the root of the dev-mode dist, so the server under test serves it at
 * `/solid-dev.json` and `packages/tests/support/solidDevBuild.ts` reads the same
 * strings the bundle was built from.
 *
 * Two kinds of string, because Solid's development runtime has two channels:
 *
 *   - `marker` — the footer `installConsoleFooter` appends to every diagnostics
 *     event (`solid-js` `dist/solid.dev.js`). Any console message carrying it is
 *     a Solid diagnostic whatever its code, and any script carrying it is a
 *     dev-runtime bundle. The production runtime has no footer at all.
 *   - `warnings` — the leading literal of every `console.warn` / `console.error`
 *     in those dists, cut at the first interpolation. `@solidjs/web`'s hydration
 *     and `useHead` warnings and `@solidjs/signals`' multiple-instances /
 *     halted-reactivity messages print through plain console calls, outside the
 *     diagnostics channel, so they carry no footer.
 *
 * Every extraction failure is fatal, and each scanned dist must contribute at
 * least one prefix of its own: a missing footer, or one package that went
 * silent while the others still speak, means the runtime moved and the lane
 * would otherwise pass for having nothing to report.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

/** Shorter than this and a prefix is not distinctive enough to attribute a
 *  console line to Solid. Eight keeps the shortest real one the runtimes have
 *  (`useHead: <`, whose tag name is the first interpolation) and drops the
 *  argument-only calls (`console.error(err)` contributes nothing at all). */
const MIN_WARNING_LENGTH = 8;

const [clientDir, outFile] = process.argv.slice(2);
if (!clientDir || !outFile) {
  fail("usage: solid-dev-manifest.mjs <client-package-dir> <out.json>");
}

/** Where a package's `dist/` is, resolved the way the client resolves it — the
 *  nearest `dist` ancestor of whatever entry the package's conditions pick
 *  (`@solidjs/signals` resolves two levels down, at `dist/prod/index.js`). */
function distDirOf(requireFrom, specifier) {
  const require = createRequire(requireFrom);
  let entry;
  try {
    entry = require.resolve(specifier);
  } catch (error) {
    fail(
      `cannot resolve ${specifier} from ${requireFrom}: ${/** @type {Error} */ (error).message}`,
    );
  }
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    if (basename(dir) === "dist") return dir;
  }
  fail(`${specifier} resolved to ${entry}, which is not inside a dist/`);
}

function fail(message) {
  console.error(`solid-dev-manifest: ${message}`);
  process.exit(1);
}

const clientPackageJson = resolve(clientDir, "package.json");
const solidDist = distDirOf(clientPackageJson, "solid-js");
const webDist = distDirOf(clientPackageJson, "@solidjs/web");
// `@solidjs/signals` is solid-js's own dependency, not the client's, so it is
// resolved from the solid-js the client resolved — the one instance whose
// strings are in the bundle.
const signalsDist = distDirOf(
  join(solidDist, "..", "package.json"),
  "@solidjs/signals",
);

/** The scanned dists, each named by the package it belongs to. A dist is a
 *  group because a package may split its development build over several files
 *  (`@solidjs/signals` has `dev.js`, `dev-shared.js` and `dev.attribution.js`,
 *  and only some carry warnings) while the package as a whole must contribute
 *  at least one prefix. */
const dists = [
  { name: "solid-js", files: [join(solidDist, "solid.dev.js")] },
  { name: "@solidjs/web", files: [join(webDist, "web.dev.js")] },
  {
    name: "@solidjs/signals",
    files: readdirSync(signalsDist)
      .filter((name) => name.startsWith("dev") && name.endsWith(".js"))
      .sort()
      .map((name) => join(signalsDist, name)),
  },
];

const sources = dists.flatMap((dist) => dist.files);

const sourceText = new Map();
for (const file of sources) {
  try {
    sourceText.set(file, readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read ${file}: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * The console footer's text, from `installConsoleFooter`'s template literal
 * ``[${event.code}] <marker> ${guideUrl(event.code)}``. The code and the URL are
 * interpolations; what sits between them is the one string both the bundle check
 * and the console check key on.
 */
function extractMarker() {
  const solidSource = sourceText.get(join(solidDist, "solid.dev.js"));
  const matches = [
    ...solidSource.matchAll(
      /`\[\$\{event\.code\}\]([^`$]+)\$\{guideUrl\(event\.code\)\}`/g,
    ),
  ];
  if (matches.length !== 1) {
    fail(
      `expected exactly one console footer template in solid.dev.js, found ${matches.length} — ` +
        `installConsoleFooter changed shape`,
    );
  }
  const marker = matches[0][1].trim();
  if (marker.length < MIN_WARNING_LENGTH) {
    fail(`the console footer text "${marker}" is too short to key on`);
  }
  return marker;
}

/**
 * Read a JavaScript string or template literal that starts at `source[index]`,
 * returning its leading literal text — for a template, everything before the
 * first `${`. Returns `undefined` when `index` is not a quote.
 */
function leadingLiteral(source, index) {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let text = "";
  for (let i = index + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      // The escape's own meaning does not matter for a prefix we only compare
      // against console text: decode the ones that change the characters.
      const escaped = source[++i];
      text += { n: "\n", t: "\t", r: "\r" }[escaped] ?? escaped;
      continue;
    }
    if (char === quote) return text;
    if (quote === "`" && char === "$" && source[i + 1] === "{") return text;
    if (quote !== "`" && char === "\n") return undefined; // unterminated
    text += char;
  }
  return undefined;
}

/** The prefixes one dist contributes: every `console.warn` / `console.error`
 *  in its files whose first argument starts with a literal, as that literal's
 *  leading text. */
function warningsOf(dist) {
  const prefixes = new Set();
  for (const file of dist.files) {
    const source = sourceText.get(file);
    for (const call of source.matchAll(/console\.(?:warn|error)\(\s*/g)) {
      const text = leadingLiteral(source, call.index + call[0].length);
      if (text === undefined) continue;
      const prefix = text.trimStart();
      if (prefix.length >= MIN_WARNING_LENGTH) prefixes.add(prefix);
    }
  }
  return prefixes;
}

const marker = extractMarker();
// EACH DIST MUST STILL SPEAK. A non-empty total is not enough: `@solidjs/web`
// contributes most of the prefixes, so a release that moved another package's
// warnings behind a helper would leave the list long and the lane blind to
// that package. Fail naming the dist that stopped.
const prefixes = new Set();
for (const dist of dists) {
  const own = warningsOf(dist);
  if (own.size === 0) {
    fail(
      `${dist.name} contributes no console.warn/console.error literal ` +
        `(${dist.files.join(", ")}) — its development runtime moved its ` +
        `warnings, and the lane would stop seeing them`,
    );
  }
  for (const prefix of own) prefixes.add(prefix);
}
const warnings = [...prefixes].sort();

writeFileSync(outFile, `${JSON.stringify({ marker, warnings }, null, 2)}\n`);
console.log(
  `solid-dev-manifest: marker ${JSON.stringify(marker)}, ${warnings.length} warning prefixes`,
);
