/// <reference path="./assets.d.ts" />

/** The parent side of the diagram renderer: one hidden, sandboxed iframe that
 *  runs mermaid, and a queue that sends it one source at a time.
 *
 *  Mermaid turns author-controlled text into markup and has shipped
 *  script-injection bugs in exactly that step. Kolu's page can type into
 *  terminals, so mermaid never runs here: it runs only inside the frame
 *  (./diagram-frame-program.js), and what comes back is treated as untrusted
 *  text that the page only ever shows as an `<img>` source (see ./sanitize).
 *  Never import `mermaid` into the page; the only reference is the asset URL
 *  of its prebuilt single file below.
 *
 *  The frame is `sandbox="allow-scripts"` and nothing else (an opaque origin:
 *  no access to kolu's DOM, cookies or storage), and its CSP allows no
 *  network. A `srcdoc` frame also inherits its parent's CSP. The app shell
 *  sends none today; a future shell policy must still allow what the frame
 *  needs: inline script, `blob:` script, inline style. */

import libraryUrl from "mermaid/dist/mermaid.min.js?url";
import frameProgram from "./diagram-frame-program.js?raw";

/** One drawn theme of a diagram: serialized SVG text plus its natural size. */
export type FrameImage = { svg: string; width: number; height: number };
export type FrameResult = { light: FrameImage; dark: FrameImage };

/** Mermaid rejected the source. Deterministic for a given text, so callers
 *  may remember it; every other rejection is the renderer itself failing. */
export class DiagramSyntaxError extends Error {
  override name = "DiagramSyntaxError";
}

// Gantt and timeline diagrams size themselves to the frame's width, so the
// frame is as wide as the document reading column (`max-w-3xl` minus its
// padding) — a diagram then fits the column it is shown in.
const FRAME_WIDTH_PX = 720;

/** How long the frame may take to start, boot, or answer one render. */
const DEADLINE_MS = 10_000;

const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'";

type FrameMessage =
  | { kind: "hello" }
  | { kind: "ready" }
  | { kind: "boot-error"; message: string }
  | ({ kind: "result"; id: number } & (
      | { ok: true; light: FrameImage; dark: FrameImage }
      | { ok: false; message: string }
    ));

type Frame = {
  /** Settles once mermaid is loaded in the frame; rejects if it never is. */
  ready: Promise<void>;
  ask(source: string): Promise<FrameResult>;
  dispose(): void;
};

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

/** Fetched by the page (same origin, same cookies as every other asset) and
 *  posted into the frame as text: a request from the opaque-origin frame
 *  would be cross-origin and fail behind cookie-authenticated proxies. */
async function fetchLibrary(): Promise<string> {
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
}

function isImage(value: unknown): value is FrameImage {
  const v = value as FrameImage | null;
  return (
    typeof v?.svg === "string" &&
    Number.isFinite(v.width) &&
    Number.isFinite(v.height)
  );
}

function createFrame(): Frame {
  const el = document.createElement("iframe");
  el.setAttribute("sandbox", "allow-scripts");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("tabindex", "-1");
  el.title = "Diagram renderer";
  // Off-screen but laid out: mermaid measures text, so `display: none` would
  // give it zero-sized labels.
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${FRAME_WIDTH_PX}px;height:800px;visibility:hidden;border:0`;
  el.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><body><script>${frameProgram}</script></body>`;

  const pending = new Map<
    number,
    (msg: FrameMessage & { kind: "result" }) => void
  >();
  const hello = Promise.withResolvers<void>();
  const booted = Promise.withResolvers<void>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== el.contentWindow) return;
    const msg = event.data as FrameMessage;
    if (msg?.kind === "hello") hello.resolve();
    else if (msg?.kind === "ready") booted.resolve();
    else if (msg?.kind === "boot-error") {
      booted.reject(
        new Error(`Diagram renderer failed to start: ${String(msg.message)}`),
      );
    } else if (msg?.kind === "result") pending.get(msg.id)?.(msg);
  };
  window.addEventListener("message", onMessage);
  document.body.append(el);

  const post = (message: unknown) =>
    el.contentWindow?.postMessage(message, "*");

  const ready = (async () => {
    const [library] = await Promise.all([
      fetchLibrary(),
      deadline(hello.promise, "start"),
    ]);
    post({ kind: "boot", library });
    await deadline(booted.promise, "load mermaid");
  })();

  let nextId = 0;
  return {
    ready,
    ask(source) {
      const id = nextId++;
      const answer = Promise.withResolvers<FrameResult>();
      pending.set(id, (msg) => {
        if (!msg.ok) answer.reject(new DiagramSyntaxError(String(msg.message)));
        else if (isImage(msg.light) && isImage(msg.dark)) {
          answer.resolve({ light: msg.light, dark: msg.dark });
        } else {
          answer.reject(new Error("Diagram renderer sent a malformed answer"));
        }
      });
      post({ kind: "render", id, source });
      return deadline(answer.promise, "draw this diagram").finally(() =>
        pending.delete(id),
      );
    },
    dispose() {
      window.removeEventListener("message", onMessage);
      el.remove();
    },
  };
}

/** The page's one frame, built on first use and kept for the page's life —
 *  unless it fails, in which case the next request builds a fresh one. */
let frame: Frame | undefined;
let queue: Promise<unknown> = Promise.resolve();

async function renderNow(source: string): Promise<FrameResult> {
  if (!frame) frame = createFrame();
  const current = frame;
  try {
    await current.ready;
    return await current.ask(source);
  } catch (err) {
    if (!(err instanceof DiagramSyntaxError)) {
      current.dispose();
      if (frame === current) frame = undefined;
    }
    throw err;
  }
}

/** Draw one mermaid source in the sandboxed frame, light then dark. Rejects
 *  with `DiagramSyntaxError` when mermaid rejects the text, or a plain `Error`
 *  saying why when the renderer itself failed (could not load, did not start,
 *  timed out). Requests are answered one at a time, in order. */
export function renderInFrame(source: string): Promise<FrameResult> {
  const run = queue.then(() => renderNow(source));
  queue = run.catch(() => undefined);
  return run;
}
