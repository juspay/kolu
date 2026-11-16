// The program that runs INSIDE the sandboxed diagram frame (see
// ./diagram-frame.ts, which inlines this file into the frame's `srcdoc` as
// text). It is the only code that ever calls mermaid, and it never touches
// kolu's page: the frame is `sandbox="allow-scripts"` (an opaque origin, no
// access to the parent's DOM or storage) under a CSP with no network.
//
// Protocol, parent ⇄ frame (every message is checked against its sender):
//   frame  → { kind: "hello" }                 the program is running
//   parent → { kind: "boot", library }         mermaid's single-file build, as text
//   frame  → { kind: "ready" } | { kind: "boot-error", message }
//   parent → { kind: "render", id, source }
//   frame  → { kind: "result", id, ok: true, light, dark }
//          | { kind: "result", id, ok: false, message }
//
// Plain JavaScript on purpose: it is shipped verbatim, never bundled.

/* global mermaid */

// One request at a time: mermaid keeps global state (its config, the scratch
// element it measures text in), so two overlapping renders would trample it.
let queue = Promise.resolve();
let renderSeq = 0;

/** Post to the parent. The frame's own origin is opaque, and the parent's
 *  origin is not observable from in here, hence `"*"`; nothing secret leaves. */
function reply(message) {
  parent.postMessage(message, "*");
}

/** Load mermaid from the posted text. It cannot be inlined into `srcdoc`
 *  (the file holds an HTML comment opener, which breaks an inline script —
 *  and is why this file must never contain one either), and the frame
 *  cannot fetch kolu's asset URL itself (a request from an opaque origin is
 *  cross-origin), so the parent fetches it and the frame runs it from a Blob. */
function boot(library) {
  const script = document.createElement("script");
  script.src = URL.createObjectURL(
    new Blob([library], { type: "text/javascript" }),
  );
  script.onload = () => {
    if (typeof mermaid === "undefined") {
      reply({
        kind: "boot-error",
        message: "the renderer script ran but defined no `mermaid`",
      });
      return;
    }
    reply({ kind: "ready" });
  };
  script.onerror = () =>
    reply({ kind: "boot-error", message: "the renderer script failed to run" });
  document.head.append(script);
}

/** Give the SVG a natural size and serialize it. Mermaid emits
 *  `width="100%"` plus an inline `max-width`, which leaves an `<img>` with no
 *  intrinsic size; the `viewBox` is the real drawing size. */
function sized(svgText) {
  const tpl = document.createElement("template");
  tpl.innerHTML = svgText;
  const svg = tpl.content.querySelector("svg");
  if (!svg) throw new Error("mermaid returned no <svg> element");
  const box = svg.viewBox.baseVal;
  const width = Math.ceil(box?.width ?? 0);
  const height = Math.ceil(box?.height ?? 0);
  if (!(width > 0 && height > 0)) {
    throw new Error("mermaid returned a drawing with no size");
  }
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.removeProperty("max-width");
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

async function renderTheme(source, theme) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    fontFamily: "system-ui, sans-serif",
    theme,
  });
  renderSeq += 1;
  const { svg } = await mermaid.render(`kolu-diagram-${renderSeq}`, source);
  return sized(svg);
}

async function render(id, source) {
  try {
    // Light first, then dark: the page shows one or the other by its `.dark`
    // class, so a theme switch never re-renders.
    const light = await renderTheme(source, "default");
    const dark = await renderTheme(source, "dark");
    reply({ kind: "result", id, ok: true, light, dark });
  } catch (err) {
    const message =
      err && typeof err.message === "string" ? err.message : String(err);
    reply({ kind: "result", id, ok: false, message });
  }
}

addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const msg = event.data;
  if (msg?.kind === "boot" && typeof msg.library === "string") {
    boot(msg.library);
  } else if (
    msg?.kind === "render" &&
    typeof msg.id === "number" &&
    typeof msg.source === "string"
  ) {
    queue = queue.then(() => render(msg.id, msg.source));
  }
});

reply({ kind: "hello" });
