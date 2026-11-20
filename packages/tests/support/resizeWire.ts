/**
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
 */

import type { Page } from "playwright";

const FRAME_CAP = 400;

const FRAME_HEAD = 600;

const RECEIVED_KEY = "__koluWsReceived";

const INSTALLED_KEY = "__koluResizeProbeInstalled";

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

export async function installResizeWireProbe(page: Page): Promise<void> {
  await page.addInitScript({ content: PROBE_SOURCE });
  await page.evaluate(PROBE_SOURCE);
}

async function readResizeWire(
  page: Page,
  terminalIds: readonly string[],
): Promise<{ sent: string[]; received: string[] }> {
  return page.evaluate(
    ({ ids, key }) => {
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

export async function readPanelWrites(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window.__wsSent ?? []).filter((frame) => frame.includes("setSubPanel")),
  );
}

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
