/**
 * The DIAGNOSTIC half of the size instrument: what crossed the socket, and
 * when.
 *
 * `winsizeRecorder.ts` answers WHAT a program was told. When a scenario goes
 * red, the next question is WHY — which fact arrived after the pane's first
 * measurement and moved its box. The cheapest honest evidence for that is the
 * wire itself: every frame the page sends (the attach with its `resizeTo`, the
 * `lifecycle.resize` a settled publish fires) and a bounded summary of every
 * frame it receives (a terminal record arriving a beat late), each stamped
 * with the page's own clock.
 *
 * Installed TWICE and as SOURCE TEXT, and both are deliberate:
 *
 *  - as an `addInitScript` (every future document, which is what a reload
 *    lands in — the mount after a reload is the moment under measurement) and
 *    into the document already open (which is what a scenario with no reload
 *    measures);
 *  - as a STRING rather than a function, because this suite runs through
 *    `tsx`. esbuild's `keepNames` wraps a named function in its own `__name`
 *    helper, and `page.evaluate(fn)` ships `fn.toString()` to a browser where
 *    that helper does not exist — `ReferenceError: __name is not defined`,
 *    measured on CI. Inline anonymous callbacks (everywhere else in this
 *    suite) are untouched by that transform; a named one must travel as text.
 *
 * `window.__wsSent` is the e2e harness's existing stash for outgoing frames
 * (`kolu-common/test-hooks`); entries here carry a
 * milliseconds-since-document-load prefix so a reader can line them up with
 * the record.
 *
 * Observation only: both patches forward to the original implementation
 * untouched, and nothing in this file is read unless a step asks for it.
 */

import type { Page } from "playwright";

/** How many frames each direction keeps. A reload loop can send thousands;
 *  the answer to "what moved the box" is in the last few hundred. */
const FRAME_CAP = 400;

/** How much of one frame is kept. A snapshot frame is megabytes and says
 *  nothing this probe is for; this is enough for the tag, the ids and a small
 *  payload — a `chrome.setSubPanel` write carries its whole state in that
 *  much, which is what makes a panel-state write readable beside the resize
 *  it rode in with. */
const FRAME_HEAD = 600;

/** Where INCOMING frames land. `__wsSent` is a declared test hook; its
 *  inbound sibling is not, and this file must not reach into the product's
 *  type surface to add one. */
const RECEIVED_KEY = "__koluWsReceived";

/** The flag that keeps a second install in ONE document from double-wrapping
 *  `send` (which would record every outgoing frame twice). A reload is a
 *  fresh document, so it never blocks the install that matters. */
const INSTALLED_KEY = "__koluResizeProbeInstalled";

/** The probe, as the text a browser runs. */
const PROBE_SOURCE = `(() => {
  if (window[${JSON.stringify(INSTALLED_KEY)}]) return;
  window[${JSON.stringify(INSTALLED_KEY)}] = true;
  var cap = ${FRAME_CAP};
  var head = ${FRAME_HEAD};
  var sent = [];
  var received = [];
  window.__wsSent = sent;
  window[${JSON.stringify(RECEIVED_KEY)}] = received;
  var push = function (into, data) {
    into.push(Math.round(performance.now()) + " " + data.slice(0, head));
    if (into.length > cap) into.splice(0, into.length - cap);
  };
  var origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string") push(sent, data);
    return origSend.call(this, data);
  };
  var Native = window.WebSocket;
  var Patched = function (url, protocols) {
    var socket = new Native(url, protocols);
    socket.addEventListener("message", function (event) {
      if (typeof event.data === "string") push(received, event.data);
    });
    return socket;
  };
  Patched.prototype = Native.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (name) {
    Object.defineProperty(Patched, name, { value: Native[name] });
  });
  window.WebSocket = Patched;
})()`;

/** Install the probe for the rest of the page's life, reload included. */
export async function installResizeWireProbe(page: Page): Promise<void> {
  await page.addInitScript({ content: PROBE_SOURCE });
  await page.evaluate(PROBE_SOURCE);
}

/** What the probe saw, filtered to the frames that decide a pane's box.
 *
 *  Sent: anything naming `resizeTo` (an attach, which IS a write), the
 *  `resize` procedure (a settled publish), or `setSubPanel` (the panel state
 *  a mount can write BACK — a split's share of the tile is half of what its
 *  main pane measures, so a write to it belongs on the same timeline as the
 *  resize it caused). Received: anything naming the terminal whose size
 *  moved, or carrying panel state — a record arrival is the candidate late
 *  input these scenarios are hunting. */
export async function readResizeWire(
  page: Page,
  terminalIds: readonly string[],
): Promise<{ sent: string[]; received: string[] }> {
  return page.evaluate(
    ({ ids, key }) => {
      // The e2e harness's own window, carrying a global the probe installed.
      // Unchecked by necessity: TypeScript has no declaration for a name this
      // file writes at runtime.
      const probed = window as unknown as Record<string, string[] | undefined>;
      return {
        sent: (window.__wsSent ?? []).filter(
          (frame) =>
            frame.includes("resizeTo") ||
            frame.includes("resize") ||
            frame.includes("setSubPanel"),
        ),
        received: (probed[key] ?? []).filter(
          (frame) =>
            frame.includes("subPanel") || ids.some((id) => frame.includes(id)),
        ),
      };
    },
    { ids: [...terminalIds], key: RECEIVED_KEY },
  );
}

/** Every `chrome.setSubPanel` this document has SENT — the split's saved state
 *  being written.
 *
 *  Only a user's gesture may produce one. A mount that writes it is the defect
 *  measured in kolu#2362: the first mount after a collapse wrote the default
 *  `collapsed: false` back over it, and the collapse was gone for good. The
 *  probe's stash is per-document, so what this answers after a reload is "did
 *  THIS mount write it", which is exactly the question. */
export async function readPanelWrites(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window.__wsSent ?? []).filter((frame) => frame.includes("setSubPanel")),
  );
}

/** How many attach streams this document has opened per terminal.
 *
 *  A pane opens one when it becomes shown, and again after it is REBUILT — so a
 *  count that grows while nothing was hidden is a remount, which costs the
 *  reader a fresh snapshot and their place in the output. Counted off the
 *  probe's own stash, which is per-document, so a reload is not mistaken for
 *  one. */
export async function readAttachCounts(
  page: Page,
  terminalIds: readonly string[],
): Promise<Record<string, number>> {
  return page.evaluate(
    (ids) => {
      const sent = window.__wsSent ?? [];
      const counts: Record<string, number> = {};
      for (const id of ids) {
        counts[id] = sent.filter(
          (frame) => frame.includes("terminalAttach") && frame.includes(id),
        ).length;
      }
      return counts;
    },
    [...terminalIds],
  );
}

/** The probe's reading as a quoted block for a failure message. */
export async function quoteResizeWire(
  page: Page,
  terminalIds: readonly string[],
): Promise<string> {
  const { sent, received } = await readResizeWire(page, terminalIds);
  const quote = (what: string, frames: string[]) =>
    frames.length === 0
      ? `  ${what}: (none)`
      : [`  ${what}:`, ...frames.slice(-12).map((f) => `    ${f}`)].join("\n");
  return [
    quote("sent (grid writes, ms since this document loaded)", sent),
    quote("received (frames naming these terminals)", received),
  ].join("\n");
}
