import {
  DiagramSyntaxError,
  type FrameImage,
  type FrameResult,
  renderInFrame,
} from "./diagram-frame";

export type DiagramImage = { src: string; width: number; height: number };
export type Diagram =
  | { ok: true; light: DiagramImage; dark: DiagramImage }
  | { ok: false; message: string };

export type DiagramCache = {
  load(source: string): Promise<Diagram>;
  peek(source: string): Diagram | undefined;
};

const REMEMBERED = 64;

function asImage(image: FrameImage): DiagramImage {
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`,
    width: image.width,
    height: image.height,
  };
}

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

export const diagrams = createDiagramCache(renderInFrame);
