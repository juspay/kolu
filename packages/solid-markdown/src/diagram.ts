/** Mermaid source text → a drawn diagram (two images) or an error message,
 *  remembered so each distinct source is drawn once per page.
 *
 *  The drawing itself happens in the sandboxed frame (./diagram-frame); this
 *  layer only turns its answer into `data:` image URLs and decides what to
 *  remember. The SVG text is encoded here once and from then on travels only
 *  as an image URL — it is never parsed as markup in the page. */

import {
  DiagramSyntaxError,
  type FrameImage,
  type FrameResult,
  renderInFrame,
} from "./diagram-frame";

/** One theme of a drawn diagram. `src` is a `data:image/svg+xml` URL. */
export type DiagramImage = { src: string; width: number; height: number };
export type Diagram =
  | { ok: true; light: DiagramImage; dark: DiagramImage }
  | { ok: false; message: string };

export type DiagramCache = {
  /** Draw `source`, or answer what was remembered. Never rejects: every
   *  failure is an `{ ok: false }` result carrying the reason. */
  load(source: string): Promise<Diagram>;
  /** The remembered result, without drawing. */
  peek(source: string): Diagram | undefined;
};

/** How many distinct sources are remembered. Each `<Markdown>` keeps the
 *  results it is showing, so eviction never blanks a diagram on screen; it
 *  only means a long-gone diagram is drawn again if it comes back. */
const REMEMBERED = 64;

function asImage(image: FrameImage): DiagramImage {
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`,
    width: image.width,
    height: image.height,
  };
}

/** The caching rules, separated from the frame so they are testable without a
 *  browser:
 *  - a drawn diagram and a syntax error are remembered (same text, same
 *    answer);
 *  - a renderer failure (could not load, timed out) is NOT remembered, so the
 *    next time a document asks, it is tried again;
 *  - concurrent loads of one source share one render. */
export function createDiagramCache(
  render: (source: string) => Promise<FrameResult>,
): DiagramCache {
  const settled = new Map<string, Diagram>();
  const inflight = new Map<string, Promise<Diagram>>();

  const remember = (source: string, diagram: Diagram) => {
    settled.delete(source);
    settled.set(source, diagram);
    if (settled.size > REMEMBERED) {
      const oldest = settled.keys().next().value;
      if (oldest !== undefined) settled.delete(oldest);
    }
  };

  return {
    peek: (source) => settled.get(source),
    load(source) {
      const known = settled.get(source);
      if (known) return Promise.resolve(known);
      const running = inflight.get(source);
      if (running) return running;
      const result = render(source)
        .then(
          (drawn): Diagram => {
            const diagram: Diagram = {
              ok: true,
              light: asImage(drawn.light),
              dark: asImage(drawn.dark),
            };
            remember(source, diagram);
            return diagram;
          },
          (err: unknown): Diagram => {
            const diagram: Diagram = {
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            };
            if (err instanceof DiagramSyntaxError) remember(source, diagram);
            return diagram;
          },
        )
        .finally(() => inflight.delete(source));
      inflight.set(source, result);
      return result;
    },
  };
}

/** The page's diagram cache, drawing in the sandboxed frame. */
export const diagrams = createDiagramCache(renderInFrame);
