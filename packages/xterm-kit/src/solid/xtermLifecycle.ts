/** Owner-correct async construction + disposal of an xterm `Terminal`.
 *
 *  Construction must await the terminal font before measuring cell dimensions —
 *  otherwise xterm measures with the fallback monospace face and every metric is
 *  wrong. But SolidJS loses its reactive owner across any `await`, so a cleanup
 *  registered after it is a silent no-op — which is exactly how kolu leaked whole
 *  xterm graphs (InputHandler + BufferLines, ~900 KB) per mode toggle
 *  (#591/#606). This owns the one safe shape:
 *
 *   1. capture the owner BEFORE the await;
 *   2. register the disposal `onCleanup` SYNCHRONOUSLY (before the async body),
 *      so a dispose during the font await still tears the terminal down;
 *   3. bail on the `disposed` flag after the await rather than build state no
 *      cleanup can reach;
 *   4. re-enter the owner with `runWithOwner` for the synchronous setup, so every
 *      primitive there (and the consumer's `onReady` wiring) registers its
 *      cleanups on the right list.
 *
 *  The consumer's policy — which addons beyond these, the stream, keybindings,
 *  the `__xterm` e2e bridge — is wired in `onReady`, inside that owner. */

import { getOwner, onCleanup, runWithOwner } from "solid-js";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITerminalOptions, Terminal as XTerm } from "@xterm/xterm";
import { patchTransformAwareMouseCoords } from "../internals";

/** The live terminal + the addons a consumer reaches back for (SearchBar reads
 *  `search`; an export path reads `serialize`; refit drives `fit`). The other
 *  addons the lifecycle loads (web-links, unicode11, image) are fire-and-forget. */
export interface XtermCore {
  terminal: XTerm;
  addons: { fit: FitAddon; search: SearchAddon; serialize: SerializeAddon };
}

/** `terminalOptions` are xterm's own constructor options; `fontFamily` is
 *  required because the lifecycle awaits that face before constructing. */
export interface XtermLifecycleOptions {
  terminalOptions: ITerminalOptions & { fontFamily: string };
}

/** Construct an xterm `Terminal` into `container` once its font has loaded, then
 *  call `onReady` with the live handle — inside the captured reactive owner, so
 *  the consumer's teardown actually runs. Disposal (term + addon-slot nulling)
 *  is owned here; a `<Xterm>`-style composer layers WebGL/touch/scroll on top. */
export function createXtermLifecycle(
  /** Read lazily — the mount element is assigned by its `ref` AFTER this runs in
   *  the component body, but is present by the time the post-await body reads it
   *  (the div mounts synchronously before the font `await` resolves). */
  getContainer: () => HTMLElement,
  /** Read lazily too, and specifically re-read AFTER the font await for
   *  construction — so a reactive `theme`/`fontSize` that changed while the font
   *  was loading constructs the terminal with the LATEST value, not a snapshot
   *  taken at call time (which the deferred live-update effects would then miss,
   *  having already fired-and-bailed while `core` was still null). */
  getOptions: () => XtermLifecycleOptions,
  onReady: (core: XtermCore) => void,
): void {
  const owner = getOwner();
  let terminal: XTerm | null = null;
  let disposed = false;

  // SYNCHRONOUS — registered before the async body, so a dispose during the font
  // await (an <Show> tile swap) still fires. `term.dispose()` disposes every
  // addon loaded below; the addons are otherwise reachable only through the
  // handle the consumer holds (and nulls in its own cleanup), so this owns no
  // separate addon slots. WebGL unload (attachWebGL's own onCleanup, registered
  // LATER in onReady) runs FIRST by SolidJS LIFO, matching the old inline
  // "unloadWebgl() before terminal.dispose()".
  onCleanup(() => {
    disposed = true;
    terminal?.dispose();
    terminal = null;
  });

  void (async () => {
    try {
      // fontFamily is static (the awaited face); read it eagerly for the load.
      await document.fonts.load(
        `1em ${getOptions().terminalOptions.fontFamily}`,
      );
      if (disposed) return;
      const container = getContainer();
      runWithOwner(owner, () => {
        // Re-read here (post-await) so reactive theme/fontSize are current, not
        // the value they held when the component body called us.
        const term = new XTerm(getOptions().terminalOptions);
        terminal = term;

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        const search = new SearchAddon();
        term.loadAddon(search);
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
        term.loadAddon(new ImageAddon());
        const serialize = new SerializeAddon();
        term.loadAddon(serialize);

        term.open(container);
        // Canvas tiles render xterm inside a CSS scale(zoom); teach xterm's
        // hit-testing to inverse it so selection / link hover / mouse reporting
        // land on the right cell (#1400). Must follow open() — that constructs
        // _core._mouseCoordsService. Strict no-op for untransformed terminals.
        patchTransformAwareMouseCoords(term);

        onReady({ terminal: term, addons: { fit, search, serialize } });
      });
    } catch (err) {
      console.error("createXtermLifecycle: setup failed:", err);
    }
  })();
}
