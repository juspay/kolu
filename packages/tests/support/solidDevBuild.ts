/**
 * **The Solid-diagnostics lane's harness half** (`ci::e2e-solid-dev`).
 *
 * That lane runs the whole suite against a server whose client is built on
 * Solid's DEVELOPMENT runtime (`koluBinSolidDev`, default.nix), so every Solid
 * dev diagnostic the running app raises reaches the browser console. Unit and
 * component tests already fail on any diagnostic; this covers the paths only
 * the e2e suite reaches.
 *
 * Two facts, both keyed on one string: the footer Solid's development runtime
 * prints after the first diagnostic of each code (`[CODE] what it means and how
 * to fix it: <docs link>`, from `installConsoleFooter` in `solid-js` 2.0.3
 * `dist/solid.dev.js`), which the production runtime does not carry at all.
 *
 *   - A console message carrying it IS a Solid diagnostic, whatever its code,
 *     so the check needs no hand-kept list of codes. The runtime prints the
 *     footer once per code per page; one is enough to fail the scenario.
 *   - A served bundle carrying it is a dev-runtime bundle. The lane checks
 *     that once per worker, so a lane that is handed a production server
 *     fails loudly instead of passing for having nothing to report.
 *     `mkClientDist` in default.nix makes the same check on the build.
 */

/** The marker — see the module note. Kept in step with `solidDevMarker` in
 *  default.nix. */
export const SOLID_DIAGNOSTIC_MARKER = "what it means and how to fix it:";

/** Is this run the Solid-diagnostics lane? `KOLU_E2E_SOLID_DEV=1` is set by
 *  `ci::e2e-solid-dev` beside the dev-mode `KOLU_SERVER`; any other value is a
 *  caller bug and fails rather than quietly running the ordinary suite. */
export const SOLID_DEV_LANE = ((): boolean => {
  const raw = process.env.KOLU_E2E_SOLID_DEV;
  if (raw === undefined) return false;
  if (raw === "1") return true;
  throw new Error(
    `KOLU_E2E_SOLID_DEV must be "1" (the Solid-diagnostics lane) or unset, got "${raw}"`,
  );
})();

/** Does this text (a console message, or a served script) carry the marker? */
export function isSolidDiagnostic(text: string): boolean {
  return text.includes(SOLID_DIAGNOSTIC_MARKER);
}

/** Fail unless the server at `baseUrl` serves a client built on Solid's
 *  development runtime: fetch the shell, then every script and module preload
 *  it names, and look for the marker. */
export async function assertServesSolidDevBuild(
  baseUrl: string,
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
      `Solid-diagnostics lane: the shell at ${shellUrl} names no script to check`,
    );
  }
  for (const url of assetUrls) {
    if (isSolidDiagnostic(await fetchText(url))) return;
  }
  throw new Error(
    `Solid-diagnostics lane: the server at ${baseUrl} serves a client without ` +
      `Solid's development runtime (no script carries "${SOLID_DIAGNOSTIC_MARKER}"). ` +
      `KOLU_SERVER must be the dev-mode build (.#koluBin-solid-dev).`,
  );
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Solid-diagnostics lane: GET ${url} answered ${response.status}`,
    );
  }
  return response.text();
}
