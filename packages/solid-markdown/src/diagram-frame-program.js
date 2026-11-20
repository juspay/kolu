let asked = false;

/** Post to the parent. The frame's own origin is opaque, and the parent's
 *  origin is not observable from in here, hence `"*"`; nothing secret leaves. */
function reply(message) {
  parent.postMessage(message, "*");
}

/** Load mermaid from the posted text. It cannot be inlined into `srcdoc`
 *  (the file holds an HTML comment opener, which breaks an inline script), and
 *  the frame cannot fetch kolu's asset URL itself (a request from an opaque
 *  origin is cross-origin), so the parent fetches it and the frame runs it
 *  from a Blob. */
function boot(library) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = URL.createObjectURL(
      new Blob([library], { type: "text/javascript" }),
    );
    script.onload = () =>
      typeof mermaid === "undefined"
        ? reject(new Error("the renderer script ran but defined no `mermaid`"))
        : resolve();
    script.onerror = () =>
      reject(new Error("the renderer script failed to run"));
    document.head.append(script);
  });
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
  const { svg } = await mermaid.render(`kolu-diagram-${theme}`, source);
  return sized(svg);
}

async function draw(library, source) {
  try {
    await boot(library);
  } catch (err) {
    reply({ kind: "boot-error", message: String(err?.message ?? err) });
    return;
  }
  try {
    const light = await renderTheme(source, "default");
    const dark = await renderTheme(source, "dark");
    reply({ kind: "result", ok: true, light, dark });
  } catch (err) {
    const message =
      err && typeof err.message === "string" ? err.message : String(err);
    reply({ kind: "result", ok: false, message });
  }
}

addEventListener("message", (event) => {
  if (event.source !== parent || asked) return;
  const msg = event.data;
  if (
    msg?.kind === "draw" &&
    typeof msg.library === "string" &&
    typeof msg.source === "string"
  ) {
    asked = true;
    void draw(msg.library, msg.source);
  }
});

reply({ kind: "hello" });
