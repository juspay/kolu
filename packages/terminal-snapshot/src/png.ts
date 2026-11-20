import { Worker } from "node:worker_threads";
import { PNG_FONT_FAMILY, PNG_PRIMARY_FACE } from "./pngFonts.ts";
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
 *  out as constants for every caller to re-apply identically. Two call sites
 *  used to hand-assemble that recipe, with only one of the three facts checked
 *  and only after the scene existed; a scene built any other way is now
 *  unspellable rather than refused. */
export function buildPngScene(
  input: Omit<SceneInput, "fontFamily" | "cellW" | "cellH">,
): SnapshotScene {
  return buildScene({
    ...input,
    fontFamily: PNG_FONT_FAMILY,
    cellW: input.fontSize * PNG_CELL_WIDTH_RATIO,
    cellH: cellHeight(input.fontSize),
  });
}

let warm: Worker | undefined;

function retire(dead: Worker): void {
  if (warm === dead) warm = undefined;
}

function rasteriser(): Worker {
  if (warm) return warm;
  const created = new Worker(new URL("./pngWorker.ts", import.meta.url));
  created.unref();
  created.once("exit", () => retire(created));
  warm = created;
  return created;
}

const RASTERISE_DEADLINE_MS = 15_000;

function sendOne(svg: string): Promise<Uint8Array> {
  const worker = rasteriser();
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
      retire(worker);
      void worker.terminate();
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
      retire(worker);
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
      retire(worker);
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
    worker.postMessage({ svg, defaultFamily: PNG_PRIMARY_FACE });
  });
}

let lock: Promise<unknown> = Promise.resolve();

/** Render a scene to PNG bytes.
 *
 *  The scene's own `width`/`height` are the raster size — a scene is already
 *  in logical pixels and the daemon has no device pixel ratio to honour, so
 *  there is no scaling decision to make here.
 *
 *  Takes a scene from {@link buildPngScene}, and the family check below is a
 *  real validation rather than a belt-and-braces assertion. `buildScene` is a
 *  public export, so a caller CAN hand-assemble a scene with a font family of
 *  its own and bring it here — the module-private family list makes that the
 *  awkward path, not an impossible one. The check matters because the failure
 *  it names is silent: resvg falls back along the family list in the DOCUMENT,
 *  not along the order buffers were registered in, so another name renders
 *  tofu for every glyph the first face lacks while still producing a perfectly
 *  valid-looking PNG.
 *
 *  It runs HERE, on the main thread, before the hop: a document the guard
 *  would refuse never costs a thread hand-off.
 */
export async function sceneToPng(scene: SnapshotScene): Promise<Uint8Array> {
  if (scene.font.family !== PNG_FONT_FAMILY) {
    throw new Error(
      `terminal-snapshot: a PNG scene must come from buildPngScene, got font family "${scene.font.family}". resvg resolves fallbacks along the document's family list, so another name renders tofu for every glyph the first face lacks — and looks like a valid screenshot while doing it.`,
    );
  }
  const svg = sceneToSvg(scene);
  const rendered = lock.then(() => sendOne(svg));
  lock = rendered.then(
    () => undefined,
    () => undefined,
  );
  return await rendered;
}
