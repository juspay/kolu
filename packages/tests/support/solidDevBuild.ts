/**
 * **The Solid-diagnostics check's harness half** (`ci::e2e-solid-dev`).
 *
 * That lane runs the whole suite against a server whose client is built on
 * Solid's DEVELOPMENT runtime (`koluBinSolidDev`, default.nix), so every Solid
 * dev diagnostic the running app raises reaches the browser console. Unit and
 * component tests already fail on any diagnostic; this covers the paths only
 * the e2e suite reaches.
 *
 * WHICH TIER EACH LANE COVERS. Solid's 75 codes come from two places, and one
 * of them has to be switched on:
 *
 *   - The RUNTIME's own 56 codes — strict reads, writes in owned scopes,
 *     cleanup and async and SSR rules — are raised by the development runtime
 *     itself (`@solidjs/signals` `dev.js` / `dev-shared.js`). They are live
 *     wherever that runtime runs: unit and component tests (`ci::unit`, which
 *     resolves the `development` condition under vitest), `ci::dev-smoke`'s
 *     dev server, and this lane's build.
 *   - The ATTRIBUTION tier's 19 codes — `EFFECT_WRITES_OWN_SOURCE`,
 *     `EFFECT_RELAY_TEAR`, `IMMUTABLE_UPDATE_IN_STORE`, the hold and
 *     waterfall family — come from `@solidjs/signals/attribution`, an engine
 *     the development runtime ships beside itself and installs only when
 *     something calls `attribution.enable()`. One caller per lane: the Vite
 *     plugin's performance-tracks module, which applies to `vite serve` alone
 *     (`ci::dev-smoke`); `@kolu/solid-test-setup`'s setup file (`ci::unit`);
 *     and the client's own `solidDiagnosticsExpose.ts` under the `solid-dev`
 *     build mode (this lane).
 *
 *     THE JUDGED SET IS ONE CONSTANT, `SOLID_ATTRIBUTION_OPTIONS`
 *     (`@kolu/solid-test-setup/attribution`), which the setup file and the
 *     `solid-dev` build both enable with, so a finding is never red in a unit
 *     test and silent here. Judged: `EFFECT_WRITES_OWN_SOURCE`,
 *     `EFFECT_RELAY_TEAR`, `IMMUTABLE_UPDATE_IN_STORE`,
 *     `UNSTABLE_LIST_IDENTITY`, `FALLBACK_FLASH`, `OPTIMISTIC_REVERTED`,
 *     `GRAPH_GROWTH`, `ABANDONED_FLIGHTS`, `WIDE_SCOPE_DEPS` and
 *     `UNSTABLE_MEMO_OUTPUT` — ten of the engine's nineteen — plus the
 *     runtime's own codes, with `HUGE_FAN_OUT` lowered to 250 subscribers by
 *     `fanOut`. Folded off are the nine the clock decides: `HOT_SCOPE_RERUNS`
 *     and `HOT_SCOPE_FANOUT` (one `hotRuns: false` turns off both),
 *     `HOT_SCOPE_TIME`, `WASTED_RECOMPUTE`, `SILENT_HOLD` and
 *     `UNTRACKED_ASYNC_HANDLER` (one `holds: false` turns off both),
 *     `LONG_HOLD`, `ASYNC_WATERFALL` and `STACKED_HOLDS` — since on this lane
 *     each of those times a daemon answering a real scenario, so they would
 *     judge the machine rather than the code. The three COUNT checks, and
 *     `GRAPH_GROWTH` (three visits to
 *     one route) and `ABANDONED_FLIGHTS` (three superseded flights of one
 *     source in a second), judge a code shape, not a clock, and stay on.
 *
 *     `default.nix`'s `mkClientDist` greps the dev-mode dist for one of the
 *     engine's codes, so a build that stopped carrying it fails there rather
 *     than reporting nothing here; and it greps the shipped dist for that
 *     code AND for an option name only this `enable()` call contributes, so
 *     the call cannot escape its build-time branch into a user's browser.
 *
 * WHAT THE CHECK KEYS ON IS SERVED, NOT TYPED HERE. The dev-mode client dist
 * carries `solid-dev.json` at its root — `{ marker, warnings }`,
 * extracted at build time from the installed Solid runtime
 * (scripts/solid-dev-manifest.mjs, through default.nix's `solidDevManifest`)
 * — so the server under test answers
 * `/solid-dev.json` with the exact strings its own bundle was built from:
 *
 *   - `marker` is the footer Solid's development runtime prints after the first
 *     diagnostic of each code (`[CODE] what it means and how to fix it: <link>`,
 *     from `installConsoleFooter`), which the production runtime does not carry
 *     at all. A console message carrying it IS a diagnostic whatever its code,
 *     and a served script carrying it is a dev-runtime bundle.
 *   - `warnings` are the leading literals of `@solidjs/web`'s and
 *     `@solidjs/signals`' plain `console.warn` / `console.error` calls (the
 *     `useHead:` and hydration warnings, the multiple-instances warning, the
 *     halted-reactivity error). Those print outside the diagnostics channel and
 *     so carry no footer; a console line that starts with one is a Solid dev
 *     warning too.
 *
 * SERVING THE MANIFEST IS WHAT TURNS THE CHECK ON. No run has to remember a
 * flag: a server built on the development runtime answers `/solid-dev.json` and
 * is checked, a production server does not and is not. `KOLU_E2E_SOLID_DEV=1`
 * is only the lane's own assertion that it must be the former, so a lane handed
 * a production server fails loudly instead of passing for having nothing to
 * report.
 */

// WHERE A PAGE REACHES SOLID'S DIAGNOSTICS CHANNEL — the name the client
// writes and this script owns, from the one module that holds it, so neither
// side can drift from the other. The client assigns it as it boots
// (`packages/client/src/solidDiagnosticsExpose.ts`, on a development
// runtime); production never writes it, and nothing there reads it.
import { SOLID_OBSERVE_GLOBAL as OBSERVE_GLOBAL } from "kolu-common/solidDiagnostics";

/** Is this run the Solid-diagnostics lane? `KOLU_E2E_SOLID_DEV=1` is set by
 *  `ci::e2e-solid-dev` beside the dev-mode `KOLU_SERVER`; any other value is a
 *  caller bug and fails rather than quietly running the ordinary suite. Read
 *  where it is used — the flag asserts a fact about the server this worker just
 *  started, so it is checked when that server is asked, not at import — and
 *  read unconditionally, so a misspelt value fails whatever that server
 *  serves. */
function laneDemandsDevBuild(): boolean {
  const raw = process.env.KOLU_E2E_SOLID_DEV;
  if (raw === undefined) return false;
  if (raw === "1") return true;
  throw new Error(
    `KOLU_E2E_SOLID_DEV must be "1" (the Solid-diagnostics lane) or unset, got "${raw}"`,
  );
}

/** What the dev-mode client dist serves at `/solid-dev.json`: the console
 *  footer every Solid diagnostic carries, and the leading literals of the
 *  plain `console.warn` / `console.error` calls that carry no footer. */
interface SolidDevManifest {
  readonly marker: string;
  readonly warnings: readonly string[];
}

/** The console check a dev-runtime server turns on: it holds that server's own
 *  diagnostic strings, so a worker asks the manifest once and every scenario
 *  matches against it. */
export interface SolidDevCheck {
  /** Is this console message a Solid dev diagnostic or warning? */
  isDiagnostic(text: string): boolean;
  /** Is it a diagnostic's console FOOTER — the "what it means and how to fix
   *  it" line Solid prints once per code? The channel reports the finding
   *  itself, so counting the footer too would count it twice. */
  isFooter(text: string): boolean;
}

const MANIFEST_PATH = "/solid-dev.json";

/** The Playwright binding {@link solidObserveInitScript} calls with each
 *  event. Exposed on the context, so a window the page opens reports too. */
export const SOLID_DIAGNOSTIC_BINDING = "__koluSolidDiagnostic";

/** One diagnostic as the page hands it over — the serialisable part of
 *  Solid's `DiagnosticEvent`, plus the stack the binding captured.
 *
 *  `severity` IS SOLID'S OWN GRADE and this harness honours it: every
 *  `emitDiagnostic` call in 2.0.4 passes one (`dev-shared.js`, `dev.js` and
 *  `dev.attribution.js` alike), so an event without one is a shape this
 *  harness does not know and is failed on rather than waved through. */
export interface PageDiagnostic {
  code?: unknown;
  loc?: unknown;
  ownerPath?: unknown;
  message?: unknown;
  severity?: unknown;
  kind?: unknown;
  nodeName?: unknown;
  data?: unknown;
  /** The stack at the moment the page's subscriber ran, which is inside the
   *  `read()` (or write) that raised it — the only name a finding with no
   *  `loc` and no `ownerPath` has. */
  stack?: unknown;
}

/**
 * THE INIT SCRIPT THAT NAMES WHAT THE CONSOLE CANNOT.
 *
 * A diagnostic whose call site throws (every `error` severity one) reaches the
 * console as its footer line alone — no code, no message, no owner, no
 * location (`@solidjs/signals` 2.0.4 `dev-shared.js:883-889`). Subscribing to
 * the channel itself gets the whole event, whatever the console did with it.
 *
 * It runs before any page script, so it cannot read a global the client has
 * not written yet: it OWNS the global instead, and subscribes the moment the
 * client assigns it. Written as source text, never a compiled function — tsx's
 * esbuild would wrap a named function in a `__name(…)` the page does not have.
 */
export function solidObserveInitScript(): string {
  return `(function () {
  var subscribe = function (observe) {
    if (!observe || !observe.diagnostics) return;
    observe.diagnostics.subscribe(function (event) {
      var data;
      try { data = JSON.parse(JSON.stringify(event.data)); } catch (e) { data = undefined; }
      window[${JSON.stringify(SOLID_DIAGNOSTIC_BINDING)}]({
        code: event.code,
        loc: event.loc,
        ownerPath: event.ownerPath,
        message: event.message,
        severity: event.severity,
        kind: event.kind,
        nodeName: event.nodeName,
        data: data,
        stack: new Error().stack,
      });
    });
  };
  var held;
  Object.defineProperty(window, ${JSON.stringify(OBSERVE_GLOBAL)}, {
    configurable: true,
    get: function () { return held; },
    set: function (value) { held = value; subscribe(value); },
  });
})();`;
}

/** One diagnostic in a failure's words: what it was, where, and under which
 *  owners. A field the event did not carry is left out rather than printed as
 *  `undefined` — `ownerPath` is absent for an unowned primitive, which is
 *  usually the finding itself, and `loc` for anything compiled without
 *  locations.
 *
 *  A NAMELESS FINDING IS THE PAYLOAD, NOT A DROPPED FIELD. A strict read in
 *  an effect's APPLY arm carries neither `loc` nor `ownerPath`, by
 *  construction: `emitDiagnostic` fills both from its subject, which defaults
 *  to the current reactive `context` (`@solidjs/signals` 2.0.4
 *  `dev-shared.js:853-871`), and an apply arm has none — `runEffect` sets the
 *  strict-read label and calls the callback without entering an owner
 *  (`dev.js:1586-1654`), and `context` is assigned only by a compute pass
 *  (`dev-shared.js:5895`) and by `runWithOwner` (`dev-shared.js:7497`). The
 *  warning sites pass no location either, only the names they hold: the
 *  value's own `_name` for a signal or memo read (`dev.js:591-596`) and the
 *  key for a store read, which fires only with no observer at all
 *  (`dev.js:5676-5688`). So `ci::dev-smoke`'s two `STRICT_READ_UNTRACKED` on
 *  a store's `length`, arriving with no `loc` and no `ownerPath`, are the
 *  channel saying everything it knows; the name quoted in the message is the
 *  whole locator, and the scenario and step stamped below are what place it. */
export function solidDiagnosticWords(event: PageDiagnostic): string {
  const code = typeof event.code === "string" ? event.code : "(no code)";
  const grade =
    typeof event.severity === "string" ? event.severity : "(no severity)";
  const where = typeof event.loc === "string" ? ` at ${event.loc}` : "";
  const path = Array.isArray(event.ownerPath)
    ? ` in ${event.ownerPath.join(" > ")}`
    : "";
  const named =
    typeof event.nodeName === "string" ? ` on "${event.nodeName}"` : "";
  const said = typeof event.message === "string" ? `: ${event.message}` : "";
  return `[${grade}] ${code}${where}${path}${relayWords(event)}${named}${said}`;
}

/** WHO RELAYED, AND WHAT THEY WROTE — the two names that decide whose tear a
 *  relay tear is. `nodeName` on an `EFFECT_RELAY_TEAR` is the VICTIM (the
 *  node that ran twice), so the pair that tells a library's own measurement
 *  apart from a write-back the app made from inside that measurement's report
 *  rides in `data` alone: `relay` is the effect that wrote, `wrote` the
 *  signal or store leaf it wrote (`@solidjs/signals` 2.0.4
 *  `dev.attribution.js:1136-1151,1238-1253`). Both are printed for that code
 *  and for no other; a tear that carries neither is printed as it stands,
 *  because a missing field is not a field worth a placeholder. */
function relayWords(event: PageDiagnostic): string {
  if (event.code !== "EFFECT_RELAY_TEAR") return "";
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return "";
  const { relay, wrote } = data as { relay?: unknown; wrote?: unknown };
  const parts: string[] = [];
  if (typeof relay === "string") parts.push(`relay "${relay}"`);
  if (typeof wrote === "string") parts.push(`wrote "${wrote}"`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/** IS THIS FINDING ADVISORY? Exactly one code is: `EFFECT_RELAY_TEAR` graded
 *  `info`. Solid grades every diagnostic it emits, and for THAT code `info`
 *  is its own word for "reported, not wrong" — the relay tear of a DOM
 *  measurement is the standing example (`RightPanelDrawer.tsx:81` through
 *  corvu-next's `createSize`), and corvu-next's own vitest setup already
 *  passes on exactly that grade.
 *
 *  `info` IS NOT A BLANKET PASS. Solid grades `EFFECT_WRITES_OWN_SOURCE`
 *  `info` whenever the write cycle runs through more than one effect
 *  (`links.length === 1 ? "warn" : "info"`, `dev.attribution.js:1054`), and
 *  `FALLBACK_FLASH` and `OPTIMISTIC_REVERTED` are always `info`. So every
 *  other code fails whatever its grade, and an unknown `info` code fails
 *  until it is dispositioned.
 *
 *  `error` and `warn` fail, and so does an event carrying no grade at all: a
 *  shape this harness does not know is a finding it must not wave through.
 *  This is not a softer gate — a derivable relay is `warn` from its first
 *  sighting, and a repeated one escalates to `warn` at three
 *  (`dev.attribution.js:1205-1217,1609`). */
export function isAdvisoryDiagnostic(event: PageDiagnostic): boolean {
  return event.severity === "info" && event.code === "EFFECT_RELAY_TEAR";
}

/** One diagnostic with the scenario and step that were running when it
 *  arrived — the e2e suite's `BeforeStep` hook records them on the world, and
 *  the binding stamps each event with them. A scenario's own name is not
 *  enough: four workers interleave, and what a failure needs is the step that
 *  raised the finding. */
export interface StampedDiagnostic extends PageDiagnostic {
  scenario?: string;
  step?: string;
}

/** Stamp an event with where the run was when it arrived. A field the hook
 *  has not recorded yet (an event raised at page load, before the first step)
 *  is left off rather than stamped `undefined`. */
export function stampDiagnostic(
  event: PageDiagnostic,
  at: { scenario?: string; step?: string },
): StampedDiagnostic {
  return {
    ...event,
    ...(at.scenario === undefined ? {} : { scenario: at.scenario }),
    ...(at.step === undefined ? {} : { step: at.step }),
  };
}

/** Identical findings, as one entry carrying the FIRST occurrence (with its
 *  scenario and step) and how many there were. */
export interface FoldedDiagnostic {
  readonly event: StampedDiagnostic;
  count: number;
}

/** Fold by `(code, loc, ownerPath, nodeName)`: one site raising on every
 *  keystroke is one line with a count, not a wall. The first occurrence is
 *  kept, because its scenario and step — and its stack — are the ones a
 *  reader can reproduce from. `nodeName` is part of the key because a
 *  location-less finding has nothing else to tell two sites apart by, and
 *  distinct sites collapsing into one row is how a finding stays unnamed. */
export function foldDiagnostics(
  events: readonly StampedDiagnostic[],
): FoldedDiagnostic[] {
  const byKey = new Map<string, FoldedDiagnostic>();
  for (const event of events) {
    const key = JSON.stringify([
      event.code ?? null,
      event.loc ?? null,
      event.ownerPath ?? null,
      event.nodeName ?? null,
    ]);
    const seen = byKey.get(key);
    if (seen) seen.count += 1;
    else byKey.set(key, { event, count: 1 });
  }
  return [...byKey.values()];
}

/** A folded group in one line: how many there were, what it was, and where
 *  the run was the first time.
 *
 *  A FINDING WITH NO LOCATION GETS ITS STACK. The binding captures
 *  `new Error().stack` inside the page's subscriber, which runs synchronously
 *  inside the `read()` that raised the finding, so for the apply-arm strict
 *  reads that carry neither `loc` nor `ownerPath` the stack is the only thing
 *  that names the reading frame. It is printed for those alone: a finding
 *  with a location already says where it is. */
function foldedWords(folded: FoldedDiagnostic): string {
  const many = folded.count > 1 ? `×${folded.count} ` : "";
  const { scenario, step } = folded.event;
  const first =
    scenario === undefined && step === undefined
      ? ""
      : ` [first in "${scenario ?? "(no scenario)"}" at step "${step ?? "(before the first step)"}"]`;
  const { loc, stack } = folded.event;
  const where =
    typeof loc === "string" || typeof stack !== "string"
      ? ""
      : `\n    first raised from:\n${stack.split("\n").slice(1).join("\n")}`;
  return `${many}${solidDiagnosticWords(folded.event)}${first}${where}`;
}

/** THE LANE'S VERDICT, or `undefined` when the scenario raised nothing.
 *
 * The diagnostics the channel named and the console lines are both reported:
 * a console line with no event behind it is a plain Solid warning, and an
 * event with no readable console line is exactly what this channel exists
 * for. The page's thrown errors ride along, because a diagnostic that threw
 * is also the throw the page reports.
 *
 * SOLID'S GRADE AND CODE DECIDE WHETHER IT FAILS, through
 * {@link isAdvisoryDiagnostic}: only an `info`-graded `EFFECT_RELAY_TEAR` is
 * advisory, printed under its own heading and failing nothing. Every other
 * finding — and any event with no grade — makes `fails` true. A console line
 * is a Solid warning the console itself printed, so it fails.
 *
 * THE HEADLINE COUNTS EACH FINDING ONCE. An error-severity diagnostic reaches
 * the console as a footer line AND the channel as an event, so footers are
 * reported apart from the count — they name nothing the events do not. */
export interface SolidDiagnosticVerdict {
  /** Does this scenario fail? */
  readonly fails: boolean;
  /** The whole report: the failing findings, then the advisory ones. */
  readonly words: string;
}

export function solidDiagnosticVerdict(found: {
  events: readonly StampedDiagnostic[];
  lines: readonly string[];
  footers?: readonly string[];
  pageErrors: readonly string[];
}): SolidDiagnosticVerdict | undefined {
  const total = found.events.length + found.lines.length;
  if (total === 0) return undefined;
  const advisory = found.events.filter(isAdvisoryDiagnostic);
  const failing = found.events.filter((e) => !isAdvisoryDiagnostic(e));
  const fails = failing.length + found.lines.length > 0;
  const parts: string[] = [];
  if (fails) {
    parts.push(
      `Solid dev diagnostics (${failing.length + found.lines.length}):`,
    );
    for (const folded of foldDiagnostics(failing))
      parts.push(`  ${foldedWords(folded)}`);
    for (const line of found.lines) parts.push(`  ${line}`);
    const footers = found.footers ?? [];
    if (footers.length > 0) {
      parts.push(
        `the console footers behind them (${footers.length}), each already named as an event above:`,
      );
      for (const footer of footers) parts.push(`  ${footer}`);
    }
    if (found.pageErrors.length > 0) {
      parts.push(`the pages threw (${found.pageErrors.length}):`);
      for (const error of found.pageErrors) parts.push(`  ${error}`);
    }
  }
  if (advisory.length > 0) {
    parts.push(
      `Solid also graded ${advisory.length} finding(s) info — advisory, failing nothing:`,
    );
    for (const folded of foldDiagnostics(advisory))
      parts.push(`  ${foldedWords(folded)}`);
  }
  return { fails, words: parts.join("\n") };
}

/** WHAT A DEV-SERVER BOOT FAILS ON (`packages/tests/devSmoke.ts`), and what
 *  it merely reports, as one pure pair so both can be tested without a
 *  browser.
 *
 *  Console errors are the module-load crash class that check exists for. A
 *  Solid dev diagnostic is a failure too: the Vite dev server serves the SAME
 *  development runtime the diagnostics lane builds, so a boot that raises one
 *  is the cheapest answer to "is this finding a boot fact?" — and `ci::dev-
 *  smoke` was green while every e2e scenario raised two, because it looked at
 *  the console alone. Page errors ride along: a diagnostic that throws reaches
 *  the page as a throw.
 *
 *  Solid's grade AND code decide which list a diagnostic lands in, exactly as
 *  they do for the e2e lane's verdict ({@link isAdvisoryDiagnostic}): an
 *  `info`-graded `EFFECT_RELAY_TEAR` is advisory, everything else fails. */
export function devSmokeFailures(saw: {
  consoleErrors: readonly string[];
  pageErrors: readonly string[];
  diagnostics: readonly StampedDiagnostic[];
}): { failures: string[]; advisories: string[] } {
  const failures: string[] = [];
  for (const text of saw.consoleErrors) failures.push(`console.error: ${text}`);
  for (const message of saw.pageErrors) failures.push(`uncaught: ${message}`);
  const folds = (events: readonly StampedDiagnostic[]) =>
    foldDiagnostics(events).map(
      (folded) => `solid diagnostic: ${foldedWords(folded)}`,
    );
  failures.push(
    ...folds(saw.diagnostics.filter((e) => !isAdvisoryDiagnostic(e))),
  );
  return {
    failures,
    advisories: folds(saw.diagnostics.filter(isAdvisoryDiagnostic)),
  };
}

/**
 * The check for the server at `baseUrl`, or `undefined` when it serves a
 * production client.
 *
 * GETs the manifest the dev-mode dist ships. A server that has one is then
 * MEASURED, not trusted: the shell's own scripts are fetched and one of them
 * must carry the marker, so a manifest left behind by a stale dist cannot turn
 * a check on over a production bundle.
 *
 * On the lane (`KOLU_E2E_SOLID_DEV=1`) a server without the manifest is a
 * failure — that lane exists to run the dev-mode build. The flag itself is
 * read first, so any other value fails before the server is asked anything.
 */
export async function solidDevCheckFor(
  baseUrl: string,
): Promise<SolidDevCheck | undefined> {
  const lane = laneDemandsDevBuild();
  const manifest = await fetchManifest(baseUrl);
  if (manifest === undefined) {
    if (lane) {
      throw new Error(
        `Solid-diagnostics lane: the server at ${baseUrl} serves no ${MANIFEST_PATH}, ` +
          `so its client is not built on Solid's development runtime. ` +
          `KOLU_SERVER must be the dev-mode build (.#koluBin-solid-dev).`,
      );
    }
    return undefined;
  }
  await assertServesSolidDevBuild(baseUrl, manifest.marker);
  return {
    isDiagnostic: (text) =>
      text.includes(manifest.marker) ||
      manifest.warnings.some((prefix) => text.startsWith(prefix)),
    isFooter: (text) => text.includes(manifest.marker),
  };
}

/**
 * The served manifest, or `undefined` when this server has none.
 *
 * A dist that does not contain the file is not a 404: `freshStaticLayer`
 * (packages/surface-app/src/server.ts) answers every unmatched non-asset path
 * with the HTML shell so a deep link reloads, and Vite's dev server does the
 * same. So absence is the shell coming back, and a 404 — what a server with no
 * client dist at all answers — means the same thing. Any other status, or a
 * body that is neither, is a server this suite cannot read and fails on.
 */
async function fetchManifest(
  baseUrl: string,
): Promise<SolidDevManifest | undefined> {
  const url = new URL(MANIFEST_PATH, baseUrl);
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `Solid-diagnostics check: GET ${url} answered ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/html")) return undefined; // the shell
  if (!contentType.startsWith("application/json")) {
    throw new Error(
      `Solid-diagnostics check: GET ${url} answered ${response.status} ` +
        `as "${contentType}" — neither the manifest nor the page shell`,
    );
  }
  const body: unknown = await response.json();
  const { marker, warnings } = body as Partial<SolidDevManifest>;
  if (
    typeof marker !== "string" ||
    marker.length === 0 ||
    !Array.isArray(warnings) ||
    warnings.length === 0 ||
    warnings.some((prefix) => typeof prefix !== "string" || prefix.length === 0)
  ) {
    throw new Error(
      `Solid-diagnostics check: ${url} is not a { marker, warnings } manifest: ${JSON.stringify(body)}`,
    );
  }
  return { marker, warnings };
}

/** Fail unless the server at `baseUrl` serves a client built on Solid's
 *  development runtime: fetch the shell, then every script and module preload
 *  it names, and look for `marker`. */
async function assertServesSolidDevBuild(
  baseUrl: string,
  marker: string,
): Promise<void> {
  const shellUrl = new URL("/", baseUrl);
  const shell = await fetchText(shellUrl);
  const assetUrls = [
    ...shell.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
    ...shell.matchAll(
      /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g,
    ),
  ].map((match) => new URL(match[1] as string, shellUrl));
  if (assetUrls.length === 0) {
    throw new Error(
      `Solid-diagnostics check: the shell at ${shellUrl} names no script to check`,
    );
  }
  for (const url of assetUrls) {
    if ((await fetchText(url)).includes(marker)) return;
  }
  throw new Error(
    `Solid-diagnostics check: the server at ${baseUrl} serves ${MANIFEST_PATH} but ` +
      `a client without Solid's development runtime (no script carries "${marker}"). ` +
      `KOLU_SERVER must be the dev-mode build (.#koluBin-solid-dev).`,
  );
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Solid-diagnostics check: GET ${url} answered ${response.status}`,
    );
  }
  return response.text();
}
