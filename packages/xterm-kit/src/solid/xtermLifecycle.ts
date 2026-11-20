import { WEB_URL_PATTERN } from "@kolu/url-shape";
import { getOwner, onCleanup, runWithOwner } from "solid-js";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITerminalOptions, Terminal as XTerm } from "@xterm/xterm";
import { patchTransformAwareMouseCoords } from "../internals";

/** The live terminal + the addons a consumer reaches back for (SearchBar reads
 *  `search`; an export path reads `serialize`). The other addons the lifecycle
 *  loads (web-links, unicode11, image) are fire-and-forget. Sizing is NOT an
 *  addon — `<Xterm>` measures the box itself; see `solid/grid.ts`. */
export interface XtermCore {
  terminal: XTerm;
  addons: { search: SearchAddon; serialize: SerializeAddon };
}

/** `terminalOptions` are xterm's own constructor options; `fontFamily` is
 *  required because the lifecycle awaits that face before constructing.
 *
 *  `webLinkHandler` is the injected click seam for {@link WebLinksAddon} —
 *  generic only (no app policy). When absent, the addon's default open runs.
 *  A consumer that wants to intercept loopback URLs (or anything else) passes
 *  its own handler; the kit never imports app code.
 *
 *  What COUNTS as a web link is not a seam: it is always `@kolu/url-shape`'s
 *  `WEB_URL_PATTERN`, so a consumer that reads URLs out of the buffer with that
 *  same pattern agrees with the underline by construction, not by remembering
 *  to pass it. */
export interface XtermLifecycleOptions {
  terminalOptions: ITerminalOptions & { fontFamily: string };
  /** Optional override for web-link activation. `(event, uri) => void`. */
  webLinkHandler?: (event: MouseEvent, uri: string) => void;
}

/** Construct an xterm `Terminal` into `container` once its font has loaded, then
 *  call `onReady` with the live handle — inside the captured reactive owner, so
 *  the consumer's teardown actually runs. Disposal (term + addon-slot nulling)
 *  is owned here; a `<Xterm>`-style composer layers WebGL/touch/scroll on top. */
export function createXtermLifecycle(
  getContainer: () => HTMLElement,
  getOptions: () => XtermLifecycleOptions,
  onReady: (core: XtermCore) => void,
): void {
  const owner = getOwner();
  let terminal: XTerm | null = null;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    terminal?.dispose();
    terminal = null;
  });

  void (async () => {
    try {
      const awaitedFontFamily = getOptions().terminalOptions.fontFamily;
      await document.fonts.load(`1em ${awaitedFontFamily}`);
      if (disposed) return;
      const container = getContainer();
      runWithOwner(owner, () => {
        const term = new XTerm({
          ...getOptions().terminalOptions,
          fontFamily: awaitedFontFamily,
        });
        terminal = term;

        term.loadAddon(
          new WebLinksAddon(getOptions().webLinkHandler, {
            urlRegex: WEB_URL_PATTERN,
          }),
        );
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

        onReady({ terminal: term, addons: { search, serialize } });
      });
    } catch (err) {
      console.error("createXtermLifecycle: setup failed:", err);
    }
  })();
}
