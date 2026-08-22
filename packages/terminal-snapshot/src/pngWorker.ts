/** The wasm rasteriser, on a thread of its own.
 *
 *  `sceneToPng`'s two awaits used to be the only interruptions in the whole
 *  render: past them, `new Resvg()` / `render()` / `asPng()` are ONE
 *  uninterrupted synchronous wasm region. On padi — the daemon that owns
 *  terminal I/O — that region measured a 146 ms event-loop stall at 80×24, 359
 *  ms at 120×50 and 2,482 ms at the cell cap — 200×130, the widest-and-tallest
 *  grid kaval's `SCREEN_CELLS_MAX_CELLS` lets an attributed read reach. A 2.5 s
 *  stall is not a slow screenshot, it is a frozen workspace: every PTY byte,
 *  every surface frame and every RPC reply waits behind it.
 *
 *  So the wasm lives here instead, and the seam is deliberately narrow: a
 *  plain SVG string in, a transferable `Uint8Array` out. Nothing about a
 *  scene, a theme or a grid crosses it — `sceneToSvg` stays on the main
 *  thread, where it measures 2–29 ms and is not worth a hop.
 *
 *  This thread owns the two things that must NOT be paid per render: the wasm
 *  instance (`initWasm` is once-per-thread and throws "Already initialized" on
 *  a second call) and ~9 MB of outline faces. Both are taken at module
 *  evaluation, under top-level await, so the first message is served by a
 *  fully warm thread and every later one costs only the rasterise. A thread
 *  that fails to take them fails to evaluate, which reaches the main thread as
 *  an `error` event — loud, named, and with no half-initialised thread left
 *  behind to serve a later screenshot in the wrong font.
 *
 *  ## Fonts
 *
 *  resvg does no system font discovery here (`loadSystemFonts: false`) — it
 *  gets exactly the faces this module hands it, so the daemon's PNG cannot
 *  quietly change because a host has a different fontconfig. The stack is
 *  chosen by measured coverage, not taste: kolu's own FiraCode Nerd Font
 *  first (it is what the browser draws, and it alone carries the powerline
 *  and private-use icons a shell prompt uses), then DejaVu Sans Mono and the
 *  two Noto symbol faces, which between them supply the glyphs FiraCode
 *  lacks and an agent TUI leans on constantly — the braille spinner frames,
 *  and `⎿`, the connector Claude Code draws under every tool call.
 *
 *  WHICH family list a glyph resolves along is not this thread's to say: it
 *  is a property of the document, and the document is built by `png.ts`
 *  (`buildPngScene`). That is why `defaultFamily` rides on the request rather
 *  than being re-spelled here — one authority for the font stack, on the side
 *  that also validates it. */

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/** One rasterise. `defaultFamily` is resvg's fallback for an element that
 *  names no family of its own; `png.ts` owns the list it comes from. */
export interface PngRasteriseRequest {
  readonly svg: string;
  readonly defaultFamily: string;
}

/** The reply. A render that throws comes back as a MESSAGE rather than as a
 *  thrown error, so a bad document costs one screenshot instead of the warm
 *  thread every later screenshot is waiting for. */
export type PngRasteriseReply =
  | { readonly ok: true; readonly png: Uint8Array }
  | { readonly ok: false; readonly message: string };

const port = parentPort;
if (!port) {
  throw new Error(
    "terminal-snapshot: pngWorker.ts is a worker_threads entry point, not a module to import — the main thread reaches it through sceneToPng.",
  );
}

/** Where the font files live, baked by Nix.
 *
 *  No PATH search and no bundled-copy fallback: kolu's rule is that a
 *  required value is baked in and its absence CRASHES rather than silently
 *  degrading, and a screenshot rendered in a substitute font is exactly the
 *  silent degradation that rule exists to prevent — it would look plausible
 *  and be wrong. */
function fontDir(): string {
  const dir = process.env.KOLU_SNAPSHOT_FONTS_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_SNAPSHOT_FONTS_DIR is unset — the terminal-snapshot renderer needs the Nix-provided font directory (nix/packages/fonts). It is baked onto the daemon wrapper in default.nix and exported by shell.nix for a dev tree.",
    );
  }
  return dir;
}

async function loadFonts(): Promise<Uint8Array[]> {
  // EVERY face in the directory, rather than a re-spelling of the derivation's
  // own list: `nix/packages/fonts/snapshot.nix` is the one authority for which
  // faces exist, and a copy here would only fail at runtime with an ENOENT
  // when the two parted. Order is immaterial — the document's family list is
  // what picks — so the directory carries everything this read needs.
  const dir = fontDir();
  const names = (await readdir(dir)).filter((f) => /\.(?:ttf|otf)$/i.test(f));
  if (names.length === 0) {
    throw new Error(
      `terminal-snapshot: ${dir} holds no font faces — the Nix font closure (nix/packages/fonts) is broken. A screenshot rendered in no font at all is not a degraded render, it is tofu.`,
    );
  }
  return await Promise.all(names.map((f) => readFile(path.join(dir, f))));
}

// The two per-thread facts, taken before a single message is served. The port
// buffers anything the main thread posts while this runs, so an early
// screenshot waits rather than misses.
const require = createRequire(import.meta.url);
await initWasm(
  await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
);
const fontBuffers = await loadFonts();

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
  // TRANSFERRED, not cloned: `asPng` slices its result OUT of the wasm heap, so
  // the buffer is this thread's to give away and the main thread pays no second
  // copy for the ~2 MB a capped screenshot weighs.
  let transfer: ArrayBuffer[] = [];
  try {
    const png = rasterise(req);
    const { buffer } = png;
    if (!(buffer instanceof ArrayBuffer)) {
      // A view on shared memory cannot be transferred, and `postMessage` would
      // quietly COPY it instead — a per-screenshot cost that hides. Named
      // rather than absorbed.
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
