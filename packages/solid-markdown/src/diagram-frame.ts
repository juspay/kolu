/// <reference path="./assets.d.ts" />

import libraryUrl from "mermaid/dist/mermaid.min.js?url";
import frameProgram from "./diagram-frame-program.js?raw";

export type FrameImage = { svg: string; width: number; height: number };
export type FrameResult = { light: FrameImage; dark: FrameImage };

export class DiagramSyntaxError extends Error {
  override name = "DiagramSyntaxError";
}

const RENDERER_FRAME_ATTR = "data-md-diagram-renderer";

const FRAME_WIDTH_PX = 720;

const MAX_FRAMES = 3;

const DEADLINE_MS = 10_000;

const MAX_DIAGRAM_SIDE_PX = 16_384;

const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'";

type FrameMessage =
  | { kind: "hello" }
  | { kind: "boot-error"; message: string }
  | ({ kind: "result" } & (
      | { ok: true; light: unknown; dark: unknown }
      | { ok: false; message: string }
    ));

function deadline<T>(work: Promise<T>, what: string): Promise<T> {
  const expired = Promise.withResolvers<never>();
  const timer = setTimeout(
    () =>
      expired.reject(
        new Error(
          `Diagram renderer did not ${what} within ${DEADLINE_MS / 1000} s`,
        ),
      ),
    DEADLINE_MS,
  );
  return Promise.race([work, expired.promise]).finally(() =>
    clearTimeout(timer),
  );
}

export function parseFrameImage(value: unknown): FrameImage | undefined {
  const v = value as Partial<FrameImage> | null;
  const side = (n: unknown): n is number =>
    Number.isInteger(n) &&
    (n as number) >= 1 &&
    (n as number) <= MAX_DIAGRAM_SIDE_PX;
  if (typeof v?.svg !== "string" || !side(v.width) || !side(v.height)) {
    return undefined;
  }
  return { svg: v.svg, width: v.width, height: v.height };
}

/** Mermaid's single file, fetched by the page (same origin, same cookies as
 *  every other asset) and posted into each frame as text: a request from the
 *  opaque-origin frame would be cross-origin and fail behind
 *  cookie-authenticated proxies. */
let library: Promise<string> | undefined;

function fetchLibrary(): Promise<string> {
  if (!library) {
    library = (async () => {
      let response: Response;
      try {
        response = await fetch(libraryUrl);
      } catch (err) {
        throw new Error(
          `Diagram renderer could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `Diagram renderer could not be loaded: HTTP ${response.status}`,
        );
      }
      return response.text();
    })();
    library.catch(() => {
      library = undefined;
    });
  }
  return library;
}

function createFrame(): HTMLIFrameElement {
  const el = document.createElement("iframe");
  el.setAttribute("sandbox", "allow-scripts");
  el.setAttribute(RENDERER_FRAME_ATTR, "");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("tabindex", "-1");
  el.title = "Diagram renderer";
  // Off-screen but laid out: mermaid measures text, so `display: none` would
  // give it zero-sized labels.
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${FRAME_WIDTH_PX}px;height:800px;visibility:hidden;border:0`;
  el.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><body><script>${frameProgram}</script></body>`;
  return el;
}

type FrameChannel = {
  hello: Promise<void>;
  answer: Promise<FrameResult>;
  close: () => void;
};

function awaitAnswer(el: HTMLIFrameElement): FrameChannel {
  const hello = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<FrameResult>();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== el.contentWindow) return;
    const msg = event.data as FrameMessage;
    if (msg?.kind === "hello") hello.resolve();
    else if (msg?.kind === "boot-error") {
      answer.reject(
        new Error(`Diagram renderer failed to start: ${String(msg.message)}`),
      );
    } else if (msg?.kind === "result") {
      if (!msg.ok) {
        answer.reject(new DiagramSyntaxError(String(msg.message)));
        return;
      }
      const light = parseFrameImage(msg.light);
      const dark = parseFrameImage(msg.dark);
      if (light && dark) answer.resolve({ light, dark });
      else answer.reject(new Error("Diagram renderer sent a malformed answer"));
    }
  };
  window.addEventListener("message", onMessage);
  return {
    hello: hello.promise,
    answer: answer.promise,
    close: () => window.removeEventListener("message", onMessage),
  };
}

async function drawInNewFrame(source: string): Promise<FrameResult> {
  const el = createFrame();
  const channel = awaitAnswer(el);
  const destroy = () => {
    channel.close();
    el.remove();
  };
  document.body.append(el);
  try {
    const [text] = await Promise.all([
      fetchLibrary(),
      deadline(channel.hello, "start"),
    ]);
    el.contentWindow?.postMessage({ kind: "draw", library: text, source }, "*");
    return await deadline(channel.answer, "draw this diagram");
  } finally {
    destroy();
  }
}

let busy = 0;
const waiting: (() => void)[] = [];

async function withFrameSlot<T>(work: () => Promise<T>): Promise<T> {
  if (busy >= MAX_FRAMES) {
    const turn = Promise.withResolvers<void>();
    waiting.push(turn.resolve);
    await turn.promise;
  } else busy += 1;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else busy -= 1;
  }
}

export function renderInFrame(source: string): Promise<FrameResult> {
  return withFrameSlot(() => drawInNewFrame(source));
}
