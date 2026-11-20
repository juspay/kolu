import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(__dirname, "../iframe/index.ts");

export interface SdkBundle {
  code: string;
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
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error("artifact-sdk: esbuild produced no output");
  const code = file.text;
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  return { code, hash };
}

export function getSdkBundle(): Promise<SdkBundle> {
  if (!cached) {
    cached = build().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}
