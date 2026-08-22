/** Rasterise a {@link SnapshotScene} to a PNG, off the browser.
 *
 *  The node half of the package — kept behind its own `terminal-snapshot/png`
 *  export so the browser, which has a canvas and needs none of this, never
 *  pulls the wasm rasteriser or the font reads into its bundle.
 *
 *  `@resvg/resvg-wasm` (not `@resvg/resvg-js`, not `@napi-rs/canvas`)
 *  because the daemon ships as TypeScript sources run from the Nix store: a
 *  prebuilt native `.node` binary would need a per-platform artifact in a
 *  tree that builds for x86_64-linux and aarch64-darwin from one lockfile,
 *  where a `.wasm` is the same bytes everywhere.
 *
 *  This module owns the DOCUMENT — the font stack, the cell advance, the
 *  scene-to-SVG build and the guard that a scene came from
 *  {@link buildPngScene}. It does not own the rasteriser: that is
 *  {@link ./pngWorker.ts}, on a thread of its own, because the wasm region is
 *  synchronous and long enough to freeze padi's event loop. See that file for
 *  the measurements and the font closure. */

import { Worker } from "node:worker_threads";
import type { PngRasteriseReply } from "./pngWorker.ts";
import {
  buildScene,
  cellHeight,
  type SceneInput,
  type SnapshotScene,
} from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

/** The face every other is a fallback for — named once, and spelled into
 *  {@link PNG_FONT_FAMILY}'s head rather than beside it, so the two cannot
 *  drift. */
const PRIMARY_FACE = "FiraCode Nerd Font Mono";

/** The font family list every glyph is drawn with, most-specific first.
 *
 *  A scene rendered to PNG MUST carry this exact list: resvg falls back along
 *  the family list in the DOCUMENT, not along the order buffers were
 *  registered in. A scene built with a bare `"FiraCode Nerd Font"` renders
 *  tofu for every glyph FiraCode lacks even though the fallback faces are
 *  loaded — measured, not assumed.
 *
 *  MODULE-PRIVATE on purpose: it is applied by {@link buildPngScene}, so a
 *  caller never has to remember to apply it (and cannot get it wrong). */
const PNG_FONT_FAMILY = [
  PRIMARY_FACE,
  "Symbols Nerd Font Mono",
  "DejaVu Sans Mono",
  "Noto Sans Symbols 2",
  "Noto Sans Symbols",
].join(", ");

/** Advance width of one cell as a fraction of the font size, for FiraCode.
 *  The daemon has no `measureText`, and this ratio is a property of the
 *  typeface (600/1000 em by its own metrics, which every FiraCode face
 *  shares), so it is a constant here rather than a per-render measurement.
 *  Module-private for the same reason as {@link PNG_FONT_FAMILY}. */
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

/** The warm rasteriser thread, or none yet.
 *
 *  LAZY: created by the first screenshot, never at import or daemon boot — a
 *  padi that is never asked for a picture pays neither the thread nor the
 *  ~12 MB the wasm and the faces take. KEPT WARM: one thread serves every
 *  later screenshot, so `initWasm` and the ~9 MB font read are paid once.
 *
 *  REPLACEABLE, and that is the subtle half. `initWasm` throws "Already
 *  initialized" if it is ever called twice, which used to make a cleared memo
 *  a trap: a font read that failed after the wasm was up cleared the whole
 *  memo, and every later screenshot re-entered `initWasm` and died reporting a
 *  wasm problem for a missing file. A THREAD is the right granularity for that
 *  memo precisely because it makes the trap unspellable — a fresh thread is a
 *  fresh module registry, so re-taking `initWasm` there is not a second call
 *  at all. A dead thread is therefore forgotten (see {@link retire}) and the
 *  next screenshot gets a new one, rather than poisoning the process. */
let warm: Worker | undefined;

/** Forget a thread that has died, unless a newer one has already replaced it. */
function retire(dead: Worker): void {
  if (warm === dead) warm = undefined;
}

function rasteriser(): Worker {
  if (warm) return warm;
  // `import.meta.url`-relative, the way the wasm itself is resolved: the
  // daemon runs TypeScript straight from the Nix store under a tsx loader, so
  // the sibling `.ts` file IS the artifact — there is no bundle step that
  // could have rewritten this path.
  const created = new Worker(new URL("./pngWorker.ts", import.meta.url));
  // A screenshot must never be the reason a daemon refuses to exit. The
  // thread is unref'd while idle and ref'd only for the window a render is
  // actually in flight (see {@link sendOne}) — so a shutting-down padi is
  // held open by a picture it is still drawing, and by nothing else.
  created.unref();
  created.once("exit", () => retire(created));
  warm = created;
  return created;
}

/** How long ONE rasterise may take before the thread is presumed WEDGED.
 *
 *  Six times the slowest render this subsystem can legally be asked for: 2,482
 *  ms, measured at the row cap (see {@link ./pngWorker.ts} for the numbers, and
 *  kaval's `SCREEN_CELLS_MAX_ROWS` for what holds that ceiling still). The
 *  margin is for a loaded box — a daemon sharing a core with a build — not for
 *  a bigger picture: nothing legal draws more cells than that, so a document
 *  still in flight at 15 s is not slow, it is stuck.
 *
 *  A DEADLINE rather than a knob, and it is not a fallback either: the caller
 *  is told its screenshot failed. What it buys is that the failure costs ONE
 *  screenshot. Without it, a synchronous wasm region that never returns settles
 *  nothing — {@link lock} chains off the same promise, so every later
 *  screenshot queues behind a render that will never finish, and the `ref()`
 *  below holds the daemon open at exit for the life of the process. */
const RASTERISE_DEADLINE_MS = 15_000;

/** Hand ONE document to the warm thread and await its reply.
 *
 *  Every failure path is loud and named — there is no main-thread rasterise to
 *  fall back to, because a screenshot that silently took 2.5 s of the daemon's
 *  event loop is the defect this module exists to remove, not a degraded mode
 *  worth keeping. */
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
      // TERMINATE, not just reject: the thread is inside an uninterruptible
      // synchronous wasm region, so there is nothing to cancel and no way to
      // know what it would eventually post. Killing it is what makes the
      // recovery real — `retire` here (rather than waiting for the async `exit`
      // this kill will raise) means a screenshot arriving in the meantime is
      // never handed the corpse, and the next one builds a fresh thread with a
      // fresh wasm registry, exactly as the death paths below do.
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
    // The ref'd WORKER is the one thing that says "a render is in flight"; this
    // timer must not become a second one holding a shutting-down daemon open.
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
    worker.postMessage({ svg, defaultFamily: PRIMARY_FACE });
  });
}

/** The lock that keeps ONE document in flight on the one warm thread.
 *
 *  Serialised rather than correlated by request id, because the rasterise is
 *  SYNCHRONOUS inside the worker: two outstanding ids would still execute one
 *  after the other on that thread, so correlation buys interleaved bookkeeping
 *  and not one millisecond of wall clock. One in-flight message also makes the
 *  death path exact — a thread that dies has exactly one caller to tell, and
 *  no reply can ever arrive against a request that is already gone.
 *
 *  Always a resolved-or-resolving promise, never a rejecting one: a screenshot
 *  that fails must not fail the screenshot queued behind it. */
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
  // `sceneToSvg` stays on the main thread on purpose: 2–29 ms of string
  // building is not worth a hop, and it keeps the seam a plain string.
  const svg = sceneToSvg(scene);
  const rendered = lock.then(() => sendOne(svg));
  lock = rendered.then(
    () => undefined,
    () => undefined,
  );
  return await rendered;
}
