import { Worker } from "node:worker_threads";
import { PNG_FONT_STACK } from "./pngFonts.ts";
import type { PngRasteriseReply } from "./pngWorker.ts";
import {
  buildScene,
  cellHeight,
  type SceneInput,
  type SnapshotScene,
} from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

const PNG_CELL_WIDTH_RATIO = 0.6;

/** Build a scene this backend can actually rasterise.
 *
 *  The ONE entry point the daemon side needs. The font family, the cell
 *  advance and the row height are facts about THIS backend — its baked faces,
 *  its lack of a `measureText` — so they are applied here rather than handed
 *  out as constants for every caller to re-apply identically. */
export function buildPngScene(
  input: Omit<SceneInput, "fontFamily" | "cellW" | "cellH">,
): SnapshotScene {
  return buildScene({
    ...input,
    fontFamily: PNG_FONT_STACK.document,
    cellW: input.fontSize * PNG_CELL_WIDTH_RATIO,
    cellH: cellHeight(input.fontSize),
  });
}

/** The one warm rasteriser thread. A dead thread is forgotten rather than
 *  reused: `initWasm` throws "Already initialized" on a second call in the
 *  same thread, so a fresh thread — a fresh module registry — is the only way
 *  to re-take it. */
class WarmRasteriser {
  #warm: Worker | undefined;

  take(): Worker {
    if (this.#warm) return this.#warm;
    const created = new Worker(new URL("./pngWorker.ts", import.meta.url));
    created.unref();
    created.once("exit", () => this.retire(created));
    this.#warm = created;
    return created;
  }

  retire(dead: Worker): void {
    if (this.#warm === dead) this.#warm = undefined;
  }

  kill(wedged: Worker): void {
    this.retire(wedged);
    void wedged.terminate();
  }
}

const rasteriser = new WarmRasteriser();

const RASTERISE_DEADLINE_MS = 15_000;

function sendOne(svg: string): Promise<Uint8Array> {
  const worker = rasteriser.take();
  worker.ref();
  return new Promise<Uint8Array>((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(deadline);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      worker.unref();
      finish();
    };
    const deadline = setTimeout(() => {
      rasteriser.kill(worker);
      settle(() =>
        reject(
          new Error(
            `terminal-snapshot: the rasteriser did not answer within ${RASTERISE_DEADLINE_MS} ms and was killed — the thread was wedged, not slow.`,
          ),
        ),
      );
    }, RASTERISE_DEADLINE_MS);
    deadline.unref();
    const onMessage = (reply: PngRasteriseReply) =>
      settle(() =>
        reply.ok
          ? resolve(reply.png)
          : reject(
              new Error(
                `terminal-snapshot: the rasteriser refused the document — ${reply.message}`,
              ),
            ),
      );
    const onError = (cause: Error) => {
      rasteriser.retire(worker);
      settle(() =>
        reject(
          new Error(
            `terminal-snapshot: the rasteriser thread failed — ${cause.message}`,
            { cause },
          ),
        ),
      );
    };
    const onExit = (code: number) => {
      rasteriser.retire(worker);
      settle(() =>
        reject(
          new Error(
            `terminal-snapshot: the rasteriser thread exited (code ${code}) with a screenshot in flight.`,
          ),
        ),
      );
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage({ svg, defaultFamily: PNG_FONT_STACK.primary });
  });
}

function serialiser(): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return (run) => {
    const next = tail.then(run);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

const rasteriseQueue = serialiser();

/** Render a scene from {@link buildPngScene} to PNG bytes.
 *
 *  The scene's own `width`/`height` are the raster size — a scene is already
 *  in logical pixels and the daemon has no device pixel ratio to honour, so
 *  there is no scaling decision to make here.
 *
 *  Rejects a scene built any other way: resvg falls back along the family list
 *  in the DOCUMENT, not along the order buffers were registered in, so another
 *  family name renders tofu for every glyph the first face lacks while still
 *  producing a valid-looking PNG. */
export async function sceneToPng(scene: SnapshotScene): Promise<Uint8Array> {
  if (scene.font.family !== PNG_FONT_STACK.document) {
    throw new Error(
      `terminal-snapshot: a PNG scene must come from buildPngScene, got font family "${scene.font.family}". resvg resolves fallbacks along the document's family list, so another name renders tofu for every glyph the first face lacks — and looks like a valid screenshot while doing it.`,
    );
  }
  const svg = sceneToSvg(scene);
  return await rasteriseQueue(() => sendOne(svg));
}
