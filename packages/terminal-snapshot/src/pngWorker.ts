import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { loadSnapshotFonts } from "./pngFonts.ts";

export interface PngRasteriseRequest {
  readonly svg: string;
  readonly defaultFamily: string;
}

export type PngRasteriseReply =
  | { readonly ok: true; readonly png: Uint8Array }
  | { readonly ok: false; readonly message: string };

const port = parentPort;
if (!port) {
  throw new Error(
    "terminal-snapshot: pngWorker.ts is a worker_threads entry point, not a module to import — the main thread reaches it through sceneToPng.",
  );
}

const require = createRequire(import.meta.url);
await initWasm(
  await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
);
const fontBuffers = await loadSnapshotFonts();

/** Rasterise one document.
 *
 *  Both wasm handles are freed in a `finally`. They are not garbage — they own
 *  memory inside the wasm heap that the JS collector cannot see, so a thread
 *  that renders a screenshot every few seconds and never frees them grows
 *  until it is killed. Constructing a `Resvg` with all six faces costs ~1 ms
 *  and ~2.4 MB of wasm heap, reclaimed by that same `free()` — which is why
 *  the faces are re-handed per render rather than a `Resvg` being kept warm. */
function rasterise(req: PngRasteriseRequest): Uint8Array {
  const resvg = new Resvg(req.svg, {
    font: {
      fontBuffers,
      defaultFontFamily: req.defaultFamily,
      loadSystemFonts: false,
    },
  });
  try {
    const rendered = resvg.render();
    try {
      return rendered.asPng();
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}

port.on("message", (req: PngRasteriseRequest) => {
  let reply: PngRasteriseReply;
  let transfer: ArrayBuffer[] = [];
  try {
    const png = rasterise(req);
    const { buffer } = png;
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(
        "terminal-snapshot: the rasteriser returned a PNG backed by shared memory, which cannot be handed across by transfer.",
      );
    }
    reply = { ok: true, png };
    transfer = [buffer];
  } catch (cause) {
    reply = {
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  port.postMessage(reply, transfer);
});
