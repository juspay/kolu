/**
 * **The Solid-diagnostics check's harness half** (`ci::e2e-solid-dev`).
 *
 * That lane runs the whole suite against a server whose client is built on
 * Solid's DEVELOPMENT runtime (`koluBinSolidDev`, default.nix), so every Solid
 * dev diagnostic the running app raises reaches the browser console. Unit and
 * component tests already fail on any diagnostic; this covers the paths only
 * the e2e suite reaches.
 *
 * WHAT THE CHECK KEYS ON IS SERVED, NOT TYPED HERE. The dev-mode client dist
 * carries `solid-dev.json` at its root — `{ marker, warnings, dists }`,
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

/** What the dev-mode client dist serves at `/solid-dev.json`. `dists` is each
 *  scanned Solid package's own prefix count, before the counts merge into the
 *  deduplicated `warnings` list; the dist derivation checks every one is at
 *  least 1, and the harness holds the shape to the same contract. */
interface SolidDevManifest {
  readonly marker: string;
  readonly warnings: readonly string[];
  readonly dists: Readonly<Record<string, number>>;
}

/** The console check a dev-runtime server turns on: it holds that server's own
 *  diagnostic strings, so a worker asks the manifest once and every scenario
 *  matches against it. */
export interface SolidDevCheck {
  /** Is this console message a Solid dev diagnostic or warning? */
  isDiagnostic(text: string): boolean;
}

const MANIFEST_PATH = "/solid-dev.json";

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
  const { marker, warnings, dists } = body as Partial<SolidDevManifest>;
  if (
    typeof marker !== "string" ||
    marker.length === 0 ||
    !Array.isArray(warnings) ||
    warnings.length === 0 ||
    warnings.some(
      (prefix) => typeof prefix !== "string" || prefix.length === 0,
    ) ||
    typeof dists !== "object" ||
    dists === null ||
    Object.keys(dists).length === 0 ||
    Object.values(dists).some((count) => typeof count !== "number" || count < 1)
  ) {
    throw new Error(
      `Solid-diagnostics check: ${url} is not a { marker, warnings, dists } manifest: ${JSON.stringify(body)}`,
    );
  }
  return { marker, warnings, dists };
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
