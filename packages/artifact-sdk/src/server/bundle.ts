/** Bundle the in-iframe SDK at server startup via esbuild. The bundle is
 *  cached in memory along with a sha-256 content hash so the served URL
 *  (`/api/artifact-sdk.js?v=<hash>`) bumps when the SDK source changes
 *  between server restarts — the HTML-decoration injector embeds the
 *  hashed URL, so cached HTML responses don't get stuck on a stale SDK. */

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(__dirname, "../iframe/index.ts");

export interface SdkBundle {
  /** The JS bundle bytes (UTF-8 string). */
  code: string;
  /** Short content-hash for URL versioning. */
  hash: string;
}

let cached: Promise<SdkBundle> | null = null;

async function build(): Promise<SdkBundle> {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    target: "es2022",
    format: "iife",
    platform: "browser",
    minify: false,
    sourcemap: false,
    // `logLevel: "silent"` previously suppressed esbuild's own warnings —
    // bundler diagnostics (deprecated APIs, unresolved imports the resolver
    // recovered from) would never reach the server log and a misconfigured
    // SDK would ship undetected. Use esbuild's default `"warning"`.
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error("artifact-sdk: esbuild produced no output");
  const code = file.text;
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  return { code, hash };
}

export function getSdkBundle(): Promise<SdkBundle> {
  if (!cached) {
    // Clear the cache slot if the build rejects — otherwise a transient
    // failure (FS hiccup, esbuild OOM) becomes permanent: every future
    // call awaits the rejected promise and the server can't recover
    // without a restart.
    cached = build().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}
